mod autostart;
mod gateway;
mod tray;

use std::sync::Arc;

use gateway::{bundled_root, GatewayProcess};
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

#[tauri::command]
fn open_external_url(url: String, app: tauri::AppHandle) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("URL không hợp lệ".into());
    }
    app.shell().open(url, None).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3000);

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            open_external_url,
            autostart::desktop_platform,
            autostart::get_autostart_enabled,
            autostart::set_autostart_enabled,
        ])
        .setup({
            move |app| {
                let resource = app.path().resource_dir().ok();
                let root = bundled_root(resource);
                let gateway = Arc::new(GatewayProcess::new(root, port));
                app.manage(gateway.clone());

                gateway
                    .ensure_running()
                    .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
                let url = gateway.app_url();
                tray::create_main_window(app.handle(), &url)?;
                tray::setup_tray(app.handle(), gateway)?;
                Ok(())
            }
        })
        .build(tauri::generate_context!())
        .expect("error building tauri app")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(gw) = app_handle.try_state::<Arc<GatewayProcess>>() {
                    gw.stop();
                }
            }
        });
}
