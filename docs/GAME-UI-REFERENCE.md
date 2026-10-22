# Tham chiếu giao diện kèn trong game (đo từ ảnh stream thật)

Nguồn: ảnh chụp stream của streamer do người dùng gửi (2026-10-14), khung hình OBS 16:9 đã thu nhỏ còn
1334×751; số đo dưới đây quy đổi về canvas **1920×1080** (hệ số ≈ 1.439), sai số khoảng ±5 px. Ảnh chỉ dùng để
đo; app không chứa hình/tài nguyên của game.

## Bảng gợi ý phím của game (khi cầm kèn)

- Một khung bo góc nền tối bán trong suốt, **căn giữa theo chiều ngang**, ở phần dưới màn hình, ngay trên hai tay
  cầm kèn. Khung ≈ x 681–1241, y 758–921 (rộng ≈ 560, cao ≈ 163; đo lại trên ảnh nét v1.0.1: x ≈ 683–1237 — mục
  "Khung bảng phím PC" dưới).
- 3 hàng, đúng thứ tự game bar của app:
  1. Hàng số `1 2 3 4 5 6 7 1̇` — tâm y ≈ 800.
  2. Hàng phím `Z X C V B N M ,` — keycap vuông nhỏ (≈ 22 px) nền sáng chữ tối, tâm y ≈ 840.
  3. Hàng modifier — y ≈ 885: icon chuột (trái) + "Cúi Xuống", icon nút cuộn + "Nửa Cung", icon chuột (phải) +
     "Ngẩng Lên". Game dùng icon chuột, không ghi chữ "[chuột trái]".
- Tâm 8 cột phím theo x: 733, 797, 862, 927, 992, 1058, 1123, 1187 → **bước cột ≈ 65 px**, tâm nhóm = 960.
- Game KHÔNG hiển thị trạng thái đang giữ chuột (không có gì tương đương banner "ĐANG GIỮ") → banner của app có
  giá trị riêng trên overlay.
- Khi quy đổi sang 2560×1440: nhân 1.333 (bước cột ≈ 87 px, hàng phím y ≈ 1120). UI scale trong cài đặt game có
  thể làm lệch → streamer tinh chỉnh bằng thanh "Cỡ giao diện game" của hộp thoại OBS (bố cục cả canvas, xem
  dưới) hoặc kéo / thu phóng source trong OBS (link cũ không có `fit=canvas`).

## Khung bảng phím PC — số đo ảnh chụp của chủ dự án (v1.0.1)

Nguồn: ảnh chụp bảng phím PC trong game của chủ dự án (2026-10-17, cắt 1109 × 337 px quanh khung; nét, gấp ≈ 2 lần
1080p — bước cột 130 px). Đo bằng sườn độ sáng từng cột / hàng (canvas `getImageData`, lọc thông cao) + ảnh phóng 4–8×
có lưới, sai số ±1 px của ảnh (±0,5 px ở 1080p). Mọi số theo **bước cột `s`** (tâm hai keycap liền nhau) và tính từ
**tâm nhóm 8 phím** `X` (ảnh: 556,5 px; 1080p: 960). Ảnh chỉ dùng để đo, không nằm trong repo.

| Phần                                    | Ảnh 1109 × 337 (px)                                           | Theo `s` (từ `X`)                          | 1080p (px)                       |
| --------------------------------------- | ------------------------------------------------------------- | ------------------------------------------ | -------------------------------- |
| Tâm 8 keycap `Z … ,`                    | 101,5 + 130·i (đúng tới 0,01 px)                              | ±0,5 … ±3,5 s                              | 732,5 + 65·i                     |
| Keycap                                  | 40 × 40 (y 155 → 195)                                         | 0,31 s                                     | ≈ 20                             |
| 7 vạch ngăn cột (mảnh, sáng)            | x 165,7 · 295,5 · … · 945,7 (trung điểm hai tâm, ±1)          | ±0,5 … ±3 s; dài y 66 → 189 (0,95 s)       | 765 + 65·i                       |
| Viền trong có hoa văn (góc cong)        | x 32 / 1081                                                   | **±4,035 s** (0,535 s ngoài tâm cột 1 / 8) | ≈ 698 / 1222                     |
| Vạch hoa văn ngang (trên / dưới)        | y 36, x 68 → 1043 (đứt ở giữa 521 → 593) / y 309, x 69 → 1049 | 0,24 s / 2,35 s dưới mép trên khung        | —                                |
| Khung ngoài (mép tấm nền bo góc)        | x ≈ 1 / 1107 (±2), y ≈ 4 / 334                                | **±4,26 s**; cao ≈ 2,54 s                  | ≈ 683 / 1237 (553,8); cao ≈ 165  |
| Hàng số `1 … 1̇` / keycap / chữ modifier | tâm y 94,5 / 175 / 260,5 (chữ x 158 → 952)                    | 0,70 / 1,32 / 1,97 s dưới mép trên khung   | ≈ 803 / 843 / 886 (khung từ 758) |

- Khớp số đo cũ từ ảnh stream thu nhỏ (khung x 681–1241, hàng y 800 / 840 / 885, keycap ≈ 22, ±5 px).
- Khoảng cách: keycap ngoài cùng → viền trong **0,38 s**, → khung ngoài 0,61 s; keycap → vạch ngăn 0,345 s. Viền
  trong chỉ cách mép ngoài 8 cột (±4 s) **0,035 s** (≈ 2 px ở 1080p) — game có khoảng trống quanh phím vì keycap hẹp
  (0,31 s) chứ không vì đệm; vạch ngăn chỉ có GIỮA các cột, mép ngoài là viền trong.

### Hệ quả: Cửa sổ nổi PC + overlay khớp game (v1.0.1, góp ý "ô ngoài cùng không được sát viền")

- Trước v1.0.1 khung = đúng 8 làn (±4 s): ô (rộng 0,85 s, cách mép làn 7 %) cách mép cửa sổ / ngoặc hit line / vạch
  gutter 5 px ở 1080p — sát viền.
- Nay khung = **khung ngoài của bảng phím** (±4,26 s, rộng 8,52 s): 8 làn vẫn đúng bước + tâm phím ở giữa, đệm
  `GAME_FRAME_PAD` = **0,26 s** mỗi bên (`src/player/layout.ts`, option `framePad` của layout / renderer) → ô ngoài
  cùng cách mép khung **0,337 s ≈ 21,9 px** ở 1080p — gần đúng khoảng keycap ngoài cùng → viền trong của game (0,38 s).
  Mép 8 làn (±4 s) rơi đúng chỗ viền trong (±4,035 s, lệch ≈ 2 px ở 1080p): như game, vạch ngăn chỉ vẽ GIỮA các
  cột, mép ngoài 8 làn không có vạch (nền làn của Cửa sổ nổi dừng ở đó); thêm một vạch ở mép phải khung = ranh giới
  với gutter ribbon (dải giữ), gutter nằm NGOÀI khung bên phải như trước.
- Không đặt mép cửa sổ ở viền trong: viền trong chỉ cách mép làn 0,035 s → ô vẫn cách mép ≈ 7 px (vẫn sát). Muốn
  đổi chỗ mép thì chỉ sửa `GAME_FRAME_PAD` (0,035 = viền trong, 0,26 = khung ngoài) — Cửa sổ nổi, overlay, bảng phím
  minh họa của "Xem trước" và test đều đọc hằng số đó.
- Chỉ áp cho Cửa sổ nổi PC và overlay `layout=game&fit=canvas` (lane dọc). Link cũ `fit=source` (streamer tự kéo
  source cho 8 làn trùng 8 phím) giữ 8 làn phủ kín — không xê dịch làn của link đang dùng. Kiểu Mobile (`'pad'`) bỏ
  qua `framePad` (khung overlay rộng hơn thì 8 cột Mobile rộng theo).

## Bố cục stream của streamer (để không đè lên)

- Phải trên: khung chat (x ≈ 1510–1910, y ≈ 125–420). Phải giữa: webcam (y ≈ 420–615). Phải dưới: thanh mục tiêu
  donate + mã QR (y ≈ 630–1040).
- Trái dưới: danh sách đồng đội + HUD máu/đạn. Trái trên: minimap.
- Vùng trống hợp lý cho overlay nốt rơi: **cột giữa phía trên bảng phím của game** (x ≈ 680–1280, y ≈ 150–750).

## Hệ quả cho overlay (Phase 3)

- Preset overlay **"khớp game"** (`?layout=game`): 8 lane phủ kín chiều ngang vùng lane, không lề, để streamer
  chỉ cần kéo giãn source cho 8 cột rơi đúng trên 8 keycap; hit line sát đáy source; KHÔNG vẽ game bar (game đã có);
  giữ hold ribbon (gutter phải) và banner "ĐANG GIỮ" (đặt ngay trên hit line); tile có độ mờ chỉnh được
  (`?opacity=`) để không che hết gameplay.
- Kích thước đề xuất ở 1920×1080: vùng lane rộng 520 px (8 × 65), cộng gutter ribbon 56 px → source **576 × 600**,
  đặt tại **x = 700, y = 150** (đáy source y = 750 ≈ mép trên bảng phím game, nên tile chạm "hit line" đúng lúc
  rơi xuống bảng phím). Ở 2560×1440: 768 × 800 tại x = 933, y = 200. (Cỡ của link cũ `fit=source` — streamer tự đặt
  source; bố cục cả canvas dưới đây từ v1.0.1 rộng bằng khung bảng phím: 610 × 600 tại (683, 150).)
- Hướng dọc mặc định của overlay giữ như Player; preset ngang (`?lanes=horizontal`) vẫn có cho bố cục khác.

## Bố cục cả canvas (`?fit=canvas`, góp ý 2026-10-15 "bay thẳng vào đúng chỗ")

Trang overlay phủ **cả canvas OBS** — Browser Source Width × Height = cỡ canvas, vị trí 0, 0 (app tự tạo qua
obs-websocket, hoặc người dùng dán link), hoặc cửa sổ "Mở thử" toàn màn hình + Window Capture + Fit to screen —
và tự vẽ khung overlay đúng chỗ theo các số đo ở trên; người dùng không kéo / căn gì. Hình học ở
`canvasPlacement` (`src/overlay/overlayParams.ts`, test ở `overlayParams.test.ts` dùng chính `computeLayout` của
renderer):

- Khung tham chiếu = hình 16:9 lớn nhất nằm giữa viewport, hệ số `k = rộng khung / 1920`. Canvas không 16:9
  (vd. 2560×1080) thì chừa hai bên / trên dưới — game căn UI theo giữa màn.
- Khớp game (v1.0.1): khung = khung bảng phím PC `553,8·k` (8 làn `520·k`, bước `65·k`, + đệm `GAME_FRAME_PAD` =
  0,26 bước mỗi bên — mục "Khung bảng phím PC" ở trên) × `600·k`, góc trên trái `(683,1, 150)·k`; gutter ribbon
  `round(56 · k · scale · cỡ ô)` nằm thêm bên phải khung (cỡ ô của Player chỉ nới gutter, không xê dịch làn).
  Kết quả: 1920×1080 → 610 × 600 tại (683, 150) (8 làn x 700–1220, mép phải khung / mép trái gutter 1237);
  2560×1440 → 813 × 800 tại (911, 200); 1280×720 → 406 × 400 tại (455, 100); 1366×768 → 434 × 427 tại (486, 107);
  3840×2160 → 1220 × 1200 tại (1366, 300); 2560×1080 → 610 × 600 tại (1003, 150). Tâm 8 làn trùng tâm 8 keycap
  (±1 px; 4K ±2 px). Trước v1.0.1: 576 × 600 tại (700, 150) — 8 làn sát mép khung.
- Tinh chỉnh `scale` (thanh "Cỡ giao diện game" của hộp thoại OBS, 70–130 %) = UI scale trong game khác mặc
  định: khung phóng / thu quanh **đáy-giữa bảng phím game** `(960, 921)·k`; quá to thì khung thấp lại, không
  trồi khỏi mép trên.
- Dải ngang: 1140 × 440 tại (370, 310) — đáy ngay trên bảng phím, không lấn khung chat bên phải (neo khi tinh
  chỉnh: đáy-giữa (940, 750)). Cột đầy đủ có game bar: 560 × 920 tại (1290, 80) — bên phải giữa màn, không đè
  bảng phím game (x 681–1241; neo (1570, 1000)).
- Giới hạn: Window Capture từ màn hình thứ 2 KHÔNG 16:9 + Fit to screen (OBS giữ tỉ lệ) thì khung 16:9 của trang
  không trùng canvas → dùng màn 16:9 hoặc Browser Source.

## Cửa sổ nổi PC — cỡ theo màn hình (bổ sung trước deploy C, 2026-10-16, D-407 – D-410, D-418, D-419)

Cửa sổ nổi (Document Picture-in-Picture) mở sẵn ở **cỡ chuẩn** của màn hình đang dùng để người chơi chỉ kéo nó tới
chỗ (`src/pip/pipPrefs.ts`, test `pipPrefs.test.ts` dùng chính `computeLayout` của renderer):

- **Giả định: UI game phóng theo CHIỀU CAO màn hình**, hệ số `k = cao px thật / 1080` (= quy tắc DPI mặc định
  "cạnh ngắn" của Unreal Engine — màn ngang thì cạnh ngắn là chiều cao). Mọi số đo 1080p ở trên nhân `k`, bảng
  phím vẫn căn giữa theo chiều ngang, đáy bảng phím neo theo đáy màn → mép trên bảng phím ở `y = 750·k` từ mép trên.
  - **16:10** (1920 × 1200, 2560 × 1600): theo giả định `k` = 1,111 / 1,481 (bước phím ≈ 72 / 96 px). Nếu game
    thật ra phóng theo bề ngang ở màn hẹp hơn 16:9 (một số game giữ khung 16:9 vừa bề ngang) thì `k` = 1 / 1,333 —
    khi đó 8 cột rộng hơn phím ≈ 11 %: kéo giãn cửa sổ cho khớp (cỡ đã kéo được nhớ theo màn hình) và báo lại để
    sửa giả định.
  - **Ultrawide** (2560 × 1080, 3440 × 1440, 5120 × 1440): `k` theo chiều cao như màn 16:9 cùng chiều cao, bảng phím ở
    giữa — cửa sổ chuẩn y hệt màn 16:9 cùng chiều cao.
  - Chưa đo trên màn thật khác 1080p; "UI scale" trong cài đặt game khác mặc định cũng làm lệch (như overlay).
- **Rộng** (v1.0.1) = khung bảng phím PC `553,8·k` (8 làn `520·k`, bước 65·k = bước phím, + đệm 0,26 bước mỗi bên —
  ô ngoài cùng cách mép cửa sổ ≈ 21,9·k px thay vì 5) + gutter ribbon renderer vẽ ở `tileScale = k / dpr`
  (`round(56 · tileScale)` px CSS; tileScale bị kẹp ≥ 0,5 ở 768p @150 % thì gutter nhỉnh hơn nhưng khung / 8 làn
  vẫn đúng) — tức ≈ `610·k` px thật (trước v1.0.1: `576·k`). Đặt mép trái cửa sổ thẳng mép trái khung bảng phím là 8
  cột thẳng 8 phím.
- **Cao** (góp ý chủ dự án: "để cho độ dài chạm rìa trên màn hình luôn"): đặt mép dưới cửa sổ lên mép trên bảng phím
  (`y = 750·k`) thì mép trên chạm mép trên màn hình → **cao NGOÀI = 750·k px thật**; cao trong (thứ `requestWindow`
  nhận) = cao ngoài − thanh tiêu đề của cửa sổ nổi. Ô / làn rộng như cũ, chỉ đường rơi dài ra; hit line vẫn ở 0,97
  chiều cao (sát đáy).
- **px CSS** = px thật / `devicePixelRatio` (Windows scale 125 % / 150 %): màn báo `screen.height` px CSS nên
  `k / dpr = screen.height / 1080`.

| Màn (cao px thật) | `k`   | Bước phím | Rộng cửa sổ | Cao ngoài | Ở dpr 1, thanh tiêu đề 34 px: cỡ trong |
| ----------------- | ----- | --------- | ----------- | --------- | -------------------------------------- |
| 768               | 0,711 | 46        | 434         | 533       | 434 × 499                              |
| 900               | 0,833 | 54        | 509         | 625       | 509 × 591                              |
| 1080              | 1     | 65        | 610         | 750       | 610 × 716                              |
| 1200 (16:10)      | 1,111 | 72        | 677         | 833       | 677 × 799                              |
| 1440              | 1,333 | 87        | 813         | 1000      | 813 × 966                              |
| 2160 (4K)         | 2     | 130       | 1220        | 1500      | 1220 × 1466                            |

(Rộng / cao / bước ở cột 3–5 tính bằng px thật; ở dpr 1,25 / 1,5 chia cho dpr — vd. 1080p @125 % = 488 × 600 ngoài,
1440p @150 % = 542 × 667 ngoài. Rộng trước v1.0.1: 410 / 480 / 576 / 640 / 768 / 1152.)

- **Thanh tiêu đề**: chưa biết trước khi mở → lần đầu đoán 34 px CSS (Chrome / Edge trên Windows ≈ 30–40), mở xong
  đo `outerHeight − innerHeight`, nhớ ở localStorage `dfht-pip-chrome`; lệch > 2 px và trình duyệt cho (cửa sổ PiP còn
  user activation) thì `resizeTo` ngay, không thì lần mở sau đã đúng.
- **Trần cỡ của Chrome (D-418):** cỡ TRONG trang tự xin (`requestWindow`) có diện tích quá **25 % diện tích màn hình**
  thì Chrome thu nhỏ cả hai chiều giữ tỉ lệ (`kMaxSiteRequestedWindowSizeRatio`; người dùng / `resizeTo` được tới
  80 %). 16 : 9, 16 : 10 dưới trần (cỡ chuẩn ≈ 21 / 23,5 % diện tích); 3 : 2 sát trần (≈ 24,7 % ở 1368 × 912 /
  1440 × 960 px CSS; 1920 × 1280 @100 % ≈ 25,1 % — vượt nhẹ, đi đường dưới); **4 : 3 / 5 : 4** vượt (1280 × 1024: 578 ×
  677 = 29,9 %) → app xin **đúng bề ngang** (8 cột vẫn thẳng 8 phím), chiều cao hạ cho vừa trần (1280 × 1024: 578 ×
  566), rồi ngay sau khi mở `resizeTo` lên cao ngoài chuẩn (cả bề ngang nếu trình duyệt vẫn thu nhỏ). Không có user
  activation lúc đó → cửa sổ thấp hơn chuẩn tới khi bấm **"Đặt lại cỡ chuẩn"** (đổi về cỡ chuẩn đủ cao).
- **Chỗ / cỡ Chrome nhớ (D-419):** Chrome nhớ chỗ + cỡ cửa sổ PiP lần trước của từng tab và dùng lại khi trang xin
  đúng cỡ như lần trước. Lần mở đầu đoán thanh tiêu đề 34 px, các lần sau xin theo số đo → cỡ xin đổi một lần → cửa sổ
  hiện ở chỗ mặc định của Chrome một lần (kéo lại lên bảng phím). "Đặt lại cỡ chuẩn" bị từ chối → lần mở sau xin
  `preferInitialWindowPlacement` để "đóng rồi mở lại" ra đúng cỡ chuẩn (không thì Chrome trả lại cỡ người dùng đã kéo).
- **Nhớ cỡ**: cỡ người dùng tự kéo được nhớ KÈM màn hình lúc lưu (localStorage `dfht-pip-size`: rộng, cao và
  `screen` = rộng / cao px CSS + dpr của màn, từ v1.0.1 thêm `framePad` = khung đang dùng) và chỉ dùng lại trên đúng
  màn đó (cùng px thật + dpr) với đúng khung; màn khác / bản lưu cũ không ghi màn / bản lưu của bố cục v1.0.0 (8 làn
  sát mép, không `framePad` — cùng bề ngang thì 8 làn nay hẹp hơn, lệch phím) → cỡ chuẩn. Cỡ đúng bằng cỡ chuẩn thì
  không nhớ. Nút **"Đặt lại cỡ chuẩn"** trên thanh công cụ của cửa sổ nổi:
  quên cỡ đã nhớ + `resizeTo` cỡ chuẩn của màn hình đang chứa cửa sổ (trong cú bấm); trình duyệt không cho → dòng nhắc
  đóng / mở lại (lần mở sau bỏ chỗ / cỡ Chrome đã nhớ — D-419).

## Bản mobile (ảnh người dùng gửi 2026-10-14, khung 1011×261 cắt từ màn hình điện thoại)

- Hàng dưới: **8 nút tròn** ghi số giản phổ `1 2 3 4 5 6 7 1`, không có chữ Z X C… Chấm trên/dưới số đổi theo quãng
  đang chọn: trong ảnh "Cúi Xuống" đang bật → 7 nút đầu là 1̣ … 7̣ (chấm dưới), nút cuối là "1" không chấm.
- Hàng trên (trái → phải): **Nửa Cung · Ngẩng Lên · Ngẩng Tự Nhiên · Cúi Xuống** — nút tròn nhỏ, nút đang chọn
  nền sáng. "Cúi Xuống" sáng khi không có ngón tay → chế độ quãng là **chạm để chọn, giữ trạng thái** (không giữ
  như chuột PC). "Ngẩng Tự Nhiên" = về quãng thường.
- Nửa Cung: ảnh tĩnh không cho biết là bật/tắt, chỉ áp 1 nốt, hay giữ → app để setting, mặc định bật/tắt.
- Hệ quả: rest không làm mất chế độ; điều cần nhắc người chơi là **thời điểm chạm đổi chế độ**.

## Bản mobile — số đo bảng nút (ảnh chụp màn hình game của chủ dự án 2026-10-16)

Nguồn: ảnh chụp màn hình game của chủ dự án 2026-10-16 (điện thoại, màn ngang, nhận được ở 1371 × 633 px, tỉ lệ ≈
19,5 : 9), đo trên ảnh phóng 3× / 7× có lưới 10 px, sai số ±2 px. Ảnh chỉ dùng để đo — app không chứa ảnh hay tài
nguyên nào của game. Mọi số dưới đây là **tương đối**: theo bề ngang `W` / chiều cao `H` của màn hình, hoặc theo
**bước cột** `s` (khoảng cách tâm hai nút số liền nhau).

- **8 nút số** (đĩa tối trong mờ, nhãn `1 2 3 4 5 6 7 1̇`): cách đều, `s ≈ 0,0912 W` (125 px của ảnh); hàng căn giữa
  màn (tâm nhóm = tâm màn); tâm hàng ở `≈ 0,606 H`. Ø nút ≈ 0,69 s. Tâm nút 1 → nút 1̇ = 7 s ≈ 0,639 W; mép ngoài
  hàng nút ≈ `0,150 W → 0,850 W` (ảnh: 205 → 1165 px).
- **Hàng nút chế độ** ngay trên hàng số (tâm ở `≈ 0,420 H`, cao hơn hàng số ≈ 0,94 s), trái → phải **Nửa Cung · Ngẩng
  Lên · Ngẩng Tự Nhiên · Cúi Xuống**, cùng một kiểu đĩa Ø ≈ 0,60 s (Nửa Cung rất mờ trong ảnh nhưng cùng loại đĩa —
  chủ dự án xác nhận). Ba nút quãng cách đều ≈ 0,922 s; Nửa Cung là nhóm riêng, cách Ngẩng Lên ≈ 1,235 s, có vạch
  ngăn mảnh ở giữa hai nhóm. Một nút tròn nhỏ hơn bên phải Cúi Xuống (biểu tượng bàn tay gạch chéo) KHÔNG phải nút
  chế độ.
- **Tâm nút chế độ theo bước cột, tính từ tâm nút 1** (`GAME_MODE_COLUMNS` ở `src/player/layout.ts`): Nửa Cung
  **1,947**, Ngẩng Lên **3,182**, Ngẩng Tự Nhiên **4,098**, Cúi Xuống **5,025** — tức Nửa Cung ≈ cột 3 − 0,05 s,
  Ngẩng Lên ≈ cột 4 + 0,19 s, Ngẩng Tự Nhiên ≈ cột 5 + 0,10 s, Cúi Xuống ≈ cột 6 + 0,03 s (cột đánh số 1…8). Hàng
  chế độ không nằm trên ranh giới cột như bàn nút `'pad'` của app (bố cục riêng của màn chơi / trang "Thu nhỏ").
- **Khung bảng nút**: vạch mảnh ngang ở `≈ 0,327 H` (có hoa văn nhỏ ở giữa) = mép trên; vạch thứ hai ở `≈ 0,698 H`
  (núm nhỏ ở đầu trái) = mép dưới. Bảng chiếm `≈ 0,33 H → 0,70 H`, ngang `≈ 0,150 W → 0,850 W`. Nút "⇆ TỰ ĐỘNG
  CHƠI" của game ở góc trên phải.
- **Không có viền trong** (đo lại v1.0.1 bằng sườn độ sáng từng cột, ±2 px): vạch trên (y ≈ 208) chạy x ≈ 202,5 →
  1166, vạch dưới (y ≈ 442, núm ở x ≈ 212) ≈ 202 → 1166; đĩa nút 1 ≈ 204,5 → 290,5, nút 1̇ ≈ 1080 → 1166 (Ø ≈ 86 =
  0,69 s). Hai đầu vạch **trùng mép ngoài nút 1 / 1̇** (≈ 0,0 s ± 0,02 s) — khác bảng phím PC (khung có viền trong,
  cột ngoài cùng cách viền một đoạn): bảng mobile không có đoạn đệm nào để chép.

### Hệ quả: trang mini Android "Khớp nút game"

- Cửa sổ nổi của Android là cửa sổ đục (không đặt đè lên nút được) → người chơi đặt nó **ngay trên bảng nút**: mép
  dưới ở mép trên khung kèn (`0,327 H`), không che hàng nút chế độ (đỉnh đĩa ở `≈ 0,361 H`), mép trên chạm mép trên
  màn hình (làn rơi dài nhất có thể); bề ngang = **8 làn** (8 s, căn giữa hàng nút — v1.0.1, xem dưới; trước đó =
  hàng nút số 7,69 s).
- **Cỡ cửa sổ thật** vì thế chỉ khoảng `0,73 W × 0,33 … 0,36 H`: màn ngang 780 × 360 px CSS → ~569 × 118 … 130 px,
  915 × 412 → ~651 × 135 … 149 px, chưa trừ thanh kéo của cửa sổ nổi / thanh địa chỉ. Bảng Căn chỉnh và
  bảng lúc dừng của trang mini thiết kế cho ~540–650 × 80–150 px (DECISIONS D-399, D-401).
- **Ô ngoài cùng không sát mép (v1.0.1, góp ý chủ dự án "cần khoảng cách giữa hai tile ngoài cùng với border"):**
  game không có viền trong (trên) nên khung "bằng hàng nút" (7,69 s) làm ô rộng đúng Ø nút chạm mép cửa sổ (đo ở
  1371 × 633, cửa sổ 962 px: khe 0 px). Khung lý tưởng = `FIT_WINDOW_STEPS` = 8 s (layout.ts): mép cửa sổ = mép
  ngoài lane 1 / 1̇ (nửa bước ngoài tâm nút), ô (0,69 s, căn tâm nút) cách mép `(1 − 0,69) / 2 ≈ 0,155 s` = nửa khe
  giữa hai ô — như bàn nút `'pad'` (8 cột phủ khung). Đo ở 1371 × 633, cửa sổ 1001 px: khe 19–20 px mỗi bên
  (≈ 0,16 s). Rộng thêm 0,155 s mỗi bên chỉ che thêm cảnh game phía trên bảng nút (không có nút nào ở đó). Ô / vòng
  vẫn đúng tâm nút thật, Ø vòng "CHẠM" / vòng đích vẫn = Ø nút chế độ (0,60 s) ở `GAME_MODE_COLUMNS`.
- Renderer `lanePadding: 'fit'` + `laneFit` (`fitGeometry` ở `src/player/layout.ts`): 8 lane rộng đúng `s`, tâm lane
  nội suy đều giữa tâm nút 1 và nút 1̇; tile rộng 0,69 s (= Ø nút số); hit line sát mép dưới (cách 2 px); vòng
  "CHẠM" Ø 0,60 s (trần 0,42 × chiều cao cửa sổ) rơi trong cột nút chế độ ở các vị trí trên và đáp sát TRÊN mép
  dưới (khe 1 px) — nút thật nằm ngay dưới cửa sổ —, kèm 4 vòng đích mờ ở đó.
- Mặc định của "Căn chỉnh" khi trang KHÔNG biết cỡ màn (kiểu "cửa sổ = 8 làn", `DEFAULT_LANE_FIT`, cửa sổ = 8 bước
  căn giữa hàng nút = 185 → 1185,6 px của ảnh): tâm nút 1 ở **6,25 %** (1/16) bề ngang cửa sổ, nút 1̇ ở **93,75 %**
  (15/16) — v1.0.1; trước đó 4,43 % / 95,63 % (cửa sổ đúng mép ngoài hàng nút, ô ngoài cùng chạm mép). Người chơi
  chỉnh tâm nút 1 / nút 1̇ và dời / giãn hàng nút chế độ (giãn quanh Ngẩng Tự Nhiên) — lưu theo máy
  (`src/mini/miniAlign.ts`); số đã lưu giữ nguyên, chỉ máy đang dùng mặc định mới đổi.

### Đúng tỉ lệ thật: cỡ cửa sổ nổi từ cỡ màn hình (D-405, D-406, D-412 – D-415)

Số đo tương đối từ ảnh chụp màn hình game của chủ dự án 2026-10-16 (màn ngang 1371 × 633, ±2 px). Trang mini không
đặt được cỡ cửa sổ nổi nhưng đọc được cỡ màn hình (`window.screen`, px CSS) → lane có **đúng khoảng cách nút thật**
dù cửa sổ rộng hay hẹp; người chơi chỉ kéo / giãn cửa sổ (chủ dự án: "để user chỉ cần kéo qua, hạn chế phải căn
chỉnh trừ khi cần").

- **Một đơn vị cho cả hai chiều (D-413).** UI game phóng cùng một hệ số theo hai chiều, nên mọi số đo dưới đây theo
  `R` = chiều cao "màn ảnh game" mà UI lấp vừa: `R = min(H, W / 2,166)` (2,166 = 1371 / 633). Mọi điện thoại ≥ 19,5 : 9
  (20 : 9, 21 : 9 …) → `R = H`: UI phóng theo **chiều cao** — cùng giả định "cạnh ngắn" với Cửa sổ nổi PC ở trên.
  Màn hẹp hơn (16 : 9, máy tính bảng) → `R = W / 2,166`: hàng nút vẫn nằm trọn trong màn (`s = 0,0912 W`). Bảng nút
  bám **đáy** màn: mép trên ở `H − (1 − 0,327) R`. Ở màn ≥ 19,5 : 9 mọi số theo `H` y như ảnh.
- Trước D-413 bước cột lấy theo bề ngang (`0,0912 W`) còn chiều cao theo `H` — hai mô hình khác nhau: ở 20 : 9 (800 × 360) lane ngoài cùng lệch ≈ 6,5 px, 21 : 9 (840 × 360) ≈ 19 px (27 % một bước).

| Đại lượng                                      | Tương đối (`R` = `H` ở màn ≥ 19,5 : 9)            | Ảnh 1371 × 633 | Màn 915 × 412 | Màn 780 × 360 |
| ---------------------------------------------- | ------------------------------------------------- | -------------- | ------------- | ------------- |
| Bước cột `s` (tâm hai nút số liền nhau)        | `0,1975 R` (`GAME_NOTE_STEP_H`; = `0,0912 W` ảnh) | 125 px         | 81,4 px       | 71,1 px       |
| Hàng nút = mép ngoài nút 1 → nút 1̇             | `(7 + 0,69) s` (`NOTE_ROW_STEPS`; ≈ 0,70 W ảnh)   | 961 px         | ≈ 626 px      | ≈ 547 px      |
| Bề ngang cần = 8 làn (v1.0.1)                  | `8 s` (`FIT_WINDOW_STEPS`; ≈ 0,73 W ảnh)          | 1000,6 px      | ≈ 651 px      | ≈ 569 px      |
| Mép trên bảng nút (vạch mảnh)                  | `0,327 H` khi `R = H` (`GAME_PANEL_TOP_H`)        | 207 px         | ≈ 135 px      | ≈ 118 px      |
| Đỉnh hàng nút chế độ (tâm 0,420 R − Ø 0,059 R) | `0,361 H` khi `R = H` (`GAME_MODE_TOP_H`)         | 228,5 px       | ≈ 149 px      | ≈ 130 px      |
| Đáy hàng nút số (tâm 383,5 + Ø 86 / 2, D-448)  | `0,674 H` khi `R = H` (`GAME_NOTE_BOTTOM_H`)      | 426,5 px       | ≈ 278 px      | ≈ 243 px      |
| Phần thấy "dưới nút" (trừ thanh cửa sổ ~24 px) | `(1 − 0,674) R − 24` (`belowVisibleOf`)           | 182,5 px       | ≈ 110 px      | ≈ 93 px       |
| "Cao: vừa" (trang + thanh trình duyệt)         | xem dưới                                          | 165 … 211 px   | 95 … 129 px   | 78 … 110 px   |

- **Dùng cỡ màn khi (D-412):** máy **Android cảm ứng** (UA hoặc `userAgentData.platform` là Android, kèm điểm chạm /
  con trỏ thô — nơi duy nhất đặt cửa sổ nổi lên game được; máy tính có cửa sổ trình duyệt không phóng to và iPhone
  ngang — Safari thụt lề vùng tai thỏ — đều "nhỏ hơn màn" mà không phải cửa sổ nổi), màn NGANG
  (`screen.orientation` là landscape-…, không có thì `width > height`; trình duyệt luôn trả cỡ dọc mà orientation nói
  ngang → lấy cạnh dài làm `W`), hai số > 0 và cạnh dài rõ ràng lớn hơn bề ngang trang (bề ngang trang ≤ 0,95 W —
  không thì trang đang chiếm cả màn). Không đạt → kiểu cũ "cửa sổ = hàng nút" ở trên, không có chỉ báo.
- **Hình học:** bước cột = `0,1975 R` × "Vạch · Giãn" (mặc định 1); tâm hàng nút (giữa nút 1 và nút 1̇) = giữa cửa
  sổ + "Vạch · Dời" (px, mặc định 0) — hàng nút của game căn giữa màn nên cửa sổ đặt giữa màn là trùng; 4 nút chế độ
  theo `GAME_MODE_COLUMNS` như trên, chỉnh bằng "Vòng · Dời / Giãn" (`laneFit.stepPx` / `shiftPx`, `fitGeometry` ở
  `src/player/layout.ts`).
- **Chỉ báo "Rộng" (D-415)** (panel ▶ + bảng Căn chỉnh): cần `FIT_WINDOW_STEPS × s` = 8 s (v1.0.1; trước đó
  `NOTE_ROW_STEPS × s`) — KHÔNG cộng "Vạch · Dời" (cửa sổ đúng cỡ mà lệch tâm vẫn đúng cỡ); hẹp hơn quá 0,15 s (dưới
  7,85 s: ô ngoài cùng cách mép < 0,08 s — sát / bị cắt) → "Hẹp quá — kéo giãn thêm", rộng hơn quá 0,6 s → "Rộng hơn
  cần thiết", còn lại "Rộng: vừa". Không hẹp mà 8 làn đã dời ra ngoài mép cửa sổ quá 0,15 s (ô ngoài cùng chạm mép
  bên đó) → "Lệch tâm — kéo cửa sổ sang trái / phải rồi đặt "Vạch · Dời" về 0".
- **Chỉ báo "Cao" (D-414):** mép dưới cửa sổ nên nằm từ **mép trên khung kèn** (`0,327 R`, mục tiêu — làn dài nhất) tới
  **đỉnh hàng nút chế độ** (`0,361 R`, giới hạn — che nút chế độ thì chạm vào game không tới nút). Trang chỉ đo được
  chiều cao trang + phần trình duyệt (`outerHeight − innerHeight` khi > 0 và ≤ 0,25 H, không thì 0); thanh kéo /
  tiêu đề của cửa sổ nổi do hãng vẽ thì không đo được — giả định **24 px** thường gặp (Samsung pop-up, HyperOS), tối
  đa 36 px. "Cao quá — đang che khung kèn" khi trang + 24 > đỉnh nút chế độ + sai số `max(4 px, 1 % H)`; "Thấp quá —
  kéo mép trên lên chạm mép màn hình" khi trang + 36 < mép trên khung kèn − sai số; còn lại "Cao: vừa". Hãng không có
  thanh riêng (thanh vẽ đè lên trang): "vừa" khi mép dưới cách mép trên khung kèn ≤ ~8 px (màn 360 px cao) — làn ngắn
  hơn chút, không che nút. Làn + hit line luôn phủ cả chiều cao trang (hit line = mép dưới).
- **Giả định, chưa đo trên máy thật:** (1) Chrome Android trong cửa sổ nổi trả `window.screen` = cả màn hình (px CSS),
  không phải cỡ cửa sổ; (2) cửa sổ nổi không thu nhỏ nội dung trang — cửa sổ nhỏ của vài hãng (HyperOS) thu cả trang
  → khoảng cách vạch sai theo đúng tỉ lệ thu, chỉnh "Vạch · Giãn"; (3) chỉ một ảnh (19,5 : 9): UI phóng theo một hệ số
  cho hai chiều, vừa màn ảnh game (D-413) — máy 20 : 9 / 21 : 9 / 16 : 9 hay "UI scale" khác của game có thể lệch, ghi
  tỉ lệ màn + số "Vạch · Giãn" phải chỉnh (checklist Phần 4 mục 3); (4) thanh kéo của cửa sổ nổi ~24 px (chỉ báo
  "Cao"); (5) thanh địa chỉ của trình duyệt (nếu hiện trong cửa sổ nổi) chỉ được tính khi trình duyệt báo
  `outerHeight` hợp lý.
