# Checklist sau deploy — https://df-harmonica-tiles.vercel.app (v1.0.1, 2026-10-17)

Kiểm bản vừa deploy lên Vercel. Mở **https://df-harmonica-tiles.vercel.app** bằng **Chrome hoặc Edge** trên máy tính
và **Safari** trên iPhone. Gặp gì lạ thì ghi: số mục + bạn bấm gì + thấy gì (chụp màn hình càng tốt). Bản 1.0.1: làm
**Phần 0** trước (các góp ý vừa sửa); mục có **(v1.0.1)** đã đổi theo bản này, mục **(vòng 7)** / **(mới)** là của bản
1.0.0.

## Phần 0 — v1.0.1 (góp ý trên bản 1.0.0)

1. **Phiên bản.** Hướng dẫn → cuối trang → **Dev notes**: **Phiên bản** `1.0.1`, commit không `-dirty`. Đang mở bản cũ
   thì chờ **Có bản mới** → **Tải lại** (hoặc đóng hết tab rồi mở lại).
2. **Quốc ca chỉ còn 2 phần.** Màn đầu (_"Quốc ca Việt Nam"_): ô chọn đoạn ở thanh điều khiển chỉ có **Phần 1**, **Phần
   2**; tiến độ ghi `… / 1:02`; hết Phần 2 là hết bài.
3. **Đếm vào ngắn hơn.** _"Quốc ca Việt Nam"_ → **Phát**: ô lùi mượt một đoạn ngắn rồi đứng yên lúc 3-2-1 — **nốt đầu đã
   thấy trên làn**, cách vạch sáng chừng 3/4 khu ô rơi; hết số thì nốt đầu rơi tới vạch sau khoảng **3,3 giây** (trước
   ~5 giây). _"TAKEDISKRUSH!"_: hết số → nốt đầu chạm vạch sau khoảng **1,3 giây** (trước ~2 giây). Không có số khi ô đã
   chạy, không nhảy lùi. Cài đặt → **03 Phát bài**: công tắc tên **Đếm vào khi bấm Phát**. Bật **Tiếng click
   metronome / đếm vào** (Cài đặt → **Âm thanh**) → **Phát** Quốc ca: sau 3-2-1 nghe 4 tick đều rồi nốt lấy đà (không
   có quãng im lặng dài). Xong tắt tiếng click.
4. **Nốt đầu chạm vạch không khựng.** Đóng hết cửa sổ Chrome / Edge rồi mở lại link (lần mở đầu là lúc dễ khựng nhất)
   → **Phát** Quốc ca: lúc nốt đầu chạm vạch sáng (keycap sáng lên) và lúc banner **ĐANG GIỮ …** đầu tiên hiện, ô rơi
   đều, không giật. Thử thêm khi đã bật nút loa (giai điệu mẫu), ở **Cửa sổ nổi** và overlay OBS. Còn khựng thì ghi
   máy (CPU / card đồ họa), trình duyệt, lúc nào (nốt đầu / banner / lúc khác).
5. **Cửa sổ nổi PC rộng bằng khung bảng phím.** Game Borderless / Windowed, mở bảng phím kèn. **Cửa sổ nổi** → **Căn
   chỉnh** → kéo cửa sổ cho mép dưới nằm trên mép trên bảng phím và **mép trái cửa sổ thẳng mép trái khung bảng phím**
   (viền tối bo góc): 8 vạch thẳng 8 phím ngay, cột ngoài cùng **không sát mép cửa sổ** (chừa khoảng như từ phím Z /
   phím , tới viền bảng phím), dải giữ chuột nằm ngoài khung bên phải. Ghi độ phân giải + tỉ lệ Windows và lệch bao
   nhiêu nếu có. Cỡ bạn đã kéo ở bản cũ: lần mở đầu ra cỡ chuẩn mới (đúng — bản cũ hẹp hơn).
6. **Overlay OBS rộng bằng khung bảng phím.** OBS (overlay **Khớp bảng phím game**, đã thêm bằng **Gửi thẳng vào OBS**
   hoặc link mới) → ô rơi thẳng 8 phím, hai cột ngoài cùng cách mép khung một khoảng (không dính vạch sáng / vạch dải
   giữ). **Xem trước** (cuối hộp thoại OBS): bảng phím minh họa và khung ô rơi cùng mép trái / phải.
7. **Android — trang mini "Khớp nút game" (nếu có máy).** Kéo cửa sổ tới **Rộng: vừa** — giờ cần rộng hơn hàng nút chừng
   1/4 nút mỗi bên: ô ngoài cùng (nút 1 / nút 1̇) không chạm mép cửa sổ, vạch / vòng vẫn thẳng nút thật. Ghi cỡ cửa sổ
   (rộng × cao) khi chỉ báo ghi **Rộng: vừa**.
8. **Trang mini đã mở ở bản 1.0.0, không có chỉ báo Rộng (máy tính / iPhone).** Mở lại trang mini (Cửa sổ nổi →
   Android → **Mở trang mini**, hoặc link `#/mini/…` cũ) ở bố cục **Khớp nút game**: hàng trên có chip **Bản mới: kéo
   rộng thêm ¼ nút mỗi bên** (cửa sổ hẹp: **kéo rộng thêm ¼ nút**), không đè nút nào; chạm → hướng dẫn đặt cửa sổ, chip
   mất và tải lại không hiện nữa. Máy chưa từng mở trang mini thì không có chip.

Trước khi test:

- Link Vercel là **một trang web khác** với bản test cũ (`http://localhost:4173`, `http://<địa chỉ IP máy tính>:4173`): Thư
  viện, Cài đặt, kết nối OBS đã nhớ ở bản cũ **không** có ở đây. Bài của bạn: ở bản cũ bấm **Chia sẻ** (hoặc **.harm**
  trên thẻ bài) rồi mở / nhập ở link mới → **Lưu vào thư viện**.
- Thư viện có ba **bài mẫu**: _"Quốc ca Việt Nam"_, _"TAKEDISKRUSH!"_ và _"寂寞的人伤心的歌"_ (v1.0.2; hai bài mẫu cũ đã
  bỏ) — mỗi thẻ bài mẫu và header màn chơi của bài mẫu có dòng nhỏ **Bản quyền bài hát thuộc về tác giả: …**.

## Phần 1 — PC (Chrome / Edge)

1. **Mở link.** Màn đầu là màn chơi với _"Quốc ca Việt Nam"_. **◂ Thư viện** → hai thẻ bài mẫu đầu đúng như trên.
2. **Bắt đầu phát không giật (vòng 7).** Mở _"TAKEDISKRUSH!"_ → **Phát**: các ô **lùi mượt lên** một đoạn (khoảng một
   phần ba giây — ô sát mép trên trượt ra khỏi khung, không ô nào "biến" giữa chừng) rồi **đứng yên** suốt lúc số to
   3-2-1; hết số thì chính các ô đó chạy tiếp — **không** nhảy lùi. **Esc** trong lúc 3-2-1 → ô trượt mượt về chỗ cũ.
   Mở _"Quốc ca Việt Nam"_ → **Phát**: các ô đang thấy trượt lên một đoạn, lúc 3-2-1 nốt đầu đã nằm trên làn (v1.0.1),
   hết số thì ô rơi mượt; lúc nốt đầu chạm vạch sáng không khựng. Cài đặt →
   **03 Phát bài** → **Đếm ngược** = **Tắt** → **Phát**: không có số, ô lùi mượt rồi rơi ngay (không nhảy cóc); xong
   đặt lại 3 giây. Không có số đếm nào khi ô đã chạy.
3. **Vòng CHẠM (vòng 7).** Bấm **Mobile** → **Phát**. Mỗi lần phải đổi chế độ: một **vòng tròn rỗng** (viền màu chế
   độ, nhìn xuyên qua được) to đúng bằng nút chế độ, giữa ghi `CHẠM`, rơi **nhanh hơn ô** và **trùng khít nút chế độ**
   đúng lúc phải chạm; chữ `CHẠM` mờ đi ngay trước khi vòng đáp nên tên nút (vd. **NGẨNG LÊN**) đọc được lúc phải chạm;
   vòng nằm **trên** nút (không bị nút che), không còn thanh `CHẠM` ngắn. Thử cả giao diện sáng (☀) và **English**
   (tên nút `SEMITONE` không bị cắt đôi).
4. **Cửa sổ nổi (PC) — đếm ngược ít nhất 3 giây (vòng 7).** Về **PC** → **Cửa sổ nổi** → **Căn chỉnh** → Esc → ▶ →
   đếm ngược 3 giây → bài chạy. Cài đặt → **03 Phát bài**: dưới **Đếm ngược trước khi phát** có thêm dòng "Cửa sổ nổi,
   trang mini và video nổi luôn đếm ít nhất 3 giây…". Đặt **Tắt** → màn chơi bấm Phát là chạy ngay, Cửa sổ nổi vẫn đếm 3 giây; đặt
   **5 giây** → Cửa sổ nổi đếm 5. Xong để lại 3 giây.
5. **Dev notes (vòng 7).** Cuối trang **Hướng dẫn** và cuối trang **Cài đặt** có link chữ nhỏ **Dev notes** (Tab tới
   được) → trang **Dev notes**: khung đầu trang ghi **Phiên bản** (số vừa release, vd. `1.0.0` — **không** phải
   `0.0.0`), **Commit** (đúng bản vừa deploy, **không** có `-dirty`) và **Ngày build**, rồi **Tài liệu tham khảo** và
   **Lịch sử thay đổi** (mục đầu là số phiên bản đó, không phải `[Unreleased]`); bấm vài link trong mục lục → cuộn đúng mục. Thanh
   điều hướng không có mục Dev notes. **(mã nguồn mở)** Cuối trang **Hướng dẫn**, ngay sau **Dev notes**, và đầu trang
   **Dev notes** có link **Mã nguồn (GitHub)** → mở tab mới tới kho GitHub của app (trang cũ vẫn giữ); cuối trang
   **Cài đặt** chỉ có **Dev notes**.
6. **Chia sẻ.** Màn chơi → **Chia sẻ** → link bắt đầu bằng `https://df-harmonica-tiles.vercel.app/#/s/` → dán vào tab
   ẩn danh → **Phát ngay** chạy, **Lưu vào thư viện** lưu được. Trang Tạo bài với AI → **Sao chép prompt** chép được
   (bản https không bị chặn clipboard).
7. **Cài như app + offline.** Mở **◂ Thư viện** một lần → thông báo **Đã sẵn sàng dùng offline** (màn đầu không hiện
   thông báo này). Biểu tượng cài ở thanh địa chỉ → cài → app mở cửa sổ riêng. Tắt mạng (rút mạng / tắt Wi-Fi) → mở
   lại app → màn chơi, Thư viện vẫn chạy. Bật mạng lại.
8. **Nhắc bản mới tự hiện (vòng 7)** — chỉ thử được khi có một bản deploy mới hơn bản bạn đang mở: để tab / app đang
   mở, sau khi bản mới lên, chuyển sang tab khác **hơn 5 phút** rồi quay lại (hoặc cứ để mở ~45 phút) → góc màn hình
   hiện **Có bản mới** → **Tải lại** → bản mới (Dev notes ghi commit mới). Không phải tự Ctrl+F5.
9. **Nút loa trên thanh điều khiển (mới).** Màn chơi: ngay trước **Tempo** có nút loa gạch chéo (rê chuột: **Bật tiếng
   giai điệu**), mặc định tắt, không có huy hiệu đỏ. Bấm → hộp **Bật phát giai điệu mẫu?** y như ở Cài đặt → **Âm
   thanh** → **Hủy** (hoặc Esc) → vẫn tắt. Bấm lại → **Tôi hiểu, bật** → nút loa đỏ, huy hiệu **🔊 Đang phát giai
   điệu** hiện (điện thoại / cửa sổ hẹp: chỉ ô đỏ **[🔊]**, trang không nhảy xuống); **Phát** → nghe giai điệu. Bấm nút
   loa lần nữa → tắt ngay (không hỏi), huy hiệu mất. Cài đặt → **Âm
   thanh** → **Phát giai điệu mẫu** luôn khớp với nút loa (bật một bên là bên kia cũng bật). Bấm chuột vào nút loa rồi
   nhấn **Space** → bài phát / dừng (không đổi tiếng). Overlay OBS, Cửa sổ nổi vẫn im lặng. Xong để **tắt**.
10. **Cửa sổ nổi PC — cỡ chuẩn theo màn hình (mới).** Game Borderless / Windowed, mở bảng phím kèn. Màn chơi kiểu **PC**
    → **Cửa sổ nổi** → **Căn chỉnh** → kéo cửa sổ cho mép dưới (vạch sáng) nằm trên mép trên bảng phím, mép trái thẳng
    mép trái khung bảng phím (v1.0.1): **8 cột thẳng 8 phím ngay** (không phải kéo giãn) và **mép trên cửa sổ (cả thanh
    tiêu đề) chạm mép trên màn hình**. Lần mở đầu có
    thể thấp hơn vài px → đóng, mở lại → đúng (app đo thanh tiêu đề lần đầu). Ghi lại độ phân giải + tỉ lệ Windows
    (Cài đặt Windows → Màn hình → Tỉ lệ) và lệch bao nhiêu nếu có. Kéo giãn cửa sổ → đóng → mở lại: vẫn cỡ vừa kéo.
    Bấm **Đặt lại cỡ chuẩn** (thanh nhỏ của cửa sổ) → cửa sổ về cỡ chuẩn ngay (hoặc dòng nhắc "đóng rồi mở lại" → làm
    theo → cỡ chuẩn; lần mở đó cửa sổ hiện ở chỗ mặc định của Chrome, kéo lại lên bảng phím). Có màn thứ hai khác độ
    phân giải: kéo tab màn chơi sang màn đó rồi mở Cửa sổ nổi → cỡ chuẩn theo màn đó (cỡ đã kéo ở màn kia không bị dùng
    lại). Biết trước: lần mở THỨ HAI (sau khi app đo được thanh tiêu đề) cửa sổ có thể hiện ở chỗ mặc định của Chrome
    thay vì chỗ bạn đã kéo — một lần thôi (Chrome chỉ nhớ chỗ khi cỡ xin không đổi); từ lần sau giữ chỗ. Màn 4:3 / 5:4
    (vd. 1280 × 1024): cửa sổ mở thấp hơn một chút rồi tự cao lên (Chrome giới hạn cỡ trang tự xin ở 25 % diện tích màn);
    vẫn thấp thì bấm **Đặt lại cỡ chuẩn** — ghi lại.

## Phần 2 — OBS (cùng máy, OBS 28+)

1. **Gửi thẳng vào OBS.** OBS → **Tools** → **WebSocket Server Settings** → tick **Enable WebSocket server** →
   **Show Connect Info** → **Copy** ở **Server Password**. Màn chơi → **OBS** → **03 Gửi thẳng vào OBS** → dán mật khẩu
   → **Kết nối**. Lần đầu Chrome / Edge **hỏi quyền truy cập thiết bị trong mạng cục bộ** → **Cho phép** (lỡ chặn: biểu
   tượng cạnh thanh địa chỉ → cho phép → **Kết nối** lại). → **Thêm overlay vào OBS** → OBS có source **DF Harmonica
   Tiles** đúng cỡ canvas, ô rơi nằm trên bảng phím kèn của game. **Phát** / **Tạm dừng** / tua ở màn chơi → overlay
   chạy theo; bấm **Phát** thì ô trên overlay cũng trượt mượt (không nhảy), lúc 3-2-1 đứng yên rồi chạy cùng lúc.
2. **Overlay kiểu Mobile (vòng 7).** Màn chơi → **Mobile** → **Phát**: overlay trong OBS **không** có bàn nút kiểu
   game, chỉ có **4 vòng mờ** ở chỗ 4 nút chế độ; vòng `CHẠM` đáp đúng vào vòng mờ đó. Về **PC**.
3. **Browser Source thủ công.** Hộp thoại OBS → **04 Browser Source thủ công** → **Sao chép link** (link bắt đầu bằng
   `https://df-harmonica-tiles.vercel.app/`) → OBS → Sources → **+** → **Browser** → dán URL, Width × Height = **Base
   (Canvas) Resolution**. Khi màn chơi **chưa** kết nối OBS (bấm **Ngắt kết nối** ở mục 03 trước): khoảng 2 giây sau
   source tự đếm ngược rồi chạy bài một lần; chuột phải source → **Refresh** chạy lại.
4. **Xem trước.** Nút **Xem trước** cuối hộp thoại → cửa sổ nhỏ nền tối, nhãn "Xem trước · không dùng để quay", chạy
   theo màn chơi; ở kiểu Mobile cũng chỉ có 4 vòng mờ (không bàn nút).

## Phần 3 — iPhone (Safari)

1. **Màn chơi kiểu Mobile.** Mở link → **◂ Thư viện** → _"TAKEDISKRUSH!"_ (bài mẫu có ô ngay từ đầu; _"Quốc ca Việt
   Nam"_ lúc 3-2-1 cũng đã thấy nốt đầu — v1.0.1) → **Mobile** → xoay ngang → **Phát**: ô lùi mượt rồi
   đứng yên lúc 3-2-1, ô rơi vào 8 nút tròn, **vòng CHẠM** đáp đúng nút chế độ và tên nút đọc được lúc đáp. Chữ đọc
   được, không phải cuộn ngang. Nút loa (trước **Tempo**) gọn, không đè nút khác; chạm → hộp cảnh báo → **Hủy**.
2. **Video nổi trên iPhone (vòng 7).** Thanh dọc → **Cửa sổ nổi** → hộp thoại hỏi **Điện thoại của bạn: Apple (iPhone /
   iPad) hay Android?** → **Apple — iPhone / iPad** → hộp thoại **Cửa sổ video nổi (thử nghiệm)** tự dựng ngay
   (**Đang dựng video… N%**; giữ màn hình sáng, không chuyển app) — **không** có mục "Trực tiếp" → tới 100 % → chạm
   **Mở video nổi** → khung video nổi mở; vuốt về màn hình chính / mở game → video vẫn nổi, đếm ngược rồi chạy. Đóng hộp
   thoại → video vẫn mở. Bấm **Cửa sổ nổi** lần nữa → vào thẳng hộp thoại video (không hỏi lại); dòng cuối ghi
   "Điện thoại: Apple (iPhone / iPad) · Đổi loại điện thoại". Ghi lại nếu thấy câu báo lỗi nào.
3. **Luyện bằng chạm.** Màn chơi kiểu Mobile → **Luyện tập** → **Chờ** → **Phát** → chạm nút chế độ rồi nút số đang sáng
   → **PERFECT** / **GOOD**.
4. **Tạo bài với AI.** Thư viện → **Tạo bài với AI** → **Sao chép prompt** (bản https chép được) → dán vào app AI kèm ảnh
   sheet → sao chép câu trả lời → nhấn giữ ô **Dán kết quả của AI vào đây** → **Dán** → **Lưu** → **Phát**.
5. **Thêm vào màn hình chính + offline.** Safari → nút Chia sẻ → **Thêm vào MH chính** → mở từ biểu tượng → app chạy
   không thanh địa chỉ. Bật chế độ máy bay → mở lại → màn chơi vẫn chạy. Tắt chế độ máy bay.
6. **Tiếng khi gạt nút im lặng (mới).** Ghi lại phiên bản iOS (Cài đặt → Cài đặt chung → Giới thiệu). Gạt nút bên hông
   sang **im lặng** (thấy vạch cam), mở một bài ở Apple Music / Spotify rồi quay lại Safari. (a) Mở màn chơi, chưa bật
   gì: nhạc kia vẫn phát, app im lặng. (b) Nút loa → **Tôi hiểu, bật** (nhạc kia tạm dừng — đúng) → **Phát** → **nghe
   giai điệu ngay từ lần Phát đầu, dù đang gạt im lặng** (nút âm lượng bên hông tăng được tiếng). (c) Gạt sang đổ chuông
   rồi lại im lặng trong lúc phát → vẫn nghe. (d) Tạm dừng → bấm nút loa (tắt) → mở lại nhạc kia: phát bình thường.
   (e) Bật lại nút loa → **◂ Thư viện** → nhạc kia mở lại được. (f) Đang phát có cuộc gọi / gọi Siri → quay lại → chạm
   một chỗ trống trên màn chơi (không chạm nút loa — đang bật thì nó là **Tắt tiếng**) → tiếng có lại (ô vẫn chạy
   suốt). (g) Cài đặt → **Âm thanh** → **Phát giai điệu mẫu** → **Tôi hiểu, bật** → **◂ Về màn chơi** → **Phát**: có
   tiếng ngay. (h) Vẫn gạt im lặng: Thư viện → **Tự chơi để tạo bài** → bật **Tiếng phản hồi khi bấm** → chạm nút số:
   nghe tiếng; tắt lại → nhạc kia mở lại được. Nếu có file MIDI: **Tạo bài từ file MIDI / MusicXML** → **Nghe thử** một
   track: nghe được; hết / dừng → nhạc kia mở lại được. Không nghe ở bước nào: ghi bước đó, có hiện câu **Chưa bật
   được âm thanh…** không, và thử tăng âm lượng / tắt chế độ tập trung. Xong để **tắt** nút loa.

## Phần 4 — Android (nếu có máy)

1. **Trang mini.** Màn chơi → **Mobile** → **Cửa sổ nổi** → **Android** → **Mở trang mini** → chuyển trình duyệt thành
   cửa sổ nổi (nút ⓘ **Hướng dẫn mở cửa sổ nổi**) → **Bắt đầu** → đếm ngược ít nhất 3 giây → ô rơi; chạm = tạm dừng, nút
   **◂** về màn chơi khi đang dừng. Trang mini im lặng kể cả khi nút loa của màn chơi đang bật.
2. **Video nổi.** Trong trang mini → **Cửa sổ video nổi (thử nghiệm)** → có cả **Trực tiếp** (nút chính **Mở video
   trực tiếp**) và **Dựng sẵn** (**Dựng video** → **Mở video dựng sẵn**); cả hai mở được khung video nổi.
3. **Khớp nút game (mới).** Kiểu **Mobile**: trang mini mặc định ở **Khớp nút game** (không có bàn nút riêng). (Máy mới,
   Cài đặt còn kiểu **PC**: trang mini mở **Thu nhỏ** có dòng **Chơi bản điện thoại?** → **Đổi sang Mobile** → vào thẳng
   **Khớp nút game**.) Mở game tới bảng nút kèn (màn ngang). Bảng lúc dừng có hai chỉ báo **Rộng** / **Cao** (không
   có = máy không cho biết cỡ màn hình — ghi lại, rồi làm theo cách cũ ở cuối mục). Kéo giãn cửa sổ nổi: **mép trên chạm
   mép trên màn hình**, mép dưới ngay trên khung kèn, **không che hàng nút chế độ** → kéo tới khi hai chỉ báo ghi
   **Rộng: vừa** và **Cao: vừa** (che nút chế độ → **Cao quá — đang che khung kèn**; hẹp → **Hẹp quá — kéo giãn thêm**).
   Chỉ báo **Cao** đoán thanh kéo của cửa sổ nổi ~24 px: ghi lại **thanh kéo của hãng bạn cao chừng nào** (nằm trên
   cửa sổ hay đè lên trang) và khi chỉ báo ghi **Cao: vừa** thì mép dưới cửa sổ thật sự ở đâu (che nút chế độ / sát /
   còn hở bao nhiêu). **Căn chỉnh** → ⓘ: đoạn đầu nói từng nút chỉnh cái gì, rồi cách kéo / đổi cỡ của Samsung, Xiaomi,
   hãng khác — ghi lại nếu hướng dẫn sai với máy bạn; hộp thoại phải đọc / cuộn được trong cửa sổ thấp. **Căn chỉnh**:
   bảng một hàng ở đỉnh, mọi nút chạm được, không che 4 vòng / mép dưới; nút chọn ghi hai dòng **Vạch · Dời** / **Vạch ·
   Giãn** (8 vạch) và **Vòng · Dời** / **Vòng · Giãn** (4 vòng) — thứ đang chọn sáng lên trên màn, thứ kia mờ đi; hiểu
   được mỗi nút làm gì mà không cần đọc hướng dẫn không? → **chỉ kéo cửa sổ** sang trái / phải: 8 vạch phải thẳng tâm
   8 nút số và 4 vòng thẳng 4 nút chế độ **mà không chỉnh số nào** (cửa sổ ở giữa màn là trùng) — lệch thì ghi lệch bao
   nhiêu rồi chỉnh **Vạch · Dời** / **Vạch · Giãn** (mỗi chạm ~1 px, **giữ** thì chạy nhanh dần), **Vòng · Dời** /
   **Vòng · Giãn** cho vòng (dời **Vạch · Dời** xa quá thì chỉ báo ghi **Lệch tâm — kéo cửa sổ sang …**: kéo cửa sổ rồi
   đặt về 0). **Ghi tỉ lệ màn hình** (vd. 2400 × 1080 = 20 : 9) **và số "Vạch · Giãn" phải chỉnh** (100 % = khớp sẵn) —
   app giả định UI game phóng theo chiều cao màn ở mọi máy ≥ 19,5 : 9; số khác 100 % ở máy 20 : 9 / 21 : 9 là giả
   định sai → báo lại → **Xong** → **Bắt đầu** → chạm vào game: ô rơi thẳng xuống nút số cần bấm, làn dài từ
   mép trên màn hình, vòng `CHẠM` đáp ở mép dưới **ngay trên** nút chế độ phải chạm, đúng lúc phải chạm; không có
   banner chế độ chắn giữa cửa sổ. Bảng lúc dừng / tạm dừng (2 hàng) không có nút nào đè nút nào. Đóng trang rồi mở lại
   → vẫn đúng chỗ đã căn. Ghi lại hãng / máy, cỡ cửa sổ đặt được (rộng × cao), hai chỉ báo và số đã chỉnh (chụp màn
   hình bảng Căn chỉnh). Không có chỉ báo: giãn cho mỗi mép ra ngoài nút 1 / nút 1̇ chừng 1/4 nút (v1.0.1), chọn **Vạch · Nút 1** /
   **Vạch · Nút 1̇** / **Vòng · Dời** / **Vòng · Giãn** để chỉnh. **Thu nhỏ** → trang cũ có bàn nút riêng vẫn chạy; mở lại vẫn **Thu nhỏ**; bấm **Khớp
   nút game** để về lại.
4. **Tiếng trên Android (mới).** Âm lượng là âm lượng **nhạc / media** (không phải chuông). Màn chơi kiểu **Mobile** →
   nút loa → **Tôi hiểu, bật** → **Phát** → nghe giai điệu ngay lần đầu. Cài đặt → **Âm thanh** → bật **Phát tiếng khi
   bấm phím / nốt** → màn chơi → **Luyện tập** → chạm nút số → có tiếng ngay khi chạm. Xong để **tắt** cả hai.
