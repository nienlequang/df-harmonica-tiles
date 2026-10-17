# Design brief — "Tactical HUD" (vibe Delta Force)

Yêu cầu người dùng (2026-10-14): UX/UI mang **vibe Delta Force**. Diễn giải: giao diện HUD chiến thuật của game bắn
súng quân sự hiện đại — tối, gọn, nét mảnh, chữ in hoa condensed, số kiểu đồng hồ HUD, **điểm nhấn xanh lá neon**
(gợi màu thương hiệu Delta Force: Brandfetch liệt kê `#0FF796` "Spring Green" cho playdeltaforce.com — nguồn tổng hợp,
không chính thức), hổ phách làm màu cảnh báo phụ.

## Nguyên tắc

1. **Lấy cảm giác, không sao chép.** Không dùng logo, font, icon, ảnh chụp hay bố cục y hệt của game/nhà phát hành.
   Mọi thứ tự vẽ bằng CSS/canvas. Chân trang Thư viện và README có dòng: _"Fan-made · không liên kết với nhà phát hành
   Delta Force"_ (trước ở ☰ Menu — đã bỏ theo góp ý 2026-10-15).
2. **Chức năng trước trang trí.** Màu modifier (thường xám trắng, trái xanh dương, phải cam, scroll xanh lá) mang
   nghĩa — giữ nguyên. Trang trí (lưới, ngoặc góc, sọc) mờ, không cạnh tranh với ô rơi.
3. **AA contrast** cho mọi cặp chữ/nền (đo bằng script), focus ring luôn thấy được, không chỉ dựa vào màu.
4. **Nhẹ.** Không ảnh nền, không font tải mạng, không animation liên tục ngoài canvas; tôn trọng
   `prefers-reduced-motion`. Hiệu ứng canvas (glow) phải cache, không tăng chi phí mỗi frame đáng kể.

## Typography

- `--font-hud`: `Bahnschrift, 'DIN Condensed', 'DIN Alternate', 'Roboto Condensed', 'Arial Narrow', system-ui,
sans-serif` — Bahnschrift có sẵn trên Windows 10/11 (máy streamer), dáng DIN, hiển thị tiếng Việt đầy đủ (đã kiểm
  tra). Không tải font.
- Tiêu đề, nhãn, nút, chip, banner: **IN HOA**, `font-stretch: semi-condensed` (nhãn nhỏ: `condensed`),
  `letter-spacing: 0.06em`, weight 600–700.
- Nội dung (mô tả, gợi ý, form): Bahnschrift thường, cỡ ≥ 15 px. Tên bài giữ nguyên hoa/thường. (App không còn lời bài
  hát / karaoke — góp ý 2026-10-15, D-311.)
- Số (thời gian, BPM, điểm, combo): `font-variant-numeric: tabular-nums`.
- Editor: giữ font mono (`ui-monospace, 'Cascadia Mono', Consolas`).
- **Không dùng ký tự ghép (U+0307 / U+0323) cho chấm quãng giản phổ trong DOM** — Bahnschrift đặt dấu lệch; vẽ chấm
  bằng phần tử/pseudo-element riêng (canvas đã vẽ chấm riêng).

## Màu (tokens trong `src/ui/app.css`)

Dark (mặc định):

| Token                                            | Giá trị                                                        | Dùng cho                |
| ------------------------------------------------ | -------------------------------------------------------------- | ----------------------- |
| `--bg`                                           | `#0a0c0e`                                                      | nền trang               |
| `--bg-grid`                                      | `rgb(255 255 255 / 0.03)`                                      | lưới 32 px trên nền     |
| `--surface` / `-2` / `-3`                        | `#11151a` / `#171c22` / `#1f262e`                              | panel, input, hover     |
| `--border` / `--border-strong`                   | `#2b333c` / `#3d4752`                                          | viền mảnh, ngoặc góc    |
| `--text` / `--text-muted`                        | `#e9edf1` / `#9aa5b1`                                          | chữ                     |
| `--accent` / `--accent-strong` / `--accent-text` | `#0ff796` / `#5dffb6` / `#04130c`                              | xanh lá neon (chính)    |
| `--accent-dim`                                   | `#0c2a1e`                                                      | nền hover / chọn        |
| `--warn` / `--warn-text`                         | `#f2c230` / `#14110a`                                          | hổ phách: cảnh báo, sọc |
| `--danger` / `--success`                         | `#ff5a4f` / `#3fd07a`                                          | trạng thái              |
| `--focus`                                        | `#0ff796` (+ outline tối 1 px bên trong khi nằm trên nền sáng) | focus ring              |

Light ("Desert", cùng cấu trúc): nền cát `#e8e3d3`, panel `#f4f0e4`, chữ `#1b1e18`, muted `#4b4f42`, viền `#b9b29c`,
accent xanh đậm `#006b44` (chữ trên accent `#ffffff`), warn `#7a5c00`. Kiểm AA lại toàn bộ.

Đã đo (WCAG): chữ/nền 16.6:1, muted trên panel 7.3:1 (trên `--surface-3` 6.1:1), accent xanh trên nền 13.8:1 (trên
`--surface-2` 12.1:1), chữ trên accent 13.4:1, chữ trên `--accent-dim` 13.1:1, warn trên nền 11.7:1; light: chữ 13.1:1,
muted 6.6–7.4:1, accent `#006b44` trên nền 5.1:1, trắng trên accent ≥ 5.7:1.
**Viền điều khiển form** (input, select, toggle, checkbox) phải ≥ 3:1 với nền: token `--control-border` = `#64717e`
(dark, 3.4–3.7:1) / `#7f7862` (light, 3.4–3.9:1); `--border` / `--border-strong` (≈ 1.9:1) chỉ dùng cho đường trang trí.

Màu modifier giữ nguyên `src/ui/palette.ts`. **Xanh neon accent gần màu tile Nửa Cung (`#22c55e`, chỉ 1.6:1)** → quy tắc:
accent CHỈ dùng cho khung UI (nút chính, focus, mục đang chọn — vd. nửa PC | Mobile đang bật ở thanh dọc màn chơi —,
thanh tiến độ, số thứ tự section, glow nút ▶, ngoặc góc khi hover); KHÔNG bao giờ tô tile hay nút phím game bar bằng accent; hit line = lõi trắng `#effff7` + glow
accent mảnh; tile Nửa Cung giữ `#22c55e` + badge `#` (không phụ thuộc màu). Hổ phách `--warn` cho sọc cảnh báo, cảnh
báo bản quyền, trạng thái chú ý.

## Hình khối & chi tiết

- Bo góc 2 px. Nút chính và panel lớn: **vát góc** (clip-path cắt ~8 px góc trên-phải và dưới-trái).
- **Ngoặc góc** (L 10 px, `--border-strong`, hover → accent) trên card / khung stage.
- Đường kẻ 1 px; tiêu đề section dạng `01 / GIAO DIỆN` với đường mảnh kéo dài sang phải.
- Tag dạng ngoặc vuông: `[ MẪU ]`, `[ CỦA BẠN ]`, `[ 76 BPM ]`.
- Nền: lưới mảnh + vignette nhẹ (CSS gradient), scanline tĩnh rất mờ (≤ 3%).
- Toast: kiểu thông báo HUD, vạch accent bên trái.

## Màn hình

- **Màn đầu = màn chơi** (góp ý 2026-10-15, D-306): `#/` là màn chơi đầy đủ với bài mẫu — không còn màn demo
  (`▶ CHƠI THỬ`) hay ☰ Menu dạng drawer.
- **Thanh điều hướng** (Thư viện, Cài đặt, Editor, MIDI, Tự chơi, Hướng dẫn, chia sẻ…): chỗ tên app ở góc trên trái là
  nút **`◂ VỀ MÀN CHƠI`** (chữ in hoa; mũi tên accent trong ô vuông vát góc, hover ô thành nền accent; tooltip = tên
  bài); góc phải là link trang + nút ngôn ngữ / theme (PrefButtons). Vạch accent ngắn ở mép dưới-trái thanh; màn hẹp thanh xuống 2 hàng thì bỏ vạch (không nằm
  nhầm dưới một link khác).
- **Player (màn chơi):** header = thanh trạng thái HUD (`◂ THƯ VIỆN`, tên bài, tag `[76 BPM]` `[ĐIỆP KHÚC]`, chip
  cảnh báo màu `--warn` — chip `@scroll −1` là link tới trình soạn; bài chưa lưu (bản nháp / bài tạm từ link) có chip
  hổ phách + một nút nhỏ giữ bài lại), góc phải = ngôn ngữ + theme (PrefButtons như thanh điều hướng); dưới header là
  thanh điều khiển (nút transport vuông viền mảnh, đang bật = nền accent). Thân 3 cột:
  - **Trái — danh sách phím tắt đầy đủ** (ShortcutsHelp, ≥ 1200 px; cao ≤ 820 px thì chế độ gọn): nhóm in hoa nhỏ,
    `kbd` viền mảnh, chân cột có link "Xem hướng dẫn"; màn hẹp hơn thì ẩn cột, nút **?** mở cùng nội dung trong hộp
    thoại.
  - **Giữa — khu tiles** (stage có khung ngoặc góc).
  - Canvas: lane tối `#0c1013` xen kẽ rất nhẹ, vạch lane mảnh; **hit line = tia laser lõi trắng + glow xanh neon** 2 px + hai
    đầu dạng ngoặc `◂ ▸`; tile phẳng, góc 3 px, viền trong tối 1 px + highlight mép trên; nhãn phím Bahnschrift
    bold condensed; ribbon "GIỮ …" (kiểu PC) in hoa kiểu stencil. Kiểu Mobile (D-366, vòng 7 D-373 / D-375): KHÔNG
    gutter ribbon / nhãn "CHẠM: <tên chế độ>"; mỗi lần chạm chế độ là một **vòng rỗng trong suốt** — viền 2–3 px màu
    chế độ (token canvas `cueRing`, sáng: bản đậm hơn ≥ 3:1 trên nền cát) + quầng `cueHalo` hai bên viền, Ø ngoài = Ø
    nút chế độ, chữ "CHẠM" in hoa ở tâm (`cueText` + quầng chữ; mờ dần khi vòng tới gần nút và không có lúc đáp — tên
    chế độ in trong nút đọc được lúc chạm, D-390) — rơi nhanh gấp 1,75 lần tile và đồng tâm với nút
    đúng beat phải chạm, vẽ trên lớp canvas trong suốt phủ trên bàn nút DOM. Tên nút chế độ trong hình tròn chỉ xuống
    dòng ở dấu cách, từ dài thu nhỏ chữ (không "SEMITON / E"). Màu chế độ là màu modifier, không phải accent.
    Overlay OBS kiểu Mobile không vẽ bàn nút: chỉ 4 vòng đích mờ (viền mảnh màu chế độ ~50 %, không tô, không chữ) ở
    hàng nút chế độ; dải ngang: 4 vòng mờ đó ngay sau hit line, không game bar Mobile (D-390).
  - Banner "ĐANG GIỮ" / "CHẾ ĐỘ": nền màu modifier + **sọc cảnh báo chéo** mờ, chữ in hoa giãn chữ.
  - Game bar: panel tối bán trong suốt viền mảnh (gợi bảng phím trong game nhưng không sao chép), keycap vuông có
    vát, phím đang cần sáng màu modifier. Kiểu Mobile: bàn nút kiểu game ở đáy khu tiles thay game bar.
  - **Phải — thanh dọc** (PlayerSideBar, rộng ~104 px, nền `--surface`, viền trái mảnh), trên → dưới: nhóm
    **Kiểu điều khiển** (hai nửa PC | Mobile ghép liền, `aria-pressed`, nửa đang bật nền accent), **Cửa sổ nổi**,
    **OBS**, **Chia sẻ**, **Cài đặt** — mỗi ô vuông viền mảnh, icon trên + nhãn ngắn in hoa condensed dưới; màn hẹp chỉ
    còn icon (nhãn vẫn là tên truy cập). Bong bóng giải thích (vd. trình duyệt chưa hỗ trợ cửa sổ nổi) nổi bên trái
    thanh, vạch `--warn` bên trái.
  - **Đáy — thanh tiến độ** trải hết bề ngang (thanh chia vạch có khấc tại đầu mỗi section, thời gian mono).
- **Thư viện:** mục **Thêm bài** = lưới 2 × 2 (màn hẹp xếp dọc), thứ tự cố định (01 Tạo bài với AI → 02 Tạo bài từ
  file MIDI / MusicXML → 03 Nhập file ký tự → 04 Tự chơi để tạo bài — góp ý 2026-10-16, D-357), mỗi ô một dòng gợi ý
  muted; thẻ bài + ngoặc góc; dòng fan-made ở chân trang. Trang con **Tạo bài với AI** (`#/ai`): 4 thẻ bước đánh số,
  ô dán lớn viền đứt (liền khi focus), dòng kết quả ✓ / ! + danh sách chỗ không đọc được, link nhỏ "hoặc tự gõ từ
  đầu"; Editor có ô dán gọn cùng kiểu ngay trên ô `.harm` (vạch accent bên trái — khung UI, không phải tile).
- **Cài đặt / Editor / MIDI:** panel + ngoặc góc, header section đánh số, form control viền mảnh, giữ bố cục hiện có
  (không đổi luồng thao tác, không đổi nhãn/aria — e2e dựa vào chúng). Cài đặt (D-355): 2 cột cố định, 01 Kiểu điều
  khiển · 02 Giao diện · 03 Phát bài · 04 Harmonica | 05 Âm thanh (thẻ thường) · 06 Luyện tập · 07 MIDI cuối, ô cạnh
  nhau, không khoảng trống lớn; không thẻ Phím tắt, không ô Lookahead. Ô Đếm ngược có hai dòng gợi ý `.field-hint`
  (dòng thứ hai: Cửa sổ nổi / trang mini / video nổi tối thiểu 3 giây).
- **Link "Dev notes"** (D-387): cố ý kín đáo — chữ nhỏ (0,78rem) `--text-muted` gạch chân, căn giữa, cao ≥ 24 px, ở
  cuối trang Hướng dẫn và sau dòng "Đặt lại mặc định" của Cài đặt; hover `--text`, focus ring chung của app; không có
  trong nav. Trang `#/dev`: h1 "Dev notes", khối "Bản đang chạy" (tiêu đề chỉ cho trình đọc màn hình; Phiên bản / Commit
  chữ mono, Ngày build chữ thường), mục lục
  hai link, rồi REFERENCE + CHANGELOG bằng bộ hiển thị markdown của trang Hướng dẫn (tiêu đề hạ một bậc).
- **Hộp thoại điện thoại** (D-383 / D-384): "Cửa sổ nổi trên điện thoại" = câu hỏi + hai nút lớn (tên + một dòng gợi
  ý; nút đoán theo máy là nút chính) + dòng chú thích nhỏ; hộp thoại Android / Apple có dòng chân "Điện thoại: … · Đổi
  loại điện thoại" (link-button nhỏ). Apple: tiến độ dựng (`<progress>` + %), nút chính lớn "Mở video nổi" (khóa tới
  khi dựng xong — lúc khóa trông như nút phụ viền nét đứt chữ `--text-muted`, không giống nút chính bấm được; mô tả
  bằng dòng tiến độ + lời nhắc qua `aria-describedby`).
- **Overlay:** giữ tối giản (nền trong suốt; `bg=chroma` chỉ còn cho link cũ), chỉ áp kiểu tile / hit line / banner;
  kiểu Mobile + lane dọc: làn theo hình học bàn nút nhưng KHÔNG vẽ bàn nút / game bar (trên stream nút thật của game
  nằm dưới) — chỉ 4 vòng đích mờ ở hàng nút chế độ, banner ở đầu khu làn. Hộp thoại OBS: 01 Kiểu overlay · 02 Hiển
  thị · 03 Gửi thẳng vào OBS (khuyên dùng) · 04 Browser Source thủ công và hàng "Xem trước" (D-348). Cửa sổ **"Xem trước"** (`preview=1`): nền tối thường `#050607` ngay từ khung đầu, khung
  16:9, bảng phím game phác xám (kiểu PC; kiểu Mobile không phác keycap), nhãn "Xem trước · không dùng để quay" ở góc
  trên phải và dòng trạng thái nhỏ "Đang chờ màn chơi…" (panel HUD tối) — không bao giờ có trong OBS. Không có nút
  "⛶ Toàn màn hình" / Window Capture / lựa chọn nền chroma.

## Kiểm tra bắt buộc sau khi áp

Screenshot 390 × 844, 1920 × 1080, 2560 × 1440 cho mọi route ở cả dark + light; script đo contrast AA các cặp màu
token + chữ trên tile/banner; e2e xanh; chụp lại ảnh README (`docs/images`).
