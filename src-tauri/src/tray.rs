use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_shell::ShellExt;

use crate::autostart;
use crate::gateway::SharedGateway;

const APP_TITLE: &str = concat!("Loa Ai Agent Bridge v", env!("CARGO_PKG_VERSION"), " - LoaAi.me");
const TRAY_ID: &str = "main-tray";

pub struct TrayAutostartItem(pub CheckMenuItem<tauri::Wry>);

pub fn setup_tray(app: &AppHandle, gateway: SharedGateway) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Mở Loa Ai Agent Bridge", true, None::<&str>)?;
    let status = MenuItem::with_id(app, "status", "Bridge đang chạy", false, None::<&str>)?;
    let autostart_checked = autostart::is_autostart_enabled(app);
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        autostart::autostart_label(),
        true,
        autostart_checked,
        None::<&str>,
    )?;
    app.manage(TrayAutostartItem(autostart.clone()));
    let quit = MenuItem::with_id(app, "quit", "Thoát", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &show,
            &status,
            &PredefinedMenuItem::separator(app)?,
            &autostart,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let gw = gateway.clone();
    let mut tray_builder = TrayIconBuilder::with_id(TRAY_ID);
    #[cfg(target_os = "macos")]
    {
        tray_builder = tray_builder
            .icon(tauri::include_image!("icons/trayTemplate.png"))
            .icon_as_template(true)
            .show_menu_on_left_click(false);
    }
    #[cfg(not(target_os = "macos"))]
    {
        tray_builder = tray_builder.icon(tauri::include_image!("icons/32x32.png"));
    }
    tray_builder
        .menu(&menu)
        .tooltip(APP_TITLE)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "show" => {
                let url = gw.app_url();
                navigate_main_window(app, &url);
            }
            "autostart" => {
                match autostart::toggle_autostart(app) {
                    Ok(enabled) => {
                        if let Some(state) = app.try_state::<TrayAutostartItem>() {
                            let _ = state.0.set_checked(enabled);
                        }
                    }
                    Err(err) => eprintln!("[tray] autostart toggle failed: {err}"),
                }
            }
            "quit" => {
                gw.stop();
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
                if let Some(gw) = tray.app_handle().try_state::<SharedGateway>() {
                    navigate_main_window(tray.app_handle(), &gw.app_url());
                }
            }
        })
        .build(app)?;

    Ok(())
}

pub fn sync_tray_autostart(app: &AppHandle, enabled: bool) -> tauri::Result<()> {
    if let Some(state) = app.try_state::<TrayAutostartItem>() {
        state.0.set_checked(enabled)?;
    }
    Ok(())
}

pub fn navigate_main_window(app: &AppHandle, url: &str) {
    load_main_window(app, url, true);
}

pub fn load_main_window(app: &AppHandle, url: &str, show: bool) {
    if let Some(win) = app.get_webview_window("main") {
        if let Ok(parsed) = url.parse::<tauri::Url>() {
            let _ = win.navigate(parsed);
        }
        if show {
            #[cfg(target_os = "macos")]
            let _ = app.set_dock_visibility(true);
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
        }
    }
}

pub fn show_main_window(app: &AppHandle) {
    if app.get_webview_window("main").is_some() {
        let _ = app.get_webview_window("main").map(|win| {
            #[cfg(target_os = "macos")]
            let _ = app.set_dock_visibility(true);
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
        });
    }
}

#[cfg(target_os = "macos")]
fn hide_main_window(app: &AppHandle, win: &tauri::WebviewWindow) {
    let _ = win.hide();
    let _ = app.set_dock_visibility(false);
}

#[cfg(not(target_os = "macos"))]
fn hide_main_window(_app: &AppHandle, win: &tauri::WebviewWindow) {
    let _ = win.hide();
}

pub fn create_main_window(app: &AppHandle, url: &str, visible: bool) -> tauri::Result<()> {
    if app.get_webview_window("main").is_some() {
        load_main_window(app, url, visible);
        return Ok(());
    }
    let app_handle = app.clone();
    let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse().unwrap()))
        .title(APP_TITLE)
        .inner_size(1024.0, 880.0)
        .resizable(true)
        .visible(visible)
        .on_navigation(move |nav_url| {
            let target = nav_url.as_str();
            if target.starts_with("data:text/html") {
                return true;
            }
            let is_local = target.starts_with("http://127.0.0.1")
                || target.starts_with("http://localhost")
                || target.starts_with("https://127.0.0.1")
                || target.starts_with("https://localhost");
            if is_local {
                return true;
            }
            if target.starts_with("http://") || target.starts_with("https://") {
                let _ = app_handle.shell().open(target, None);
                return false;
            }
            true
        })
        .build()?;

    if visible {
        let _ = win.show();
        let _ = win.set_focus();
    } else {
        hide_main_window(app, &win);
    }

    let app_for_close = app.clone();
    let win_clone = win.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            hide_main_window(&app_for_close, &win_clone);
        }
    });
    Ok(())
}
