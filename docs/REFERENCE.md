# Tài liệu tham khảo — Delta Force Harmonica Tiles

Phần chi tiết đã tách khỏi trang **Hướng dẫn** trong app (góp ý 2026-10-16, DECISIONS D-363). Trang Hướng dẫn
(`#/guide` = phần người dùng của [README](../README.md)) cố ý ngắn: bắt đầu nhanh, những chỗ hay nhầm, các tính năng
chính. File này giữ mọi thứ còn lại — cú pháp `.harm` đầy đủ, bảng thông báo lỗi, tham số URL của overlay, phím tắt,
chi tiết từng tính năng, giới hạn đã biết — cho người muốn biết hết và cho người phát triển. Tên nút ghi ở đây lấy
đúng từ `src/i18n/strings.ts` (tiếng Việt). Trong app, file này hiện nguyên văn ở trang **Dev notes** (`#/dev` — link
nhỏ "Dev notes" ở cuối trang Hướng dẫn và trang Cài đặt), kèm phiên bản, commit, ngày build của bản đang chạy và lịch
sử thay đổi (CHANGELOG); nội dung bài Hướng dẫn không link tới đây — chỉ có link nhỏ đó ở chân trang (D-257, D-387). App chính thức:
**https://df-harmonica-tiles.vercel.app**.

## Mục lục

- [Định dạng .harm đầy đủ](#định-dạng-harm-đầy-đủ)
- [Phím tắt của màn chơi](#phím-tắt-của-màn-chơi)
- [Màn chơi: đếm ngược, đếm vào, kiểu Mobile](#màn-chơi-đếm-ngược-đếm-vào-kiểu-mobile)
- [Âm thanh](#âm-thanh)
- [Luyện tập chi tiết](#luyện-tập-chi-tiết)
- [Tạo bài chi tiết](#tạo-bài-chi-tiết)
- [Donate text](#donate-text)
- [Overlay OBS chi tiết](#overlay-obs-chi-tiết)
- [Tham số URL của overlay](#tham-số-url-của-overlay)
- [Cửa sổ nổi chi tiết](#cửa-sổ-nổi-chi-tiết)
- [Trang mini cho Android và Cửa sổ video nổi](#trang-mini-cho-android-và-cửa-sổ-video-nổi)
- [Cài đặt chi tiết](#cài-đặt-chi-tiết)
- [Cài như app và dùng offline](#cài-như-app-và-dùng-offline)
- [Giới hạn đã biết](#giới-hạn-đã-biết)
- [Giấy phép và bản quyền bài mẫu](#giấy-phép-và-bản-quyền-bài-mẫu)

## Định dạng .harm đầy đủ

`.harm` là văn bản thường (UTF-8), mỗi dòng một việc. Đây cũng chính là định dạng của guide gửi qua donate.

```text
@title Bài ví dụ
@artist Không rõ
@bpm 90
@time 4/4
@scroll +1
// Dòng comment: app bỏ qua

# ĐOẠN 1
Z X C V
B*.5 N*.5 M ,*2
_ X-C*2 Z _*.5

# ĐIỆP KHÚC
[giữ chuột phải]
Z X C V
[thả chuột phải]
L:N Z R:Z S:C

@repeat ĐOẠN 1
```

### Loại dòng

| Dòng bắt đầu bằng | Là gì                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| `@`               | directive (bảng dưới)                                                                              |
| `#`               | tên đoạn (section), ví dụ `# ĐIỆP KHÚC`. Trước header đầu tiên, các dòng thuộc đoạn `Main`         |
| `//`              | comment, app bỏ qua                                                                                |
| `//!`             | comment đặc biệt: hiện thành **cảnh báo** trong trình soạn (app dùng để đánh dấu nốt bị gập quãng) |
| (dòng trống)      | bỏ qua                                                                                             |
| còn lại           | dòng nốt: các token nốt cách nhau bằng khoảng trắng                                                |

App không có lời bài hát. File cũ có lời ở đầu dòng (`Đồ rê mi: Z X C`) vẫn mở được: phần trước **dấu `:` đầu tiên
có khoảng trắng phía sau** bị bỏ qua, app không bao giờ ghi lại phần đó. Nếu phần bị bỏ toàn là nốt (dấu `:` gõ lạc,
vd. `Z X C: V B`) hoặc sau dấu `:` không còn gì, trình soạn hiện cảnh báo để bạn xóa dấu `:`.

### Directive

| Directive                   | Ý nghĩa                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| `@title <tên>`              | tên bài                                                                                             |
| `@artist <tên>`             | tác giả / ca sĩ                                                                                     |
| `@bpm <số>`                 | tempo (số dương, có thể lẻ: `@bpm 92.5`), mặc định 90                                               |
| `@time <tử>/<mẫu>`          | nhịp, mặc định `4/4` (tử 1–32, mẫu 1 / 2 / 4 / 8 / 16 / 32); dùng để vẽ vạch nhịp và độ dài đếm vào |
| `@scroll +1` / `@scroll -1` | bài soạn với Nửa Cung = thăng (+1, mặc định) hay giáng (−1); game là thăng — xem dưới bảng          |
| `@repeat <tên đoạn>`        | chèn lại toàn bộ dòng nốt của một đoạn **phía trên**; dùng nhiều lần được                           |

Directive viết hai lần thì dòng sau cùng thắng. Directive lạ (`@foo`) chỉ bị cảnh báo và bỏ qua.

Trong game Nửa Cung luôn là **thăng**. Bài cũ ghi `@scroll -1` vẫn mở và phát được, nhưng màn chơi hiện chip cảnh báo
(bài viết cho giáng, game là thăng — các nốt Nửa Cung sẽ lệch cao độ). Sửa: bấm vào chip đó (hoặc Thư viện → **Sửa**
trên thẻ bài) → trình soạn → **Công cụ** → **Tối ưu lại cung / quãng** (bài viết lại ghi `@scroll +1`).

`@repeat` chèn cả các dòng chỉ có `[giữ …]` / `[thả …]` của đoạn đó; trạng thái giữ chạy tiếp tự nhiên qua phần được
chèn. Tên đoạn so khớp chính xác trước, không có thì so không phân biệt hoa thường / khoảng trắng; nhiều đoạn trùng
tên thì lấy đoạn gần nhất phía trên.

### Token nốt (cách nhau bằng khoảng trắng)

| Viết                                      | Nghĩa                                                                                | Ví dụ                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------- |
| `Z X C V B N M ,`                         | 8 phím nốt = 1 2 3 4 5 6 7 1̇ (Đồ … Đố). Không phân biệt hoa thường; `,` là phím thật | `Z X C`                                 |
| `KEY*dur`                                 | độ dài tính bằng beat, mặc định 1                                                    | `C*2` `B*.5` `N*1.5` `X*0.25` `Z*1/3`   |
| `_` / `_*dur`                             | nghỉ                                                                                 | `_` `_*.5` `_*2`                        |
| `KEY-KEY` (`KEY-KEY-KEY`…)                | luyến: tổng độ dài ghi sau cụm (mặc định 1) chia đều cho các nốt                     | `X-C` `X-C*2` `Z-X-C*1.5`               |
| `[giữ chuột trái]` … `[thả chuột trái]`   | giữ **Cúi Xuống** (hạ 1 quãng tám) cho các nốt ở giữa                                | `[giữ chuột trái] N M [thả chuột trái]` |
| `[giữ chuột phải]` … `[thả chuột phải]`   | giữ **Ngẩng Lên** (lên 1 quãng tám)                                                  |                                         |
| `[giữ scroll]` … `[thả scroll]`           | giữ **Nửa Cung**                                                                     |                                         |
| `[L]` `[/L]` `[R]` `[/R]` `[S]` `[/S]`    | viết tắt của 6 nhãn trên                                                             | `[R] Z X [/R]`                          |
| `L:KEY` `R:KEY` `S:KEY` `LS:KEY` `RS:KEY` | modifier cho **một nốt** (L = trái, R = phải, S = scroll; `SL:` `SR:` cũng được)     | `L:N` `RS:C` `Z-L:N`                    |

**Độ dài:** số thập phân dương (`0.25`, `.5`, `1`, `1.5`, `2`, `4`…) hoặc phân số `a/b` cho chùm ba (`1/3`, `2/3`).
`*1` có thể bỏ. Độ dài ≤ 0 là lỗi. Với luyến, độ dài là **tổng**: `X-C*2` = X 1 beat + C 1 beat; `Z-X-C` = ba nốt,
mỗi nốt 1/3 beat.

**Giữ / thả:**

- Nhãn đọc không phân biệt hoa thường, kể cả gõ không dấu (`[giu chuot trai]`); có thể đứng riêng một dòng.
- Trạng thái giữ **kéo dài qua nhiều dòng** tới khi thả; hết bài mà chưa thả thì app tự thả (kèm cảnh báo).
- Trái và phải **không giữ cùng lúc**; scroll kết hợp được với trái hoặc phải. Thả khi chưa giữ, giữ hai lần liền,
  hay giữ trái khi đang giữ phải đều là lỗi.
- Prefix **cộng dồn** với nút đang giữ (đang giữ scroll mà gặp `L:N` = N với trái + scroll). Prefix có cả L lẫn R,
  hoặc ngược với nút đang giữ, là lỗi.
- Khi app tự viết `.harm` (donate text, Tạo bài từ file, Tạo bài với AI, Tối ưu lại), nó dùng nhãn đầy đủ, gom các nốt liền nhau
  cùng nút thành một cặp `[giữ …] … [thả …]` và bỏ `*1`. Ngoại lệ: nốt trong một cụm luyến cần nút khác các nốt còn
  lại được ghi bằng prefix (vd. `Z-L:N`), vì không chèn `[giữ …]` vào giữa cụm luyến được.

**Cao độ (khi nghe trong app):** `Z` = C4 (đổi ở Cài đặt → **Quãng tám gốc**), Cúi Xuống −12 bán cung, Ngẩng Lên
+12, Nửa Cung +1 (thăng, như game). Tầm kèn: C3–C6.

### Dấu phần của donate text

Dòng bắt đầu bằng **`số/số` + khoảng trắng** (như `1/5 `, `2/5 ` — số phần của donate text) được bỏ dấu đó rồi đọc
như bình thường, nên dán nguyên các tin donate vào là ra đúng bài. Có thể có nhiều dấu liền nhau; dòng chỉ có dấu bị
bỏ qua.

### Thông báo lỗi và ý nghĩa

App không bao giờ "chết" vì lỗi cú pháp: mỗi lỗi ghi rõ **dòng** và **cột**, token lỗi bị bỏ qua khi phát.

| Thông báo (trong trình soạn)                     | Mức      | Ý nghĩa / cách sửa                                             |
| ------------------------------------------------ | -------- | -------------------------------------------------------------- |
| Thả chuột trái khi chưa giữ                      | Lỗi      | có `[thả …]` mà phía trước chưa `[giữ …]` nút đó               |
| Không thể giữ chuột phải khi đang giữ chuột trái | Lỗi      | trái và phải không giữ cùng lúc — thả nút kia trước            |
| Đang giữ … rồi, giữ lặp                          | Lỗi      | `[giữ …]` hai lần mà chưa thả                                  |
| Prefix "…" xung đột chuột trái/phải              | Lỗi      | prefix vừa L vừa R (`LR:N`), hoặc ngược với nút đang giữ       |
| Token lạ: "…"                                    | Lỗi      | gõ sai phím (`A`, `Q`…), thiếu dấu cách, ngoặc sai             |
| Độ dài không hợp lệ: "…" (phải là số beat > 0)   | Lỗi      | `Z*0`, `Z*abc`, `Z*`                                           |
| @repeat: không có section "…" ở phía trên        | Lỗi      | sai tên đoạn, hoặc đoạn đó nằm bên dưới                        |
| Giá trị không hợp lệ cho @…                      | Lỗi      | `@bpm abc`, `@time 4`, `@scroll 2` — app dùng giá trị mặc định |
| Directive lạ: "@…" (bỏ qua)                      | Cảnh báo | directive không có trong bảng trên                             |
| Đang giữ … tới hết bài (tự thả ở cuối)           | Cảnh báo | quên `[thả …]`                                                 |
| `//! …`                                          | Cảnh báo | do bạn hoặc công cụ ghi (vd. nốt bị gập quãng)                 |
| @repeat "…": vượt giới hạn mở rộng               | Cảnh báo | `@repeat` lồng nhau quá nhiều, phần lặp từ đó bị bỏ            |
| Phần trước dấu ":" bị bỏ qua (kiểu lời cũ)       | Cảnh báo | dấu `:` gõ lạc nuốt mất nốt (`Z X C: V`) — xóa dấu `:`         |

## Phím tắt của màn chơi

Danh sách này (kèm phím game và cách giữ chuột / chạm theo đúng tên nút bạn đặt ở Cài đặt) luôn hiện ở cột trái màn
chơi; màn hẹp thì bấm **?** (**Phím tắt**).

| Phím  | Việc                                                         |
| ----- | ------------------------------------------------------------ |
| Space | Phát / Tạm dừng (đang đếm ngược thì hủy)                     |
| R     | Phát lại từ đầu                                              |
| ← / → | Dòng trước / dòng sau                                        |
| L     | Loop A-B theo dòng: lần 1 đặt A, lần 2 đặt B, lần 3 tắt loop |
| [ / ] | Tempo −2 / +2 BPM                                            |
| Esc   | Hủy đếm ngược                                                |

Phím tắt không chạy khi đang gõ trong ô nhập hoặc khi hộp thoại đang mở. Dùng **Tab** để tới một nút (vd. **Mobile**,
**OBS**) thì **Space** bấm nút đó (như mọi trang web); bấm chuột vào nút rồi nhấn Space thì Space vẫn là Phát / Tạm
dừng (D-345). Các phím `Z X C V B N M ,` và chuột trái / phải / scroll **không bao giờ** là phím tắt — chúng dành cho
chế độ luyện tập. Cửa sổ nổi: Space chạy / dừng, R chơi lại. Overlay tự chạy một mình: bấm vào overlay = chạy, Space =
chạy / dừng, R chạy lại từ đầu, ← / → đổi dòng.

## Màn chơi: đếm ngược, đếm vào, kiểu Mobile

**Thanh điều khiển:** **Phát** / **Tạm dừng**, **Từ đầu**, **Dòng trước** / **Dòng sau**, **Nhảy tới đoạn**, **Loop**
(lặp A–B theo dòng), **Luyện tập**, **Tempo**, **Lookahead** (số beat thấy trên màn, 4–12, mặc định **6** — ít beat
hơn = ô to hơn, rơi nhanh hơn; chỉ chỉnh ở đây, Cài đặt không có ô lookahead). Màn hẹp có thêm nút **?**. Bài **chưa
nằm trong Thư viện** có chip **Bản nháp — chưa lưu** (kèm **Mở trình soạn để lưu**) hoặc **Bài tạm từ link — chưa
lưu** (kèm **Lưu vào thư viện**). Chip cảnh báo / lỗi bấm vào là mở trình soạn của bài.

**Đếm ngược và đếm vào** (D-354):

- **Đếm ngược** (Cài đặt → **Phát bài** → **Đếm ngược trước khi phát**, 0–10 giây, mặc định **3 giây**): bấm Phát rồi
  Alt-Tab vào game; số to `3-2-1` hiện trong lúc ô còn đứng yên. Space / Esc để hủy.
- **Đếm vào** (Cài đặt → **Phát bài** → **Đếm vào khi bấm Phát**, mặc định bật): sau đếm ngược, ô chạy dẫn vào một
  đoạn ngắn rồi mới tới nốt đầu (ô của phần đếm vào mờ hơn). Từ v1.0.1 (D-427) quãng nốt đầu đi từ chỗ đứng yên tới vạch
  sáng = **65 %** quãng cũ "1 ô nhịp + đoạn lặng trước nốt đầu": bài vào ngay beat 0 (_"TAKEDISKRUSH!"_) đi 0,65 ô nhịp
  = 2,6 beat; _"Quốc ca Việt Nam"_ (nốt đầu ở beat 2,75) đi 4,39 beat thay vì 6,75 (đếm vào 1,64 beat). Đoạn từ đầu
  đếm vào tới nốt đầu luôn chứa ít nhất **2 beat nguyên** (D-439): bài 3/4 / 2/4 vào ngay đầu ô nhịp đếm vào 2 beat (3/4:
  quãng 0,67 × cũ; 2/4: bằng 1 ô nhịp như trước) để có 2 tick; không bao giờ dài hơn 1 ô nhịp. Đoạn lặng đầu
  dài từ ~1,86 ô nhịp trở lên thì không đếm vào (bài vẫn chạy từ chỗ phát). **Không có số đếm nào** khi ô đã chạy — ở
  màn chơi, Cửa sổ nổi, overlay hay trang mini. Tiếng tick chỉ có khi bật **Tiếng click metronome / đếm vào** ở Cài đặt
  → **Âm thanh**: tick ở mọi beat nguyên từ đầu đoạn đếm vào tới nốt đầu (cả qua đoạn lặng đầu bài — Quốc ca: −1, 0, 1,
  2 rồi nốt lấy đà ở 2,75), nhấn mạnh ở đầu ô nhịp (D-428).
- **Không giật lúc bắt đầu** (D-377, D-389): trong lúc đếm ngược, khu ô rơi vẽ **đúng khung hình mà đếm vào sẽ bắt
  đầu** (lùi đúng đoạn đếm vào so với chỗ phát; đếm vào tắt thì đúng chỗ phát) — hết số là ô chạy tiếp từ đó, không nhảy lùi,
  không ô nào biến mất. Bấm Phát thì ô **trượt mượt** (~0,36 giây) từ khung đang đứng tới khung đó thay vì nhảy; hủy
  đếm ngược / dừng giữa lúc đếm vào thì trượt ngược về chỗ phát; đếm ngược **Tắt** mà đếm vào bật thì khung đầu sau khi
  bấm vẫn là khung đang đứng, ô lùi mượt rồi rơi (nốt đầu vẫn đúng giờ). Chơi lại / tua / nhảy dòng xa hơn một ô nhịp
  vẫn nhảy thẳng. Lúc đếm ngược nốt đầu thường đã nằm sẵn trên làn (Quốc ca: 4,39 beat trên vạch sáng, trong 6 beat
  lookahead — trước v1.0.1 là 6,75 beat nên làn còn trống lúc đếm ngược). Thanh
  trạng thái (banner, game bar, tiến độ) vẫn ghi chỗ phát. Áp cho màn chơi, Cửa sổ nổi, overlay (theo màn chơi và tự
  chạy) và trang mini.
- Thanh điều khiển của màn chơi **không** có hai ô này (góp ý 2026-10-16). **Cửa sổ nổi**, **trang mini** và **Cửa sổ
  video nổi** cũng theo đúng hai cài đặt này (D-367 — không có ô riêng), nhưng **đếm ngược tối thiểu 3 giây** (D-381:
  bấm ▶ ở đó rồi còn phải chuyển vào game — Cài đặt 5 giây → 5, Tắt → 3; dòng nhắc ngay dưới ô **Đếm ngược trước khi
  phát** của Cài đặt). Link trang mini có `?delay=` thì số trong link thắng.

**Kiểu Mobile** (nút **Mobile** ở thanh dọc, hoặc Cài đặt → **Kiểu điều khiển** → **Mobile (nút cảm ứng)**): màn chơi
đổi sang bố cục giống màn chơi kèn trên điện thoại — 8 nút tròn lớn ở đáy khu ô rơi, 4 nút chế độ tròn nhỏ phía trên
ở giữa, đúng thứ tự game; nút chế độ đang chọn sáng lên (màu của chế độ).

- Ô ghi số giản phổ (chấm trên = quãng cao, chấm dưới = quãng thấp); số trên 8 nút tròn cũng đổi chấm theo chế độ đang
  chọn, như game.
- **Vòng `CHẠM`** (D-373, thay thanh ngắn của vòng 6): mỗi lần phải chạm nút chế độ có một **vòng tròn rỗng** — viền
  2–3 px màu của chế độ, có quầng tương phản mảnh hai bên viền để nổi trên mọi nền, bên trong trong suốt (thấy ô phía
  sau) — **đường kính ngoài đúng bằng nút chế độ**, giữa ghi `CHẠM` (không có tên chế độ). Vòng rơi thẳng xuống nút đó
  **nhanh gấp 1,75 lần ô** (xuất hiện muộn hơn ô cùng beat, đi nhanh hơn) và **đồng tâm với nút đúng lúc phải chạm**
  ("đáp" vào nút); sau đó đứng yên trên nút và mờ dần trong 1/4 beat. Chữ `CHẠM` mờ dần khi tâm vòng còn cách tâm
  nút 1 → ½ đường kính và không có lúc vòng đồng tâm / đứng trên nút — tên chế độ in trong nút ("NGẨNG LÊN") đọc
  được đúng lúc phải chạm (D-390). Vòng vẽ trên một lớp trong suốt nằm **trên** bàn nút (không bị nút che lúc đáp).
  Phần đếm vào có vòng mờ hơn. Trang mini **Thu nhỏ** và **Cửa sổ nổi** ở kiểu Mobile dùng cùng bàn nút kiểu game ở
  đáy nên vòng đáp đúng nút như ở màn chơi; trang mini **Khớp nút game** không có bàn nút — vòng đáp ở mép dưới cửa
  sổ, ngay trên nút chế độ thật của game (4 vòng mờ đánh dấu chỗ đáp, D-396); không còn dải / nhãn `CHẠM: <tên chế độ>` cạnh làn ở bất cứ đâu (D-366). Tên nút chế độ in trong hình tròn chỉ
  xuống dòng ở dấu cách — từ dài (tiếng Anh `SEMITONE`) thu nhỏ chữ cho lọt một dòng.
- **Overlay OBS kiểu Mobile** (cả cửa sổ **Xem trước**, D-375): **không vẽ bàn nút** (trên stream nút thật của game
  nằm ngay bên dưới) — làn vẫn thẳng 8 nút, vạch sáng ở đỉnh hàng nút số, chỉ có **4 vòng mờ** (viền mảnh màu chế độ,
  không tô, không chữ) đánh dấu chỗ 4 nút chế độ; vòng `CHẠM` đáp đúng vào đó. Overlay **Dải ngang** (ô chạy ngang)
  cũng chỉ có 4 vòng mờ ngay sau vạch sáng làm đích, không game bar kể cả khi link có `gamebar=1` (bản game bar
  Mobile chính là bàn nút đầy đủ — D-390). Chế độ đang bật đọc ở banner.
- Nút chế độ sắp phải chạm có **vòng vàng**; banner nhắc trước `SẮP CHẠM: …` khoảng 1 beat; banner gọn ở đầu khu ô rơi
  ghi chế độ đang chọn, vd. `CHẾ ĐỘ: Ngẩng Tự Nhiên · Nửa Cung: TẮT`; chỗ nghỉ không làm mất chế độ.
- Chơi lại, nhảy dòng / đoạn, Loop: game giữ nguyên chế độ bạn đang bật, nên nếu chế độ đó khác cái nốt đầu chỗ mới cần
  thì vòng `CHẠM` hiện ngay ở nốt đó.
- Trên điện thoại: nên xoay ngang (điện thoại dọc có gợi ý **Xoay ngang để giống màn hình game**, bấm ✕ để tắt). Bấm
  **Phát** thì trang tự cuộn cho khu ô rơi + bàn nút vừa màn hình; nút tạm dừng nhỏ ở góc trên trái khu ô rơi.
- Cách nút **Nửa Cung** hoạt động trên mobile **chưa được xác nhận**: Cài đặt → **Nút Nửa Cung hoạt động kiểu** →
  _Bật / tắt (giữ trạng thái tới khi chạm lại)_ (mặc định) hoặc _Chỉ áp cho 1 nốt_. Bài (`.harm`) giống hệt nhau ở cả
  hai kiểu — chỉ cách hiển thị đổi.

## Âm thanh

**Mặc định app không phát tiếng nào** — không giai điệu, không tiếng tick: giai điệu bài hát phát trên stream có thể
bị YouTube / Facebook / TikTok nhận diện bản quyền (tắt tiếng đoạn video, gỡ video, cảnh cáo kênh) — kể cả khi do
synth của app thổi.

Bật giai điệu mẫu có hai chỗ, cùng một công tắc (`audioEnabled`) và cùng một hộp thoại cảnh báo bản quyền (D-392):

1. **Nút loa** trên thanh điều khiển màn chơi (ngay trước **Tempo**; trình đọc màn hình đọc tên cố định **Tiếng giai
   điệu** kèm trạng thái đã nhấn / chưa nhấn, tooltip là việc sẽ làm: **Bật tiếng giai điệu** khi đang tắt, **Tắt
   tiếng** khi đang bật — D-424) → hộp thoại cảnh báo → **Tôi hiểu, bật**. Đang bật thì nút đỏ; bấm lần nữa là tắt
   ngay, không hỏi. Bấm chuột vào nút rồi nhấn Space vẫn là phát / dừng (chỉ khi Tab tới nút thì Space mới bấm nút).
2. Thẻ **Âm thanh** ở Cài đặt (thẻ bình thường, luôn hiện — D-356): bật **Phát giai điệu mẫu** → cùng hộp thoại →
   **Tôi hiểu, bật**.

Hủy / Esc giữ tắt. Khi đang bật, màn chơi hiện huy hiệu đỏ **🔊 Đang phát giai điệu** (màn hẹp / thấp như điện thoại:
ô đỏ gọn **[🔊]**, chữ đầy đủ ở tooltip và cho trình đọc màn hình — bật / tắt không làm trang nhảy, D-417); tiêu đề thẻ Âm thanh có nhãn
**Đang bật giai điệu** (và **Đang bật tiếng click** khi tiếng click bật).

Cũng trong thẻ này: **Tiếng click metronome / đếm vào** (tiếng tick, không dính bản quyền), **Metronome suốt bài**,
**Âm lượng click**, **Phát tiếng khi bấm phím / nốt** cho chế độ luyện tập (mặc định tắt để tránh trễ), **Âm sắc**
(Harmonica / Sine) và **Âm lượng synth** — áp cho mọi tiếng synth: giai điệu mẫu, tiếng khi bấm và nút **Nghe thử** ở
Tạo bài từ file; chỉnh ở đây không tự phát tiếng nào. **Đặt lại mặc định** tắt hết âm thanh. **Overlay OBS, trang mini
và cửa sổ video luôn im lặng.** Nút **Nghe giai điệu mẫu** (khi luyện tập) chỉ hiện khi đã bật Phát giai điệu mẫu.

**Trên điện thoại (D-421 – D-423):**

- Trình duyệt chỉ cho mở âm thanh trong một cú chạm: app mở ngay lúc bạn bấm **Tôi hiểu, bật** (nút loa hoặc Cài đặt),
  bật **Tiếng click** / **Phát tiếng khi bấm phím / nốt**, hoặc bấm **Phát** — nên lần Phát đầu đã có tiếng. iPhone lần
  đầu có thể mất tới vài giây: app chờ tối đa 3 giây rồi mới cho ô chạy không tiếng.
- **iPhone / iPad:** khi đang bật tiếng, màn chơi xin iOS phát như một app nghe nhạc — tiếng kêu **cả khi gạt nút im
  lặng bên hông** (Safari 16.4+ dùng Audio Session API; iOS cũ hơn: một đoạn âm thanh im lặng lặp lại). Đổi lại, nhạc
  của app khác (Apple Music, Spotify…) tạm dừng trong lúc đó; tắt hết tiếng (giai điệu + click) hoặc rời màn chơi là
  trả lại. Âm thanh tắt (mặc định) thì app không đụng tới gì. Cũng vậy với **Nghe thử** ở Tạo bài từ file (chỉ trong
  lúc đang nghe) và màn **Tự chơi để tạo bài** (khi bật tiếng click / tiếng phản hồi; dừng thu hoặc rời màn là trả —
  D-426).
- Bị gián đoạn (cuộc gọi, Siri, app khác chiếm loa) hoặc trình duyệt chưa cho mở: ô vẫn chạy, cú bấm / chạm kế tiếp ở
  bất cứ đâu trên trang (Phát, bàn nút, chỗ trống…) thử mở lại; mở không được thì hiện **một lần** câu nhắc — trên
  iPhone kèm: tăng âm lượng, tắt chế độ tập trung, gạt nút bên hông sang đổ chuông. Đừng bấm nút loa để thử lại: lúc
  đó tiếng đang bật nên nút loa là **Tắt tiếng**.
- **Android:** âm lượng là âm lượng nhạc / media của máy (không có nút gạt im lặng cho trang web).

## Luyện tập chi tiết

Bấm **Luyện tập** trên thanh điều khiển màn chơi. Cách bấm theo **Kiểu điều khiển**:

- **PC:** phím thật `Z X C V B N M ,` + **giữ chuột trái / phải / nút cuộn trên khu ô rơi**. **Không có phím bàn phím
  thay chuột** (phím nốt bấm kèm Ctrl / Alt / Meta bị bỏ qua để phím tắt trình duyệt chạy bình thường).
- **Mobile:** **chỉ chạm / giữ bàn nút trên màn hình** (trên máy tính thì click chuột) — bàn phím và đàn MIDI không
  được nhận.

Hai chế độ (mặc định chọn ở Cài đặt → **Luyện tập** → **Chế độ luyện tập mặc định**):

- **Chờ** — bài dừng ở mỗi nốt tới khi bạn bấm đúng phím + nút giữ.
- **Chấm điểm** — chạy theo nhịp; lệch ≤ 100 ms là **Perfect**, ≤ 220 ms là **Good**, còn lại **Miss**. Có combo,
  % chính xác và bảng **Kết quả luyện tập** cuối bài.

**Chỉ nhận phím khi tab app đang được chọn (focus)** — không luyện được trong lúc cửa sổ game đang được chọn.

**Luyện bằng chạm (kiểu Mobile):** chạm nút chế độ trước, rồi chạm nốt. Nút chế độ giữ trạng thái tới khi chạm nút
khác; **Nửa Cung** theo Cài đặt **Nút Nửa Cung hoạt động kiểu** (_Chỉ áp cho 1 nốt_: chạm lại trước nốt đó là hủy). Đổi
chế độ sớm lúc đang nghỉ cũng được. Nốt dài: giữ nút số tới hết ô. Chạm nhiều ngón cùng lúc được. Kết quả hiện ngay trên
nút vừa chạm (trúng thì nút loé sáng), **combo** ở góc trên phải khu ô rơi. Đúng nốt nhưng sai chế độ → **SAI CHẾ ĐỘ**
và nút chế độ đúng nháy vàng. **Rung khi chạm** (công tắc trong dải điểm, chỉ hiện trên trình duyệt có rung — Chrome
Android; iPhone không có) mặc định bật trên máy cảm ứng. Chạm trên bàn nút không cuộn / phóng to trang, nhấn giữ không
mở menu.

**Đàn MIDI** (kiểu PC): cắm đàn → Cài đặt → **MIDI** → **Bật MIDI** (trình duyệt hỏi quyền) → chọn **Thiết bị MIDI**
→ chỉnh **Dịch bán cung** / **Dịch quãng tám** cho phím đàn khớp tầm harmonica (C3–C6 khi `Z` = C4). Tùy chọn **Chỉ
cần đúng pitch class (bỏ qua quãng tám)**. Chạy trên Chrome, Edge, Firefox 108+; Safari không có Web MIDI.

## Tạo bài chi tiết

Mọi bài tạo mới (trừ **Lưu** ở trang Tạo bài với AI) mở trong trình soạn dưới dạng **bản nháp** — trạng thái **Bản
nháp — chưa lưu**, chưa vào Thư viện (D-318):

- Sửa rồi **Lưu** (Ctrl+S) thì bài vào Thư viện. Đã sửa mà rời trang khi chưa lưu thì app hỏi (**Ở lại** / **Bỏ thay
  đổi** / **Lưu rồi đi**).
- Chưa sửa gì mà rời đi thì bản nháp bị bỏ, không lưu, không hỏi. Kết quả đã ưng thì cứ bấm **Lưu** — lưu được cả khi
  chưa sửa.
- **Phát từ dòng con trỏ** trên bản nháp chưa sửa thì phát luôn (không lưu); đã sửa thì app lưu rồi mới phát. Bản nháp
  chỉ còn tới khi tải lại trang.

### Tạo bài với AI

Trang `#/ai` (Thư viện → **Tạo bài với AI**, D-358): **Sao chép prompt** (bản tiếng Việt hoặc tiếng Anh theo ngôn ngữ
giao diện; prompt nằm ở `docs/AI-PROMPT-CAM-AM.md` / `src/editor/aiPrompt.ts`) → dán vào ChatGPT / Claude / Gemini kèm
ảnh hoặc chữ của bài → dán câu trả lời vào ô **Dán kết quả của AI vào đây** → **Lưu** (hoặc **Mở trong Editor**). Sau
khi lưu: **Phát**, **Sửa trong Editor**, **Thư viện**, **Tạo bài khác**. Link **hoặc tự gõ từ đầu** mở một bản nháp
trống.

Bộ chuyển (`src/editor/camamConvert.ts`, D-359) nhận cả câu trả lời của AI (khối code + lời giải thích) hoặc văn bản đã
là `.harm`:

- Có khối ` ``` ` thì lấy khối đầu tiên; số dòng trong thông báo là số dòng của văn bản bạn dán.
- Dán nhầm prompt → app nhắc dán **câu trả lời** của AI. Văn bản đã là `.harm` không lỗi → giữ nguyên.
- Cảm âm (`do1 re1 mi1…`, `do2` = quãng 2, `fa#1`, `_`, `*2`, cụm luyến `dola`) → `.harm` ở **tông dễ chơi nhất** theo
  kiểu điều khiển của bạn (ít giữ chuột / Nửa Cung nhất, kiểu Mobile thì ít lần chạm đổi chế độ nhất), nốt vượt tầm gộp
  về quãng gần nhất, luôn `@scroll +1`. Ô **Tông** cho chọn vài phương án khác (không bắt buộc).
- Dòng chữ giải thích (ít hơn nửa số từ đọc được là nốt) bị bỏ qua và ghi vào danh sách **Chỗ không đọc được**. Ghi chú
  `//` của AI (vd. `// không chắc`) thành cảnh báo `//! …` ngay trên dòng nốt kế tiếp — trình soạn hiện, màn chơi không
  hiện.

Nguồn không có nhịp (đa số trang cảm âm) → mọi nốt dài 1 beat: dùng **Tap timing (gõ nhịp)**. AI có thể đọc sai nốt,
nhất là ảnh mờ hoặc bài dài; đừng nhờ AI tự "nhớ" giai điệu (rất hay bịa) — luôn đưa nguồn thật.

**Trong trình soạn** (D-360): ô **Dán kết quả của AI vào đây** nằm ngay trên ô **Nội dung bài (.harm)**. Dán (Ctrl+V)
→ chuyển và **thay** nội dung bài ngay, một bước **Hoàn tác** ("Dán kết quả AI"); gõ hay kéo thả chữ vào ô thì chỉ xem
trước, bấm **Áp dụng** mới thay. Đổi **Tông** ngay sau khi áp dụng thì áp lại, không thêm bước hoàn tác. Văn bản dán
không có `@title` thì giữ tên bài hiện tại. **Xóa ô dán** để làm lại; **Lấy prompt cho AI** mở `#/ai` ở tab mới. Rồi
**Lưu** như thường.

### Tạo bài từ file MIDI / MusicXML

Thư viện → **Tạo bài từ file MIDI / MusicXML** → tab **Từ file**. Nhận:

- **MIDI:** `.mid`, `.midi`, `.kar`, `.rmi` — tối đa 2 MB;
- **MusicXML:** `.musicxml`, `.xml` (tối đa 20 MB), `.mxl` nén (tối đa 5 MB) — ví dụ tải từ **MuseScore**
  (musescore.com → Download → MusicXML hoặc MIDI).

App **không tải bài từ đường link**: tải file về máy rồi kéo thả vào trang (kéo thẳng từ thanh tải xuống của trình
duyệt cũng được) hoặc bấm **Chọn file MIDI / MusicXML**. File chỉ được đọc trên máy bạn.

Rồi đi qua 5 bước:

1. **Chọn file.**
2. **Chọn track** (MIDI) / **Chọn bè và giọng** (MusicXML). Bảng liệt kê từng track: tên, nhạc cụ, số nốt, tầm cao
   độ, % đơn âm, piano roll và nút **Nghe thử**; dưới tên track có dòng **≈ N nốt/phút · BPM M**. Track **Gợi ý**
   được chọn sẵn theo **mật độ nốt so với tempo**: giai điệu thường có **số nốt mỗi phút gần bằng BPM** (khoảng 1
   nốt mỗi phách, như câu hát). Track **thưa quá** (pad, nốt ngân dài) hay **dày quá** (đàn rải, đánh hợp âm) đều
   không phải giai điệu dù nhiều nốt; track gần như đơn âm, không nằm ở bè trầm được ưu tiên, tên track kiểu
   _melody / vocal / lead / giai điệu_ được cộng điểm nhẹ. Nhìn dòng **≈ N nốt/phút** để tự so: con số càng gần BPM
   càng giống giai điệu. **Giai điệu chia ra nhiều track thì tick hết các track đó** — nốt được gộp lại rồi mới
   trích. Track trống (kênh 10) bị ẩn. Với MusicXML: chọn bè (part) và giọng (voice) — bè hát được ưu tiên; dấu lặp,
   volta (1., 2.) được trải ra theo thứ tự chơi.
3. **Trích melody.** **Khi nốt chồng nhau**: giữ nốt cao nhất (mặc định), thấp nhất hoặc dài nhất. **Lượng tử hóa
   (grid)**: 1/4 beat (mặc định cho MIDI), 1/8, 1/3 (chùm ba) hoặc Tắt (mặc định cho MusicXML vì nhịp đã chính xác).
   **Tempo (BPM)** lấy từ file, sửa được.
4. **Chọn cung và quãng.** App thử 12 cách dịch giọng × các cách đặt quãng sao cho mọi nốt nằm trong tầm kèn
   C3–C6, rồi xếp hạng theo **Độ khó** = 10 × số nốt scroll + 4 × số lần giữ + 1 × số nốt có modifier (kiểu Mobile
   tính số lần chạm đổi chế độ). Nói đơn giản: **ít nốt Nửa Cung và ít lần giữ chuột = dễ thổi hơn**. Phương án
   **Tối ưu** được chọn sẵn. Chơi **theo nhạc gốc** (bật bài hát thật rồi thổi theo) thì bấm **Giữ cung gốc**, nếu
   không bạn sẽ lệch tông với bài hát. Nốt vẫn vượt tầm **luôn được gộp về quãng gần nhất** (không cần bật gì): bảng
   có thêm cột **Nốt gập quãng**, và dòng chứa chúng có cảnh báo `//! …` để bạn sửa tay.
5. **Xem trước và tạo bài.** Nhập **Tên bài**, **Tác giả (không bắt buộc)**. **Dòng và section do app tự chia** —
   không có ô nào phải chỉnh: ngắt dòng ở chỗ nghỉ hoặc vạch nhịp (mỗi dòng khoảng 1–2 ô nhịp, chừng 4–12 nốt), khoảng
   4 dòng một section "Phần N", chỗ nghỉ từ 2 ô nhịp luôn sang section mới. File có marker hợp lý (vd. dấu tập A / B
   của MusicXML, marker của MIDI) thì section theo marker. Nốt đón (lấy đà) đầu bài nằm chung dòng 1. Xem trước
   `.harm` → **Mở trong Editor**: bài mở dạng **bản nháp** (chỉ vào Thư viện khi bạn bấm Lưu). Muốn chia khác thì
   sửa trong trình soạn.

Bản nhạc phức tạp (piano hai tay, nhiều hợp âm) có thể bị trích sai nốt — chọn đúng track giai điệu và nghe / xem lại
kết quả. App không đọc lời trong file MIDI / MusicXML.

### Thu melody từ đàn MIDI

**Tạo bài từ file MIDI / MusicXML** → tab **Thu melody**: **Bật MIDI**, chọn **Thiết bị MIDI**, đặt **Tempo (BPM)**,
**Nhịp**, **Metronome trong lúc thu** → bấm **Thu**: app đếm vào 1 ô nhịp **bằng hình** rồi ghi lại các nốt bạn chơi
→ **Dừng**. Có **Thu lại** và **Hoàn tác**; sau đó chọn cung và tạo bài như trên (bước 4–5).

- Tiếng click (đếm vào và **Metronome trong lúc thu**) chỉ có khi bật **Tiếng click metronome / đếm vào** ở Cài đặt →
  **Âm thanh**; tắt thì đếm vào chỉ bằng hình và toggle Metronome bị khóa.
- **Tiếng phản hồi khi bấm (synth của app)** chỉ áp cho màn này, **mặc định tắt** — đừng bật khi đang stream vì tiếng
  sẽ lọt lên stream.

### Tự chơi để tạo bài

Biết chơi bài đó trong game rồi? Thư viện → **Tự chơi để tạo bài**: bấm như trong game, app ghi lại thành bài.

1. **Thiết lập:** **Tên bài**, **Tempo (BPM)**, **Nhịp** (4/4, 3/4, 6/8), **Lưới quantize** (1/4 beat, 1/8
   beat, chùm ba hoặc **Tắt**). Kiểu điều khiển lấy theo Cài đặt (**Đổi trong Cài đặt**).
2. Bấm **● Thu** → app **đếm vào 1 ô nhịp bằng đèn nhịp** (không có tiếng) → chơi:
   - **PC:** phím `Z X C V B N M ,`; **giữ chuột trong khung thu**: trái = Cúi Xuống, phải = Ngẩng Lên, nút cuộn =
     Nửa Cung.
   - **Mobile:** chạm 4 nút chế độ (giữ trạng thái tới lần chạm khác) và 8 nút số trên màn hình.
3. Ô hiện ngay trên **cuộn nốt** khi bạn bấm. Mỗi lúc một nốt (nốt mới cắt nốt cũ). **Dừng** để xong; đổi **Lưới
   quantize** để xem lại bản thu theo lưới khác.
4. **Thu lại** / **Hoàn tác** nếu chưa ưng → **Mở trong Editor**: bài mở dạng **bản nháp**. Muốn ít giữ
   chuột hơn thì **Công cụ** → **Tối ưu lại cung / quãng**.

**Tiếng phản hồi khi bấm** (chỉ cho màn này) **mặc định tắt** — đừng bật khi đang stream vì tiếng sẽ lọt lên stream.
Chỉ nhận phím khi tab app đang được chọn (focus); phím không ăn thì bấm một cái vào khung thu.

### Công cụ trong trình soạn

- **Tap timing (gõ nhịp)** — chọn **Phạm vi** (cả bài hoặc một đoạn), mở bài gốc ở chỗ khác, bấm **Bắt đầu tap** rồi
  nhấn Space (hoặc chạm ô tap) đúng lúc mỗi nốt bắt đầu. Khoảng cách giữa hai lần bấm thành độ dài nốt (theo `@bpm`),
  tùy chọn **Làm tròn về bội 0.25 beat**. Nốt bấm cuối và các chỗ nghỉ giữ nguyên độ dài. **Áp dụng** để ghi vào bài.
- **Tối ưu lại cung / quãng** (hộp thoại **Tối ưu tông**) — đọc cao độ các nốt của bài rồi tìm cung / quãng ít phải
  giữ chuột và scroll nhất, giữ nguyên đoạn, tempo và nhịp. Nốt vượt tầm luôn được gộp về quãng gần nhất; bài viết
  lại luôn ghi `@scroll +1` (Nửa Cung = thăng như game). Toàn bộ văn bản được viết lại (comment bị xóa, `@repeat`
  được trải ra) — không ưng thì **Hoàn tác**.
- Nhập cảm âm không còn trong **Công cụ** (từ 2026-10-16): dán vào ô **Dán kết quả của AI vào đây** phía trên ô soạn.

## Donate text

Trình soạn → **Donate text**: chia bài thành nhiều tin ngắn để gửi qua donate.

- **Có độ dài (\*dur)** (tắt thì mọi nốt và nghỉ thành 1 beat khi dán lại), **Có tên đoạn (# section)**.
- **Số ký tự tối đa mỗi tin**: 30–2000, mặc định **200**.
- **Kiểu chữ:** _PC (phím Z X C V B N M ,)_ hoặc _Mobile (số nút 1–8, chạm đổi chế độ)_.
- Mỗi phần mở đầu bằng `1/5 `, `2/5 `…; bấm **Sao chép phần k** từng phần hoặc **Sao chép tất cả**.
- Chia tại ranh giới dòng; dòng quá dài được tách thành nhiều dòng `.harm` cùng loại.
- **Dán lại tất cả các phần** (kiểu PC) vào trình soạn là ra đúng bài.
- Kiểu **Mobile** để người chơi điện thoại đọc: số là vị trí nút 1–8 từ trái sang, `[tên chế độ]` là lúc chạm đổi
  chế độ. Văn bản kiểu Mobile **không dán lại** vào trình soạn được — muốn gửi bài để người khác sửa / phát thì dùng
  kiểu PC hoặc link chia sẻ.

## Overlay OBS chi tiết

Hộp thoại **Tạo link OBS** (nút **OBS** ở thanh dọc màn chơi, D-348): **Kiểu overlay** (**Khớp bảng phím game** — 8 cột
rơi đúng trên 8 phím của game, không game bar; **Dải ngang trên bảng phím** — ô chạy từ phải sang trái ngay phía trên
bảng phím; **Cột đầy đủ có game bar** — như màn chơi, ở bên phải màn hình), **Hiển thị** (**Độ đậm của ô**; **Cỡ giao
diện game (tinh chỉnh)** 70–130 %), rồi hai cách: **Gửi thẳng vào OBS (khuyên dùng)** và **Browser Source thủ công**;
cuối hộp thoại là nút **Xem trước**. Ba tùy chọn hiển thị được nhớ trong trình duyệt (`dfht-obs-display`, D-343).

- Trang overlay **phủ cả canvas OBS** (Browser Source rộng × cao đúng bằng canvas) và tự vẽ ô rơi đúng chỗ trên bảng
  phím kèn của game, theo số đo bảng phím ở màn 16:9 (canvas không 16:9, vd. 2560 × 1080, thì căn theo giữa màn như
  game). Kiểu **Khớp bảng phím game**: khung ô rơi rộng bằng **khung bảng phím** của game (1920 × 1080: 610 × 600 tại
  683, 150 gồm dải giữ bên phải; 8 cột x 700–1220 thẳng 8 phím, hai bên chừa 0,26 bước cột nên ô ngoài cùng không sát
  mép — v1.0.1, D-431, D-432; link cũ `fit=source` giữ 8 cột phủ kín). Link nhúng sẵn cả bài (`data=…`; bài mẫu thì chỉ cần id) vì OBS có bộ nhớ riêng, kèm ảnh chụp cài đặt của bạn
  để overlay dùng khi phải tự chạy một mình.
- **Gửi thẳng vào OBS:** obs-websocket 5 (OBS 28+), chỉ tới `127.0.0.1` cổng `4455` (đổi ở **Nâng cao: địa chỉ và
  cổng**), không gửi gì ra Internet. **Nhớ trên máy này** lưu địa chỉ + mật khẩu trong trình duyệt (chữ thường, không mã
  hóa — mật khẩu này chỉ mở được OBS trên chính máy bạn); bỏ tick là xóa ngay. **Ngắt kết nối** = lần sau mở app không
  tự kết nối nữa. Source được thêm vào cảnh đang phát (Studio Mode: cảnh Program). Không nối được thì app ghi rõ lý do
  (OBS chưa mở, chưa bật WebSocket server, sai mật khẩu, OBS cũ hơn 28, trình duyệt chặn mạng cục bộ…).
- **Browser Source thủ công:** overlay chạy theo màn chơi khi màn chơi đang kết nối OBS (cách trên). Nếu không, khoảng
  2 giây sau khi OBS tải source, nó đếm ngược + đếm vào theo cài đặt lúc tạo link rồi chạy hết bài **một lần** (không
  lặp). Chạy lại: chuột phải source → **Refresh**, hoặc gán phím tắt "Refresh browser source" trong OBS → Settings →
  Hotkeys.
- **Xem trước** (D-349): cửa sổ 960 × 540 mở link Browser Source kèm `preview=1` — trang nền tối thường (không trong
  suốt), khung 16:9, bảng phím game vẽ minh họa (keycap xám thẳng 8 làn), nhãn **Xem trước · không dùng để quay**, tiêu
  đề cửa sổ "Xem trước overlay (không dùng để quay) — <bài>". Chạy theo màn chơi qua BroadcastChannel. Không dùng để
  quay (cách Window Capture + Chroma Key đã bỏ ở vòng 6). Kiểu Mobile: không phác keycap, không bàn nút — chỉ 4 vòng mờ
  ở chỗ nút chế độ như overlay trong OBS (D-375).

**Overlay chạy theo màn chơi thế nào:**

- Overlay mở trong cùng trình duyệt với màn chơi (cửa sổ **Xem trước**) nghe màn chơi trực tiếp; overlay trong OBS
  nghe qua kết nối obs-websocket của **Gửi thẳng vào OBS**.
- Mở overlay mà khoảng 2 giây không nghe thấy màn chơi nào → overlay tự chạy một mình (đếm ngược + đếm vào theo cài
  đặt lúc tạo link, không lặp). Màn chơi xuất hiện sau đó → overlay chuyển sang chạy theo.
- Đang chạy theo thì overlay không nhận phím / chuột. Đóng tab màn chơi → overlay dừng tại chỗ và chờ (ở cửa sổ trình
  duyệt thường, kể cả **Xem trước**, hiện **Đang chờ màn chơi…**; trong OBS không bao giờ hiện chữ này). Tab màn chơi
  bị che (bạn đang ở trong game) vẫn được: overlay chạy tiếp theo tempo đã biết và khớp lại khi nhận tin của màn chơi.
- Màn chơi đang đếm ngược: overlay trượt mượt tới rồi đứng yên ở đúng khung bắt đầu của đếm vào như màn chơi (stream
  không thấy cú nhảy lúc bấm Phát), rồi chạy cùng lúc; màn
  chơi còn chờ độ trễ ra loa (khi bật âm thanh) thì overlay chờ theo (tối đa 1 giây) thay vì chạy trước rồi bị kéo lùi
  (D-378).
- Mở nhiều tab màn chơi: overlay theo tab bạn vừa **thao tác** (Phát, tạm dừng, tua, đổi tempo…). Chỉ mở thêm một tab
  app (màn đầu cũng là màn chơi) thì overlay **không** đổi theo tab đó (D-337).
- **Cửa sổ nổi** đang mở (kiểu PC): overlay chạy theo cửa sổ nổi (màn chơi chính tạm dừng khi mở nó); đóng cửa sổ nổi
  thì overlay theo lại màn chơi (D-338).

## Tham số URL của overlay

Link có dạng `https://df-harmonica-tiles.vercel.app/#/overlay/<id bài mẫu>?…`,
`https://df-harmonica-tiles.vercel.app/#/overlay?…&data=…` hoặc
`https://df-harmonica-tiles.vercel.app/?overlay=1&song=<id>&…`. Nút **OBS** viết sẵn các tham số (luôn có
`fit=canvas`; cửa sổ **Xem trước** thêm `preview=1`); bảng dưới để tự chỉnh. Đọc ở `src/overlay/overlayParams.ts` —
đổi một bên thì sửa bên kia.

| Tham số     | Giá trị                            | Mặc định                   | Ý nghĩa                                                                                                                                              |
| ----------- | ---------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `song`      | id bài                             | —                          | bài mẫu (`seed-quoc-ca-viet-nam`, `seed-takediskrush`, `seed-ji-mo-de-ren`, `seed-sao-minh-chua-nam-tay-nhau`) hoặc bài đã lưu ở trình duyệt mở link |
| `data`      | chuỗi nén (như phần sau `#/s/`)    | —                          | nhúng cả bài vào link; thắng `song`                                                                                                                  |
| `fit`       | `source` / `canvas`                | `source`                   | `canvas` = trang phủ cả canvas OBS, ô rơi tự nằm trên bảng phím game; `source` = trang chỉ là khung ô rơi (link cũ)                                  |
| `layout`    | `full` / `game`                    | `full`                     | `game` = kiểu Khớp bảng phím game                                                                                                                    |
| `lanes`     | `vertical` / `horizontal`          | `vertical`                 | ô rơi dọc, hoặc chạy ngang từ phải sang trái (kiểu Dải ngang)                                                                                        |
| `gamebar`   | `0` / `1`                          | `1` (`layout=game`: `0`)   | game bar mô phỏng bảng phím (kiểu Mobile, mọi kiểu lane: không game bar, không bàn nút — chỉ 4 vòng mờ; bỏ qua)                                      |
| `banner`    | `0` / `1`                          | `1`                        | banner `ĐANG GIỮ …` / chế độ mobile                                                                                                                  |
| `bg`        | `transparent` / `theme` / `chroma` | `transparent`              | nền trong suốt hoặc theo giao diện app; `chroma` (`#00FF00`) chỉ còn cho link cũ — hộp thoại không tạo nữa                                           |
| `preview`   | `0` / `1`                          | `0`                        | `1` = cửa sổ **Xem trước**: nền tối, bảng phím game minh họa, nhãn "không dùng để quay"                                                              |
| `opacity`   | 0.3–1                              | `1` (`layout=game`: 0.85)  | độ đậm thân ô (bỏ qua khi `bg=chroma`: luôn 1)                                                                                                       |
| `scale`     | 0.5–3                              | `1`                        | `fit=canvas`: tinh chỉnh cỡ giao diện game (hộp thoại: 0.7–1.3); `fit=source`: phóng to ô và chữ                                                     |
| `scheme`    | `pc` / `mobile`                    | `pc`                       | kiểu điều khiển \*                                                                                                                                   |
| `semitone`  | `toggle` / `oneshot`               | `toggle`                   | chỉ với `scheme=mobile`: nút Nửa Cung bật / tắt giữ trạng thái, hay chỉ áp cho 1 nốt \*                                                              |
| `nl` `nr`   | chữ (URI-encoded, ≤ 24 ký tự)      | tên mặc định theo ngôn ngữ | tên gọi Cúi Xuống (`nl`) / Ngẩng Lên (`nr`) trên game bar và banner \*                                                                               |
| `nn` `ns`   | chữ (URI-encoded, ≤ 24 ký tự)      | tên mặc định theo ngôn ngữ | tên gọi Ngẩng Tự Nhiên (`nn`) / Nửa Cung (`ns`) \*                                                                                                   |
| `lookahead` | 4–12                               | `6`                        | số beat thấy trước trên màn \*                                                                                                                       |
| `tilescale` | 0.5–3                              | `1`                        | **Cỡ tile và nhãn** của màn chơi \*                                                                                                                  |
| `sublabel`  | `solfege` / `number` / `none`      | theo trình duyệt mở link   | nhãn phụ trên ô \*                                                                                                                                   |
| `lang`      | `vi` / `en`                        | theo trình duyệt mở link   | ngôn ngữ chữ trên overlay \*                                                                                                                         |
| `theme`     | `dark` / `light`                   | theo trình duyệt mở link   | giao diện \*                                                                                                                                         |
| `countin`   | `0` / `1`                          | `0`                        | khi tự chạy: ô chạy dẫn vào như đếm vào của màn chơi (không có số đếm)                                                                               |
| `delay`     | 0–10 (giây)                        | `0`                        | khi tự chạy: đếm ngược trước mỗi lần chạy                                                                                                            |
| `bpm`       | 20–400                             | tempo của bài              | khi tự chạy: đổi tempo                                                                                                                               |

\* Khi overlay đang chạy theo màn chơi, các giá trị này lấy từ màn chơi; giá trị trong link (ảnh chụp cài đặt của bạn
lúc tạo link) chỉ dùng khi overlay tự chạy một mình. Tham số `autoplay`, `loop`, `lyrics` của link cũ bị bỏ qua:
overlay tự chạy luôn bắt đầu sau đếm ngược và không lặp. Link không có `lookahead` chạy ở 6 beat (từ vòng 6; trước đó
8).

Bật / tắt nhận `1` / `0` (cả `true` / `false`, `yes` / `no`, `on` / `off`); giá trị sai thì dùng mặc định. Overlay
**không bao giờ phát tiếng** và không ghi gì vào cài đặt của trình duyệt mở nó.

## Cửa sổ nổi chi tiết

Cho người chơi **một màn hình**: một cửa sổ nhỏ **luôn nằm trên mọi cửa sổ** (kể cả game), chỉ có 8 làn ô rơi + vạch
sáng + banner giữ / chế độ — đặt ngay trên bảng phím kèn trong game. Dùng Document Picture-in-Picture có sẵn của
trình duyệt: không phải tải hay cài gì.

- **Mở:** kiểu **PC** → nút **Cửa sổ nổi** ở thanh dọc màn chơi (bài đang mở; màn chơi ở tab gốc tự tạm dừng). Khi
  cửa sổ đang mở, nút có nhãn nhỏ **Đang mở** — bấm lần nữa để đóng. Cửa sổ đang mở một bài khác thì màn chơi hiện
  **Chuyển sang bài này**. Kiểu **Mobile** (hoặc điện thoại / máy tính bảng không có Document PiP): nút này hỏi
  **Điện thoại của bạn: Apple (iPhone / iPad) hay Android?** rồi mở trang mini (Android) hoặc video nổi (Apple) — xem
  [Trang mini cho Android và Cửa sổ video nổi](#trang-mini-cho-android-và-cửa-sổ-video-nổi) (D-383). Cửa sổ nổi đang
  mở mà màn chơi đổi sang **Mobile** → cửa sổ đổi ngay sang bàn nút kiểu game ở đáy (vòng `CHẠM` đáp vào nút chế độ,
  banner lên đầu khu làn — D-366, D-373).
- **Căn với bảng phím game:** **Căn chỉnh** (trên thanh nhỏ của cửa sổ nổi) → hiện 8 vạch dẫn `Z … ,` và vạch mép
  dưới. Kéo cửa sổ tới ngay trên bảng phím kèn, mép dưới chạm mép trên bảng phím, kéo giãn cho 8 cột thẳng 8 phím. Esc
  để tắt Căn chỉnh. **Cỡ tile và nhãn** của Cài đặt không áp vào cửa sổ nổi.
- **Cỡ chuẩn theo màn hình** (D-407 – D-410, D-431 – D-433): cửa sổ mở sẵn rộng bằng **khung bảng phím** PC của game
  (8 cột đúng 8 phím ở giữa, đệm 0,26 bước cột mỗi bên — ô ngoài cùng cách mép ≈ 22 px ở 1080p như phím ngoài cùng
  cách viền của game) cộng dải giữ bên phải, và — khi mép dưới nằm trên mép trên bảng phím — mép trên chạm mép trên
  màn hình (đường rơi dài nhất). Đặt **mép trái cửa sổ thẳng mép trái khung bảng phím** là 8 cột thẳng 8 phím. UI game
  giả định phóng theo chiều cao màn: `k = cao px thật / 1080`, rộng ≈ `610·k` (khung `553,8·k` + dải giữ `56·k`), cao
  **ngoài** (gồm thanh tiêu đề) = `750·k` px thật, chia cho tỉ lệ Windows (125 % / 150 %). Vd. 900p: 509 × 625
  ngoài; 1080p: 610 × 750; 1440p: 813 × 1000; 4K: 1220 × 1500 (trước v1.0.1: 480 / 576 / 768 / 1152 — 8 cột sát mép;
  bảng đầy đủ + giả định 16:10 / ultrawide: `docs/GAME-UI-REFERENCE.md`). Cỡ đã kéo ở v1.0.0 bị bỏ qua một lần (cùng
  bề ngang thì 8 cột nay hẹp hơn, lệch phím). Thanh tiêu đề đo lần đầu mở rồi nhớ
  (`dfht-pip-chrome`) — lần đầu có thể thấp hơn vài px, mở lại là đúng. Cỡ bạn tự kéo được nhớ **theo màn hình**
  (`dfht-pip-size` kèm cỡ màn + tỉ lệ; sang màn khác → cỡ chuẩn của màn đó). Nút **Đặt lại cỡ chuẩn** trên thanh nhỏ:
  quên cỡ đã nhớ và đổi ngay về cỡ chuẩn; trình duyệt không cho đổi cỡ thì có dòng nhắc đóng rồi mở lại cửa sổ nổi
  (lần mở đó ra đúng cỡ chuẩn, ở chỗ mặc định của Chrome — D-419). Chrome giới hạn cỡ trang tự xin ở 25 % diện tích
  màn (D-418): màn 4:3 / 5:4 cửa sổ xin đúng bề ngang, thấp hơn, rồi tự cao lên ngay khi mở (không được thì **Đặt lại
  cỡ chuẩn**). Chrome nhớ chỗ cửa sổ của lần trước chỉ khi cỡ xin không đổi: lần mở thứ hai (sau khi đo thanh tiêu đề)
  có thể hiện ở chỗ mặc định một lần.
- **Chơi:** ▶ (hoặc Space) → đếm ngược theo Cài đặt → **Phát bài**, **tối thiểu 3 giây** (Tắt cũng đếm 3; thanh nhỏ
  không có ô đếm ngược riêng — D-367, D-381) để kịp bấm vào game → bài chạy (đếm vào không có số). R chơi lại từ đầu.
  Thanh nhỏ tự ẩn khi đang chạy, rê chuột lên để hiện lại.
- **Game phải chạy Borderless / Windowed** (Fullscreen độc quyền che mọi cửa sổ khác).
- **Giới hạn của trình duyệt:** cửa sổ nổi **không trong suốt** (nền tối đặc) và **có thanh tiêu đề**; trang web không
  tự đặt được vị trí cửa sổ. Chỉ có trên Chrome / Edge 116+ máy tính (và Firefox 151+); trình duyệt máy tính khác bấm
  nút sẽ hiện một dòng giải thích.
- Âm thanh theo Cài đặt (mặc định tắt). Cửa sổ nổi chỉ để **bạn** nhìn — người xem stream thấy ô rơi thì dùng overlay
  OBS. Bản desktop Tauri (ô rơi trong suốt thật) chỉ là mã nguồn chưa build thử, xem `docs/TAURI.md`.

## Trang mini cho Android và Cửa sổ video nổi

> **Thử nghiệm.** Dành cho người chơi **bản điện thoại** muốn nhìn ô rơi **ngay trên game** trên chính chiếc điện
> thoại đó. Video nổi dựng sẵn đã chạy trên iPhone thật của chủ dự án; trang mini Android chưa thử trên máy thật. Máy
> không ổn thì đặt một điện thoại / máy tính bảng thứ hai cạnh máy chơi và mở màn chơi bình thường trên đó.

**Nút Cửa sổ nổi trên điện thoại** (kiểu **Mobile**, hoặc máy không có Document PiP — D-383): lần đầu app hỏi
**Điện thoại của bạn: Apple (iPhone / iPad) hay Android?** (hộp thoại **Cửa sổ nổi trên điện thoại**, hai nút lớn
**Apple — iPhone / iPad** và **Android**; nút đoán theo máy được chọn sẵn). Lựa chọn được nhớ trên máy này
(localStorage `dfht-phone-kind`); cuối hai hộp thoại sau có dòng **Điện thoại: … · Đổi loại điện thoại** để hỏi lại.

- **Android** → hộp thoại **Cửa sổ mini / video nổi (thử nghiệm)** → **Mở trang mini** (bên dưới).
- **Apple** → thẳng tới video nổi của bài đang mở — xem [Video nổi trên iPhone / iPad](#video-nổi-trên-iphone--ipad).

Trang **mini** (`#/mini/<bài>`) chỉ có làn ô rơi (theo **Kiểu điều khiển**), **không có âm thanh** và giữ màn hình
sáng trong lúc chạy. Không có thanh điều hướng của app. Hai bố cục, chọn ở bảng lúc dừng và nhớ trên máy (D-395);
máy chưa chọn thì theo **Kiểu điều khiển** — Mobile → **Khớp nút game**, PC → **Thu nhỏ** (D-402):

- **Khớp nút game**: cửa sổ nổi của Android che mất phần bên dưới nên đặt nó **ngay trên bảng nút kèn** của game — 8 làn
  rơi thẳng 8 nút số thật, vạch chạm là **mép dưới cửa sổ**, vòng `CHẠM` rơi trong cột của nút chế độ thật và đáp ở mép
  dưới (4 vòng mờ đánh dấu chỗ đáp), ngay trên nút phải chạm. Không có bàn nút riêng, không banner chế độ (kiểu Mobile —
  vòng + nút thật của game đã cho biết chế độ, D-403); nhãn làn nhỏ ở đỉnh. Cần **Căn chỉnh** một lần (bên dưới).
  Cửa sổ đặt trên bảng nút chỉ cao ~80–150 px: bảng lúc dừng gói thành 2 hàng (D-401).
- **Thu nhỏ**: trang mini cũ — làn + bàn nút kiểu game thu nhỏ, đọc được trong cửa sổ khoảng 300 × 300, đặt ở góc
  màn hình.

Ở kiểu **PC** (mặc định của Cài đặt), bảng lúc dừng có **Chơi bản điện thoại?** + nút **Đổi sang Mobile** (ghi Kiểu điều
khiển như nút PC | Mobile của màn chơi).

**Đúng tỉ lệ thật** (D-405, D-406, D-412 – D-415 — để bạn chỉ cần kéo cửa sổ): trên **máy Android cảm ứng**, trang đọc
cỡ **màn hình** điện thoại (màn ngang, rộng hơn hẳn cửa sổ) nên 8 làn có **đúng khoảng cách nút thật**, hàng làn căn
giữa cửa sổ, dù cửa sổ rộng hay hẹp. UI game giả định phóng theo **chiều cao** màn (cùng giả định với Cửa sổ nổi PC):
bước cột ≈ `0,1975 ×` chiều cao màn ở mọi máy ≥ 19,5 : 9 (= `0,0912 ×` bề ngang ở màn của ảnh game); màn hẹp hơn
(16 : 9, máy tính bảng) theo bề ngang. Máy tính / iPhone không dùng cách này. Bảng lúc dừng và bảng Căn chỉnh có hai chỉ
báo:

- **Rộng:** **Rộng: vừa** / **Hẹp quá — kéo giãn thêm** / **Rộng hơn cần thiết** — cần = **8 làn** (8 bước cột ≈ 0,73
  bề ngang màn ảnh game — rộng hơn hàng nút chừng 1/4 nút mỗi bên để ô ngoài cùng không sát mép, D-434; trước v1.0.1 =
  hàng nút). Đã dời **Vạch · Dời** tới mức 8 làn ra ngoài mép cửa sổ:
  **Lệch tâm — kéo cửa sổ sang trái / phải rồi đặt "Vạch · Dời" về 0** (cửa sổ đúng cỡ, chỉ lệch chỗ).
- **Cao:** **Cao: vừa** / **Thấp quá — kéo mép trên lên chạm mép màn hình** / **Cao quá — đang che khung kèn** — mép
  trên chạm mép trên màn hình, mép dưới từ mép trên khung kèn (≈ 0,327 chiều cao màn) tới đỉnh hàng nút chế độ (≈
  0,361) — không che nút chế độ. Thanh kéo của cửa sổ nổi (trang không đo được) tính ~24 px khi xét "cao quá", tới
  36 px khi xét "thấp quá". Làn + vạch chạm luôn phủ cả chiều cao cửa sổ (vạch chạm = mép dưới).

Cách đặt: kéo giãn cửa sổ tới khi hai chỉ báo đều **vừa**, rồi **Căn chỉnh** và kéo cửa sổ sang trái / phải cho 8 vạch
thẳng tâm 8 nút số (đặt giữa màn là trùng — hàng nút của game căn giữa). Chỉ chỉnh số khi còn lệch: **Vạch · Dời** (dời
cả hàng, px), **Vạch · Giãn** (khoảng cách — cửa sổ nhỏ của vài hãng thu cả trang, máy có tỉ lệ màn khác), **Vòng ·
Dời** / **Vòng · Giãn** (hàng nút chế độ). Máy không cho biết cỡ màn (cỡ màn ≈ cỡ cửa sổ, màn dọc, 0, không phải
Android) → không có chỉ báo, dùng cách "cửa sổ = hàng nút" bên dưới (**Vạch · Nút 1** / **Vạch · Nút 1̇**).

**Căn chỉnh** (chỉ ở **Khớp nút game**, chỉ lúc dừng — D-398, D-399, D-416): kéo cửa sổ xuống ngay trên khung kèn
(không che hàng nút chế độ), kéo
góc cho mỗi mép ra ngoài nút 1 / nút 1̇ chừng 1/4 nút (khi không có chỉ báo), rồi bấm **Căn chỉnh**: 8 vạch dọc (tâm 8
làn), 4 vòng (chỗ vòng `CHẠM` đáp, chỉ kiểu Mobile) và vạch mép dưới; nhãn số của vạch hiện ngay trên hàng vòng khi
còn chỗ. Bảng chỉnh **một số mỗi lúc**; mỗi nút chọn ghi hai dòng — chỉnh **cái gì** (**Vạch** = 8 vạch nút số, **Vòng**
= 4 vòng nút chế độ) và **thế nào** — thứ đang chọn sáng lên trên vạch dẫn, thứ kia mờ: **Vạch · Dời** / **Vạch · Giãn**
/ **Vòng · Dời** / **Vòng · Giãn** (đúng tỉ lệ thật) hoặc **Vạch · Nút 1** / **Vạch · Nút 1̇** / **Vòng · Dời** / **Vòng ·
Giãn** (không có chỉ báo; kiểu PC: chỉ hai nút đầu) rồi **−** / **+** — mỗi chạm
dời đúng 1 px trên màn, **giữ** thì lặp và nhanh dần (5 px mỗi lần — D-400) — hoặc thanh trượt khi cửa sổ đủ rộng
(phím mũi tên ≈ 0,6 px). **Vạch nút 1 (trái)** và **Vạch nút 1̇ (phải)** = tâm nút 1 / nút 1̇ theo % bề ngang cửa sổ
(6 làn giữa chia đều; được ra ngoài khung một chút khi cửa sổ không giãn đủ), **Vòng nút chế độ: dời ngang** (± 1 cột)
và **Vòng nút chế độ: giãn khoảng cách** (70–130 %, quanh Ngẩng Tự Nhiên). Mặc định theo số đo ảnh game (`docs/GAME-UI-REFERENCE.md`: nút 1 ở 6,25 %, nút
1̇ ở 93,75 % khi cửa sổ = 8 làn căn giữa hàng nút; trước v1.0.1: 4,43 % / 95,63 % — số đã lưu giữ nguyên; máy đã mở
trang mini ở bản 1.0.0 với số mặc định thấy một lần chip **Bản mới: kéo rộng thêm ¼ nút mỗi bên** ở chỗ chỉ báo — chạm
mở hướng dẫn, đổi số căn chỉnh cũng tắt nó, D-441). **Đặt lại mặc định**; **Xong** hoặc Esc để thoát. Lưu trên máy
(localStorage `dfht-mini-calibration`). Cửa sổ thấp (≤ 220 px): bảng một hàng ~36 px ở đỉnh, nền gần trong suốt, không
che vòng / mép dưới. Trong lúc căn, chạm vào cửa sổ / Space / R không chạy bài. Nút ⓘ trong bảng Căn chỉnh = từng nút chọn chỉnh
cái gì (đoạn đầu — đọc được ngay cả ở cửa sổ thấp), rồi cách kéo / đổi cỡ cửa sổ nổi theo hãng (Samsung dạng xem
pop-up, Xiaomi / HyperOS, hãng khác); ở cửa sổ thấp hộp thoại phủ cả cửa sổ và cuộn được.

1. **Mở trang:** màn chơi → kiểu **Mobile** → **Cửa sổ nổi** → (lần đầu) **Android** → hộp thoại **Cửa sổ mini / video
   nổi (thử nghiệm)** cho bài đang mở → **Mở trang mini**.
2. **Chuyển trình duyệt thành cửa sổ nổi** (cách theo hãng ở dưới). **Khớp nút game:** đặt cửa sổ ngay trên bảng
   nút kèn rồi **Căn chỉnh** (ở trên). **Thu nhỏ:** kéo nó lên **góc trên** màn hình game, không che 12 nút kèn.
3. **Bắt đầu** → **chạm vào game** trong lúc đếm ngược (theo Cài đặt → **Phát bài**, **tối thiểu 3 giây**; panel chỉ
   nhắc "Đếm ngược: 3 giây · đổi ở Cài đặt → Phát bài" — D-367, D-381). Đếm vào cũng theo Cài đặt. Bài tự chạy tới hết.
4. Chạm vào cửa sổ mini = **tạm dừng**; chạm lại = **Chạy tiếp** (đếm ngược lại từ đầu). Hết bài chạm để **Chơi lại**.
   Nút ⓘ (**Hướng dẫn mở cửa sổ nổi**) có lại các bước dưới đây ngay trong trang.
5. **Về màn chơi** (D-362): lúc đang dừng (sẵn sàng / tạm dừng / hết bài), nút **◂** ở góc trên trái (tên đọc màn hình
   "Về màn chơi") mở màn chơi đầy đủ của bài (`#/play/<bài>`). Trong lúc đếm ngược và lúc ô đang rơi không có nút nào
   thêm.

**Cách mở cửa sổ nổi theo hãng:**

- **Samsung:** Đa nhiệm → chạm biểu tượng trình duyệt → **Mở ở dạng xem pop-up**. **Không** mở qua Game Booster /
  Gaming Hub. Game đứng hoặc ô ngừng rơi: cài Good Lock → MultiStar → bật **Multi Focus**.
- **Xiaomi / Redmi / POCO (HyperOS):** Đa nhiệm → nhấn giữ thẻ trình duyệt → **Cửa sổ nhỏ**, hoặc mở từ thanh bên. Vài
  máy Redmi giá rẻ không có tính năng này.
- **Huawei / Honor:** vuốt từ mép màn hình vào và giữ → thanh đa cửa sổ → trình duyệt.
- **OPPO / realme / OnePlus:** Thanh bên thông minh → trình duyệt. Chạm ra ngoài cửa sổ trong lúc chơi có thể làm
  cửa sổ bị giấu vào mép màn hình ("ẩn nhanh" của realme); có máy OnePlus bị văng game khi mở cửa sổ nhỏ.
- **vivo / iQOO, máy không có cửa sổ nổi:** vivo / iQOO có cửa sổ nhỏ nhưng không phóng to được (chữ khó đọc) và có
  thể làm treo game. Dùng máy thứ hai đặt cạnh, hoặc thử **Cửa sổ video nổi** bên dưới. iPhone / iPad không có cửa sổ
  nổi cho trình duyệt — ở màn chơi bấm **Cửa sổ nổi** → **Apple — iPhone / iPad** để mở video nổi của bài.

**Lưu ý khi chơi:** tắt **con quay hồi chuyển (gyroscope)** trong game (nếu không, kéo cửa sổ nổi sẽ làm xoay góc
nhìn); **không** mở cửa sổ qua tiện ích chơi game của hãng (Game Booster, Gaming Hub, Game Turbo, Game Space…) — chạm
vào game bị chặn thì gỡ DF khỏi các tiện ích đó; không chạm vào cửa sổ mini khi đang thổi (chạm = tạm dừng); game hiện
**cảnh báo bảo mật** thì đóng cửa sổ ngay. Trang **chỉ hiển thị**: không bấm thay bạn, không đọc màn hình game. Cộng
đồng có **lời đồn chưa kiểm chứng** rằng mở cửa sổ nhỏ khi chơi có thể bị khóa tài khoản — tự cân nhắc.

Link trang mini: `https://df-harmonica-tiles.vercel.app/#/mini/<bài>?delay=5` — `delay` (số giây nguyên 0–10) đè đếm
ngược của Cài đặt cho trang đó (kể cả mức tối thiểu 3 giây). Bài của bạn nằm trong trình duyệt của **chính máy đó**:
bài tự tạo trên PC thì gửi link chia sẻ sang điện thoại, **Lưu vào thư viện** rồi mới mở trang mini.

### Video nổi trên iPhone / iPad

Safari trên iPhone không mở được Picture-in-Picture cho video vẽ trực tiếp từ canvas (cách "Trực tiếp"), nhưng phát
được video **dựng sẵn** (D-384, D-385). Nên với **Apple**, nút **Cửa sổ nổi** của màn chơi đi thẳng tới hộp thoại
**Cửa sổ video nổi (thử nghiệm)** chỉ có cách dựng sẵn:

1. Hộp thoại mở là **dựng ngay** video của bài đang mở: thanh tiến độ **Đang dựng video… N%** và nhắc giữ trang mở,
   màn hình sáng tới 100 % (không chuyển app; app giữ màn hình sáng trong lúc dựng). Đóng hộp thoại lúc đang dựng = hủy
   dựng.
2. Dựng xong: dòng **Đã dựng xong: <cỡ file> · <số> giây.** và nút lớn **Mở video nổi** (nhận focus). Chạm một lần —
   trình duyệt chỉ cho mở Picture-in-Picture trong đúng cú chạm, nên app gọi nó ngay trong cú chạm, trên video đã nạp
   sẵn (D-361).
3. Hộp thoại ghi **Video nổi đang mở — chuyển sang game ngay, video đếm ngược rồi chạy.** Video có sẵn đếm ngược theo
   Cài đặt → **Phát bài**, tối thiểu 3 giây; đếm vào theo Cài đặt; không có tiếng. **Đóng cửa sổ video** để tắt.

Đóng hộp thoại **không** đóng video đang mở; mở lại hộp thoại thì dùng lại video đã dựng (đổi bài, giao diện, kiểu
điều khiển, đếm ngược… thì dựng lại). Rời màn chơi thì video đóng. Dựng lỗi → câu "Không dựng được video…" kèm nút
**Dựng video** để thử lại; trình duyệt không dựng được (không có WebCodecs / không phát được WebM) → "Trình duyệt này
chưa dựng được video nổi. Cập nhật iOS / Safari bản mới nhất rồi thử lại, hoặc dùng máy thứ hai."

### Cửa sổ video nổi (thử nghiệm)

Nút **Cửa sổ video nổi (thử nghiệm)** trong trang mini phát ô rơi dưới dạng **video** trong khung Picture-in-Picture
**luôn nằm trên mọi app** — cả trên máy không có cửa sổ nổi (Chrome Android, Chrome / Edge máy tính). Video có sẵn
đếm ngược 3-2-1, không có tiếng; chạm ra ngoài khung là chạm vào game.

- **Trực tiếp** → **Mở video trực tiếp** (nút chính khi trình duyệt hỗ trợ): vẽ ô rơi ngay lúc phát, mở nhanh — nhưng
  hình **có thể đứng khi trình duyệt xuống nền**. Nút ❚❚ / ▶ của khung video tạm dừng / chạy tiếp; hết bài thì ▶ chơi
  lại từ đầu. **Máy Apple không có mục này** (Safari không mở được — D-385; app cũng không chuẩn bị luồng canvas ở đó).
- **Dựng sẵn** → **Dựng video** (có thanh tiến độ, **Hủy dựng** được — **giữ trang mở cho tới 100 %**) → **Mở video
  dựng sẵn**: phát file video đã dựng nên **vẫn chạy khi trình duyệt xuống nền**. Bài 3 phút ~15 MB, chỉ giữ trong lúc
  trang mở. Máy Apple: tự dựng ngay mỗi lần hộp thoại mở (**Hủy dựng** vẫn hủy được).
- **Đóng cửa sổ video** để tắt. Video được chuẩn bị sẵn ngay khi hộp thoại mở, và lần chạm nút gọi Picture-in-Picture
  ngay lập tức (Safari chỉ cho mở PiP trong đúng lần chạm — D-361). Chạm khi video chưa sẵn sàng → "Video chưa sẵn sàng
  — chờ một giây rồi chạm lại." Video chuẩn bị mà 4 giây vẫn chưa nạp được, hoặc iPhone báo "chưa sẵn sàng" lần thứ hai
  → câu "không hỗ trợ" bên dưới (không bắt chạm lại mãi — D-370). Video dựng sẵn theo **Đếm vào** của Cài đặt.
- **Dựng sẵn qua `http://`:** iPhone dựng được cả khi mở app bằng `http://<IP máy tính>:…` trong mạng nhà (chủ dự án
  đã thử). Một số trình duyệt khác (Chrome) ẩn bộ mã hóa video WebCodecs trên trang `http://` không phải localhost →
  nút **Dựng video** mờ kèm câu về WebCodecs; trên link chính thức (`https`) thì không sao.
- Trình duyệt từ chối hoặc không hỗ trợ: app ghi một câu dễ hiểu thay vì lỗi kỹ thuật — trên iPhone / iPad "iPhone / iPad
  chưa hỗ trợ cửa sổ video nổi cho trang web này.", trình duyệt khác "Trình duyệt này chưa cho trang web mở cửa sổ video
  nổi…". Trình duyệt không có Picture-in-Picture hay không dựng được video WebM thì trang ghi một dòng giải thích.
- Trang mini coi là máy Apple khi bạn đã chọn **Apple** ở câu hỏi loại điện thoại; chưa chọn bao giờ thì đoán theo
  trình duyệt (iPhone mở thẳng link trang mini vẫn được cách chỉ dựng sẵn).

## Cài đặt chi tiết

Cài đặt tự lưu trên trình duyệt này (settings v5). Trang Cài đặt có 7 thẻ đánh số, xếp hai cột cố định (D-355):

- **01 Kiểu điều khiển:** _PC (bàn phím + giữ chuột)_ hoặc _Mobile (nút cảm ứng)_ — đổi được ngay bằng nút **PC** |
  **Mobile** ở thanh dọc màn chơi; với Mobile thêm **Nút Nửa Cung hoạt động kiểu**. **Tên gọi nút:** đổi tên 4 nhãn
  (Cúi Xuống, Ngẩng Lên, Ngẩng Tự Nhiên, Nửa Cung) cho khớp game của bạn — để trống là tên mặc định.
- **02 Giao diện:** **Chủ đề màu** (Tối / Sáng), **Ngôn ngữ** (Tiếng Việt / English), **Cỡ tile và nhãn**, **Nhãn phụ
  trên tile** (Solfège (Đồ Rê Mi) / Số 1–7 / Ẩn — mặc định **Ẩn**).
- **03 Phát bài:** **Đếm vào khi bấm Phát** (mặc định bật; trước v1.0.1 tên "Đếm vào 1 ô nhịp khi bấm Phát"), **Đếm ngược trước khi phát** (mặc định **3
  giây**; dòng nhắc thứ hai: Cửa sổ nổi, trang mini và video nổi luôn đếm ít nhất 3 giây, kể cả khi Tắt).
- **04 Harmonica:** **Quãng tám gốc** (`Z` = C4 mặc định). Nửa Cung luôn là **thăng** (+1 bán cung) như game.
- **05 Âm thanh:** xem [Âm thanh](#âm-thanh).
- **06 Luyện tập:** **Chế độ luyện tập mặc định**, ghi chú cách bấm theo kiểu điều khiển.
- **07 MIDI:** **Bật MIDI**, **Thiết bị MIDI**, **Dịch bán cung**, **Dịch quãng tám**, **Chỉ cần đúng pitch class (bỏ
  qua quãng tám)**.
- **Đặt lại mặc định** đưa mọi cài đặt về mặc định (không đụng tới bài hát).

**Lookahead** (mặc định 6 beat) chỉ chỉnh trên thanh điều khiển màn chơi. Danh sách phím tắt nằm ở cột trái màn chơi
(Cài đặt không còn thẻ Phím tắt). Cài đặt từ bản cũ được chuyển một lần: **Đếm ngược** đang Tắt thành 3 giây, **Nhãn
phụ trên tile** thành Ẩn (v4); lookahead đang là 8 (mặc định cũ) thành 6, giá trị khác giữ nguyên (v5); các lựa chọn
đã bỏ (chiều Nửa Cung, phím thay chuột khi luyện tập, hiện lời) biến mất.

## Cài như app và dùng offline

- **Cài như app (PWA):** trên Chrome / Edge máy tính bấm biểu tượng cài đặt ở thanh địa chỉ (hoặc menu trình duyệt →
  cài trang này thành ứng dụng); trên điện thoại dùng "Thêm vào màn hình chính". App mở trong cửa sổ riêng, không
  thanh địa chỉ.
- **Offline:** sau lần mở đầu tiên, toàn bộ app được lưu trong trình duyệt — lần sau mở không cần mạng (app báo **Đã
  sẵn sàng dùng offline**). Trang dùng `http://` qua mạng LAN (vd. điện thoại mở `http://192.168.x.x:4173`) không có
  service worker nên không offline được.
- Khi có bản mới, app hiện **Có bản mới** với nút **Tải lại** (dùng bản mới ngay) hoặc **Để sau**. Thư viện và cài
  đặt của bạn không mất.
- **App tự kiểm tra bản mới** (D-382) — không cần tự tải lại trang: khi bạn quay lại tab app (tối đa 5 phút một lần) và
  cứ 45 phút một lần khi tab đang hiện. Offline thì bỏ lượt, lỗi mạng không báo gì. Overlay OBS và trang mini không
  đăng ký service worker nên không có nhắc này.

## Giới hạn đã biết

- **Luyện tập chỉ nhận phím khi tab app đang được chọn** (focus) — không luyện được trong lúc cửa sổ game đang được chọn.
- Cách nút **Nửa Cung trên mobile** hoạt động (bật / tắt hay chỉ 1 nốt) **chưa xác nhận** trong game.
- **Web MIDI không có trên Safari** (dùng Chrome, Edge, Firefox 108+). Kiểu Mobile không nhận đàn MIDI khi luyện tập.
- **Gửi thẳng vào OBS** cần OBS 28+ và màn chơi chạy trên **cùng máy** với OBS; chưa được thử với OBS thật trước khi
  phát hành — gặp lỗi thì dùng Browser Source thủ công. Trình duyệt có thể hỏi quyền truy cập thiết bị trong mạng cục
  bộ (trang `https` nói chuyện với `127.0.0.1`) — chọn Cho phép.
- **Browser Source thủ công không nối OBS** thì overlay tự chạy một mình theo link, một lần mỗi lần OBS tải / refresh
  (không theo Tạm dừng / tua / tempo của màn chơi).
- Overlay tự khớp bảng phím theo **UI scale mặc định** của game; UI scale khác thì chỉnh **Cỡ giao diện game (tinh
  chỉnh)**.
- **Cửa sổ nổi** chỉ có trên Chrome / Edge 116+ máy tính (và Firefox 151+); cửa sổ đục, có thanh tiêu đề, phải tự kéo
  vào chỗ; game phải Borderless / Windowed.
- **Trang mini (Android) và Cửa sổ video nổi** là **thử nghiệm**; trang mini chưa thử trên điện thoại Android thật:
  tùy hãng, game có thể đứng, cửa sổ có thể bị giấu hoặc game bị văng. **Khớp nút game** đo theo một ảnh chụp màn
  hình game (màn ≈ 19,5 : 9) — máy / cỡ giao diện game khác cần **Căn chỉnh**; "đúng tỉ lệ thật" giả định trình duyệt
  trong cửa sổ nổi báo cỡ cả màn hình, không thu nhỏ trang và UI game phóng theo chiều cao màn (chưa thử trên máy
  thật — sai thì chỉnh **Vạch · Giãn** / **Vạch · Dời**); chỉ báo **Cao** đoán thanh kéo của cửa sổ nổi ~24 px; cửa sổ
  nổi chỉ có vài cỡ cố định thì có thể không giãn đúng mép hàng nút (chỉnh **Vạch · Dời** / **Vạch · Giãn**, hoặc
  **Vạch · Nút 1** / **Vạch · Nút 1̇** khi không có chỉ báo). **Cửa sổ video nổi** mở từ trang mini vẫn là bố
  cục có bàn nút (chưa khớp nút game). Video **Trực tiếp** có thể đứng hình khi trình
  duyệt xuống nền — dùng **Dựng sẵn**.
- **iPhone / iPad:** không có cửa sổ nổi cho trình duyệt; **video nổi dựng sẵn** chạy được (đã thử trên iPhone thật),
  **Trực tiếp** thì không (Safari không mở PiP cho video vẽ từ canvas — app ẩn cách này trên máy Apple). Phải chờ dựng
  xong (giữ trang mở, màn hình sáng) mới mở được; đổi bài / cài đặt là dựng lại.
- **Âm thanh bật:** sau số cuối của đếm ngược, ô có thể đứng thêm khoảng 60–80 ms (độ trễ ra loa) rồi mới chạy — không
  nhảy, chỉ chậm bắt đầu một chút. Lần đầu một ô chạm vạch sáng, máy yếu có thể khựng 35–60 ms (GPU vẽ hiệu ứng lần
  đầu; app đã "làm nóng" hiệu ứng phát sáng trong lúc đếm ngược — D-380).
- **Luyện bằng chạm** chưa thử trên điện thoại thật (cảm giác rung, đa chạm trên iPhone). Trên điện thoại dọc, chữ nút
  chế độ nhỏ — xoay ngang cho giống game.
- **Tự chơi để tạo bài** chỉ nhận phím khi tab app đang được chọn và ghi mỗi lúc một nốt — nhấn hai phím gần như
  cùng lúc (< 40 ms) thì giữ phím sau.
- **Tạo bài từ MIDI / MusicXML có thể chọn sai nốt** với bản nhạc phức tạp (nhiều bè, hợp âm, piano hai tay) — luôn
  kiểm tra lại. Gợi ý track chỉ là gợi ý; cách chia dòng / section tự động có thể chưa hợp ý — sửa trong trình soạn.
- **AI chuyển cảm âm có thể sai** — phát thử, sửa các chỗ AI ghi `// không chắc` (thành cảnh báo `//!` trong trình soạn).
- **Bản nháp** (bài vừa tạo, chưa Lưu) mất khi tải lại trang.
- **Bộ nhớ theo từng trình duyệt:** bài lưu ở Chrome không thấy ở Edge, OBS hay máy khác; xóa dữ liệu duyệt web là
  mất bài. **Sao lưu bằng nút Xuất .json / Xuất .harm** thường xuyên.
- Link chia sẻ của bài rất dài có thể bị app chat cắt mất (app cảnh báo khi link trên 8000 ký tự) — gửi file `.harm`
  thay thế. Link bị cắt sẽ mở ra trang "Link chia sẻ không hợp lệ".

## Giấy phép và bản quyền bài mẫu

Mã nguồn của app theo giấy phép MIT (file `LICENSE`) — giấy phép chỉ áp dụng cho **mã nguồn**. Các bài mẫu
(`src/library/seeds/*.harm`) là bản ký âm giai điệu để minh họa, **không** thuộc giấy phép MIT; bản quyền bài hát thuộc
về tác giả / chủ sở hữu quyền (file `NOTICE`): _"Quốc ca Việt Nam"_ — Văn Cao (gia đình nhạc sĩ đã hiến tặng bản quyền
cho Nhà nước), _"TAKEDISKRUSH!"_ — N2UtheHartlocker, _"寂寞的人伤心的歌"_ (Bài Ca Đau Khổ Của Kẻ Cô Đơn) — 龙梅子、杨海彪, _"Sao Mình Chưa Nắm Tay Nhau"_ — Yan Nguyễn.
Thẻ bài mẫu ở Thư viện và header màn chơi có dòng nhỏ **Bản quyền bài hát thuộc về tác giả: …** (bài của người dùng,
kể cả bản sao của bài mẫu, thì không). Nếu bạn là tác giả và muốn gỡ bài, hãy liên hệ qua
[GitHub Issues](https://github.com/nienlequang/df-harmonica-tiles/issues) — link này cũng có ở cuối trang Hướng dẫn và
đầu trang Dev notes.
