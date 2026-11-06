// The desktop shell (ARCHITECTURE.md §10): the same web build in a Tauri window. The only
// native code is the GitHub token in the OS keychain (§9), which src/store/token.ts calls,
// and Families in folders (folder.rs, issue #64).
// ponytail: printing uses the webview's window.print(); if a platform's webview can't
// print (§11 risk), add a command that calls the webview's native print here.

const SERVICE: &str = "io.yeraz.app";
const ACCOUNT: &str = "github-token";

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_token() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn set_token(token: String) -> Result<(), String> {
    entry()?.set_password(&token).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_token() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// A web page's HTML, for a bookmark's title and description: https only, 8 s, 512 KB at most.
/// The app reads text out of it and never shows it as HTML.
#[tauri::command]
async fn fetch_page(url: String) -> Result<String, String> {
    if !url.starts_with("https://") {
        return Err("Only https pages".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Read;
        let response = ureq::get(&url)
            .timeout(std::time::Duration::from_secs(8))
            .call()
            .map_err(|e| e.to_string())?;
        let mut body = Vec::new();
        response
            .into_reader()
            .take(512 * 1024)
            .read_to_end(&mut body)
            .map_err(|e| e.to_string())?;
        Ok(String::from_utf8_lossy(&body).into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

mod folder;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let file = app
                .path()
                .app_data_dir()
                .ok()
                .map(|d| d.join("folders.txt"));
            app.manage(folder::Allowed::load(file));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_token,
            set_token,
            delete_token,
            fetch_page,
            folder::pick_folder,
            folder::pick_parent,
            folder::allow_folder,
            folder::new_folder,
            folder::list_folder,
            folder::read_file,
            folder::write_file,
            folder::remove_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Yeraz");
}
