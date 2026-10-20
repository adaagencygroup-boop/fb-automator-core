// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

#[allow(dead_code)]
struct SidecarState {
    child: Arc<Mutex<Option<CommandChild>>>,
}

fn main() {
    let sidecar_child: Arc<Mutex<Option<CommandChild>>> = Arc::new(Mutex::new(None));
    let child_clone = Arc::clone(&sidecar_child);

    let mut builder = tauri::Builder::default();

    // Deep link forwarding via single instance: focus existing window and forward URL
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        println!("🚀 [Tauri] App instance triggered with args: {:?}", argv);
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
        }

        // If launched via deep-link protocol (e.g. fbautomator://oauth/callback#...)
        let deep_links: Vec<String> = argv
            .into_iter()
            .filter(|arg| arg.starts_with("fbautomator://"))
            .collect();

        if !deep_links.is_empty() {
            println!("🔗 [Tauri] Forwarding deep link to frontend: {:?}", deep_links);
            let _ = app.emit("deep-link://new-url", deep_links);
        }
    }));

    // Register deep-link plugin
    builder = builder.plugin(tauri_plugin_deep_link::init());

    // Register shell plugin
    builder = builder.plugin(tauri_plugin_shell::init());

    let app = builder
        .manage(SidecarState {
            child: sidecar_child,
        })
        .setup(move |app| {
            // Register deep-link protocol scheme on Windows
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }

            // Khởi động Sidecar local_engine tại port 28129
            println!("🚀 [Tauri] Spawning Python Sidecar: local_engine on port 28129...");

            let sidecar_command = app.shell().sidecar("local_engine");
            match sidecar_command {
                Ok(cmd) => {
                    let cmd_with_args = cmd.args(["--port", "28129"]);
                    match cmd_with_args.spawn() {
                        Ok((mut rx, child)) => {
                            println!("✅ [Tauri] Python Sidecar spawned successfully!");
                            let mut state_lock = child_clone.lock().unwrap();
                            *state_lock = Some(child);

                            // Drain stdout and stderr so pipe buffer never blocks
                            tauri::async_runtime::spawn(async move {
                                use tauri_plugin_shell::process::CommandEvent;
                                while let Some(event) = rx.recv().await {
                                    match event {
                                        CommandEvent::Stdout(bytes) => {
                                            println!("[Sidecar] {}", String::from_utf8_lossy(&bytes));
                                        }
                                        CommandEvent::Stderr(bytes) => {
                                            eprintln!("[Sidecar ERR] {}", String::from_utf8_lossy(&bytes));
                                        }
                                        _ => {}
                                    }
                                }
                            });
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
