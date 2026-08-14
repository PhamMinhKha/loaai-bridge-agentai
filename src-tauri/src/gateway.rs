use std::path::PathBuf;
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

    fn node_cmd() -> String {
        if cfg!(windows) {
            "node.exe".into()
        } else {
            "node".into()
        }
    }

    pub fn start(&self) -> Result<(), String> {
        let mut guard = self.child.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Ok(());
        }
        let node = Self::node_cmd();
        let script = self.root.join("src").join("index.js");
        if !script.exists() {
            return Err(format!("Không tìm thấy gateway tại {}", script.display()));
        }
        eprintln!(
            "[gateway] spawn {} {} (cwd={})",
            node,
            script.display(),
            self.root.display()
        );
        let child = Command::new(&node)
            .arg(script)
            .current_dir(&self.root)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Không spawn node: {e}"))?;
        *guard = Some(child);
        Ok(())
    }

    pub fn ensure_running(&self) -> Result<(), String> {
        if self.wait_healthy(2) {
            eprintln!("[gateway] đã chạy sẵn trên port {}", self.port);
            return Ok(());
        }
        self.start()?;
        if !self.wait_healthy(30) {
            return Err(format!(
                "Gateway không phản hồi /health sau 30s (port {})",
                self.port
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

    pub fn app_url(&self) -> String {
        format!("http://127.0.0.1:{}/?app=1", self.port)
    }
}

pub type SharedGateway = Arc<GatewayProcess>;

pub fn project_root() -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if cwd.join("src").join("index.js").exists() {
        return cwd;
    }
    let mut path = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
    for _ in 0..6 {
        if path.join("src").join("index.js").exists() {
            return path;
        }
        if !path.pop() {
            break;
        }
    }
    cwd
}

pub fn bundled_root(resource_dir: Option<PathBuf>) -> PathBuf {
    if let Some(res) = resource_dir {
        let bundle = res.join("gateway-bundle");
        if bundle.join("src").join("index.js").exists() {
            return bundle;
        }
    }
    project_root()
}
