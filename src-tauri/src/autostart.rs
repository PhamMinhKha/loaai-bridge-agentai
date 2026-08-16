use tauri::AppHandle;
#[cfg(not(windows))]
use tauri_plugin_autostart::ManagerExt;

const AUTOSTART_ARG: &str = "--autostart";
const APP_REG_NAME: &str = "Loa Ai Agent Bridge";

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
    is_enabled(&app)
}

#[tauri::command]
pub fn set_autostart_enabled(app: AppHandle, enabled: bool) -> Result<bool, String> {
    if enabled {
        enable(&app)?;
    } else {
        disable(&app)?;
    }
    let current = is_enabled(&app)?;
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

pub fn launched_from_autostart() -> bool {
    std::env::args().any(|a| a == AUTOSTART_ARG)
}

pub fn is_autostart_enabled(app: &AppHandle) -> bool {
    is_enabled(app).unwrap_or(false)
}

/// Rewrite a previously broken Windows Run entry (unquoted path with spaces).
pub fn heal_if_enabled(app: &AppHandle) {
    if is_autostart_enabled(app) {
        let _ = enable(app);
    }
}

pub fn toggle_autostart(app: &AppHandle) -> Result<bool, String> {
    if is_enabled(app)? {
        disable(app)?;
    } else {
        enable(app)?;
    }
    is_enabled(app)
}

fn is_enabled(app: &AppHandle) -> Result<bool, String> {
    #[cfg(windows)]
    {
        let _ = app;
        windows::is_enabled()
    }
    #[cfg(not(windows))]
    {
        app.autolaunch()
            .is_enabled()
            .map_err(|e| e.to_string())
    }
}

fn enable(app: &AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _ = app;
        windows::enable()
    }
    #[cfg(not(windows))]
    {
        app.autolaunch().enable().map_err(|e| e.to_string())
    }
}

fn disable(app: &AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _ = app;
        windows::disable()
    }
    #[cfg(not(windows))]
    {
        app.autolaunch().disable().map_err(|e| e.to_string())
    }
}

#[cfg(windows)]
mod windows {
    use super::{APP_REG_NAME, AUTOSTART_ARG};
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE, REG_BINARY};
    use winreg::{RegKey, RegValue};

    const RUN_KEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run";
    const APPROVED_KEY: &str =
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
    /// Task Manager / Settings → Startup: enabled (12-byte blob).
    const APPROVED_ENABLED: [u8; 12] = [
        0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ];
    /// Older plugin builds may have used the Cargo package name.
    const LEGACY_NAMES: &[&str] = &["voice-gateway-app", "voice_gateway_app"];

    fn exe_path() -> Result<String, String> {
        let exe = std::env::current_exe().map_err(|e| format!("Không đọc được đường dẫn app: {e}"))?;
        let raw = exe.to_string_lossy();
        let plain = raw
            .strip_prefix(r"\\?\UNC\")
            .map(|rest| format!(r"\\{rest}"))
            .or_else(|| raw.strip_prefix(r"\\?\").map(|s| s.to_string()))
            .unwrap_or_else(|| raw.into_owned());
        if !std::path::Path::new(&plain).is_file() {
            return Err(format!("Không thấy file app: {plain}"));
        }
        Ok(plain)
    }

    fn run_command() -> Result<String, String> {
        Ok(format!("\"{}\" {AUTOSTART_ARG}", exe_path()?))
    }

    pub fn enable() -> Result<(), String> {
        let command = run_command()?;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let run = hkcu
            .open_subkey_with_flags(RUN_KEY, KEY_SET_VALUE)
            .map_err(|e| format!("Không ghi registry Run: {e}"))?;
        run.set_value(APP_REG_NAME, &command)
            .map_err(|e| format!("Không bật autostart: {e}"))?;
        for name in LEGACY_NAMES {
            let _ = run.delete_value(name);
        }

        if let Ok((approved, _)) = hkcu.create_subkey(APPROVED_KEY) {
            let _ = approved.set_raw_value(
                APP_REG_NAME,
                &RegValue {
                    vtype: REG_BINARY,
                    bytes: APPROVED_ENABLED.to_vec(),
                },
            );
            for name in LEGACY_NAMES {
                let _ = approved.delete_value(name);
            }
        }
        Ok(())
    }

    pub fn disable() -> Result<(), String> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(run) = hkcu.open_subkey_with_flags(RUN_KEY, KEY_SET_VALUE) {
            let _ = run.delete_value(APP_REG_NAME);
            for name in LEGACY_NAMES {
                let _ = run.delete_value(name);
            }
        }
        if let Ok(approved) = hkcu.open_subkey_with_flags(APPROVED_KEY, KEY_SET_VALUE) {
            let _ = approved.delete_value(APP_REG_NAME);
            for name in LEGACY_NAMES {
                let _ = approved.delete_value(name);
            }
        }
        Ok(())
    }

    fn run_value(run: &RegKey) -> Option<String> {
        if let Ok(v) = run.get_value::<String, _>(APP_REG_NAME) {
            if !v.trim().is_empty() {
                return Some(v);
            }
        }
        for name in LEGACY_NAMES {
            if let Ok(v) = run.get_value::<String, _>(name) {
                if !v.trim().is_empty() {
                    return Some(v);
                }
            }
        }
        None
    }

    pub fn is_enabled() -> Result<bool, String> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let run = match hkcu.open_subkey_with_flags(RUN_KEY, KEY_READ) {
            Ok(k) => k,
            Err(_) => return Ok(false),
        };
        if run_value(&run).is_none() {
            return Ok(false);
        }
        Ok(startup_approved_enabled(&hkcu).unwrap_or(true))
    }

    fn startup_approved_enabled(hkcu: &RegKey) -> Option<bool> {
        let approved = hkcu.open_subkey_with_flags(APPROVED_KEY, KEY_READ).ok()?;
        let raw = approved.get_raw_value(APP_REG_NAME).ok()?;
        if raw.bytes.len() < 8 {
            return None;
        }
        Some(raw.bytes.iter().rev().take(8).all(|b| *b == 0))
    }
}
