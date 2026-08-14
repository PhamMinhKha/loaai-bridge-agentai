use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

#[tauri::command]
pub fn desktop_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

#[tauri::command]
pub fn get_autostart_enabled(app: AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_autostart_enabled(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let mgr = app.autolaunch();
    if enabled {
        mgr.enable().map_err(|e| e.to_string())?;
    } else {
        mgr.disable().map_err(|e| e.to_string())?;
    }
    let current = mgr.is_enabled().map_err(|e| e.to_string())?;
    let _ = crate::tray::sync_tray_autostart(&app, current);
    Ok(current)
}

pub fn autostart_label() -> &'static str {
    if cfg!(target_os = "macos") {
        "Khởi động khi đăng nhập"
    } else if cfg!(target_os = "windows") {
        "Khởi động cùng Windows"
    } else {
        "Khởi động cùng hệ thống"
    }
}

pub fn is_autostart_enabled(app: &AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

pub fn toggle_autostart(app: &AppHandle) -> Result<bool, String> {
    let mgr = app.autolaunch();
    let enabled = mgr.is_enabled().map_err(|e| e.to_string())?;
    if enabled {
        mgr.disable().map_err(|e| e.to_string())?;
    } else {
        mgr.enable().map_err(|e| e.to_string())?;
    }
    mgr.is_enabled().map_err(|e| e.to_string())
}
