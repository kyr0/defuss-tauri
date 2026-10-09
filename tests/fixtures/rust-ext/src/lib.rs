//! Fixture extension proving the defuss-tauri hook contract end to end: the generated host calls
//! `defuss_tauri_extend` first in its builder chain, and a custom command registers through it.
#[tauri::command]
fn fixture_ping() -> u32 { 42 }

/// The one function defuss-tauri requires from every rust.extensions crate.
pub fn defuss_tauri_extend(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.invoke_handler(tauri::generate_handler![fixture_ping])
}
