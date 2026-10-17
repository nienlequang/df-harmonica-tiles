# Overlay desktop (Tauri v2) — tùy chọn

Bản web (**https://df-harmonica-tiles.vercel.app**, xem [README](../README.md)) là sản phẩm chính: người dùng
**không phải tải gì**. Thư mục `src-tauri/` là phần **tùy chọn** cho streamer muốn overlay ô rơi **nổi ngay trên game**
mà không cần OBS Window Capture hay PowerToys: một cửa sổ trong suốt, không viền, luôn nằm trên cùng, cho chuột bấm
xuyên qua, điều khiển bằng phím tắt toàn cục khi đang ở trong game.

> **Trạng thái: CHƯA TỪNG ĐƯỢC BUILD HAY CHẠY THỬ.** Máy phát triển không có Rust toolchain, nên `src-tauri/` và
> `.github/workflows/tauri.yml` được viết theo tài liệu Tauri v2 nhưng chưa biên dịch lần nào. Lần build đầu có thể
> cần sửa vài chỗ nhỏ (chữ ký API giữa các bản Tauri 2.x, đường dẫn icon…). Phần web (`src/desktop/tauriBridge.ts`)
> thì có unit test.

**App không bao giờ gửi phím, chuột hay bất kỳ input nào vào game.** Cửa sổ overlay chỉ hiển thị bản web đã build
(`dist/`); nó không đọc hay ghi bộ nhớ của game. Phím tắt toàn cục chỉ để _app_ nhận lệnh của bạn (phát, dừng…).

## Có gì trong `src-tauri/`

| File                        | Nội dung                                                                                                                                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tauri.conf.json`           | `frontendDist: ../dist`, `devUrl: http://localhost:5173`, `withGlobalTauri: true`, một cửa sổ `main`: `transparent`, `decorations: false`, `alwaysOnTop`, `resizable`, `shadow: false`, 576 × 600 tại (700, 150); bundle `.msi` + `.exe` (NSIS) |
| `Cargo.toml`                | `tauri` 2, `tauri-plugin-global-shortcut` 2 (build: `tauri-build` 2)                                                                                                                                                                            |
| `build.rs`                  | `tauri_build::build()`                                                                                                                                                                                                                          |
| `src/main.rs`               | đăng ký phím tắt toàn cục, emit sự kiện `dfht-command`, bật / tắt click xuyên qua, mở link từ đối số dòng lệnh                                                                                                                                  |
| `capabilities/default.json` | quyền cho trang: chỉ `core:event:allow-listen` / `core:event:allow-unlisten` trên cửa sổ `main`                                                                                                                                                 |

Phía web: `src/desktop/tauriBridge.ts` (import trong `src/main.tsx`).

## Cần cài (Windows)

1. **Rust** qua [rustup](https://rustup.rs) — toolchain `stable` (mặc định trên Windows là MSVC).
2. **Microsoft C++ Build Tools** (Visual Studio Build Tools, chọn workload _Desktop development with C++_).
3. **WebView2 Runtime** — có sẵn trên Windows 10 (1803+) và Windows 11; thiếu thì cài "Evergreen" của Microsoft.
4. **Node.js ≥ 20.19** và `npm ci` như khi phát triển bản web.

## Build

```bash
npm ci

# 1. Icon (chỉ lần đầu): tauri-build trên Windows cần src-tauri/icons/icon.ico
npm run icons                                              # icon PWA → public/icons/
npx --yes @tauri-apps/cli@2 icon public/icons/icon-512.png  # sinh src-tauri/icons/*

# 2. Chạy thử (beforeDevCommand tự chạy `npm run dev`, cửa sổ mở http://localhost:5173)
npx --yes @tauri-apps/cli@2 dev

# 3. Đóng gói (beforeBuildCommand tự chạy `npm run build` → dist/)
npm run build
npx --yes @tauri-apps/cli@2 build
```

- `npx --yes @tauri-apps/cli@2` **tải Tauri CLI về** ở lần chạy đầu (CLI không nằm trong `package.json` để bản web
  giữ ít dependency). Lần build Rust đầu tiên tải crate và mất vài phút.
- Kết quả: `src-tauri/target/release/bundle/msi/*.msi` và `src-tauri/target/release/bundle/nsis/*-setup.exe`
  (`src-tauri/target/` và `src-tauri/gen/` đã gitignore).
- Version lấy từ `package.json` (`"version": "../package.json"`), nên `npm run release` đổi luôn version bản desktop.

## Chọn bài cho overlay

Webview của Tauri có **bộ nhớ riêng** (giống OBS): không thấy thư viện trong trình duyệt của bạn. Có 3 cách:

1. **Mặc định:** cửa sổ mở `index.html?overlay=1&song=seed-quoc-ca-viet-nam&layout=game` (`app.windows[0].url` trong
   `tauri.conf.json`) — bài mẫu, preset "Khớp bảng phím game". Sửa URL này rồi build lại nếu muốn bài / tham số
   khác (tham số: `docs/REFERENCE.md` → "Tham số URL của overlay", trong app là trang Dev notes `#/dev`).
2. **Truyền link khi mở app (khuyên dùng):** trên web bấm **Tạo link OBS** → **Sao chép link**, rồi chạy file `.exe`
   với link đó làm đối số đầu tiên. App **chỉ lấy phần `?…` và `#…`** của link và áp lên trang đóng gói sẵn bên
   trong — không bao giờ tải trang web từ mạng. Dạng tương đối cũng được: `"?overlay=1&song=seed-takediskrush"`
   hoặc `"#/overlay/seed-quoc-ca-viet-nam?layout=game&scale=1.2"`.
   Mọi dạng đều **thay hẳn** query mặc định của cửa sổ: link dạng hash (`#/overlay/…?…`) **không kế thừa**
   `overlay=1&song=…&layout=game` của cách 1 — muốn preset "Khớp bảng phím game" thì ghi `layout=game` trong link
   (link từ **Tạo link OBS** đã có sẵn).
3. **File `.bat`** cho tiện (shortcut `.lnk` của Windows giới hạn ~260 ký tự, không đủ cho link có `data=` dài; dòng
   lệnh `.bat` chứa được ~8000 ký tự):

   ```bat
   @echo off
   rem Sửa đường dẫn tới file .exe đã cài và dán link từ "Tạo link OBS" vào giữa hai dấu ngoặc kép.
   start "" "C:\Program Files\Harmonica Tiles Overlay\Harmonica Tiles Overlay.exe" "https://df-harmonica-tiles.vercel.app/#/overlay?layout=game&data=..."
   ```

   Trong file `.bat`, ký tự `%` phải viết thành `%%` (link do app tạo thường không có `%`).

## Phím tắt toàn cục

Chạy cả khi cửa sổ game đang được chọn (đăng ký trong `src/main.rs` bằng `tauri-plugin-global-shortcut`):

| Phím         | Việc                                                                      |
| ------------ | ------------------------------------------------------------------------- |
| `Ctrl+Alt+P` | Phát / tạm dừng (như Space)                                               |
| `Ctrl+Alt+R` | Phát lại từ đầu (như R)                                                   |
| `Ctrl+Alt+→` | Dòng sau (như →)                                                          |
| `Ctrl+Alt+←` | Dòng trước (như ←)                                                        |
| `Ctrl+Alt+T` | Bật / tắt **click xuyên qua** cửa sổ overlay                              |
| `Ctrl+Alt+D` | Hiện / ẩn **khung cửa sổ** (thanh tiêu đề để kéo, viền để đổi kích thước) |

Không phím tắt nào dùng `Z X C V B N M ,` (phím nốt của game). Khi cửa sổ overlay đang được chọn thì Space / R / ← /
→ của chính trang overlay cũng chạy. Tổ hợp nào đã bị app khác chiếm thì app ghi lỗi ra console và chạy tiếp với các
phím còn lại.

### Cách hoạt động

1. Rust nhận phím tắt (chỉ lúc **nhấn**, bỏ lúc thả) và gửi sự kiện `dfht-command` tới webview, payload là một
   trong `"toggle"`, `"restart"`, `"nextLine"`, `"prevLine"`.
2. `src/desktop/tauriBridge.ts` nghe sự kiện đó qua `window.__TAURI__.event.listen` (API toàn cục có nhờ
   `withGlobalTauri: true`) và phát lại CustomEvent `dfht:command` với `detail: { command }` trên `window`.
3. OverlayView / PlayerView nghe `dfht:command` (`src/overlay/commands.ts`) và làm đúng việc của Space / R / → / ←.

Trong trình duyệt thường (không có `window.__TAURI__`) cầu nối không làm gì. Payload lạ bị bỏ qua.

### Click xuyên qua và di chuyển cửa sổ

- **Click xuyên qua** = `WebviewWindow::set_ignore_cursor_events(true)`: mọi cú bấm chuột rơi xuống game bên dưới
  (cần cho Cúi Xuống / Ngẩng Lên / Nửa Cung). Khởi động ở trạng thái **tắt** (cửa sổ nhận chuột) để bạn còn chỉnh.
- Cửa sổ không viền nên không kéo được; bấm `Ctrl+Alt+D` để hiện khung, kéo / đổi cỡ cho 8 cột nằm đúng trên 8 phím
  của game, rồi `Ctrl+Alt+D` lần nữa để ẩn.
- Quy trình gợi ý: mở app → `Ctrl+Alt+D` → kéo vào vị trí → `Ctrl+Alt+D` → `Ctrl+Alt+T` (bật click xuyên qua) → vào
  game → `Ctrl+Alt+P` để chạy.
- Kích thước mặc định 576 × 600 tại (700, 150) là preset "Khớp bảng phím game" ở màn 1920×1080, Windows scale 100%
  (số trong `tauri.conf.json` là pixel logic, scale 125% / 150% sẽ lệch → kéo lại bằng khung).
- Đóng app: tắt click xuyên qua (`Ctrl+Alt+T`), chọn cửa sổ rồi Alt+F4; hoặc chuột phải biểu tượng trên taskbar →
  Close window.

## Giới hạn

- **Game chạy Fullscreen độc quyền (exclusive) sẽ che mọi cửa sổ always-on-top** — đặt Delta Force ở chế độ
  **Borderless / Windowed (không viền)**.
- Vị trí / kích thước cửa sổ **không được nhớ** giữa các lần mở (chưa dùng plugin window-state).
- Chỉ nhắm **Windows**. macOS cần thêm `macOSPrivateApi` cho cửa sổ trong suốt; Linux phụ thuộc compositor — chưa cấu
  hình.
- Muốn OBS quay cả overlay desktop: Game Capture chỉ lấy hình game (không có overlay); dùng Display Capture, hoặc
  Window Capture cửa sổ overlay với nền `bg=chroma` (thêm vào link) + bộ lọc Chroma Key của OBS (README / hộp thoại OBS
  của bản web không còn cách Window Capture từ vòng 6 — D-348).
- Overlay luôn im lặng (giống bản web); service worker / cập nhật PWA không cần cho bản desktop.
- Chưa build thử (xem đầu trang): một vài chữ ký API Tauri 2.x được viết phòng hờ (vd. `navigate` nhận `&self` hay
  `&mut self`), query trong `app.windows[0].url` chưa được kiểm chứng — nếu bị bỏ mất, đổi sang dạng hash
  `index.html#/overlay/seed-quoc-ca-viet-nam?layout=game`.

## Build trên GitHub Actions (chạy tay)

`.github/workflows/tauri.yml` **chỉ chạy khi bấm "Run workflow"** (Actions → "Tauri desktop") — đẩy tag `v*` không tự
build (bản web vẫn deploy từ máy bằng `npm run deploy:prod`). Mỗi lần chạy: `windows-latest` → Node + Rust → `npm ci` →
sinh icon nếu thiếu → `tauri-apps/tauri-action@v0` build `.msi` + `.exe` → tạo tag `v<version của package.json>` và
**GitHub Release dạng nháp** (xem lại rồi mới publish).
