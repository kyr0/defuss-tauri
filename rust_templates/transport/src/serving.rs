//! Request policy is pure where possible; tiny_http owns HTTP parsing and wire formatting.
use crate::source::AssetSource;
use std::{collections::BTreeMap, io::{self, Cursor, Read, Seek, SeekFrom}};
use tiny_http::{Header, Request, Response, StatusCode};

#[derive(Clone)]
pub struct ServerOptions { pub entry: String, pub spa: bool, pub headers: BTreeMap<String, String> }
pub fn normalize_path(raw: &str) -> Result<String, u16> {
    let path = raw.split('?').next().ok_or(400u16)?;
    if !path.starts_with('/') || path.starts_with("//") { return Err(400); }
    let bytes = path.as_bytes();
    for (i, byte) in bytes.iter().enumerate() { if *byte == b'%' && (i + 2 >= bytes.len() || !bytes[i+1].is_ascii_hexdigit() || !bytes[i+2].is_ascii_hexdigit()) { return Err(400); } }
    let decoded = percent_encoding::percent_decode_str(path).decode_utf8().map_err(|_| 400u16)?;
    if decoded.contains(['\\', ':']) || decoded.chars().any(char::is_control) || decoded.split('/').any(|part| matches!(part, "." | "..")) { return Err(400); }
    Ok(decoded.trim_start_matches('/').to_owned())
}
pub fn parse_range(raw: &str, len: u64) -> Result<(u64, u64), u16> {
    if len == 0 { return Err(416); }
    let raw = raw.strip_prefix("bytes=").ok_or(416u16)?;
    if raw.contains(',') { return Err(416); }
    let (first, last) = raw.split_once('-').ok_or(416u16)?;
    if first.is_empty() {
        let count: u64 = last.parse().map_err(|_| 416u16)?;
        if count == 0 { return Err(416); }
        return Ok((len.saturating_sub(count), len - 1));
    }
    let start: u64 = first.parse().map_err(|_| 416u16)?;
    let end: u64 = if last.is_empty() { len - 1 } else { last.parse().map_err(|_| 416u16)? };
    if start >= len || end < start { return Err(416); }
    Ok((start, end.min(len - 1)))
}
pub(crate) struct Handler { source: AssetSource, options: ServerOptions, authority: String }
impl Handler {
    pub fn new(source: AssetSource, options: ServerOptions, port: u16) -> io::Result<Self> {
        if !source.has(&options.entry) { return Err(io::Error::other("HTML entry absent from asset manifest")); }
        for (name, value) in &options.headers {
            if ["content-length", "transfer-encoding", "connection", "content-range", "host"].contains(&name.to_ascii_lowercase().as_str()) || Header::from_bytes(name.as_bytes(), value.as_bytes()).is_err() { return Err(io::Error::other("Invalid/custom transport-owned header")); }
        }
        Ok(Self { source, options, authority: format!("127.0.0.1:{port}") })
    }
    fn header<'a>(request: &'a Request, name: &'static str) -> Option<&'a str> {
        request.headers().iter().find(|h| h.field.equiv(name)).map(|h| h.value.as_str())
    }
    fn base_headers(&self, path: &str) -> BTreeMap<String, String> {
        let content_type = if path.ends_with(".js") || path.ends_with(".mjs") { "text/javascript".to_owned() } else if path.ends_with(".wasm") { "application/wasm".to_owned() } else { mime_guess::from_path(path).first_or_octet_stream().to_string() };
        let mut headers = BTreeMap::from([
            ("content-type".into(), content_type), ("cache-control".into(), "no-cache".into()),
            ("accept-ranges".into(), "bytes".into()), ("x-content-type-options".into(), "nosniff".into()),
        ]);
        for (name, value) in &self.options.headers { headers.insert(name.to_ascii_lowercase(), value.clone()); }
        headers
    }
    fn send(&self, request: Request, status: u16, headers: BTreeMap<String, String>, reader: Box<dyn Read + Send>, len: u64) {
        let Ok(length) = usize::try_from(len) else { let _ = request.respond(Response::from_string("Asset too large for host").with_status_code(500)); return; };
        let headers = headers.into_iter().filter_map(|(name, value)| Header::from_bytes(name.as_bytes(), value.as_bytes()).ok()).collect();
        // tiny_http handles HEAD suppression while preserving the representation's content length.
        let response = Response::new(StatusCode(status), headers, reader, Some(length), None);
        let _ = request.respond(response);
    }
    fn error(&self, request: Request, code: u16, extra: Option<(String, String)>) {
        let data = format!("HTTP {code}\n").into_bytes(); let len = data.len() as u64;
        let mut headers = BTreeMap::from([("content-type".into(), "text/plain; charset=utf-8".into()), ("cache-control".into(), "no-store".into())]);
        if let Some((name, value)) = extra { headers.insert(name, value); }
        self.send(request, code, headers, Box::new(Cursor::new(data)), len);
    }
    pub fn respond(&self, request: Request) {
        let hosts: Vec<_> = request.headers().iter().filter(|h| h.field.equiv("Host")).collect();
        if hosts.len() != 1 || hosts[0].value.as_str() != self.authority { return self.error(request, 421, None); }
        if !matches!(request.method().as_str(), "GET" | "HEAD") { return self.error(request, 405, Some(("allow".into(), "GET, HEAD".into()))); }
        let mut path = match normalize_path(request.url()) { Ok(path) => path, Err(code) => return self.error(request, code, None) };
        if path.is_empty() { path = self.options.entry.clone(); }
        else if path.ends_with('/') { path.push_str("index.html"); }
        else if !self.source.has(&path) && self.source.has(&format!("{path}/index.html")) {
            let (base, query) = request.url().split_once('?').map(|(a,b)| (a, format!("?{b}"))).unwrap_or((request.url(), String::new()));
            let location = format!("{base}/{query}");
            return self.error(request, 308, Some(("location".into(), location)));
        }
        if !self.source.has(&path) && self.options.spa {
            let document = Self::header(&request, "Sec-Fetch-Dest") == Some("document")
                && Self::header(&request, "Accept").is_some_and(|v| v.contains("text/html"))
                && !path.rsplit('/').next().unwrap_or("").contains('.');
            if document { path = self.options.entry.clone(); }
        }
        let mut opened = match self.source.open(&path) { Ok(file) => file, Err(error) => return self.error(request, if error.kind() == io::ErrorKind::PermissionDenied { 403 } else { 404 }, None) };
        let mut headers = self.base_headers(&path);
        let (status, start, len) = if let Some(range) = Self::header(&request, "Range") {
            match parse_range(range, opened.len) {
                Ok((start, end)) => { headers.insert("content-range".into(), format!("bytes {start}-{end}/{}", opened.len)); (206, start, end-start+1) }
                Err(code) => return self.error(request, code, Some(("content-range".into(), format!("bytes */{}", opened.len)))),
            }
        } else { (200, 0, opened.len) };
        if opened.reader.seek(SeekFrom::Start(start)).is_err() { return self.error(request, 500, None); }
        self.send(request, status, headers, Box::new(opened.reader.take(len)), len);
    }
}
