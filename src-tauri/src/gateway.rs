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
        let mut extra = Vec::new();
        if let Ok(pf) = std::env::var("ProgramFiles") {
            extra.push(PathBuf::from(pf).join("nodejs").join("node.exe"));
        }
        if let Ok(pf86) = std::env::var("ProgramFiles(x86)") {
            extra.push(PathBuf::from(pf86).join("nodejs").join("node.exe"));
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            extra.push(PathBuf::from(&local).join("Programs").join("nodejs").join("node.exe"));
            extra.push(PathBuf::from(local).join("fnm_multishells"));
        }
        extra.push(PathBuf::from(r"C:\Program Files\nodejs\node.exe"));
        extra.push(PathBuf::from(r"C:\Program Files (x86)\nodejs\node.exe"));
        for p in extra {
            if p.is_file() {
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
    #[cfg(not(windows))]
    {
        eprintln!("{title}: {msg}");
    }
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
