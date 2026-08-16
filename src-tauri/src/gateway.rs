use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

pub struct GatewayProcess {
    child: Mutex<Option<Child>>,
    port: u16,
    root: PathBuf,
}

impl GatewayProcess {
    pub fn new(root: PathBuf, port: u16) -> Self {
        Self {
            child: Mutex::new(None),
            port,
            root,
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn node_cmd() -> PathBuf {
        if let Ok(p) = which_bin("node") {
            return p;
        }
        for p in node_search_paths() {
            if p.is_file() {
                eprintln!("[gateway] found Node.js at {}", p.display());
                return p;
            }
        }
        if cfg!(windows) {
            PathBuf::from("node.exe")
        } else {
            PathBuf::from("node")
        }
    }

    pub fn start(&self) -> Result<(), String> {
        let mut guard = self.child.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Ok(());
        }
        let node = Self::node_cmd();
        let root = user_path(&self.root);
        let script = root.join("src").join("index.js");
        if !script.exists() {
            return Err(format!(
                "Khong tim thay gateway tai {}\nThu muc: {}",
                script.display(),
                root.display()
            ));
        }
        let log_path = gateway_log_path();
        if let Some(dir) = log_path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let mut log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|e| format!("Khong ghi log {}: {e}", log_path.display()))?;
        let _ = writeln!(
            log,
            "\n===== spawn {} {} (cwd={}) =====",
            node.display(),
            script.display(),
            root.display()
        );
        drop(log);

        let log_out = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|e| e.to_string())?;
        let log_err = log_out.try_clone().map_err(|e| e.to_string())?;

        eprintln!(
            "[gateway] spawn {} {} (cwd={})",
            node.display(),
            script.display(),
            root.display()
        );

        let mut cmd = Command::new(&node);
        cmd.arg(&script)
            .current_dir(&root)
            .env("PORT", self.port.to_string())
            .stdout(Stdio::from(log_out))
            .stderr(Stdio::from(log_err));
        if let Some(user_env) = user_env_path() {
            cmd.env("VG_USER_ENV", user_env.to_string_lossy().as_ref());
        }
        cmd.env("PATH", gui_path_env());
        hide_console(&mut cmd);

        let child = cmd.spawn().map_err(|e| {
            format!(
                "Khong chay duoc Node.js ({e}).\nCan cai Node 18+ va mo lai app.\nLog: {}",
                log_path.display()
            )
        })?;
        *guard = Some(child);
        Ok(())
    }

    pub fn ensure_running(&self) -> Result<(), String> {
        let owns_child = self
            .child
            .lock()
            .map(|g| g.is_some())
            .unwrap_or(false);

        if self.wait_healthy(2) {
            if owns_child {
                if !self.has_current_gateway() {
                    eprintln!(
                        "[gateway] gateway con (pid Tauri) thiếu API mới — restart"
                    );
                    self.stop();
                    thread::sleep(Duration::from_millis(900));
                } else {
                    return Ok(());
                }
            } else if !self.has_current_gateway() {
                eprintln!(
                    "[gateway] phát hiện gateway cũ trên port {} (apiVersion < 2) — tắt và chạy lại bản mới",
                    self.port
                );
                kill_processes_on_port(self.port)?;
                thread::sleep(Duration::from_millis(900));
            } else if !self.has_tunnel_api() {
                eprintln!(
                    "[gateway] đã có gateway trên port {} (thiếu API tunnel) — tắt Node trên port này rồi mở lại app",
                    self.port
                );
                return Ok(());
            } else {
                eprintln!("[gateway] gateway đã chạy trên port {}", self.port);
                return Ok(());
            }
        }

        self.start()?;
        if !self.wait_healthy(30) {
            let hint = fs::read_to_string(gateway_log_path()).unwrap_or_default();
            let tail = hint
                .chars()
                .rev()
                .take(1200)
                .collect::<String>()
                .chars()
                .rev()
                .collect::<String>();
            return Err(format!(
                "Gateway khong phan hoi /health sau 30s (port {}).\nLog: {}\n{}",
                self.port,
                gateway_log_path().display(),
                tail
            ));
        }
        Ok(())
    }

    pub fn stop(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    pub fn wait_healthy(&self, timeout_secs: u64) -> bool {
        let url = format!("http://127.0.0.1:{}/health", self.port);
        let deadline = std::time::Instant::now() + Duration::from_secs(timeout_secs);
        while std::time::Instant::now() < deadline {
            if let Ok(resp) = reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(2))
                .build()
                .and_then(|c| c.get(&url).send())
            {
                if resp.status().is_success() {
                    return true;
                }
            }
            thread::sleep(Duration::from_millis(500));
        }
        false
    }

    fn gateway_api_version(&self) -> u64 {
        let url = format!("http://127.0.0.1:{}/health", self.port);
        let Ok(resp) = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
            .and_then(|c| c.get(&url).send())
        else {
            return 0;
        };
        if !resp.status().is_success() {
            return 0;
        }
        let Ok(body) = resp.text() else {
            return 0;
        };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) else {
            return 0;
        };
        json.get("features")
            .and_then(|f| f.get("apiVersion"))
            .and_then(|v| v.as_u64())
            .unwrap_or(1)
    }

    fn has_current_gateway(&self) -> bool {
        const EXPECTED: u64 = 2;
        self.gateway_api_version() >= EXPECTED
    }

    fn has_tunnel_api(&self) -> bool {
        let url = format!("http://127.0.0.1:{}/api/tunnel/status", self.port);
        reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
            .and_then(|c| c.get(&url).send())
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }

    pub fn app_url(&self) -> String {
        format!("http://127.0.0.1:{}/?app=1", self.port)
    }
}

pub type SharedGateway = Arc<GatewayProcess>;

fn has_gateway(dir: &Path) -> bool {
    dir.join("src").join("index.js").exists()
}

/// Windows canonicalize adds `\\?\` prefix; Node.js fails to run scripts under it (EISDIR on C:).
fn user_path(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    let plain = if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        s.into_owned()
    };
    PathBuf::from(plain)
}

fn resolve_gateway_dir(path: &Path) -> Option<PathBuf> {
    if has_gateway(path) {
        return Some(user_path(path));
    }
    if let Ok(canon) = path.canonicalize() {
        if has_gateway(&canon) {
            return Some(user_path(&canon));
        }
    }
    None
}

pub fn project_root() -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if has_gateway(&cwd) {
        return cwd;
    }
    let mut path = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
    for _ in 0..8 {
        if has_gateway(&path) {
            return path;
        }
        if !path.pop() {
            break;
        }
    }
    cwd
}

pub fn bundled_root(resource_dir: Option<PathBuf>) -> PathBuf {
    // Dev (tauri dev): luôn dùng repo gốc — tránh snapshot cũ trong target/debug/gateway-bundle.
    if cfg!(debug_assertions) {
        let root = project_root();
        if let Some(found) = resolve_gateway_dir(&root) {
            eprintln!("[gateway] dev mode — dùng repo: {}", found.display());
            return found;
        }
    }

    let mut candidates = Vec::new();
    if let Some(res) = &resource_dir {
        candidates.push(res.join("gateway-bundle"));
        candidates.push(res.clone());
        candidates.push(res.join("dist").join("gateway-bundle"));
        candidates.push(res.join("..").join("dist").join("gateway-bundle"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("resources").join("gateway-bundle"));
            candidates.push(dir.join("resources"));
            candidates.push(dir.join("gateway-bundle"));
            candidates.push(dir.to_path_buf());
        }
    }
    candidates.push(project_root());
    for c in candidates {
        if let Some(found) = resolve_gateway_dir(&c) {
            return found;
        }
    }
    user_path(&project_root())
}

pub fn gateway_log_path() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));
    base.join("Loa Ai Agent Bridge").join("gateway.log")
}

pub fn user_env_path() -> Option<PathBuf> {
    gateway_log_path().parent().map(|p| p.join(".env"))
}

pub fn show_error_dialog(title: &str, msg: &str) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let escaped = msg.replace('\'', "''");
        let title_e = title.replace('\'', "''");
        let script = format!(
            "Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show(@'\n{escaped}\n'@,'{title_e}')"
        );
        let _ = Command::new("powershell")
            .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &script])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
    #[cfg(target_os = "macos")]
    {
        let body = msg.replace('\\', "\\\\").replace('"', "\\\"");
        let title_e = title.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!(
            r#"display dialog "{body}" with title "{title_e}" buttons {{"OK"}} default button "OK" with icon caution"#
        );
        let _ = Command::new("osascript").args(["-e", &script]).status();
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        eprintln!("{title}: {msg}");
    }
}

pub fn loading_page_url() -> String {
    "data:text/html;charset=utf-8,".to_string() + &url_encode_html(r#"<!DOCTYPE html>
<html lang="vi"><head><meta charset="utf-8"><title>Loa Ai Agent Bridge</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
  font-family:system-ui,sans-serif;background:#0b0f17;color:#e2e8f0}
  .box{text-align:center;padding:2rem}
  .spin{width:36px;height:36px;border:3px solid #334155;border-top-color:#3b82f6;
  border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 1rem}
  @keyframes spin{to{transform:rotate(360deg)}}
  h1{font-size:1.1rem;margin:0 0 .35rem}
  p{margin:0;color:#94a3b8;font-size:.9rem}
</style></head><body><div class="box">
<div class="spin"></div><h1>Đang khởi động gateway…</h1>
<p>Vui lòng đợi vài giây.</p></div></body></html>"#)
}

pub fn error_page_url(msg: &str) -> String {
    let safe = html_escape(msg);
    let log = gateway_log_path().display().to_string();
    let body = format!(
        r#"<!DOCTYPE html>
<html lang="vi"><head><meta charset="utf-8"><title>Loa Ai Agent Bridge</title>
<style>
  body{{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
  font-family:system-ui,sans-serif;background:#0b0f17;color:#e2e8f0;padding:1.5rem}}
  .box{{max-width:34rem;background:#151d2e;border:1px solid #334155;border-radius:12px;padding:1.5rem}}
  h1{{font-size:1.05rem;margin:0 0 .75rem;color:#f87171}}
  pre{{white-space:pre-wrap;word-break:break-word;background:#0a101c;border:1px solid #1e293b;
  border-radius:8px;padding:.85rem;font-size:.78rem;line-height:1.45;color:#cbd5e1}}
  ul{{margin:.75rem 0 0;padding-left:1.2rem;color:#94a3b8;font-size:.85rem;line-height:1.55}}
  code{{background:#0a101c;padding:.1rem .35rem;border-radius:4px}}
</style></head><body><div class="box">
<h1>Gateway chưa chạy được</h1>
<pre>{safe}</pre>
<ul>
<li>Cài <b>Node.js 18+</b> từ <code>https://nodejs.org</code> hoặc Homebrew (<code>brew install node</code>).</li>
<li>Sau khi cài, mở lại app (đóng hẳn icon menu bar → mở lại).</li>
<li>Log chi tiết: <code>{log}</code></li>
</ul></div></body></html>"#
    );
    "data:text/html;charset=utf-8,".to_string() + &url_encode_html(&body)
}

fn node_search_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    #[cfg(windows)]
    {
        if let Ok(pf) = std::env::var("ProgramFiles") {
            paths.push(PathBuf::from(pf).join("nodejs").join("node.exe"));
        }
        if let Ok(pf86) = std::env::var("ProgramFiles(x86)") {
            paths.push(PathBuf::from(pf86).join("nodejs").join("node.exe"));
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            paths.push(PathBuf::from(&local).join("Programs").join("nodejs").join("node.exe"));
            let fnm_shells = PathBuf::from(&local).join("fnm_multishells");
            if fnm_shells.is_dir() {
                if let Ok(entries) = fs::read_dir(&fnm_shells) {
                    for entry in entries.flatten() {
                        paths.push(entry.path().join("node.exe"));
                    }
                }
            }
        }
        paths.push(PathBuf::from(r"C:\Program Files\nodejs\node.exe"));
        paths.push(PathBuf::from(r"C:\Program Files (x86)\nodejs\node.exe"));
    }
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        paths.push(PathBuf::from("/opt/homebrew/bin/node"));
        paths.push(PathBuf::from("/usr/local/bin/node"));
        paths.push(PathBuf::from("/usr/bin/node"));
        if let Ok(home) = std::env::var("HOME") {
            let home = PathBuf::from(home);
            paths.push(home.join(".fnm").join("current").join("bin").join("node"));
            paths.push(home.join(".volta").join("bin").join("node"));
            paths.push(home.join(".asdf").join("shims").join("node"));
            let nvm_versions = home.join(".nvm").join("versions").join("node");
            if nvm_versions.is_dir() {
                if let Ok(entries) = fs::read_dir(&nvm_versions) {
                    let mut vers: Vec<PathBuf> = entries
                        .filter_map(|e| e.ok())
                        .map(|e| e.path())
                        .filter(|p| p.is_dir())
                        .collect();
                    vers.sort();
                    if let Some(latest) = vers.last() {
                        paths.push(latest.join("bin").join("node"));
                    }
                }
            }
        }
    }
    paths
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn url_encode_html(html: &str) -> String {
    html.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn which_bin(name: &str) -> Result<PathBuf, ()> {
    let exe = if cfg!(windows) && !name.ends_with(".exe") {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    if let Ok(paths) = std::env::var("PATH") {
        for dir in std::env::split_paths(&paths) {
            let p = dir.join(&exe);
            if p.is_file() {
                return Ok(p);
            }
        }
    }
    Err(())
}

fn hide_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let _ = cmd;
}

/// macOS GUI apps get a minimal PATH; extend so Node can spawn openclaw/python/homebrew tools.
fn gui_path_env() -> String {
    let mut paths: Vec<String> = Vec::new();
    if let Ok(existing) = std::env::var("PATH") {
        if !existing.is_empty() {
            paths.push(existing);
        }
    }
    #[cfg(target_os = "macos")]
    {
        paths.push("/opt/homebrew/bin".into());
        paths.push("/usr/local/bin".into());
        if let Ok(home) = std::env::var("HOME") {
            paths.push(format!("{home}/.local/bin"));
            let nvm_root = format!("{home}/.nvm/versions/node");
            if let Ok(entries) = fs::read_dir(&nvm_root) {
                let mut vers: Vec<PathBuf> = entries
                    .filter_map(|e| e.ok())
                    .map(|e| e.path().join("bin"))
                    .filter(|p| p.is_dir())
                    .collect();
                vers.sort();
                for p in vers {
                    paths.push(p.to_string_lossy().into_owned());
                }
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        paths.push("/usr/local/bin".into());
        if let Ok(home) = std::env::var("HOME") {
            paths.push(format!("{home}/.local/bin"));
        }
    }
    paths.push("/usr/bin".into());
    paths.push("/bin".into());
    paths.join(":")
}

fn kill_processes_on_port(port: u16) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let script = format!(
            "Get-NetTCPConnection -LocalPort {port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {{ Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }}"
        );
        let status = Command::new("powershell")
            .args([
                "-NoProfile",
                "-WindowStyle",
                "Hidden",
                "-Command",
                &script,
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map_err(|e| format!("Khong tat process tren port {port}: {e}"))?;
        if !status.success() {
            return Err(format!("Khong tat duoc process tren port {port}"));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = port;
        Ok(())
    }
}
