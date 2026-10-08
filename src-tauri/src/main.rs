// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

struct SidecarState {
    child: Arc<Mutex<Option<CommandChild>>>,
}

fn main() {
    let sidecar_child: Arc<Mutex<Option<CommandChild>>> = Arc::new(Mutex::new(None));
    let child_clone = Arc::clone(&sidecar_child);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState {
            child: sidecar_child,
        })
        .setup(move |app| {
            // Khởi động Sidecar local_engine tại port 28129
            println!("🚀 [Tauri] Spawning Python Sidecar: local_engine on port 28129...");

            let sidecar_command = app.shell().sidecar("local_engine");
            match sidecar_command {
                Ok(cmd) => {
                    let cmd_with_args = cmd.args(["--port", "28129"]);
                    match cmd_with_args.spawn() {
                        Ok((_rx, child)) => {
                            println!("✅ [Tauri] Python Sidecar spawned successfully!");
                            let mut state_lock = child_clone.lock().unwrap();
                            *state_lock = Some(child);
                        }
                        Err(err) => {
                            eprintln!("⚠️ [Tauri] Could not spawn local_engine sidecar: {}. (If developing, run engine.py manually)", err);
                        }
                    }
                }
                Err(err) => {
                    eprintln!("⚠️ [Tauri] Sidecar binary 'local_engine' not configured: {}", err);
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Error while building Tauri application");

    // Quản lý vòng đời tiến trình: Tự động kill local_engine khi đóng App
    app.run(move |_app_handle, event| match event {
        RunEvent::WindowEvent {
            event: WindowEvent::CloseRequested { .. },
            ..
        }
        | RunEvent::ExitRequested { .. } => {
            println!("🛑 [Tauri] Closing app, terminating Python sidecar cleanly...");
            // Gọi shutdown endpoint qua HTTP trước để engine đóng database nhẹ nhàng
            let _ = std::thread::spawn(|| {
                let _ = std::process::Command::new("curl")
                    .args(["-X", "POST", "http://127.0.0.1:28129/api/shutdown"])
                    .output();
            });
        }
        _ => {}
    });
}
