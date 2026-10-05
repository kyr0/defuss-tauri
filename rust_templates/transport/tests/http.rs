//! Real loopback sockets and real disk sources; no mocked transport.
use defuss_tauri_transport::{normalize_path, parse_range, AssetSource, ServerOptions, Transport};
use std::{collections::BTreeMap, fs, io::{Read, Write}, net::{TcpListener, TcpStream}, path::PathBuf, sync::atomic::{AtomicU64, Ordering}, thread, time::Duration};
static SERIAL: AtomicU64 = AtomicU64::new(0);
static FILES: &[(&str, &[u8])] = &[("index.html", b"<h1>hello</h1>"), ("sw.js", b"worker"), ("movie.bin", b"0123456789"), ("nested/index.html", b"nested"), ("space name.js", b"javascript")];
struct Temp(PathBuf);
impl Temp { fn new() -> Self { let path = std::env::temp_dir().join(format!("defuss-transport-{}-{}", std::process::id(), SERIAL.fetch_add(1, Ordering::Relaxed))); fs::create_dir(&path).unwrap(); Self(path) } }
impl Drop for Temp { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
fn options() -> ServerOptions { ServerOptions { entry: "index.html".into(), spa: true, headers: BTreeMap::from([("Cross-Origin-Opener-Policy".into(), "same-origin".into())]) } }
fn start(profile: &Temp) -> Transport { Transport::start(AssetSource::embedded(FILES).unwrap(), options(), &profile.0, None).unwrap() }
fn request(server: &Transport, method: &str, path: &str, headers: &str) -> String {
    let authority = server.origin().trim_start_matches("http://").to_string();
    let mut socket = TcpStream::connect(&authority).unwrap(); socket.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
    write!(socket, "{method} {path} HTTP/1.1\r\nHost: {authority}\r\nConnection: close\r\n{headers}\r\n").unwrap();
    let mut result = String::new(); socket.read_to_string(&mut result).unwrap(); result
}
#[test]
fn paths_and_ranges_are_bounded() {
    assert_eq!(normalize_path("/space%20name.js?x=1"), Ok("space name.js".into()));
    for path in ["/../x", "/%2e%2e/x", "/x%5cy", "/%00", "/%GG", "//evil/x", "/C:/x", "/%FF"] { assert!(normalize_path(path).is_err(), "{path}"); }
    for (input, expected) in [("bytes=2-4",(2,4)),("bytes=8-",(8,9)),("bytes=-3",(7,9)),("bytes=0-100",(0,9)),("bytes=-100",(0,9))] { assert_eq!(parse_range(input,10),Ok(expected)); }
    for input in ["bytes=20-", "bytes=3-2", "bytes=-0", "bytes=0-1,2-3", "items=0-2", "bytes=a-b"] { assert_eq!(parse_range(input,10),Err(416)); }
    assert_eq!(parse_range("bytes=0-0",0),Err(416));
}
#[test]
fn real_http_head_ranges_mime_fallback_and_host() {
    let profile=Temp::new(); let server=start(&profile);
    let body=request(&server,"GET","/","");assert!(body.starts_with("HTTP/1.1 200"));assert!(body.ends_with("<h1>hello</h1>"));assert!(body.to_lowercase().contains("cross-origin-opener-policy: same-origin"));
    let head=request(&server,"HEAD","/movie.bin","");assert!(head.to_lowercase().contains("content-length: 10"));assert_eq!(head.split_once("\r\n\r\n").unwrap().1,"");
    let range=request(&server,"GET","/movie.bin","Range: bytes=2-5\r\n");assert!(range.starts_with("HTTP/1.1 206"));assert!(range.ends_with("2345"));assert!(range.to_lowercase().contains("content-range: bytes 2-5/10"));
    assert!(request(&server,"GET","/movie.bin","Range: bytes=99-100\r\n").starts_with("HTTP/1.1 416"));
    for path in ["/missing.js","/missing.wasm","/missing.css","/service-worker.js"] { assert!(request(&server,"GET",path,"Accept: text/html\r\nSec-Fetch-Dest: document\r\n").starts_with("HTTP/1.1 404")); }
    assert!(request(&server,"GET","/route","Accept: text/html\r\nSec-Fetch-Dest: document\r\n").ends_with("<h1>hello</h1>"));
    assert!(request(&server,"GET","/route","").starts_with("HTTP/1.1 404"));
    assert!(request(&server,"POST","/","").starts_with("HTTP/1.1 405"));
    assert!(request(&server,"GET","/%2e%2e/private","").starts_with("HTTP/1.1 400"));
    assert!(request(&server,"GET","/nested?x=y","").to_lowercase().contains("location: /nested/?x=y"));
    assert!(request(&server,"GET","/space%20name.js","").to_lowercase().contains("content-type: text/javascript"));
    let mut socket=TcpStream::connect(server.origin().trim_start_matches("http://")).unwrap();
    socket.set_read_timeout(Some(Duration::from_secs(3))).unwrap();write!(socket,"GET / HTTP/1.1\r\nHost: attacker.example\r\nConnection: close\r\n\r\n").unwrap();
    let mut response=String::new();socket.read_to_string(&mut response).unwrap();assert!(response.starts_with("HTTP/1.1 421"));
}
#[test]
fn persisted_origin_survives_restart_and_conflicts_never_fall_back() {
    let profile=Temp::new(); let first=start(&profile); let origin=first.origin();
    assert!(Transport::start(AssetSource::embedded(FILES).unwrap(),options(),&profile.0,None).is_err());
    drop(first);
    // Worker shutdown is asynchronous; only retry the SAME persisted port.
    let mut next=None;
    for _ in 0..30 { if let Ok(server)=Transport::start(AssetSource::embedded(FILES).unwrap(),options(),&profile.0,None) { next=Some(server);break; } thread::sleep(Duration::from_millis(50)); }
    let second=next.expect("transport did not release its listener");assert_eq!(second.origin(),origin);
    let conflict=TcpListener::bind("127.0.0.1:0").unwrap();
    assert!(Transport::start(AssetSource::embedded(FILES).unwrap(),options(),&Temp::new().0,Some(conflict.local_addr().unwrap().port())).is_err());
}
#[test]
fn live_files_are_manifest_limited_and_headers_cannot_corrupt_framing() {
    let disk=Temp::new(); let profile=Temp::new(); fs::write(disk.0.join("index.html"),"first").unwrap();fs::write(disk.0.join("secret.txt"),"secret").unwrap();
    let source=AssetSource::disk(&disk.0,["index.html".into()]).unwrap();let server=Transport::start(source,options(),&profile.0,None).unwrap();
    assert!(request(&server,"GET","/","").ends_with("first"));fs::write(disk.0.join("index.html"),"second").unwrap();assert!(request(&server,"GET","/","").ends_with("second"));assert!(request(&server,"GET","/secret.txt","").starts_with("HTTP/1.1 404"));
    let mut bad=options();bad.headers.insert("Content-Length".into(),"0".into());assert!(Transport::start(AssetSource::embedded(FILES).unwrap(),bad,&Temp::new().0,None).is_err());
    assert!(AssetSource::disk(&disk.0,["../outside".into()]).is_err());
}
#[cfg(unix)]
#[test]
fn changed_symlink_cannot_escape_live_source() {
    use std::os::unix::fs::symlink;
    let disk=Temp::new();let profile=Temp::new();let external=Temp::new();fs::write(disk.0.join("index.html"),"safe").unwrap();fs::write(external.0.join("secret"),"secret").unwrap();
    let source=AssetSource::disk(&disk.0,["index.html".into()]).unwrap();let server=Transport::start(source,options(),&profile.0,None).unwrap();
    fs::remove_file(disk.0.join("index.html")).unwrap();symlink(external.0.join("secret"),disk.0.join("index.html")).unwrap();assert!(request(&server,"GET","/","").starts_with("HTTP/1.1 403"));
}
