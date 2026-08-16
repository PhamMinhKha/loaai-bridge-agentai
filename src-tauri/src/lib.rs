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

    let from_autostart = autostart::launched_from_autostart();

    tauri::Builder::default()
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--autostart"])
                .app_name("Loa Ai Agent Bridge")
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            open_external_url,
            autostart::desktop_platform,
            autostart::get_autostart_enabled,
            autostart::set_autostart_enabled,
        ])
        .setup({
            move |app| {
                autostart::heal_if_enabled(app.handle());

                let resource = app.path().resource_dir().ok();
                let root = bundled_root(resource);
                let gateway = Arc::new(GatewayProcess::new(root, port));
                app.manage(gateway.clone());

                tray::create_main_window(
                    app.handle(),
                    &gateway::loading_page_url(),
                    !from_autostart,
                )?;

                match gateway.ensure_running() {
                    Ok(()) => {
                        tray::load_main_window(app.handle(), &gateway.app_url(), !from_autostart);
                    }
                    Err(e) => {
                        eprintln!("[gateway] {e}");
                        gateway::show_error_dialog("Loa Ai Agent Bridge", &e);
                        tray::load_main_window(
                            app.handle(),
                            &gateway::error_page_url(&e),
                            true,
                        );
                        schedule_webview_reload(
                            app.handle().clone(),
                            gateway.clone(),
                            from_autostart,
                        );
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

fn schedule_webview_reload(
    app: tauri::AppHandle,
    gateway: SharedGateway,
    from_autostart: bool,
) {
    thread::spawn(move || {
        for _ in 0..90 {
            if gateway.wait_healthy(1) {
                let url = gateway.app_url();
                let app_handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    tray::load_main_window(&app_handle, &url, !from_autostart);
                });
                break;
            }
            thread::sleep(Duration::from_millis(500));
        }
    });
}
