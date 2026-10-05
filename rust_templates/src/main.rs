#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
//! Desktop entry point; the host lives in the library so iOS/Android can load it.
fn main() { defuss_tauri_host_lib::run(); }
