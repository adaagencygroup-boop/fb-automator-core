// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{RunEvent, WindowEvent};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

struct SidecarState {
    child: Arc<Mutex<Option<Child>>>,
}

fn chrono_like_now() -> String {
    // Đủ để đọc log — không phụ thuộc crate chrono
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

fn log_line(msg: &str) {
    let path = log_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "[{}] {}", chrono_like_now(), msg);
    }
    eprintln!("{}", msg);
}

#[cfg(target_os = "linux")]
fn linux_data_dir() -> PathBuf {
    std::env::var_os("XDG_DATA_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .unwrap_or_else(std::env::temp_dir)
                .join(".local/share")
        })
        .join("FBAutomator")
}

fn log_directory() -> PathBuf {
    #[cfg(target_os = "linux")]
    {
        linux_data_dir().join("logs")
    }
    #[cfg(not(target_os = "linux"))]
    {
        std::env::var_os("LOCALAPPDATA")
            .map(|p| PathBuf::from(p).join("FB_Page_Automator"))
            .unwrap_or_else(|| PathBuf::from("."))
    }
}

fn log_path() -> PathBuf {
    log_directory().join("tauri_sidecar.log")
}

#[cfg(target_os = "linux")]
fn sidecar_temp_dir() -> PathBuf {
    linux_data_dir().join("engine-temp")
}

#[cfg(not(target_os = "linux"))]
fn sidecar_temp_dir() -> PathBuf {
    let candidates = [
        PathBuf::from(r"F:\FB_Page_Automator\engine-temp"),
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("engine-temp")))
            .unwrap_or_else(|| PathBuf::from("engine-temp")),
        std::env::var_os("LOCALAPPDATA")
            .map(|p| PathBuf::from(p).join("FB_Page_Automator").join("engine-temp"))
            .unwrap_or_else(|| PathBuf::from("engine-temp")),
    ];
    for dir in candidates {
        let drive_ok = dir
            .components()
            .next()
            .map(|c| {
                let s = c.as_os_str().to_string_lossy();
                if s.len() >= 2 && s.as_bytes().get(1) == Some(&b':') {
                    PathBuf::from(format!("{}\\", &s[..2])).exists()
                } else {
                    true
                }
            })
            .unwrap_or(true);
        if !drive_ok {
            continue;
        }
        if std::fs::create_dir_all(&dir).is_ok() {
            return dir;
        }
    }
    PathBuf::from(r"F:\FB_Page_Automator\engine-temp")
}

fn resolve_sidecar_exe() -> Option<PathBuf> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    // onedir (ưu tiên): $INSTDIR/local_engine/local_engine.exe + _internal/
    let onedir = dir.join("local_engine").join("local_engine.exe");
    if onedir.is_file() {
        return Some(onedir);
    }
    // Legacy onefile / sidecar cạnh app
    for name in [
        "local_engine.exe",
        "local_engine-x86_64-pc-windows-msvc.exe",
        "local_engine",
    ] {
        let p = dir.join(name);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

fn spawn_local_engine() -> Option<Child> {
    let exe = match resolve_sidecar_exe() {
        Some(p) => p,
        None => {
            log_line("❌ local_engine.exe not found next to app");
            return None;
        }
    };
    let temp_dir = sidecar_temp_dir();
    let _ = std::fs::create_dir_all(&temp_dir);
    let temp_str = temp_dir.to_string_lossy().to_string();

    let log_dir = log_directory();
    let _ = std::fs::create_dir_all(&log_dir);
    let stdout_path = log_dir.join("local_engine.out.log");
    let stderr_path = log_dir.join("local_engine.err.log");
    let stdout_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&stdout_path)
        .ok()
        .map(Stdio::from)
        .unwrap_or(Stdio::null());
    let stderr_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&stderr_path)
        .ok()
        .map(Stdio::from)
        .unwrap_or(Stdio::null());

    log_line(&format!("🚀 Spawning {:?} TEMP={}", exe, temp_str));

    #[cfg(target_os = "linux")]
    let work_dir = linux_data_dir();
    #[cfg(not(target_os = "linux"))]
    let work_dir = exe
        .parent()
        .unwrap_or(std::path::Path::new("."))
        .to_path_buf();

    let mut cmd = Command::new(&exe);
    cmd.args(["--port", "28129"])
        .env("TEMP", &temp_str)
        .env("TMP", &temp_str)
        .env("TMPDIR", &temp_str)
        .current_dir(&work_dir)
        .stdin(Stdio::null())
        .stdout(stdout_file)
        .stderr(stderr_file);

    // Không gắn console → đóng/ẩn cửa sổ không giết engine; tách process group.
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }

    match cmd.spawn() {
        Ok(child) => {
            log_line(&format!("✅ Spawned local_engine pid={}", child.id()));
            Some(child)
        }
        Err(err) => {
            log_line(&format!("❌ Spawn failed: {}", err));
            None
        }
    }
}

fn wait_for_engine_ready(timeout_secs: u64) -> bool {
    let deadline = std::time::Instant::now() + Duration::from_secs(timeout_secs);
    while std::time::Instant::now() < deadline {
        if let Ok(resp) = ureq_health() {
            if resp {
                log_line("✅ Engine health OK");
                return true;
            }
        }
        thread::sleep(Duration::from_millis(1500));
    }
    log_line("⚠️ Engine health timeout — UI sẽ tự retry");
    false
}

/// Minimal HTTP GET readiness probe.
fn ureq_health() -> Result<bool, ()> {
    use std::io::{Read, Write as IoWrite};
    use std::net::TcpStream;
    let mut stream =
        TcpStream::connect_timeout(&"127.0.0.1:28129".parse().unwrap(), Duration::from_secs(2))
            .map_err(|_| ())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .ok();
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .ok();
    let req = "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    stream.write_all(req.as_bytes()).map_err(|_| ())?;
    let mut buf = String::new();
    let _ = stream.read_to_string(&mut buf);
    Ok(buf.contains("200") || buf.contains("online"))
}

/// Theo dõi local_engine: chết giữa chừng → spawn lại (trừ khi app đang tắt).
fn start_engine_watchdog(
    child_arc: Arc<Mutex<Option<Child>>>,
    shutting_down: Arc<AtomicBool>,
) {
    thread::spawn(move || {
        let mut backoff_secs: u64 = 2;
        loop {
            if shutting_down.load(Ordering::SeqCst) {
                break;
            }
            thread::sleep(Duration::from_secs(3));
            if shutting_down.load(Ordering::SeqCst) {
                break;
            }

            let mut need_respawn = false;
            if let Ok(mut lock) = child_arc.lock() {
                match lock.as_mut() {
                    Some(child) => match child.try_wait() {
                        Ok(Some(status)) => {
                            log_line(&format!(
                                "⚠️ local_engine đã thoát (status={status}) — sẽ khởi động lại"
                            ));
                            *lock = None;
                            need_respawn = true;
                        }
                        Ok(None) => {
                            // còn sống
                        }
                        Err(err) => {
                            log_line(&format!("⚠️ try_wait lỗi: {err} — spawn lại"));
                            *lock = None;
                            need_respawn = true;
                        }
                    },
                    None => {
                        need_respawn = true;
                    }
                }
            }

            if !need_respawn {
                backoff_secs = 2;
                continue;
            }

            // Có thể process khác vẫn giữ port (engine sống nhưng handle mất)
            if ureq_health().unwrap_or(false) {
                log_line("ℹ️ Port 28129 vẫn OK — không spawn trùng");
                backoff_secs = 2;
                continue;
            }

            if shutting_down.load(Ordering::SeqCst) {
                break;
            }

            log_line(&format!("🔄 Respawn local_engine (backoff {backoff_secs}s)…"));
            if let Some(child) = spawn_local_engine() {
                if let Ok(mut lock) = child_arc.lock() {
                    *lock = Some(child);
                }
                let _ = wait_for_engine_ready(90);
                backoff_secs = 2;
            } else {
                thread::sleep(Duration::from_secs(backoff_secs));
                backoff_secs = (backoff_secs * 2).min(30);
            }
        }
    });
}

fn main() {
    let sidecar_child: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
    let child_for_setup = Arc::clone(&sidecar_child);
    let child_for_run = Arc::clone(&sidecar_child);
    let child_for_watch = Arc::clone(&sidecar_child);
    let shutting_down = Arc::new(AtomicBool::new(false));
    let shutting_for_run = Arc::clone(&shutting_down);
    let shutting_for_watch = Arc::clone(&shutting_down);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState {
            child: sidecar_child,
        })
        .setup(move |_app| {
            log_line("==== App setup: start local_engine ====");
            if let Some(child) = spawn_local_engine() {
                let mut state_lock = child_for_setup.lock().unwrap();
                *state_lock = Some(child);
            }
            start_engine_watchdog(child_for_watch, shutting_for_watch);
            // onedir: không unpack 1GB mỗi lần — thường sẵn sàng trong ~30–90s (DB/AV)
            thread::spawn(|| {
                wait_for_engine_ready(180);
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Error while building Tauri application");

    app.run(move |_app_handle, event| match event {
        RunEvent::WindowEvent {
            event: WindowEvent::CloseRequested { .. },
            ..
        }
        | RunEvent::ExitRequested { .. }
        | RunEvent::Exit => {
            if shutting_for_run.swap(true, Ordering::SeqCst) {
                return; // đã xử lý
            }
            log_line("🛑 App closing — stop local_engine");
            let _ = thread::spawn(|| {
                let _ = Command::new("curl")
                    .args(["-X", "POST", "http://127.0.0.1:28129/api/shutdown"])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
            });
            if let Ok(mut lock) = child_for_run.lock() {
                if let Some(mut child) = lock.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
        _ => {}
    });
}
