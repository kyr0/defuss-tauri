//! Example defuss-tauri Rust extension: installs a custom application menu and observes page loads.
//! It demonstrates the whole hook contract without any web-facing API: everything happens in Rust,
//! observable in the terminal you started `make example-rust-extension` from.
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Builder, Wry};

const HELLO_ID: &str = "rust-ext-hello";

/// The one function defuss-tauri requires from every rust.extensions crate: wrap the builder first.
pub fn defuss_tauri_extend(builder: Builder<Wry>) -> Builder<Wry> {
    builder
        // A tiny inline plugin runs once at startup, when an AppHandle first exists. Extensions must
        // not call Builder::setup themselves: the host owns that single slot.
        .plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("defuss-example-rust-ext")
                .setup(|app, _api| {
                    let hello = MenuItem::with_id(app, HELLO_ID, "Say hello (Rust extension)", true, None::<&str>)?;
                    let quit = PredefinedMenuItem::quit(app, None)?;
                    let submenu = Submenu::with_items(app, "Rust Extension", true, &[&hello, &quit])?;
                    let menu = Menu::with_items(app, &[&submenu])?;
                    // App-level menu bar; the host's window menu (Reload configured target) stays untouched.
                    app.set_menu(menu)?;
                    println!("[rust-ext] custom menu installed; pick 'Rust Extension' in the menu bar");
                    Ok(())
                })
                .build(),
        )
        .on_menu_event(|_app, event| {
            if event.id().as_ref() == HELLO_ID {
                println!("[rust-ext] hello from the Rust extension");
            }
        })
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                println!("[rust-ext] page loaded: {}", webview.url().map(|url| url.to_string()).unwrap_or_else(|_| "(unknown)".to_string()));
            }
        })
}
