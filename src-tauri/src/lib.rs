mod autostart;
mod gateway;
mod tray;

use std::sync::Arc;
use std::thread;
use std::time::Duration;

use gateway::{bundled_root, GatewayProcess, SharedGateway};
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
        .unwrap_or(8888);

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

                match gateway.ensure_running() {
                    Ok(()) => {
                        open_app_window(app.handle(), &gateway)?;
                    }
                    Err(e) => {
                        eprintln!("[gateway] {e}");
                        gateway::show_error_dialog("Loa Ai Agent Bridge", &e);
                        open_app_window(app.handle(), &gateway)?;
                        schedule_webview_reload(app.handle().clone(), gateway.clone());
                    }
                }
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

fn open_app_window(app: &tauri::AppHandle, gateway: &SharedGateway) -> tauri::Result<()> {
    tray::create_main_window(app, &gateway.app_url())
}

fn schedule_webview_reload(app: tauri::AppHandle, gateway: SharedGateway) {
    thread::spawn(move || {
        for _ in 0..90 {
            if gateway.wait_healthy(1) {
                let url = gateway.app_url();
                let app_handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    tray::navigate_main_window(&app_handle, &url);
                });
                break;
            }
            thread::sleep(Duration::from_millis(500));
        }
    });
}
