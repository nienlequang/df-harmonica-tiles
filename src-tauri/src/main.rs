//! Delta Force Harmonica Tiles — overlay desktop (Tauri v2). Hướng dẫn: docs/TAURI.md.
//!
//! CHƯA TỪNG ĐƯỢC BUILD / CHẠY THỬ trên máy phát triển (không có Rust toolchain) — viết theo tài liệu
//! Tauri v2 + tauri-plugin-global-shortcut 2. Cửa sổ chỉ HIỂN THỊ bản web đã build (`../dist`); app không
//! bao giờ gửi phím hay chuột vào game.
//!
//! Phím tắt toàn cục (chạy cả khi đang ở trong game):
//!   Ctrl+Alt+P   phát / tạm dừng       → emit "dfht-command" với payload "toggle"
//!   Ctrl+Alt+R   phát lại từ đầu       → "restart"
//!   Ctrl+Alt+→   dòng sau              → "nextLine"
//!   Ctrl+Alt+←   dòng trước            → "prevLine"
//!   Ctrl+Alt+T   bật / tắt click xuyên qua cửa sổ (set_ignore_cursor_events)
//!   Ctrl+Alt+D   hiện / ẩn khung cửa sổ (thanh tiêu đề để kéo, viền để đổi cỡ)
//! Trang web nhận "dfht-command" ở src/desktop/tauriBridge.ts rồi phát CustomEvent `dfht:command`.

// Bản release không mở thêm cửa sổ console trên Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager, Runtime, Url, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Nhãn cửa sổ trong tauri.conf.json (capabilities/default.json cũng trỏ tới nhãn này).
const MAIN_WINDOW: &str = "main";
/// Tên sự kiện gửi tới webview (= TAURI_COMMAND_EVENT trong src/desktop/tauriBridge.ts).
const COMMAND_EVENT: &str = "dfht-command";

/// Click xuyên qua đang bật? Cửa sổ khởi động ở trạng thái nhận chuột bình thường.
static CLICK_THROUGH: AtomicBool = AtomicBool::new(false);
/// Khung cửa sổ đang hiện? tauri.conf.json đặt `decorations: false`.
static FRAME_VISIBLE: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Copy, Debug)]
enum Action {
    /// Lệnh cho trang: "toggle" | "restart" | "nextLine" | "prevLine" (contract `dfht:command`).
    Command(&'static str),
    ToggleClickThrough,
    ToggleFrame,
}

/// Mọi phím tắt toàn cục. Không dùng Z X C V B N M , (phím nốt của game / chế độ luyện tập).
fn bindings() -> [(Shortcut, Action); 6] {
    let ctrl_alt = Some(Modifiers::CONTROL | Modifiers::ALT);
    [
        (Shortcut::new(ctrl_alt, Code::KeyP), Action::Command("toggle")),
        (Shortcut::new(ctrl_alt, Code::KeyR), Action::Command("restart")),
        (Shortcut::new(ctrl_alt, Code::ArrowRight), Action::Command("nextLine")),
        (Shortcut::new(ctrl_alt, Code::ArrowLeft), Action::Command("prevLine")),
        (Shortcut::new(ctrl_alt, Code::KeyT), Action::ToggleClickThrough),
        (Shortcut::new(ctrl_alt, Code::KeyD), Action::ToggleFrame),
    ]
}

fn action_for(shortcut: &Shortcut) -> Option<Action> {
    bindings()
        .into_iter()
        .find(|(s, _)| s == shortcut)
        .map(|(_, action)| action)
}

fn on_shortcut<R: Runtime>(app: &AppHandle<R>, shortcut: &Shortcut, state: ShortcutState) {
    // Chỉ xử lý lúc nhấn (bỏ lúc thả): mỗi lần bấm đúng một lệnh.
    if !matches!(state, ShortcutState::Pressed) {
        return;
    }
    let Some(action) = action_for(shortcut) else {
        return;
    };
    match action {
        Action::Command(command) => {
            if let Err(err) = app.emit(COMMAND_EVENT, command) {
                eprintln!("[dfht] không gửi được lệnh {command}: {err}");
            }
        }
        Action::ToggleClickThrough => toggle_window_flag(app, &CLICK_THROUGH, |window, on| {
            window.set_ignore_cursor_events(on)
        }),
        Action::ToggleFrame => {
            toggle_window_flag(app, &FRAME_VISIBLE, |window, on| window.set_decorations(on))
        }
    }
}

/// Đảo một trạng thái cửa sổ; chỉ ghi nhớ trạng thái mới khi Tauri áp dụng thành công.
fn toggle_window_flag<R: Runtime>(
    app: &AppHandle<R>,
    flag: &AtomicBool,
    apply: impl Fn(&WebviewWindow<R>, bool) -> tauri::Result<()>,
) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let next = !flag.load(Ordering::SeqCst);
    match apply(&window, next) {
        Ok(()) => flag.store(next, Ordering::SeqCst),
        Err(err) => eprintln!("[dfht] không đổi được trạng thái cửa sổ: {err}"),
    }
}

/// Đối số dòng lệnh đầu tiên không bắt đầu bằng `-` = link overlay (vd. link từ nút "Tạo link OBS", hoặc
/// dạng tương đối `?overlay=1&data=…` / `#/overlay/<id>?…`). Chỉ lấy phần `?query` và `#hash` đặt lên trang
/// của chính app — origin giữ nguyên là bản đóng gói, không bao giờ mở trang web ngoài.
fn open_link_argument<R: Runtime>(app: &AppHandle<R>) {
    let Some(arg) = std::env::args().skip(1).find(|a| !a.starts_with('-')) else {
        return;
    };
    // `navigate` nhận `&self` hoặc `&mut self` tùy bản Tauri 2.x — `mut` cho chắc.
    #[allow(unused_mut)]
    let Some(mut window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let Ok(base) = window.url() else {
        return;
    };
    let link = arg.trim();
    // Mọi dạng đều bắt đầu từ query SẠCH: router của web gộp location.search với query trong hash (khóa
    // thiếu trong hash lấy từ search), nên giữ `overlay=1&song=…&layout=game` mặc định của cửa sổ sẽ làm
    // link `#/overlay/<id>?…` kế thừa `layout=game` (và `song` / tham số khác) ngoài ý muốn.
    let target = if let Some(fragment) = link.strip_prefix('#') {
        let mut url = base.clone();
        url.set_query(None);
        url.set_fragment(Some(fragment));
        Some(url)
    } else if let Some(rest) = link.strip_prefix('?') {
        let (query, fragment) = match rest.split_once('#') {
            Some((q, f)) => (q, Some(f)),
            None => (rest, None),
        };
        let mut url = base.clone();
        url.set_query(Some(query));
        url.set_fragment(fragment);
        Some(url)
    } else {
        match Url::parse(link) {
            Ok(full) if matches!(full.scheme(), "http" | "https") => {
                let mut url = base.clone();
                url.set_query(full.query());
                url.set_fragment(full.fragment());
                Some(url)
            }
            _ => base.join(link).ok().filter(|url| url.origin() == base.origin()),
        }
    };
    match target {
        Some(url) => {
            if let Err(err) = window.navigate(url) {
                eprintln!("[dfht] không mở được link overlay: {err}");
            }
        }
        None => eprintln!("[dfht] bỏ qua đối số không phải link overlay: {link}"),
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| on_shortcut(app, shortcut, event.state()))
                .build(),
        )
        .setup(|app| {
            let shortcuts = app.global_shortcut();
            for (shortcut, action) in bindings() {
                // Tổ hợp đã bị app khác chiếm: báo rồi chạy tiếp với các phím còn lại.
                if let Err(err) = shortcuts.register(shortcut) {
                    eprintln!("[dfht] không đăng ký được phím tắt cho {action:?}: {err}");
                }
            }
            open_link_argument(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("không chạy được ứng dụng Tauri");
}
