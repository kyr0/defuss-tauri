//! Generated-host wiring for user Rust extensions. defuss-tauri replaces this file when
//! rust.extensions is configured; without an extension it stays an identity function, so
//! lib.rs is independent of that decision and default hosts expose no user code.
pub fn wire(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> { builder }
