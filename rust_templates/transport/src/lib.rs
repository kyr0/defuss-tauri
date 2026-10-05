//! Loopback HTTP for static bytes, not an application server. No IPC or execution endpoints.
mod source;
mod serving;
pub use source::AssetSource;
pub use serving::{normalize_path, parse_range, ServerOptions};
use std::{fs, io, net::{Ipv4Addr, TcpListener}, path::Path, sync::{Arc, atomic::{AtomicBool, Ordering}}, thread, time::Duration};

pub struct Transport { port: u16, stop: Arc<AtomicBool>, server: Arc<tiny_http::Server> }
impl Transport {
    /// Caller holds the profile lock until shutdown. A persisted origin is never silently changed.
    pub fn start(source: AssetSource, options: ServerOptions, profile: &Path, explicit: Option<u16>) -> io::Result<Self> {
        fs::create_dir_all(profile)?;
        let port_file = profile.join("origin.json");
        let saved = match fs::read(&port_file) {
            Ok(bytes) => {
                let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(io::Error::other)?;
                let port = value["port"].as_u64().filter(|n| (1..=65535).contains(n)).ok_or_else(|| io::Error::other("Invalid persisted origin; refusing to silently replace it"))?;
                Some(port as u16)
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Err(error) => return Err(error),
        };
        if explicit.is_some_and(|port| port < 1) { return Err(io::Error::other("Explicit static port must be 1..65535")); }
        let port = explicit.or(saved).unwrap_or(0);
        // Bind once and pass the same live listener to tiny_http; no probe-close-rebind race.
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, port)).map_err(|error| io::Error::new(error.kind(), format!("Cannot bind stable loopback port {port}: {error}. Close the conflicting process or explicitly select a different assets.port; no automatic origin reset.")))?;
        let bound = listener.local_addr()?.port();
        if saved != Some(bound) {
            if saved.is_some() { eprintln!("defuss-tauri: explicit origin change to port {bound}; previous origin storage is not migrated"); }
            let next = profile.join("origin.json.next");
            fs::write(&next, format!("{{\"schema\":1,\"port\":{bound}}}\n"))?;
            fs::rename(next, &port_file)?;
        }
        let server = Arc::new(tiny_http::Server::from_listener(listener, None).map_err(io::Error::other)?);
        let stop = Arc::new(AtomicBool::new(false));
        let handler = Arc::new(serving::Handler::new(source, options, bound)?);
        for _ in 0..4 {
            let server = Arc::clone(&server); let stop = Arc::clone(&stop); let handler = Arc::clone(&handler);
            thread::spawn(move || {
                while !stop.load(Ordering::Acquire) {
                    match server.recv_timeout(Duration::from_millis(200)) {
                        Ok(Some(request)) => handler.respond(request),
                        Ok(None) => (),
                        Err(_) => break,
                    }
                }
            });
        }
        Ok(Self { port: bound, stop, server })
    }
    pub fn origin(&self) -> String { format!("http://127.0.0.1:{}", self.port) }
}
impl Drop for Transport {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        for _ in 0..4 { self.server.unblock(); }
        // Do not join a worker potentially blocked by a client. Native process exit owns final teardown.
    }
}
