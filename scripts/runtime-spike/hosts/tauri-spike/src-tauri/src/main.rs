// Tauri host spike (MM-010): minimal window + lifecycle events + native export
// leg (resvg SVG->PNG) + measurement modes mirroring the Electron spike.
// Spike code only — zero product reuse assumption.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
use std::time::Instant;

#[tauri::command]
fn spike_ready() {
    println!("[ready] renderer-ready");
    if env::var("SPIKE_QUIT_AFTER_READY").is_ok() {
        std::process::exit(0);
    }
    if let Ok(hold) = env::var("SPIKE_HOLD") {
        let secs: u64 = hold.parse().unwrap_or(5);
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(secs));
            std::process::exit(0);
        });
    }
}

// Native export leg: canonical SVG -> 2x PNG via resvg + explicit font file.
fn run_native_png_export(spec: &str) {
    // spec: "<svgPath>|<outPath>|<fontPath>|<scale>"
    let parts: Vec<&str> = spec.split('|').collect();
    if parts.len() != 4 {
        eprintln!("[export-png] bad spec");
        std::process::exit(2);
    }
    let (svg_path, out_path, font_path, scale) = (parts[0], parts[1], parts[2], parts[3]);
    let scale: f32 = scale.parse().unwrap_or(2.0);
    let t0 = Instant::now();
    let svg = std::fs::read_to_string(svg_path).expect("read svg");

    let mut fontdb = fontdb::Database::new();
    if let Err(e) = fontdb.load_font_file(font_path) {
        eprintln!("[export-png] font load failed: {e}");
    }
    let opts = usvg::Options {
        fontdb: std::sync::Arc::new(fontdb),
        ..Default::default()
    };
    let tree = match usvg::Tree::from_str(&svg, &opts) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[export-png] parse failed: {e}");
            std::process::exit(3);
        }
    };
    let size = tree.size();
    let w = (size.width() * scale).ceil() as u32;
    let h = (size.height() * scale).ceil() as u32;
    let Some(mut pixmap) = tiny_skia::Pixmap::new(w, h) else {
        eprintln!("[export-png] pixmap alloc failed {w}x{h}");
        std::process::exit(4);
    };
    resvg::render(&tree, tiny_skia::Transform::from_scale(scale, scale), &mut pixmap.as_mut());
    match pixmap.encode_png() {
        Ok(png) => {
            std::fs::write(out_path, &png).expect("write png");
            let ms = t0.elapsed().as_secs_f64() * 1000.0;
            println!("[export-png] {:.1}ms {}B", ms, png.len());
            std::process::exit(0);
        }
        Err(e) => {
            eprintln!("[export-png] encode failed: {e}");
            std::process::exit(5);
        }
    }
}

fn main() {
    if let Ok(spec) = env::var("SPIKE_EXPORT_PNG") {
        run_native_png_export(&spec);
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, argv, _cwd| {
            println!("[event] second-instance {:?}", argv);
        }))
        .invoke_handler(tauri::generate_handler![spike_ready])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| match event {
            tauri::RunEvent::Opened { urls } => {
                println!("[event] open-file {:?}", urls);
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } => {
                println!("[event] reopen has_visible_windows={has_visible_windows}");
            }
            _ => {}
        });
}
