# Changelog

Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), phiên bản theo [SemVer](https://semver.org/).

## [Unreleased]

## [1.0.2] - 2026-10-17

### v1.0.2 — bài mẫu mới + ghi công bản quyền (2026-10-17)

DECISIONS D-446.

#### Added

- **Bài mẫu thứ ba:** _"寂寞的人伤心的歌 (Bài Ca Đau Khổ Của Kẻ Cô Đơn)"_ — 龙梅子、杨海彪 (125 BPM, 2:52, 504 nốt, 10
  đoạn), đứng sau _"Quốc ca Việt Nam"_ và _"TAKEDISKRUSH!"_ trong Thư viện. Chuyển từ cảm âm bằng chính bộ chuyển của
  app (ô **Dán kết quả của AI vào đây**), tông dễ chơi nhất.
- **Ghi công bài mẫu:** thẻ bài mẫu ở Thư viện và header màn chơi có dòng nhỏ **Bản quyền bài hát thuộc về tác giả:
  …** (tiếng Anh: _Song © its author(s): …_); bài của bạn (kể cả bản sao của bài mẫu) thì không.
- Cuối trang **Hướng dẫn** và đầu trang **Dev notes**: **Nếu bạn là tác giả và muốn gỡ bài, hãy liên hệ qua GitHub
  Issues** (mở tab mới).

#### Changed

- Giấy phép: MIT chỉ áp dụng cho mã nguồn. File `NOTICE` mới (README, `docs/REFERENCE.md` có dòng tương ứng): các bài
  mẫu là bản ký âm giai điệu để minh họa, bản quyền tác phẩm thuộc tác giả / chủ sở hữu quyền, không cấp phép theo MIT.
  `LICENSE` giữ nguyên văn bản MIT.

## [1.0.1] - 2026-10-17

### Mã nguồn mở (2026-10-17)

DECISIONS D-443 – D-445.

#### Added

- Link nhỏ **Mã nguồn (GitHub)** ở đầu trang **Dev notes** và cuối trang **Hướng dẫn** (cạnh **Dev notes**, mở tab
  mới): mã nguồn của app ở [github.com/nienlequang/df-harmonica-tiles](https://github.com/nienlequang/df-harmonica-tiles),
  giấy phép MIT (file `LICENSE`).

#### Changed

- Cho người phát triển: test dùng hai bài tự soạn ở `src/test/fixtures/` thay cho hai file bài mẫu cũ; CI GitHub Actions
  chạy lint, typecheck, format, test, build ở mỗi push lên `main` / pull request (e2e chỉ chạy tay); bản desktop Tauri
  chỉ build khi chạy tay. App không đổi hành vi.

### v1.0.1 — góp ý của chủ dự án trên bản live 1.0.0 (2026-10-17)

DECISIONS D-427 – D-442.

#### Fixed

- **Nốt đầu chạm vạch sáng không còn khựng.** Nguyên nhân: lần đầu keycap sáng (bóng sáng + hiệu ứng nhấn) và banner
  **ĐANG GIỮ …** hiện lên, trình duyệt phải dựng hiệu ứng đồ họa ngay giữa lúc ô đang rơi. Giờ app dựng sẵn những hiệu
  ứng đó (vô hình) lúc ô còn đứng yên — ở màn chơi, Cửa sổ nổi (chờ CSS của cửa sổ nạp xong rồi mới dựng), overlay OBS
  và trang mini; bật tiếng thì âm thanh cũng được chuẩn bị sẵn. Đo trên Edge headless, trình duyệt mới mở, khung hở lớn
  nhất quanh lần chạm đầu của _"Quốc ca Việt Nam"_ kiểu PC (16,7 ms = không rớt khung; máy dùng chung nên số dao động —
  hai đợt đo, mỗi đợt 3 lượt trước / sau): **CPU thường 24–30 → 17 ms** — hết rớt khung (có tiếng: 25–30 → 17–33 ms). CPU
  chậm 4 ×: trước 27–55 ms, sau 19–40 ms (có tiếng: 29–68 → 19–50 ms); overlay theo màn chơi 40 → 25 ms, trang mini 34 →
  21 ms (trung vị, một đợt). Ở CPU chậm 4 × trang mới đôi khi vẫn còn một khung ~30 ms lúc chạm đầu (ở 6 × lần chơi đầu
  và lần chơi sau như nhau — chi phí mỗi nốt, không còn chi phí lần đầu).
- **Cửa sổ nổi (PC) và overlay OBS: ô ngoài cùng không còn sát viền.** Cửa sổ nổi và overlay **Khớp bảng phím game**
  giờ rộng bằng **khung bảng phím** của game (đo trên ảnh chụp bảng phím của chủ dự án): 8 cột vẫn thẳng 8 phím, hai
  bên chừa khoảng như viền của game (≈ 22 px ở 1080p). Cỡ chuẩn của Cửa sổ nổi: 1080p 610 × 750 (trước 576 × 750),
  1440p 813 × 1000, 4K 1220 × 1500 — đặt **mép trái cửa sổ thẳng mép trái khung bảng phím**. Overlay ở canvas 1920 ×
  1080: 610 × 600 tại (683, 150). Cỡ Cửa sổ nổi bạn đã tự kéo ở bản 1.0.0 được bỏ qua một lần (cửa sổ mở lại ở cỡ
  chuẩn mới). Link overlay cũ không có `fit=canvas` giữ nguyên.
- **Trang mini Android "Khớp nút game": ô ngoài cùng không chạm mép cửa sổ.** Cửa sổ vừa giờ rộng hơn hàng nút chừng
  1/4 nút mỗi bên (chỉ báo **Rộng: vừa** tính theo đó); không có chỉ báo thì kéo mỗi mép ra ngoài nút 1 / nút 1̇ chừng
  1/4 nút. Số căn chỉnh bạn đã lưu giữ nguyên. Màn chơi kiểu Mobile, Cửa sổ nổi kiểu Mobile và overlay kiểu Mobile vốn
  đã có khoảng cách — không đổi.

#### Changed

- **Đếm vào ngắn lại 35 %.** Lúc đếm ngược 3-2-1, nốt đầu giờ nằm gần vạch sáng hơn (thường đã thấy sẵn trên làn) và rơi
  tới vạch nhanh hơn: quãng đi = 65 % quãng cũ — _"TAKEDISKRUSH!"_ 2,6 beat (trước 4), _"Quốc ca Việt Nam"_ 4,39 beat
  (trước 6,75). Vẫn đứng yên lúc đếm ngược, không số khi ô đã chạy, không nhảy lùi — ở màn chơi, Cửa sổ nổi, overlay
  (theo màn chơi và tự chạy), trang mini, video nổi. Bật **Tiếng click** thì tick theo nhịp tới nốt đầu (Quốc ca: 4 tick
  rồi nốt lấy đà), luôn ít nhất 2 tick: bài 3/4 / 2/4 vào ngay đầu ô nhịp đếm vào 2 beat (2/4 vẫn 1 ô nhịp như trước).
  Cài đặt → **Phát bài**: tên mới **Đếm vào khi bấm Phát**.
- **Trang mini "Khớp nút game" không biết cỡ màn hình** (máy tính, iPhone, máy không báo cỡ màn — không có chỉ báo
  **Rộng**): mặc định giờ là cửa sổ rộng hơn hàng nút ~1/4 nút mỗi bên (trước: đúng mép nút 1 / nút 1̇), nên cửa sổ đặt
  theo cách cũ thì làn hơi lệch vào trong. Máy đã dùng trang mini ở bản 1.0.0 (số căn chỉnh mặc định) thấy một lần nhắc
  **Bản mới: kéo rộng thêm ¼ nút mỗi bên** ở hàng trên — chạm để xem hướng dẫn, nhắc không hiện lại. Số căn chỉnh đã
  lưu không đổi.
- **Bài mẫu "Quốc ca Việt Nam" chỉ còn Phần 1 + Phần 2** (1:02 thay vì ~2:02).

## [1.0.0] - 2026-10-16

### Âm thanh trên iPhone / điện thoại (2026-10-17)

Chủ dự án báo: iPhone bật tiếng giai điệu rồi bấm Phát mà không nghe gì, gạt nút bên hông sang đổ chuông mới nghe.
DECISIONS D-421 – D-426.

#### Fixed

- **iPhone: tiếng phát cả khi gạt nút im lặng bên hông.** Khi bạn bật tiếng (giai điệu mẫu / click / tiếng khi bấm),
  màn chơi xin iOS phát như một app nghe nhạc (Safari 16.4+: Audio Session API; iOS cũ hơn: một đoạn âm thanh im lặng
  lặp lại). Nhạc của app khác tạm dừng trong lúc đó; tắt hết tiếng hoặc rời màn chơi là trả lại. Âm thanh tắt (mặc
  định) thì app không đụng tới gì. Cũng áp cho **Nghe thử** ở Tạo bài từ file (chỉ trong lúc nghe) và màn **Tự chơi
  để tạo bài** (tiếng click / tiếng phản hồi).
- **Lần Phát đầu đã có tiếng:** bấm **Tôi hiểu, bật** (nút loa hoặc Cài đặt → **Âm thanh**), bật **Tiếng click** /
  **Phát tiếng khi bấm phím / nốt** là mở âm thanh ngay trong cú bấm đó. iPhone lần đầu mở chậm: app chờ tới 3 giây
  (trước là 1 giây) trước khi cho ô chạy không tiếng.
- **Bị gián đoạn không còn mất tiếng cả phiên:** cuộc gọi / Siri / app khác chiếm loa, hoặc trình duyệt chưa cho mở —
  ô vẫn chạy, âm thanh tự gắn lại khi máy trả loa, hoặc ở cú bấm / chạm kế tiếp (Phát, bàn nút, bất cứ đâu trên
  trang). Câu nhắc **Chưa bật được âm thanh…** hiện một lần mỗi lần mở trang (cả khi chỉ bật tiếng khi bấm lúc luyện
  tập); trên iPhone kèm cách xử lý (tăng âm lượng, tắt chế độ tập trung, gạt nút bên hông).

#### Changed

- Nút loa: trình đọc màn hình đọc tên cố định **Tiếng giai điệu** kèm trạng thái đã nhấn / chưa nhấn; tooltip vẫn là
  việc sẽ làm (**Bật tiếng giai điệu** / **Tắt tiếng**).

### Bổ sung trước deploy (chủ dự án duyệt, 2026-10-16)

Ba bổ sung chủ dự án duyệt cho lần deploy đầu; DECISIONS D-392 – D-398, sửa sau review D-399 – D-404, đúng tỉ lệ
thật + chiều cao của trang mini D-405 – D-406, cỡ Cửa sổ nổi PC D-407 – D-411, sửa sau review 2 D-412 – D-420.

#### Added

- **Nút loa trên thanh điều khiển màn chơi** (ngay trước **Tempo**): mặc định tắt tiếng; bấm → đúng hộp cảnh báo bản
  quyền của Cài đặt → Âm thanh → **Tôi hiểu, bật** thì giai điệu mẫu bật, nút đỏ và huy hiệu **🔊 Đang phát giai
  điệu** hiện; bấm lần nữa là tắt ngay. Cùng một công tắc với Cài đặt → **Âm thanh** → **Phát giai điệu mẫu**. Overlay,
  trang mini, Cửa sổ nổi vẫn im lặng.
- **Trang mini Android "Khớp nút game"** (mặc định ở kiểu Mobile): đặt cửa sổ nổi ngay trên bảng nút kèn của game —
  8 làn rơi thẳng 8 nút số, vòng `CHẠM` đáp ở mép dưới ngay trên nút chế độ phải chạm (theo số đo ảnh chụp màn hình
  game), không có bàn nút / banner chế độ riêng. **Căn chỉnh** (lúc đang dừng): 8 vạch + 4 vòng; nút chọn ghi hai dòng
  — chỉnh cái gì (**Vạch** = 8 vạch nút số, **Vòng** = 4 vòng nút chế độ) và thế nào (**Dời** / **Giãn**, hoặc **Nút
  1** / **Nút 1̇**), thứ đang chọn sáng lên trên màn — rồi **−** / **+** (mỗi chạm 1 px, giữ để chạy nhanh dần) hoặc
  thanh trượt; **Đặt lại mặc định**; nhớ trên máy. Bảng Căn chỉnh và bảng lúc dừng gọn cho cửa sổ thấp ~80–150 px (cỡ thật khi đặt trên bảng
  nút). ⓘ của Căn chỉnh có cách kéo / đổi cỡ cửa sổ nổi theo hãng (Samsung, Xiaomi / HyperOS, hãng khác). **Thu nhỏ** =
  trang mini cũ có bàn nút riêng (mặc định ở kiểu PC), app nhớ lựa chọn. Kiểu PC: dòng **Chơi bản điện thoại?** + nút
  **Đổi sang Mobile**.
- **Trang mini "Khớp nút game" đúng tỉ lệ thật** (chủ dự án: chỉ cần kéo, hạn chế phải căn chỉnh): trên máy Android
  cảm ứng, trang đọc cỡ màn hình điện thoại nên 8 làn có đúng khoảng cách nút thật dù cửa sổ rộng / hẹp, hàng làn căn
  giữa cửa sổ (UI game giả định phóng theo chiều cao màn, như Cửa sổ nổi PC). Hai chỉ báo ở bảng lúc dừng và bảng Căn
  chỉnh: **Rộng: vừa** / **Hẹp quá — kéo giãn thêm** / **Rộng hơn cần thiết** / **Lệch tâm — kéo cửa sổ sang trái |
  phải** và **Cao: vừa** / **Thấp quá — kéo mép trên lên chạm mép màn hình** / **Cao quá — đang che khung kèn** (cửa sổ
  nên chạy từ mép trên màn hình xuống ngay trên khung kèn, không che hàng nút chế độ — làn dài nhất). Căn chỉnh khi đó
  chỉnh **Vạch · Dời** / **Vạch · Giãn** / **Vòng · Dời** / **Vòng · Giãn**; máy không cho biết cỡ màn (hoặc máy tính,
  iPhone) thì như cũ (**Vạch · Nút 1** / **Vạch · Nút 1̇**, không chỉ báo). Số đo thêm ở `docs/GAME-UI-REFERENCE.md`.
- **Cửa sổ nổi PC: cỡ chuẩn cho mọi màn hình.** Mở sẵn ở cỡ mà 8 cột rộng đúng 8 phím game và, khi mép dưới nằm trên
  bảng phím, mép trên chạm mép trên màn hình (1080p: 576 × 750 kể cả thanh tiêu đề; 900p, 1200p, 1440p, 4K… theo chiều
  cao màn, cả Windows 125 % / 150 %). Thanh tiêu đề đo ở lần mở đầu rồi nhớ. Nút **Đặt lại cỡ chuẩn** trên thanh nhỏ
  của cửa sổ nổi. Màn 4:3 / 5:4 (Chrome giới hạn cỡ trang tự xin ở 25 % diện tích màn): xin đúng bề ngang, chiều cao
  thấp hơn rồi tự cao lên ngay khi mở.

#### Changed

- Huy hiệu **Đang phát giai điệu**: lời nhắc chỉ thêm nút loa bên cạnh Cài đặt → Âm thanh. Màn hẹp / thấp (điện
  thoại): chỉ còn ô đỏ **[🔊]** (chữ đầy đủ ở tooltip / trình đọc màn hình) để bật giai điệu không làm trang nhảy.
- Cửa sổ nổi PC: cỡ đã kéo chỉ được nhớ **theo từng màn hình** (sang màn khác / đổi tỉ lệ Windows → cỡ chuẩn của màn
  đó); cỡ nhớ từ bản trước (576 × 600, không ghi màn hình) không dùng lại — mở lần đầu ở cỡ chuẩn mới, cao hơn.
- Thanh điều khiển ở màn ~1024 px: hai thanh trượt Tempo / Lookahead ngắn lại một chút để vẫn nằm một hàng.
- Hộp thoại ở khung rất thấp (≤ 240 px, vd. cửa sổ nổi) phủ cả khung, đầu gọn, phần thân cuộn được.

#### Fixed

- Bật giai điệu bằng nút loa trong lúc đếm ngược: âm thanh được mở khóa ngay trong cú bấm (trước đó Safari / iPhone có
  thể chặn — báo lỗi và chạy không tiếng).

### Vòng sửa 7 + chuẩn bị deploy (2026-10-16)

Theo 8 mục góp ý vòng 7 và 5 mục trước deploy người dùng đã duyệt sau khi test bản vòng 6 trên PC và iPhone;
DECISIONS D-373 – D-391. Bản này lên Vercel: **https://df-harmonica-tiles.vercel.app**.

#### Added

- **Cửa sổ nổi trên điện thoại hỏi loại máy:** nút **Cửa sổ nổi** (kiểu Mobile, hoặc điện thoại không có cửa sổ nổi
  của trình duyệt) hỏi **Điện thoại của bạn: Apple (iPhone / iPad) hay Android?** một lần và nhớ trên máy (dòng
  **Đổi loại điện thoại** ở cuối hộp thoại để đổi). Android → hộp thoại trang mini như cũ.
- **Video nổi cho iPhone / iPad:** chọn **Apple** là vào thẳng video nổi của bài đang mở — app dựng video ngay (thanh
  tiến độ, giữ màn hình sáng), xong thì một chạm **Mở video nổi** rồi chuyển sang game. Đóng hộp thoại không tắt video
  đang mở; video đã dựng được giữ cho lần mở sau.
- **App tự kiểm tra bản mới** khi bạn quay lại tab và mỗi 45 phút — **Có bản mới → Tải lại** hiện mà không cần tự tải
  lại trang.
- Trang **Dev notes** (`#/dev`): tài liệu tham khảo (`docs/REFERENCE.md`: cú pháp `.harm` đầy đủ, bảng lỗi, tham số
  URL của overlay, giới hạn đã biết) + phiên bản, commit, ngày build của bản đang chạy + CHANGELOG. Vào bằng link nhỏ
  **Dev notes** ở cuối trang Hướng dẫn và trang Cài đặt.
- Cài đặt → **03 Phát bài**: dòng nhắc "Cửa sổ nổi, trang mini và video nổi luôn đếm ít nhất 3 giây…".
- Dán link app vào Facebook / Zalo / Discord có ô xem trước (tên app, mô tả, biểu tượng).

#### Changed

- **Kiểu Mobile:** nhắc chạm nút chế độ là một **vòng `CHẠM` trong suốt** (viền màu chế độ, to đúng bằng nút chế độ,
  chữ `CHẠM` ở giữa) rơi **nhanh hơn ô 1,75 lần** và **trùng khít nút đúng lúc phải chạm**, vẽ nổi trên bàn nút — thay
  thanh `CHẠM` ngắn của vòng 6. Áp ở màn chơi, Cửa sổ nổi, trang mini, video nổi và overlay.
- **Overlay OBS kiểu Mobile** (cả **Xem trước**): không vẽ bàn nút nữa (nút thật của game nằm ngay dưới) — chỉ 4 vòng
  mờ đánh dấu 4 nút chế độ, vòng `CHẠM` rơi vào đó. Overlay dải ngang: 4 vòng mờ đó thay 4 vòng tô đặc có ký hiệu.
- **Cửa sổ nổi**, **trang mini** và **video nổi** đếm ngược theo Cài đặt → Phát bài nhưng **ít nhất 3 giây** (Tắt → 3
  giây; link mini có `?delay=` thì theo link).
- Vòng `CHẠM`: chữ `CHẠM` mờ đi ngay trước khi vòng đáp vào nút, để đọc được tên nút đúng lúc phải chạm.
- Hộp thoại video của trang mini trên iPhone / iPad: chỉ còn **Dựng sẵn** và tự dựng khi mở (Safari không mở được
  **Trực tiếp**); máy khác giữ cả hai, **Mở video trực tiếp** là nút chính.
- Link trong tài liệu: **https://df-harmonica-tiles.vercel.app** thay link tạm "cập nhật sau khi deploy"; ảnh
  README chụp lại (màn chơi Mobile, Thư viện, hộp thoại OBS, Cài đặt). `docs/LOCAL-TEST-CHECKLIST.md` thành checklist
  sau deploy.

#### Removed

- Hai bài mẫu cũ — app chỉ còn _"Quốc ca Việt Nam"_ và _"TAKEDISKRUSH!"_. Bản sao bạn đã lưu trong Thư viện của
  mình không bị xóa.
- Bàn nút kiểu game trong overlay OBS kiểu Mobile (thay bằng 4 vòng mờ, xem trên).

#### Fixed

- **Khựng lúc bắt đầu phát:** hết đếm ngược, khu ô rơi không còn nhảy lùi một ô nhịp (ô thấy trong lúc 3-2-1 biến
  mất, làn trống ~0,5 giây — rõ nhất ở _"Quốc ca Việt Nam"_). Giờ bấm Phát thì ô trượt mượt (~1/3 giây) về khung mà
  đếm vào bắt đầu rồi đứng yên trong lúc đếm ngược, hết số thì chạy tiếp; Esc trượt về chỗ cũ; tắt đếm ngược mà bật
  đếm vào thì ô lùi mượt rồi rơi — không lúc nào nhảy cóc. Ở màn chơi, Cửa sổ nổi, overlay (theo màn chơi và tự chạy)
  và trang mini. Overlay
  theo màn chơi chờ độ trễ âm thanh của màn chơi thay vì chạy trước rồi bị kéo lùi.
- Khựng ~0,1 giây (máy bận: tới ~0,3 giây) đúng lúc nốt đầu chạm vạch sáng: app "làm nóng" hiệu ứng phát sáng của ô
  và phím trong lúc đếm ngược.
- Tài liệu: bỏ câu "Dựng sẵn cần https" — iPhone dựng được cả qua `http://` trong mạng nhà.
- Tên nút chế độ tiếng Anh `SEMITONE` không còn bị cắt đôi ("SEMITON / E") trong nút tròn — chữ thu nhỏ cho vừa.
- Overlay OBS kiểu Mobile dải ngang không còn hiện game bar Mobile (bàn nút đầy đủ) khi link có `gamebar=1`.
- Hộp thoại video nổi (Apple): lúc còn dựng, nút **Mở video nổi** trông rõ là đang khóa (viền nét đứt) và trình đọc màn
  hình đọc kèm tiến độ; câu báo không hỗ trợ ghi "iPhone / iPad".
- Trang Dev notes đánh dấu `-dirty` cả khi còn file mới chưa commit.

### Vòng sửa 6 (2026-10-16)

Theo 13 mục góp ý người dùng đã duyệt sau khi test bản vòng 5 trên PC và iPhone; DECISIONS D-348 – D-372 (D-366 –
D-372 = sửa thêm sau review, mục **Fixed** cuối vòng này).

#### Added

- **Tạo bài với AI** (`#/ai`, mục đầu tiên của **Thêm bài** ở Thư viện): 4 bước trên một trang — **Sao chép prompt**
  (VI / EN theo ngôn ngữ giao diện; **Xem prompt** khi trình duyệt chặn clipboard), link mở ChatGPT / Claude / Gemini
  kèm mẹo **Tìm bài ở đâu?**, ô lớn **Dán kết quả của AI vào đây** (tự đổi sang phím `Z X C…`, giữ chuột, Nửa Cung, chọn
  tông dễ chơi nhất; dòng kết quả ghi số nốt và chỗ không đọc được; ô **Tông** không bắt buộc), **Tên bài** + **Lưu**
  (bài vào Thư viện ngay; rồi **Phát** / **Sửa trong Editor** / **Thư viện** / **Tạo bài khác**) hoặc **Mở trong
  Editor** (bản nháp). Link nhỏ **hoặc tự gõ từ đầu** mở bản nháp trống.
- Trình soạn: ô **Dán kết quả của AI vào đây** ngay trên văn bản `.harm` — dán là thay bài bằng kết quả (một bước
  **Hoàn tác**), gõ / kéo thả thì xem trước rồi **Áp dụng**; **Lấy prompt cho AI**, **Xóa ô dán**.
- Hai bài mẫu mới đứng đầu Thư viện: _"Quốc ca Việt Nam"_ (Văn Cao) — cũng là bài mở sẵn ở màn đầu — và
  _"TAKEDISKRUSH!"_ (N2UtheHartlocker), chép nguyên từ bài người dùng tạo trong app. Hai bài mẫu cũ tạm giữ sau hai
  bài này và sẽ bị bỏ trước khi deploy.
- Hộp thoại OBS: nút **Xem trước** — cửa sổ nhỏ nền tối chạy theo màn chơi, có bảng phím game vẽ minh họa và nhãn
  "Xem trước · không dùng để quay" (tham số overlay mới `preview=1`).
- Trang mini: nút **◂** (góc trên trái, chỉ hiện khi đang dừng) về màn chơi của bài.
- `docs/REFERENCE.md`: tài liệu tham khảo đầy đủ (cú pháp `.harm` + bảng lỗi, phím tắt, tham số URL của overlay, chi
  tiết từng tính năng, giới hạn đã biết) tách khỏi trang Hướng dẫn.
- `docs/SPEC.md` có mục "2026-10-16 — Góp ý vòng 6" ở đầu "Thay đổi so với spec gốc".

#### Changed

- **Kiểu Mobile:** nhắc chạm nút chế độ là một **thanh `CHẠM` ngắn**, rộng đúng bằng nút chế độ, màu của chế độ, rơi
  thẳng xuống nút đó và chạm nút đúng lúc phải đổi chế độ — thay vạch đứt nét "CHẠM: …" kéo ngang mọi làn. Áp ở màn
  chơi, trang mini, Cửa sổ nổi, overlay và cửa sổ video nổi.
- **Không đếm hai lần:** số to chỉ hiện trong lúc đếm ngược (ô đứng yên); đếm vào chỉ là ô chạy trước 1 ô nhịp, không
  vẽ số nào (màn chơi, Cửa sổ nổi, overlay, trang mini).
- **Lookahead mặc định 6 beat** (trước 8; cài đặt đang để 8 tự thành 6 — settings v5); chỉ chỉnh ở thanh điều khiển của
  màn chơi. Link overlay không có `lookahead` chạy 6.
- **Cài đặt** gọn hai cột: 01 Kiểu điều khiển, 02 Giao diện, 03 Phát bài, 04 Harmonica | 05 Âm thanh, 06 Luyện tập,
  07 MIDI (cuối cùng); các ô xếp ngang, không còn khoảng trống lớn.
- **Âm thanh** là thẻ thường luôn hiện ở Cài đặt (không còn "Nâng cao — âm thanh" thu gọn); mặc định vẫn tắt, bật giai
  điệu vẫn hỏi xác nhận bản quyền, huy hiệu đỏ **🔊 Đang phát giai điệu** giữ nguyên.
- Thư viện → **Thêm bài** theo thứ tự: Tạo bài với AI → Tạo bài từ file MIDI / MusicXML → Nhập file ký tự (.harm /
  .txt / .json) → Tự chơi để tạo bài.
- Hộp thoại **Tạo link OBS**: chỉ còn hai cách — **Gửi thẳng vào OBS (khuyên dùng)** và **Browser Source thủ công**
  (ghi rõ: phát bài một lần mỗi khi OBS tải / refresh source, không theo Phát / tạm dừng trừ khi đang kết nối).
- **Cửa sổ video nổi** (trang mini): video được chuẩn bị sẵn khi hộp thoại mở và lần chạm gọi Picture-in-Picture ngay —
  sửa lỗi iPhone "The request is not triggered by user activation"; trình duyệt từ chối / không hỗ trợ thì hiện câu dễ
  hiểu (iPhone: "iPhone chưa hỗ trợ cửa sổ video nổi cho trang web này.") thay vì lỗi thô.
- **Trang Hướng dẫn** ngắn hơn nhiều (~290 dòng thay ~840): Bắt đầu nhanh → **Những chỗ hay nhầm** → các mục ngắn;
  phần chi tiết chuyển sang `docs/REFERENCE.md`. Ảnh chụp mới (thêm trang Tạo bài với AI và Cài đặt).

#### Removed

- Cách **Window Capture (màn hình thứ 2)** của OBS, nút **Mở thử**, lựa chọn nền chroma và nút **⛶ Toàn màn hình**
  của trang overlay (link cũ `bg=chroma` vẫn mở được).
- **Đếm vào** và **Đếm ngược** trên thanh điều khiển của màn chơi (vẫn ở Cài đặt → **Phát bài**).
- Ô **Lookahead** và thẻ **Phím tắt** ở trang Cài đặt (lookahead ở thanh điều khiển; phím tắt ở cột trái màn chơi).
- Nút **Tạo bài mới thủ công** ở Thư viện (thay bằng **hoặc tự gõ từ đầu** ở trang Tạo bài với AI) và công cụ **Nhập
  cảm âm** trong **Công cụ** của trình soạn (thay bằng ô dán).
- Ô **Đếm ngược** riêng trên thanh nhỏ của **Cửa sổ nổi** và trên trang mini (cả hai theo Cài đặt → **Phát bài**).

#### Fixed

- **Kiểu Mobile ở overlay OBS / Xem trước và Cửa sổ nổi:** còn dải chữ "CHẠM: Ngẩng Lên" cạnh làn và thanh `CHẠM` rơi
  xuống vạch sáng (không có nút chế độ nào ở đó; overlay "Cả cột" còn vẽ nút chế độ của game bar ở chỗ khác). Giờ cả
  hai dùng **bàn nút kiểu game** ở đáy như màn chơi (overlay: thay game bar, tên nút theo màn chơi / link; Xem trước
  không vẽ phím `Z X C…` của bản PC) nên thanh rơi đúng xuống nút chế độ; không còn nhãn "CHẠM: <tên chế độ>" ở đâu.
  Overlay **Dải ngang** tự vẽ 4 vòng chế độ nhỏ ngay sau vạch sáng làm đích.
- **Ô dán kết quả AI:** câu trả lời có **nhiều khối code** (bài dài, "viết tiếp") chỉ lấy khối đầu mà vẫn báo "0 lỗi"
  — giờ ghép mọi khối theo thứ tự ("ghép 2 phần"); dán tiếp phần sau vào cuối ô cũng ghép. Trình soạn: dán vài dòng nốt
  không còn đổi tempo / nhịp / tác giả của bài về 90 / 4/4; sau **Hoàn tác** hay sửa tay không còn báo "Đã đưa … vào
  bài" sai (nút **Áp dụng** hiện lại); một lần dán không đổi gì không còn làm lần gõ tay sau bị áp dụng ngay (trang
  Tạo bài với AI: tên bài đã sửa không bị trả về); trình đọc màn hình đọc được kết quả ngay lần dán đầu.
- **Cửa sổ video nổi trên iPhone:** video không nạp được (hoặc báo "chưa sẵn sàng" lần thứ hai) không còn bắt "chờ một
  giây rồi chạm lại" mãi — hiện câu "iPhone chưa hỗ trợ cửa sổ video nổi cho trang web này.".
- Trang mini và video PiP theo Cài đặt → **Đếm vào** (trước luôn chạy 1 ô nhịp dẫn vào).
- Chữ: link cuối cột phím tắt **Xem hướng dẫn** (trước "Hướng dẫn đầy đủ" — trang Hướng dẫn giờ ngắn); hộp thoại
  **Cửa sổ mini / video nổi (thử nghiệm)** (trước ghi "Android" dù là lối vào video nổi cho iPhone); gợi ý tiếng click
  không còn nói đếm vào "hiện bằng hình". `#/ai`: link Thư viện của thanh điều hướng là mục cha (`aria-current="true"`),
  không "trang hiện tại".
- Cửa sổ overlay desktop (Tauri) mở bài mẫu **Quốc ca Việt Nam** thay bài mẫu cũ sắp bị bỏ.

### Vòng sửa theo góp ý test local (2026-10-15)

Theo góp ý A–E của người dùng sau khi test bản local (đầu `docs/SPEC.md`); DECISIONS D-306 – D-347 (D-334 – D-347 =
sửa thêm sau review, mục **Fixed** cuối vòng này).

#### Added

- **Gửi thẳng vào OBS** (hộp thoại **Tạo link OBS**, obs-websocket 5 có sẵn trong OBS 28+): dán Server Password →
  **Kết nối** → **Thêm overlay vào OBS** tạo (hoặc **Cập nhật overlay trong OBS**) Browser Source "DF Harmonica Tiles"
  đúng cỡ canvas, ở góc 0,0, trên cùng cảnh đang phát — không phải kéo / căn tay. **Nhớ trên máy này** (tự nối lại
  khi mở app, thử lại 1–30 s), **Nâng cao: địa chỉ và cổng**, **Ngắt kết nối**; mỗi lỗi một câu giải thích (OBS chưa
  mở, chưa bật WebSocket server, sai / thiếu mật khẩu, OBS cũ, trình duyệt chặn mạng cục bộ…). Client obs-websocket
  tự viết, không thêm dependency.
- **Overlay chạy theo màn chơi**: cùng bài, Phát / Tạm dừng / tua / nhảy dòng / đếm ngược / đếm vào / tempo / loop
  A-B và cùng cách hiển thị (kiểu điều khiển, tên nút, Lookahead, cỡ ô, nhãn phụ, ngôn ngữ, giao diện) — qua
  BroadcastChannel cho cửa sổ **Mở thử** và qua obs-websocket cho Browser Source trong OBS. Không nghe thấy màn chơi
  ~2 s thì overlay tự chạy một mình theo ảnh chụp cài đặt trong link (đếm ngược + đếm vào, không lặp); màn chơi xuất
  hiện sau thì chuyển sang theo. Tab màn chơi bị che (Alt-Tab vào game) overlay vẫn chạy tiếp.
- **Bố cục cả canvas** (`fit=canvas`): trang overlay phủ cả canvas OBS và tự vẽ ô rơi đúng chỗ trên bảng phím game
  (khung 16:9 giữa màn: 1080p 576 × 600 tại 700,150; 1440p 768 × 800 tại 933,200), tinh chỉnh **Cỡ giao diện game**
  70–130 % khi UI scale trong game khác mặc định. Cửa sổ **Mở thử** có nút **⛶ Toàn màn hình** (Window Capture + Fit to
  screen ở màn hình thứ 2) và dòng **Đang chờ màn chơi…**; cả hai ẩn trong OBS và khi đã toàn màn hình.
- Tham số overlay mới: `fit`, `tilescale`, `sublabel`, `lang`, `theme`.
- Màn chơi: **thanh dọc bên phải** theo thứ tự **Kiểu điều khiển** PC | Mobile, **Cửa sổ nổi**, **OBS**, **Chia
  sẻ**, **Cài đặt** (điện thoại: hàng / cột icon); **cột trái = danh sách phím tắt đầy đủ** (phím tắt, 8 phím game
  với số 1 … 1̇ và Đồ … Đố, giữ chuột hoặc chạm theo kiểu điều khiển, ghi chú luyện tập, link **Hướng dẫn đầy đủ**) —
  màn hẹp mở bằng nút **?**; nút đổi ngôn ngữ và giao diện ở góc trên phải.
- Nút **◂ Về màn chơi** thay tên app ở mọi trang có thanh điều hướng (về bài vừa mở ở màn chơi, không có thì bài
  mẫu); link **Hướng dẫn** trên thanh điều hướng.
- Thư viện: mục **Thêm bài** với 4 cách theo thứ tự, mỗi cách một dòng giải thích — **Nhập file ký tự (.harm / .txt /
  .json)**, **Tạo bài từ file MIDI / MusicXML**, **Tự chơi để tạo bài** (lối vào mới ở Thư viện), **Tạo bài mới thủ
  công**; dòng fan-made ở chân trang.
- **Bản nháp:** bài tạo từ file MIDI / MusicXML, Thu melody, Tự chơi để tạo bài và Tạo bài mới thủ công mở trong trình
  soạn với trạng thái **Bản nháp — chưa lưu** — chưa sửa gì mà rời đi thì không lưu, không hỏi; sửa rồi thì **Lưu** /
  Ctrl+S (hoặc hộp hỏi khi rời trang) mới vào Thư viện.
- Tạo bài từ file: mỗi track / bè ghi **≈ N nốt/phút · BPM M** để thấy vì sao được gợi ý.
- Kiểu Mobile: nút **Cửa sổ nổi** ở thanh dọc mở trang mini (Android) cho bài đang mở, không phải chọn bài.

#### Changed

- `#/` là **màn chơi đầy đủ** với bài mẫu (như `#/play/<id>`; Phát có đếm ngược / đếm vào như mọi bài).
- Thanh vị trí trong bài xuống **đáy màn chơi**, trải hết bề ngang.
- **Đếm ngược mặc định 3 giây**, **Nhãn phụ trên tile mặc định Ẩn** (settings v4; cài đặt cũ được chuyển một lần:
  đếm ngược Tắt → 3 giây, nhãn phụ → Ẩn).
- **Nửa Cung cố định thăng** (+1) như game; bài `@scroll -1` vẫn phát, màn chơi hiện chip cảnh báo, **Tối ưu lại cung /
  quãng** luôn ghi `@scroll +1`; mọi bài app tạo ra ghi `@scroll +1`.
- **Luyện tập kiểu PC:** Cúi Xuống / Ngẩng Lên / Nửa Cung chỉ bằng nút chuột trên khu tiles (phím nốt bấm kèm Ctrl /
  Alt / Meta được bỏ qua để phím tắt trình duyệt chạy bình thường). **Kiểu Mobile:** chỉ nhận chạm / click trên bàn nút
  — bàn phím và đàn MIDI không được nhận.
- **Gợi ý track / bè giai điệu theo mật độ nốt so với tempo** (số nốt mỗi phút gần bằng BPM; thưa quá hay dày quá —
  pad, đàn hợp âm — không phải giai điệu), cộng đơn âm, không bè trầm, tên track và bè hát; không còn theo "nhiều nốt
  nhất".
- **Gộp nốt vượt tầm luôn bật** (wizard, Tối ưu lại, Nhập cảm âm); cột **Nốt gập quãng** chỉ hiện khi có nốt bị gập.
- **Chia dòng và section tự động** (chỗ nghỉ / vạch nhịp, ~1–2 ô nhịp mỗi dòng, ~4 dòng mỗi section, marker của file
  khi hợp lý); bước 5 đổi tên **Xem trước và tạo bài**.
- Hộp thoại **Tạo link OBS** chỉ còn tùy chọn hiển thị (Kiểu overlay, Độ đậm của ô, Cỡ giao diện game) và ba cách:
  Gửi thẳng vào OBS (khuyên dùng), Browser Source thủ công (Width × Height = cỡ canvas), Window Capture (màn hình thứ
  2). Bài luôn là bài đang mở ở màn chơi; nền theo cách dùng (Browser Source trong suốt, Mở thử xanh chroma).
- Nút **Cửa sổ nổi** (kiểu PC) là một nút bật / tắt có nhãn **Đang mở**; ghi chú "không hỗ trợ" / "bị chặn" tự ẩn sau
  8 giây.
- Prompt AI cho cảm âm (VI + EN) không còn quy tắc lời, đánh số lại 1–17.
- README viết lại theo giao diện mới, ảnh chụp mới (thêm ảnh Thư viện); `docs/LOCAL-TEST-CHECKLIST.md` viết lại theo
  góp ý A–E; `docs/GAME-UI-REFERENCE.md` thêm mục "Bố cục cả canvas".

#### Removed

- **Lời / karaoke ở mọi nơi:** dải lời và nút **Lời** của Player, công cụ **Dán lời và chia chữ**, **Hiện lời
  (karaoke)** ở Cài đặt, **Có lời** của Donate text, lời trong prompt AI / cảm âm, đọc lời từ MIDI (`.kar`) /
  MusicXML (chọn lượt lời), tham số overlay `lyrics`. File `.harm` / `.json` cũ có lời vẫn mở được (phần lời bị bỏ
  qua), app không ghi lời nữa.
- Màn demo "Chơi thử" và **☰ Menu** trượt bên phải; nút **Sửa** của màn chơi (chip lỗi cú pháp vẫn mở trình soạn).
- Cài đặt **Chiều Nửa Cung (scroll)** và **phím bàn phím thay chuột** khi luyện tập / tự chơi (Ctrl / Alt / Shift…,
  cảnh báo Ctrl + N, nút Đổi phím).
- Công tắc gập quãng / nút "Bật gập quãng"; các ô "Ngắt dòng tại chỗ nghỉ", "Mỗi dòng tối đa", "Mỗi section",
  "Section theo marker".
- Trong hộp thoại OBS: chọn bài, nền, tỉ lệ, số beat thấy trước, kiểu điều khiển, tự chạy khi mở, hết bài thì chạy
  lại, đếm vào, chờ trước khi chạy, hiện lời, bảng kích thước / vị trí Browser Source. Tham số `autoplay`, `loop`,
  `lyrics` của link cũ bị bỏ qua.
- Chế độ gộp tie "auto" khi trích melody MIDI (chỉ có nghĩa với file có lời).

#### Fixed (sau review)

- Màn chơi của bài **chưa nằm trong Thư viện** không còn là ngõ cụt: bản nháp có chip **Bản nháp — chưa lưu** + nút
  **Mở trình soạn để lưu**; bài mở từ link chia sẻ có chip **Bài tạm từ link — chưa lưu** + nút **Lưu vào thư viện**.
- **◂ Về màn chơi** (và Forward của trình duyệt) sau khi Lưu một bản nháp đã phát mở **bài đã lưu**, không mở lại nội
  dung cũ của bản nháp.
- Mở thêm một tab app (màn đầu là màn chơi) không còn giành overlay OBS khỏi tab đang chơi; overlay chuyển tab khi bạn
  thao tác ở tab kia và có bài ngay.
- Overlay chạy theo **Cửa sổ nổi** khi nó đang mở (trước đây đứng hình vì màn chơi chính tạm dừng); đóng cửa sổ nổi →
  theo lại màn chơi.
- Điện thoại / máy tính bảng không có cửa sổ nổi kiểu máy tính, ở kiểu PC: nút **Cửa sổ nổi** mở trang mini (Android)
  thay vì báo "dùng Chrome hoặc Edge trên máy tính".
- Đếm ngược mặc định của **Cửa sổ nổi** là **3 giây** như màn chơi.
- Chip cảnh báo `@scroll -1` là link mở trình soạn; gợi ý của chip cảnh báo / lỗi không còn nhắc nút **Sửa** (màn chơi
  không có nút đó).
- Dấu `:` gõ lạc nuốt mất nốt (vd. `Z X C: V B`) giờ có **cảnh báo** trong trình soạn; tiền tố lời của file cũ vẫn
  được bỏ qua im lặng.
- Hộp thoại **Tạo link OBS** nhớ **Kiểu overlay**, **Độ đậm của ô**, **Cỡ giao diện game** — mở lại rồi **Thêm /
  Cập nhật overlay trong OBS** không ghi đè source đã căn bằng giá trị mặc định.
- Cửa sổ **Mở thử** đang toàn màn hình (khung Window Capture) không hiện chữ **Đang chờ màn chơi…** lên stream.
- Tab tới một nút (vd. **Mobile**, **OBS**) rồi nhấn **Space** thì bấm nút đó thay vì Phát (bấm chuột rồi Space vẫn là
  Phát / Tạm dừng).
- Chữ: tiếng Việt dùng "màn chơi" thay "Player" (hộp thoại **Phím tắt của màn chơi**, **Đang chờ màn chơi…**, các câu
  OBS); ghi chú luyện tập không còn chữ "Practice"; trang tạo bài tên **Tạo bài từ file MIDI / MusicXML** như nút ở
  Thư viện; ví dụ của **Nhập cảm âm** chỉ còn dòng nốt (không còn kiểu `lời: nốt`).
- `docs/DESIGN.md` theo giao diện mới (không còn màn demo / ☰ Menu / font lời bài hát).

### Added

- Phase 0: scaffold Vite 8 + React 18 + TypeScript strict, ESLint 10 + Prettier, Vitest, cấu trúc `src/`,
  contract model (`src/core/types.ts`), bảng phím (`src/core/keys.ts`), settings store, router hash, i18n vi/en,
  2 bài seed.
- Phase 1 (MVP Player): parser/serializer `.harm` (round-trip, `@repeat`, hold qua dòng, prefix, diagnostic
  dòng + cột), timeline + truy vấn + thống kê; thư viện (seed + bài user localStorage có migrate, tìm kiếm bỏ
  dấu, nhân bản, xóa, import .harm/.json, export); Player canvas 8 lane (tile, ribbon giữ, banner, game bar,
  karaoke, vạch nhịp, nhãn section), transport (Space/R/←/→/L/[ ], count-in, loop A-B, BPM override, lookahead),
  audio clock + scheduler (harmonica/sine synth, metronome); Settings (persist + reset); Playwright smoke.
- Phase 2 (Editor, chia sẻ, công cụ soạn bài): Editor `#/edit/:id` (ô `.harm` có số dòng + đánh dấu lỗi, parse
  sau 150 ms, preview thông tin / thống kê / lỗi bấm để tới vị trí / các dòng theo đoạn, Lưu + Ctrl+S, bài mẫu và
  bài từ link lưu thành bản sao, phát từ dòng con trỏ, xuất .harm/.json, chặn rời trang khi chưa lưu kể cả nút
  Back); menu Công cụ có Hoàn tác / Làm lại: Tap timing (gõ Space theo nhạc để ghi độ dài nốt), Dán lời và chia
  chữ (theo dòng / chảy liên tục), Nhập cảm âm (Đô Rê Mi…, quy ước hoa/thường hoặc số), Tối ưu lại cung / quãng
  (optimizer DP: ít scroll, ít lần giữ, giữ cung gốc, gập quãng); Donate text (chia tin ≤ N ký tự đánh số `k/n`,
  dán lại các phần ra đúng bài); link chia sẻ `#/s/…` (lz-string, mở bài tạm không cần lưu); parser nhận dấu
  `k/n`, có span nguồn cho từng dòng / token.
- Phase 2 (Practice mode): bật "Luyện tập" trong Player, chế độ Chờ (dừng ở mỗi nốt tới khi bấm đúng phím +
  modifier) và Chấm điểm (Perfect ≤ 100 ms / Good ≤ 220 ms / Miss, combo, % chính xác, bảng kết quả); bấm phím
  thật Z X C… + chuột trái / phải / giữa trên khu tiles hoặc phím thay thế cấu hình được (cảnh báo Ctrl+N), game bar
  sáng phím đang bấm, tiếng phản hồi tùy chọn, "Nghe giai điệu mẫu"; đếm ngược 0–10 s trước khi phát; đàn MIDI
  (Web MIDI) làm nguồn bấm, có dịch bán cung / quãng tám. Cài đặt thêm card Luyện tập và MIDI.
- Phase 2b (MIDI): "Tạo bài từ MIDI" `#/midi` — file .mid/.midi/.kar 5 bước (chọn track có gợi ý + piano roll +
  nghe thử, trích melody với policy chồng nốt / grid / BPM, chọn cung và quãng, chia dòng / section theo marker
  hoặc số ô nhịp, lời karaoke từ file) rồi mở Editor; "Thu melody" từ đàn MIDI (đếm vào, metronome, quantize,
  thu lại / hoàn tác). Editor / Share / MIDI và @tonejs/midi tải theo route (chunk riêng); trang không tải được
  (vd. tab cũ sau khi cập nhật app) hiện nút "Tải lại trang" thay cho màn hình trắng.
- Smoke e2e Phase 2: Editor + Donate (DoD dán lại các phần ra 0 lỗi, cùng số nốt), link chia sẻ phát được, wizard
  MIDI với file SMF tự sinh, practice, card Cài đặt mới, chặn rời Editor, Space trong Tap timing.
- Phase 2c (màn đầu): `#/` là màn chơi thử toàn màn hình — bài mẫu hiện sẵn ô ở khung đầu + một nút ▶ lớn,
  chạm một lần là ô rơi ngay (không đếm vào / đếm ngược, không tiếng), Space tạm dừng, hết bài có "Chơi lại";
  thư viện / bài mới / tạo bài từ file / cài đặt / ngôn ngữ / giao diện nằm sau nút Menu ☰ (mở Menu thì demo tạm
  dừng). Thư viện chuyển sang `#/library`; link chia sẻ, `#/play/:id`, overlay mở thẳng như cũ.
- Phase 2c (kiểu điều khiển Mobile): Cài đặt "Kiểu điều khiển: PC / Mobile" + kiểu nút Nửa Cung (bật / tắt hoặc
  chỉ 1 nốt) + đổi tên 4 nút. Mobile: tile số giản phổ có chấm quãng, game bar như bản mobile (4 nút chế độ + 8 nút
  số), vạch + nhãn "CHẠM: …" tại lúc đổi chế độ (giữ qua nghỉ), "SẮP CHẠM" trước 1 beat, banner chế độ hiện tại;
  optimizer có cost model mobile (chạm đổi chế độ) ở Tối ưu lại / wizard / preview; Donate text xuất được kiểu
  mobile (chỉ để đọc).
- Phase 2c (âm thanh mặc định tắt): mặc định không tiếng nào (đếm vào bằng hình); Player bỏ nút âm thanh /
  metronome; mọi tùy chọn âm thanh nằm trong "Nâng cao — âm thanh" cuối Cài đặt; bật "Phát giai điệu mẫu" phải xác
  nhận cảnh báo bản quyền, khi bật Player hiện huy hiệu "Đang phát giai điệu"; tiếng click metronome là tùy chọn
  riêng; settings cũ được migrate tắt âm thanh một lần.
- Phase 2c (import mở rộng): wizard "Tạo bài từ file" nhận MusicXML (`.musicxml`, `.xml`, `.mxl` nén) — chọn bè +
  giọng + lượt lời, tie / chùm ba / dấu lặp + volta, tempo, rehearsal mark → section, lời gắn từng nốt; MIDI chọn
  nhiều track rồi gộp; kéo thả file thẳng từ thanh download của trình duyệt; "Nhập file" chỉ sang wizard khi gặp
  file MIDI / MusicXML.
- Phase 2c (chia sẻ, cảm âm): nút "Chia sẻ" (sao chép link `#/s/…`) trên thẻ bài Thư viện và trong Player; Thư viện
  ghi rõ `.harm` / `.json` / `.txt` là định dạng riêng của app; Nhập cảm âm có "Sao chép prompt cho AI"
  (`docs/AI-PROMPT-CAM-AM.md`) và tự chọn quy ước "Chỉ hậu tố số".
- Smoke e2e Phase 2c: `first-run.spec.ts` (màn đầu một chạm là ô rơi, Menu, 375 px), `phase2c.spec.ts` (hộp thoại
  bản quyền, Mobile trong Player, Chia sẻ ở Thư viện, MusicXML 5 bước, Menu tạm dừng demo).
- Phase 3 (overlay OBS): route `#/overlay/:id`, `#/overlay?…&data=…` (bài nhúng trong link — OBS có bộ nhớ riêng)
  và `?overlay=1&song=…` — chỉ ô rơi (kèm dải giữ, banner, tùy chọn lời / game bar), không nút, nền trong suốt /
  xanh chroma `#00FF00` / theme, **luôn im lặng**; tham số `bpm`, `autoplay`, `countin`, `loop`, `delay`, `lookahead`,
  `lyrics`, `scale`, `lanes=horizontal`, `bg`, `layout=game` (8 cột khớp bảng phím game, hit line sát đáy, không game
  bar), `opacity`, `scheme`, `gamebar`, `banner`. Bấm / Space chạy, R chạy lại, ← / → đổi dòng; đếm ngược trước khi
  chạy để kịp Alt-Tab về game; thẻ lỗi dễ đọc khi link thiếu / hỏng / bài không có trong bộ nhớ của OBS. Hộp thoại
  **Tạo link OBS** (☰ Menu và nút **OBS** trong Player): kiểu overlay, nền, tỉ lệ, độ đậm ô, sao chép link / **Mở
  thử** trong cửa sổ riêng (cho Window Capture), bảng kích thước + vị trí Browser Source cho canvas 1080p / 1440p,
  hướng dẫn ngắn. Overlay tải lười; nền trong suốt / chroma áp ngay từ khung hình đầu (không nháy mỗi lần OBS
  refresh). Lệnh ngoài `dfht:command` (toggle / restart / nextLine / prevLine) cho Player và overlay.
- Phase 3 (PWA): cài như app, chạy offline hoàn toàn sau lần mở đầu (service worker precache cả chunk tải lười),
  lời nhắc **Có bản mới** → **Tải lại** / **Để sau** (chỉ tải lại tab đã bấm), thông báo một lần "Đã sẵn sàng dùng
  offline"; icon SVG + PNG 192 / 512 / maskable / apple-touch sinh bằng `npm run icons` (pngjs). Overlay, bản 1
  file, dev và cửa sổ Tauri không đăng ký service worker. `npm run build:single` ra một file
  `dist-single/index.html` (inline mọi JS / CSS / chunk / icon) mở được từ file://.
- Phase 4 (tùy chọn, chưa build thử — máy không có Rust): overlay desktop Tauri v2 trong `src-tauri/` (cửa sổ trong
  suốt, không viền, luôn nổi; phím tắt toàn cục Ctrl+Alt+P / R / → / ←, Ctrl+Alt+T click xuyên qua, Ctrl+Alt+D
  khung cửa sổ), cầu nối `src/desktop/tauriBridge.ts`, hướng dẫn `docs/TAURI.md`, workflow `tauri.yml` (chỉ chạy nếu
  repo lên GitHub).
- Docs Phase 3: README tiếng Việt cho streamer (bắt đầu trong 30 giây, chơi PC / Mobile, âm thanh, luyện tập, thêm
  bài, định dạng `.harm` đầy đủ, donate text, chia sẻ link, OBS — Window Capture + Chroma Key hoặc Browser Source,
  kích thước / vị trí, bảng tham số URL — cài đặt, PWA / offline, giới hạn đã biết, cho người phát triển) kèm 5 ảnh
  chụp; CLAUDE.md (cấu trúc mới, quy trình test local → deploy khi người dùng đồng ý); DECISIONS D-205..D-236.
- E2e Phase 3: `overlay.spec.ts` (nền trong suốt / chroma kể cả trước khi JS chạy, ô rơi khi autoplay, layout game,
  link `data=` từ nút OBS mở ở context trống, thẻ lỗi), `pwa.spec.ts` (offline từ precache, bản 1 file qua
  file://).
- Phase 3b (**Tự chơi để tạo bài**, `#/record`, ☰ Menu): chọn tên bài, tempo, nhịp (4/4, 3/4, 6/8), lưới quantize
  (1/4, 1/8, chùm ba, tắt); đếm vào 1 ô nhịp bằng đèn nhịp; thu bằng phím thật `Z X C V B N M ,` + giữ chuột trái /
  phải / nút cuộn trong khung thu (hoặc phím thay thế Ctrl / Alt / Shift, cảnh báo Ctrl + N) hoặc, với kiểu Mobile,
  4 nút chế độ + 8 nút số trên màn hình; cuộn nốt hiện ô ngay khi bấm; đơn âm (nốt mới cắt nốt cũ), quantize theo
  lưới (đổi lưới sau khi thu để xem lại); **Thu lại** / **Hoàn tác**; **Mở trong Editor** (thêm lời bằng Dán lời và
  chia chữ). **Tiếng phản hồi khi bấm** riêng cho màn này, mặc định tắt; hỏi trước khi rời trang khi đang thu / bản
  thu chưa mở.
- Phase 3b (**Cửa sổ nổi**, 1 màn hình): cửa sổ Document Picture-in-Picture luôn nằm trên mọi cửa sổ (Chrome / Edge
  116+, không cần tải gì) chỉ có 8 làn ô rơi kiểu "khớp bảng phím game" + banner; mở từ nút **Cửa sổ nổi** ở header
  Player (Player tab gốc tạm dừng) hoặc ☰ Menu → **Cửa sổ nổi (1 màn hình)** (chọn bài); thanh nhỏ ▶ / ↺ / **Đếm
  ngược** (0 / 3 / 5 / 10 s, mặc định 5) / **Căn chỉnh** (8 vạch dẫn + mép dưới), Space / R / Esc; nhớ kích thước
  (gợi ý 576 × 600 ở 1080p, 768 × 800 ở 1440p); vòng render chạy bằng rAF của chính cửa sổ nổi, canvas theo DPR màn
  hình chứa nó; trình duyệt không hỗ trợ → một dòng giải thích.
- E2e Phase 3b: `record.spec.ts` (thu Z X C, C giữ chuột phải → Editor), `pip.spec.ts` (mở cửa sổ nổi từ Player và
  từ Menu, ô rơi chạy, Căn chỉnh, đóng; trình duyệt không có API).
- Phase 4m (**Mobile giống màn chơi kèn**): khi Kiểu điều khiển = Mobile, Player và màn đầu dùng bố cục như bản
  điện thoại của game — 8 nút tròn lớn số giản phổ trải hết bề ngang ở đáy khu ô rơi, 4 nút chế độ tròn nhỏ (Nửa
  Cung · Ngẩng Lên · Ngẩng Tự Nhiên · Cúi Xuống) phía trên ở giữa, nút đang chọn sáng màu chế độ, nút sắp chạm có vòng
  vàng; ô "viên thuốc" rơi thẳng vào tâm nút tròn (hit line = đỉnh nút số); banner gọn dưới dải lời; điện thoại: bấm
  Phát tự cuộn khu ô rơi vào màn + nút tạm dừng trong khu ô rơi, gợi ý "Xoay ngang để giống màn hình game" khi cầm
  dọc. PC, overlay, cửa sổ nổi không đổi.
- Phase 4m (**Luyện bằng chạm**): Mobile + Luyện tập → bấm được 4 nút chế độ + 8 nút tròn bằng chạm / chuột như game
  (chạm chế độ giữ trạng thái, Nửa Cung theo Cài đặt, đa chạm), chấm Perfect / Good / Miss ở cả Chờ và Chấm điểm,
  kết quả + tia sáng ngay trên nút, combo trong khu ô rơi, sai chế độ thì nút chế độ đúng nháy vàng; **Rung khi chạm**
  (Android, tắt được); chặn cuộn / zoom / menu nhấn giữ trên bàn nút; HUD trên điện thoại bỏ ghi chú bàn phím.
- Phase 4m (**Cửa sổ mini cho Android, thử nghiệm**): ☰ Menu → **Cửa sổ mini (Android, thử nghiệm)** → trang
  `#/mini/<bài>?delay=` chỉ có làn ô rơi + bàn nút thu nhỏ, đọc được ở ~300 × 300, đếm ngược (Không / 3 / 5 / 10 s)
  rồi tự chạy, chạm = tạm dừng / chạy tiếp, giữ màn hình sáng (Wake Lock), luôn im lặng; nút ⓘ hướng dẫn mở cửa sổ
  nổi theo hãng (Samsung, Xiaomi / HyperOS, Huawei / Honor, OPPO / realme / OnePlus; vivo / iPhone → máy thứ hai) +
  lưu ý (tắt con quay hồi chuyển, không mở qua Game Booster / Gaming Hub, cảnh báo bảo mật). **Cửa sổ video nổi
  (thử nghiệm)**: ô rơi phát thành video Picture-in-Picture luôn nằm trên — "Trực tiếp" (canvas stream) hoặc "Dựng
  sẵn" (WebCodecs VP8 / VP9 + muxer WebM tự viết, vẫn chạy khi trình duyệt xuống nền).
- E2e Phase 4m: `mini.spec.ts` (trang mini 360 × 360 cảm ứng: không cuộn ngang, ▶ → đếm ngược → ô rơi, chạm tạm dừng,
  hướng dẫn; không có PiP → giải thích + nút tắt; dựng sẵn video WebM), `phase2c.spec.ts` (bàn nút kiểu game, luyện
  bằng chạm trên màn ngang điện thoại).

### Changed

- Phase 3b — giao diện **Tactical HUD** (`docs/DESIGN.md`): font Bahnschrift có sẵn trên Windows (không tải font),
  điểm nhấn xanh neon `#0ff796` (theme sáng "Desert" `#006b44`) chỉ cho khung UI — không bao giờ tô ô / phím game,
  hổ phách chỉ cho cảnh báo; nhãn in hoa condensed, số tabular, panel vát góc + ngoặc góc, tiêu đề section đánh số
  `01 / …`, tag `[ MẪU ]`, nền lưới mảnh + vignette, toast / modal / Menu kiểu HUD (drawer phải, số thứ tự, dòng
  fan-made); Player: thanh trạng thái HUD, thanh tiến độ chia vạch có khấc đầu đoạn, nút transport vuông, hit line
  laser lõi trắng (glow vẽ bằng hai vạch, không shadowBlur), tile phẳng viền trong, banner giữ / chế độ có sọc cảnh báo,
  keycap vát góc; overlay chroma vẽ mọi thứ đặc (không viền xanh lem). Màu modifier giữ nguyên; contrast AA cả hai
  theme, viền control ≥ 3:1; tôn trọng `prefers-reduced-motion`, bỏ mọi animation lặp ngoài canvas. Icon PWA và màu
  manifest theo nền mới `#0a0c0e`. README: ảnh chụp mới, dòng fan-made.

### Fixed

#### Phase 1 (vòng review)

- `.harm`: giới hạn `@repeat` tính theo ký tự (100 000) thay vì dòng, có warning `repeat-limit` — file nhỏ lồng
  repeat không còn treo parser; tra section bằng bảng băm; so tên section bỏ qua hoa thường / NBSP / tab;
  `unclosed-hold` khi replay có `fromLine`; regex số thập phân chạy tuyến tính.
- Serializer ghi dạng chuẩn (`canonicalSong`): lời có `: ` hoặc mở đầu bằng `#` `@` `//`, luyến 1 nốt, nhịp /
  bpm không hợp lệ… luôn đọc lại đúng; nhập JSON chỉ có model nhận các lời đó, nhịp ngoài miền `@time` bị từ chối.
- Âm thanh: lần Play đầu không mất click đếm vào / nốt đầu (chờ unlock ≤ 1 s); AudioContext tạo sẵn khi vào
  Player từ thư viện (không khựng 0.5–1 s lúc bấm Play); click / nốt đầu nghe đúng lúc chạm hit line với mọi
  output latency (kể cả Bluetooth); nốt ở đầu loop đúng giờ; loop + count-in không wrap khi phát từ sau loop
  end; đổi BPM không cắt nốt đang ngân, không kích lại; pause cắt nốt chưa kịp vang; scheduler nghỉ khi pause.
- Canvas: ô nhịp đếm vào vẽ mờ (không "sáng" nhầm); loop A-B vẽ vòng kế sau loop end; nhãn phím ≥ 28px với
  mọi tileScale, không chồng nhau ở lookahead cao; nhãn phụ và THẢ hiện trên tile / run ngắn; nhãn section
  không che tile lane Z; canvas sắc nét đúng device pixel và tự vẽ lại khi đổi DPR lúc pause; viền tile theme
  sáng đủ tương phản.
- Player: dải lời tách khỏi canvas, dòng dài trượt theo chữ đang hát thay vì bị cắt; chọn lại section đang hiện
  thì phát lại đoạn đó, dropdown không nuốt phím tắt; game bar nháy lại khi cùng phím lặp; keycap sáng theme
  sáng dễ phân biệt; toast ở đỉnh, không che game bar.
- Phase 1 ẩn mọi lối vào Editor / Share / MIDI (thư viện và Player), route của chúng hiện trang "sắp có"; thẻ
  thư viện có danh sách dòng bị lỗi; số ít / số nhiều trong thông báo.
- A11y: Modal bẫy focus (portal + inert), nút đóng có nhãn dịch, focus đầu vào nút Hủy; placeholder và viền
  control đạt tương phản; Toggle nối hint qua `aria-describedby`; "Xóa tìm kiếm" trả focus về ô tìm.
- Không nháy theme tối khi tải trang theme sáng; lưu settings / thư viện khi storage đầy không crash (toast);
  nhân bản bài có nhiều `@title` đổi đúng dòng; độ dài bài trên thẻ khớp đồng hồ Player.
- Test: suite không còn timeout ngẫu nhiên khi chạy song song (helper Player bỏ `getByRole` lặp lại, timeout
  mặc định 15 s, ngân sách riêng cho property test nặng).

#### Phase 2 + 2b (vòng review)

- Donate text: dòng dài được chia thành các dòng `.harm` cùng loại, không cắt giữa lời — lời khớp số nốt chia
  theo nốt nên karaoke vẫn đúng sau khi dán lại; title / header quá dài được rút gọn bằng `…` thay vì vỡ thành
  dòng lỗi; mọi giới hạn 30–2000 dán lại ra 0 lỗi, 0 cảnh báo, cùng dãy nốt và section.
- Link chia sẻ: bài có ký tự điều khiển (`\v`, `\f`, NUL dán từ Word / PDF) hay surrogate lẻ không còn ra link
  "hỏng"; bài rỗng / toàn khoảng trắng không sao chép link mà báo lỗi.
- `.harm`: CR lẻ là xuống dòng ở mọi nơi (parser, serializer, sửa văn bản theo span) — title / lời có CR không
  làm bài đổi sau khi lưu; lời do "Dán lời và chia chữ" ghi ra mở đầu bằng `số/số ` không bị đọc thành dấu donate.
- Practice: loop A-B — bấm sớm nốt đầu vòng kế ngay trước loop end được chấm đúng (không còn SAI + MISS), bấm
  muộn nốt cuối vòng trước ngay sau wrap không tính sai; bản vẽ vòng kế không mang viền chấm của vòng hiện tại;
  Ctrl / Alt làm phím thay modifier không còn làm hỏng phím tắt Player (Alt+Space phát / dừng, Alt+←/→ không đổi
  trang, Ctrl+R không tải lại); câu MIDI trên HUD theo trạng thái thật (đang nghe / bị từ chối / thiết bị chưa
  cắm, cập nhật khi cắm rút); bấm chuột nhanh không bôi đen chữ; màn thấp (≤ 800px) cuộn được thay vì ép khu
  tiles; bảng kết quả không mất vì một cú bấm lên nền.
- Editor: lưu bài mẫu / bài từ link không mount lại trình soạn (giữ Hoàn tác, undo gốc, con trỏ, cuộn, focus);
  đóng công cụ trả focus về nút "Công cụ", áp dụng thì về ô soạn; menu Công cụ đóng khi Tab ra ngoài, không tràn
  màn ở ≤ 760px; bấm lỗi / "Dòng N" cuộn ngang tới token và cuộn trang ở bố cục xếp chồng; Nhập cảm âm giữ phương
  án cung đã chọn khi đổi Tên bài / Tempo; Tap timing hỏi lại trước khi bỏ các lần tap dở; Chia lời bỏ qua dòng
  chỉ có nghỉ (dòng sau không bị lệch); ShareView nhận ra bài đã lưu khi quay lại (không nhân bản), nút "Đã lưu
  vào thư viện" giữ focus; Donate cảnh báo khi văn bản có lỗi, kèm nút "Tới lỗi đầu tiên"; dòng `@repeat` trong
  preview giữ đủ contrast.
- MIDI: gộp tie `auto` xét từng nốt (intro không lời của file karaoke không mất nốt lặp); policy `longest` giữ
  nốt dài thật thay vì nốt mới nhất; lời của nốt bị bỏ (chồng nốt, quá ngắn, quantize) chuyển sang nốt bên cạnh;
  gợi ý track không coi melody legato là đa âm; nhiều tempo / nhịp cùng một tick lấy event sau cùng; file bị cắt
  cụt có cảnh báo; tab Thu melody không tự chọn thiết bị khi đang ẩn, khi MIDI tắt trong Cài đặt hoặc sau khi
  chọn "— Chọn thiết bị —"; rời `#/midi` khi đang có file / bản thu thì hỏi lại; track trùng tên có tên truy cập
  riêng; chọn file mới đưa tùy chọn chia dòng / section về mặc định.
- Giao diện chung: modal chồng nhau — chỉ modal trên cùng nhận Tab / Esc, một Esc đóng đúng một hộp; bấm nền chỉ
  đóng bằng chuột trái; số ít / số nhiều tiếng Anh đúng cho mọi số đếm ("1 beat", "1 error"); nút đang bật vẫn
  đọc được khi hover; nhãn toggle dài xuống dòng ngay cạnh switch.
- Test e2e: Tap timing theo hộp hỏi bỏ tap; thêm kịch bản focus công cụ, Ctrl+S bài mẫu giữ phiên soạn, chia sẻ
  bài rỗng, modal chồng nhau, bấm nền bằng chuột phải / giữa, contrast nút đang bật, toggle nhãn dài.

#### Phase 3 + 3b (vòng review)

- Tài liệu: README — cách OBS Window Capture thêm bước cắt thanh tiêu đề / thanh địa chỉ của cửa sổ **Mở thử**
  (Crop/Pad), kích thước bảng tính sau khi cắt, nền chroma luôn ô đậm 100% (mờ bằng Opacity của filter), nhắc nền xanh
  khi ghim trên cùng màn hình; ví dụ cảm âm viết thường (`fa#`, `sib`, `dola` — chữ hoa là quãng 2), cả trong trợ giúp
  của hộp thoại Nhập cảm âm (vi + en); Cửa sổ nổi ở "Giới hạn đã biết" ghi đúng Chrome / Edge 116+ (và Firefox 151+);
  ngoại lệ prefix trong cụm luyến khi app tự viết `.harm`; phần cho người dùng không còn trỏ tới file trong repo (bản
  desktop Tauri ghi rõ chưa có bản cài, chi tiết ở mục cho người phát triển). `docs/AI-PROMPT-CAM-AM.md` dùng đúng
  nhãn quy ước "Chỉ theo hậu tố số" / "Digit suffix only" và nói app tự chọn. CLAUDE.md: bước thêm bài seed nhắc sửa
  các test đang ghim 2 seed. DECISIONS: sửa D-176 (donate Mobile = vị trí nút 1–8), ghi chú thay thế cho D-025,
  D-118, D-186, D-202, D-224; thêm D-257 – D-259. DESIGN.md: tên nút sau "CHẠM:" giữ hoa / thường (D-241).
- Hướng dẫn trong app: trang **Hướng dẫn** (☰ Menu → **Hướng dẫn**, `#/guide` và `#/guide/cam-am`) hiện phần người
  dùng của README và hướng dẫn prompt AI cho cảm âm ngay trong bản web — trước đây người chỉ có link web không mở
  được `docs/AI-PROMPT-CAM-AM.md`. Mục lục cuộn tới đúng mục, ảnh minh họa, khối code có nút Sao chép, điện thoại
  không cuộn ngang. Nhập cảm âm có link "Hướng dẫn đầy đủ và nơi tìm nguồn bài" (tab mới), Thư viện có link "Cú
  pháp .harm".
- Kiểu Mobile: chơi lại, phát lại sau khi hết bài, nhảy dòng / đoạn, Loop A-B và overlay `loop=1` hiện `CHẠM: …` ở
  nốt đầu khi chế độ đang giữ khác chế độ nốt đó cần (trước đây banner giả định đã về Ngẩng Tự Nhiên); SẮP CHẠM không
  báo cue ngoài vùng loop; seek khi đang dừng không còn coi như đã chạm mọi cue.
- Tự chơi để tạo bài: quantize không còn đẩy dây chuyền cả đoạn legato trễ một ô khi có một lần bấm lạc; cuộn nốt
  kiểu Mobile ghi số giản phổ (chấm quãng vẽ riêng) thay cho `Z X C…`.
- Overlay OBS: link mang cách nút Nửa Cung (`semitone=oneshot`) và tên gọi nút tùy chỉnh (`nl` `nr` `nn` `ns`) —
  OBS không đọc được Cài đặt của bạn; game bar của overlay đọc được trên nền theme sáng; lưới mờ trên nền chroma
  không còn pixel bán trong suốt; hộp thoại **Tạo link OBS** đặt Window Capture + Chroma Key lên trước (khuyên dùng)
  và thêm bước cắt thanh tiêu đề / địa chỉ của cửa sổ Mở thử.
- Cửa sổ nổi: 8 cột thẳng 8 phím game ngay lần mở đầu ở Windows 125 % / 150 % và 1440p; huy hiệu "Đang phát giai
  điệu" hiện cả trong cửa sổ nổi.
- Player: "Chia sẻ" bài dài cho một thông báo (đã sao chép + khuyên gửi `.harm`) thay vì thông báo lỗi đè mất xác
  nhận; hàng nút header xuống dòng, không cuộn ngang ở 320–375 px; nút chế độ sắp chạm có vòng hổ phách tĩnh (không
  nhấp nháy); tile chờ bấm có viền tĩnh khi bật giảm chuyển động; tooltip lệch `@scroll` và Editor (Xem trước, Tối ưu
  lại) gọi đúng tên Nửa Cung tùy chỉnh.
- Tạo bài từ file: Thu melody mặc định không phát tiếng nào (đếm vào bằng hình; click chỉ khi bật trong Cài đặt;
  "Tiếng phản hồi khi bấm" chỉ cho màn này, mặc định tắt); nốt đón đầu bài không còn tách thành section "Main" lạc;
  chữ ngân 2–3 nốt bằng nhau thành luyến `X-C` (karaoke vẫn tô từng chữ); chùm 5 / chùm 7 ghi đúng `1/5` / `1/7`; lời
  MusicXML lượt 2 không mượn chữ lượt 1 ở chỗ luyến; nhận file `.rmi`; thả file ở bước 2–5 không còn làm trình duyệt
  mở file (thay bằng chọn file mới); piano roll dùng màu trung tính cho nốt.
- Cài đặt: settings cũ (v2) migrate tắt cả tiếng khi bấm phím; **Âm sắc** / **Âm lượng synth** chuyển sang nhóm
  **Synth của app**, luôn chỉnh được (áp cả cho tiếng khi bấm và **Nghe thử**).
- Tương phản cao Windows (forced colors): switch, nút đang bật, keycap / nút số đang cần, nút chế độ đang chọn, chấm
  quãng `1̇`, nút chế độ sắp chạm, bàn nút Mobile ở màn thu và thanh vị trí / Tempo / Lookahead vẽ lại bằng màu hệ
  thống — trước đây mất trạng thái.
- Bản desktop Tauri (chưa build thử): link dạng `#/overlay/…` truyền vào `.exe` không còn kế thừa `layout=game` mặc
  định của cửa sổ.
- Tài liệu: README thêm tham số overlay `semitone` / `nl` `nr` `nn` `ns`, preset dải ngang `gamebar=0&lyrics=0`, cue
  "vào lại" Mobile, căn cột Cửa sổ nổi ở 125 % / 150 % / 1440p, Thu melody im lặng mặc định, nhóm Synth của app,
  nốt đón / luyến khi import, `.rmi`, mục **Hướng dẫn** trong Menu; DECISIONS D-260 – D-286.
- Test: e2e `forced-colors.spec.ts` (kiểm bằng pixel) và `guide.spec.ts`; unit test cho bộ đọc markdown, link của
  trang Hướng dẫn, ví dụ cảm âm viết thường.

#### Phase 4m (vòng review)

- Bàn nút Mobile: bật giảm chuyển động (Android "Xóa hiệu ứng") không còn để PERFECT / tia sáng / vòng vàng "cần chạm"
  đứng yên mãi trên màn — hiệu ứng mờ dần rồi tự gỡ; chữ kết quả lớn của bố cục PC cũng mờ đi như mong đợi. Tia sáng
  "trúng" không còn tự nháy lại khi nốt mới tới cùng cột (lần trúng giả). Đúng nốt mà sai chế độ ghi **SAI CHẾ ĐỘ**
  (không phải SAI PHÍM); dòng hướng dẫn chế độ Chờ nói "chạm đúng nút chế độ rồi chạm nốt".
- Điện thoại dọc: chữ trên ô đang rơi / đang giữ dừng phía trên tên nút chế độ thay vì chui dưới nó; viên "CHẠM: …"
  không còn bị nhãn đoạn (ĐIỆP KHÚC…) che chữ đầu.
- Tương phản cao Windows: tên trong nút chế độ đang chọn của bàn nút Mobile đọc được (trước đây chữ tối trên nền
  Highlight tối).
- Trang mini, kiểu PC: 8 phím game bar (và banner) thẳng 8 làn ngay khi mở ở khung ~300 px và sau khi đổi kích thước
  (trước đây lệch tới hơn nửa làn tới khi kéo cửa sổ).
- Cửa sổ video nổi: khung video trực tiếp có nút ❚❚ / ▶ (Media Session), hết bài ▶ chơi lại, đứng yên thì không vẽ lại
  (đỡ pin); "Dựng sẵn" chỉ bật khi trình duyệt phát được video WebM (không bắt chờ dựng xong mới báo lỗi), dựng không
  bị hãm như timer khi trang xuống nền, giữ màn hình sáng khi dựng, nhắc "giữ trang này mở cho tới 100 %"; tiến độ
  không vẽ lại cả trang / không đọc liên tục cho screen reader; khung nguồn vẽ ở DPR 1 (nhẹ hơn trên điện thoại).
- Hướng dẫn trang mini + README: lưu ý chung không mở cửa sổ qua tiện ích chơi game của hãng (Game Booster, Gaming Hub,
  Game Turbo, Game Space…), chạm bị chặn thì gỡ DF khỏi đó; vivo / iQOO có cửa sổ nhỏ nhưng không phóng to được (không
  phải "không có cửa sổ nổi"). DECISIONS D-299 – D-305.
- Test: e2e trang mini (☰ Menu → Cửa sổ mini → Mở trang mini; 300 × 300 kiểu PC keycap thẳng làn; mở / đóng video PiP
  trực tiếp; mở video dựng sẵn rồi rời trang → đóng + thu hồi blob URL), giảm chuyển động trên bàn nút, pixel tên nút
  chế độ ở tương phản cao; unit test tương ứng.
