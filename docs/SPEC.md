# SPEC: Harmonica Tiles cho Delta Force

> Bản gốc của yêu cầu dự án (giữ nguyên văn để tham chiếu). Các quyết định diễn giải nằm ở `docs/DECISIONS.md`.

## Thay đổi so với spec gốc (do người dùng yêu cầu sau)

- **2026-10-17 — v1.0.1, góp ý của chủ dự án trên bản live 1.0.0 (ghi đè các mục cũ bên dưới nếu mâu thuẫn).** Chi
  tiết: `docs/DECISIONS.md` D-427 … D-438; sửa sau review D-439 … D-442.
  1. **Nốt đầu chạm vạch sáng không khựng** — làm nóng hiệu ứng DOM của lần chạm đầu (keycap sáng, banner giữ, nhãn
     modifier) và bảng sóng âm thanh trước khi phát.
  2. **Đếm vào ngắn lại 35 %:** quãng nốt đầu đi từ chỗ đứng yên (lúc đếm ngược) tới vạch sáng = 0,65 × (1 ô nhịp +
     đoạn lặng trước nốt đầu); vẫn đứng yên lúc đếm ngược, không số khi ô đã chạy, không nhảy lùi, ở mọi nơi (màn chơi,
     Cửa sổ nổi, overlay, trang mini, video nổi). Tiếng click (nếu bật) tick theo nhịp tới nốt đầu, ít nhất 2 tick
     (bài 2/4 / 3/4 vào ngay đầu ô nhịp: đếm vào 2 beat). Tên cài đặt thành "Đếm vào khi bấm Phát".
  3. **Cửa sổ nổi PC + overlay khớp game (`fit=canvas`) rộng bằng khung bảng phím PC của game** (đo trên ảnh chụp của
     chủ dự án): 8 cột vẫn thẳng 8 phím, hai bên chừa 0,26 bước cột → ô ngoài cùng không sát mép; rộng ≈ 610·k (ghi đè
     576·k của mục 2026-10-16 số 3). Link cũ `fit=source` giữ nguyên.
  4. **Trang mini "Khớp nút game": cửa sổ lý tưởng = 8 làn** (rộng hơn hàng nút ~1/4 nút mỗi bên — bảng nút mobile
     không có viền trong) → ô ngoài cùng không sát mép; bố cục bàn nút Mobile / overlay Mobile vốn đã có khoảng cách.
     Máy đã dùng trang mini ở bản 1.0.0 mà trang không biết cỡ màn (không có chỉ báo Rộng): nhắc một lần "kéo rộng
     thêm ¼ nút mỗi bên".
  5. **Bài mẫu "Quốc ca Việt Nam" chỉ còn Phần 1 + Phần 2** (1:02 ở 80 BPM).

- **2026-10-16 — Bổ sung trước deploy, chủ dự án duyệt (ghi đè các mục cũ bên dưới nếu mâu thuẫn).** Chi tiết:
  `docs/DECISIONS.md` D-392 … D-398; sửa sau review D-399 … D-404; đúng tỉ lệ thật + cỡ Cửa sổ nổi PC D-405 … D-411.
  1. **Nút loa trên thanh điều khiển màn chơi** (cạnh Tempo, mặc định tắt tiếng; ghi đè ý "bỏ nút âm thanh khỏi thanh
     điều khiển Player" của mục 2026-10-14): đang tắt → bấm hiện ĐÚNG hộp cảnh báo bản quyền của Cài đặt → Âm thanh,
     "Tôi hiểu, bật" mới bật (huy hiệu đỏ "Đang phát giai điệu" như cũ), hủy = giữ tắt; đang bật → bấm là tắt ngay.
     Cùng setting với Cài đặt → Âm thanh. Bật giai điệu vẫn LUÔN qua hộp cảnh báo đó. Overlay / trang mini vẫn im lặng.
  2. **Trang mini Android "Khớp nút game"** (mặc định ở kiểu Mobile; "Thu nhỏ" = trang mini cũ có bàn nút riêng, mặc
     định ở kiểu PC, nhớ lựa chọn; kiểu PC có nút "Đổi sang Mobile"; bảng thiết kế cho cửa sổ thật ~80–150 px cao): cửa
     sổ nổi Android đục nên đặt NGAY TRÊN bảng nút kèn của game — 8 làn thẳng 8 nút số thật, hit line ở mép dưới cửa
     sổ, vòng "CHẠM" rơi trong cột nút chế độ thật và đáp ở mép dưới; không bàn nút riêng. "Căn chỉnh" (lúc dừng): 8
     vạch + 4 vòng, chỉnh tâm nút 1 / nút 1̇ (lane nội suy đều) + dời / giãn hàng chế độ, mặc định theo số đo ảnh game
     (docs/GAME-UI-REFERENCE.md), "Đặt lại mặc định", nhớ theo máy; hướng dẫn kéo / đổi cỡ cửa sổ theo hãng.
     **Đúng tỉ lệ thật + chiều cao** (D-405, D-406 — "để user chỉ cần kéo qua, hạn chế phải căn chỉnh trừ khi cần",
     "để cho độ dài chạm rìa trên màn hình luôn"; sửa sau review 2 D-412 – D-416): máy Android cảm ứng đọc được cỡ màn
     hình (màn ngang, rộng hơn hẳn cửa sổ) thì bước cột theo chiều cao màn (0,0912 × 1371 / 633 × cao = 0,0912 × bề
     ngang ở màn của ảnh game; màn hẹp hơn 19,5 : 9 theo bề ngang), px CSS, hàng làn căn giữa cửa sổ, dù cửa sổ rộng /
     hẹp; cửa sổ nên chạy từ mép trên màn hình xuống ngay trên khung kèn (0,327 × chiều cao màn), không che hàng nút chế
     độ (0,361), làn + hit line phủ cả chiều cao; chỉ báo "Rộng" / "Cao" (vừa / hẹp quá / rộng hơn cần thiết / lệch tâm
     — vừa / thấp quá / cao quá) ở bảng lúc dừng + Căn chỉnh; Căn chỉnh khi đó là Vạch · Dời / Vạch · Giãn / Vòng · Dời
     / Vòng · Giãn (tinh chỉnh tùy chọn). Không dùng được cỡ màn (hoặc máy tính / iPhone) → kiểu "cửa sổ = hàng nút"
     như trên.
  3. **Cửa sổ nổi PC — cỡ chuẩn cho mọi màn hình** (D-407 – D-410; ghi đè hai preset 1080p / 1440p cũ): rộng ≈ 576·k (từ
     v1.0.1: 610·k — khung bảng phím, xem mục 2026-10-17),
     cao NGOÀI = 750·k px thật (`k = cao px thật / 1080`, chia tỉ lệ Windows) — 8 cột đúng 8 phím, mép dưới trên bảng
     phím thì mép trên chạm mép trên màn hình, chỉ đường rơi dài ra; thanh tiêu đề đo rồi nhớ; cỡ tự kéo nhớ theo từng
     màn hình; nút "Đặt lại cỡ chuẩn" trong cửa sổ nổi. Cỡ chuẩn vượt trần 25 % diện tích màn của Chrome (4:3 / 5:4):
     xin đúng bề ngang, chiều cao hạ rồi `resizeTo` lên (D-418).

- **2026-10-16 — Góp ý vòng 7 + chuẩn bị deploy (ghi đè các mục cũ bên dưới, kể cả mục vòng 6, nếu mâu thuẫn).**
  Người dùng test bản vòng 6 (f851e4a) trên PC + iPhone, gửi góp ý tiếng Việt; lead gom thành 8 mục R7 + 5 mục P
  trước deploy, người dùng duyệt ("lên Vercel luôn"). Chi tiết quyết định: `docs/DECISIONS.md` D-373 … D-388; sửa sau
  review D-389 … D-391.
  1. **Kiểu Mobile — nhắc chạm chế độ = VÒNG trong suốt** (thay thanh ngắn của vòng 6, mục 2): viền màu của chế độ,
     bên trong nhìn xuyên qua, to đúng bằng nút chế độ, chữ "CHẠM" (EN "TAP") ở tâm; rơi **nhanh gấp 1,75 lần ô** (hiện
     muộn hơn, đi nhanh hơn) và **đồng tâm với nút chế độ đúng lúc phải chạm** ("đáp" vào nút). Ở mọi nơi kiểu Mobile
     vẽ nhắc chạm.
  2. **Tự kiểm tra bản mới:** khi tab hiện lại và định kỳ (~30–60 phút) app gọi `registration.update()` của service
     worker, nên "Có bản mới → Tải lại" tự hiện, không cần tải lại tay. Overlay / trang mini (không đăng ký SW) không
     đổi.
  3. **Giật lúc nốt đầu bắt đầu rơi:** trong lúc đếm ngược vẽ đúng khung hình mà đếm vào sẽ bắt đầu (ô đứng yên ở chỗ
     bắt đầu của đếm vào), hết số thì ô chỉ việc chạy tiếp — không nhảy lùi một ô nhịp, không mất ô. Giữ ý cũ: số to chỉ
     khi ô đứng yên; đếm vào = đoạn ô rơi dẫn vào, không số. Đo và sửa mọi chỗ khựng ≥ 100 ms khác (lần đầu vẽ hiệu
     ứng phát sáng ở vạch sáng). Như nhau ở màn chơi, Cửa sổ nổi, overlay (theo màn chơi + tự chạy), trang mini.
     Sau review (D-389): bước từ khung đang đứng sang khung đó lúc bấm Phát (và ngược lại khi hủy, cả khi đếm ngược Tắt
     mà đếm vào bật) cũng không nhảy — ô trượt mượt ~1/3 giây.
  4. **Bàn nút Mobile theo người xem:** màn chơi, Cửa sổ nổi, trang mini giữ **bàn nút đầy đủ** kiểu game (8 nút số +
     4 nút chế độ). Overlay OBS (cả "Xem trước") kiểu Mobile **không** vẽ bàn nút — chỉ một hàng 4 vòng mờ đánh dấu 4
     nút chế độ (không nút số); vòng "CHẠM" đáp vào đó. (Thay phần overlay của mục 2 vòng 6 / D-366.)
  5. **Đếm ngược của Cửa sổ nổi + trang mini** = giá trị Cài đặt → 03 Phát bài nhưng **tối thiểu 3 giây** (5 → 5;
     Tắt → 3) vì bấm ▶ ở đó rồi còn phải chuyển vào game; Cài đặt có dòng nhắc điều này.
  6. **Nút "Cửa sổ nổi" kiểu Mobile** hỏi trước "Điện thoại của bạn: Apple (iPhone/iPad) hay Android?" (nhớ theo máy,
     đổi lại được). Android → hộp thoại trang mini như cũ. Apple → thẳng tới **video nổi**: bắt đầu dựng sẵn ngay, có
     tiến độ, rồi nút lớn "Mở video nổi" (một cú chạm — trình duyệt chỉ cho mở PiP trong cú chạm). Kiểu PC không đổi
     (Document PiP).
  7. **iPhone:** "Trực tiếp" (luồng canvas) Safari không hỗ trợ; "Dựng sẵn" (WebCodecs → WebM) **chạy được** trên
     iPhone của người dùng, kể cả qua `http://<địa chỉ IP máy tính>:4173`. Máy Apple dùng dựng sẵn tự động, ẩn "Trực tiếp" (vẫn
     giữ ở Android / Chrome máy tính). Sửa mọi chỗ trong tài liệu / checklist nói dựng sẵn không chạy qua http.
  8. **"Dev notes":** một trang trong app (`#/dev`) chứa tài liệu cho người phát triển / tham khảo (`docs/REFERENCE.md`:
     cú pháp `.harm` đầy đủ, bảng lỗi, tham số URL overlay, giới hạn — kèm phiên bản app, commit / ngày build và
     CHANGELOG), vào được nhưng cố ý hơi kín: link chữ nhỏ, mờ "Dev notes" ở cuối trang Hướng dẫn và trang Cài đặt
     (vẫn đủ tương phản AA, Tab tới được).
  - **Trước deploy (P1–P5):** bỏ hẳn hai bài mẫu cũ khỏi app (file `.harm` chỉ còn là fixture của test ở
    `src/test/fixtures/`, sau thay bằng hai bài tự soạn — DECISIONS D-443; mục 10 "Seed data" của spec gốc bên dưới chỉ còn giá trị lịch sử —
    app chỉ có hai bài mẫu "Quốc ca Việt Nam" và "TAKEDISKRUSH!"); thay `VERCEL_URL_TODO` bằng
    **https://df-harmonica-tiles.vercel.app** (Vercel project `df-harmonica-tiles`); chụp lại ảnh README đã đổi giao
    diện; `docs/LOCAL-TEST-CHECKLIST.md` thành checklist **sau deploy**; mục Deploy của CLAUDE.md ghi cách deploy lại.
- **2026-10-16 — Góp ý vòng 6 sau khi test local trên PC + iPhone (ghi đè các mục cũ bên dưới, kể cả mục
  2026-10-14 / 2026-10-15, nếu mâu thuẫn).** Chi tiết quyết định: `docs/DECISIONS.md` D-348 … D-372.
  1. **OBS chỉ còn 2 cách:** "Gửi thẳng vào OBS" (obs-websocket, khuyên dùng) và "Browser Source thủ công" (dán
     link, cỡ = canvas). Bỏ hẳn Window Capture, lựa chọn nền chroma, nút "⛶ Toàn màn hình". "Mở thử" đổi thành
     **"Xem trước"**: cửa sổ nhỏ nền tối thường, vẫn theo màn chơi, chỉ để xem người xem thấy gì. Link cũ có
     `bg=chroma` vẫn đọc được.
  2. **Kiểu Mobile — nhắc chạm chế độ:** bỏ vạch đứt nét "CHẠM: …" kéo ngang mọi làn (và viên nhãn của nó), bỏ cả
     dải "CHẠM: <tên chế độ>" cạnh làn. Thay bằng một **thanh ngắn rộng đúng bằng nút chế độ**, chỉ dày vừa chữ
     "CHẠM" (không ghi tên chế độ), màu của chế độ đó, **rơi thẳng xuống nút chế độ** và chạm nút đúng lúc phải chạm.
     Ở MỌI nơi kiểu Mobile vẽ ô rơi: màn chơi, trang mini, Cửa sổ nổi, overlay OBS / Xem trước (đều dùng bàn nút
     kiểu game ở đáy làn; overlay dải ngang tự vẽ 4 vòng chế độ ngay sau hit line), video PiP.
  3. **Lookahead mặc định 6 beat** (Cài đặt cũ 8 → 6); bỏ ô Lookahead khỏi trang Cài đặt (vẫn ở thanh điều khiển
     màn chơi).
  4. **"Đếm vào" + "Đếm ngược" chỉ còn ở Cài đặt → 03 Phát bài** (bỏ khỏi thanh điều khiển màn chơi; Cửa sổ nổi và
     trang mini cũng theo Cài đặt, không có ô riêng). Không đếm hai lần: số to chỉ hiện lúc đếm ngược (ô đứng yên);
     đếm vào (nếu bật) chỉ là đoạn ô rơi dẫn vào 1 ô nhịp (từ v1.0.1 ngắn hơn — mục 2026-10-17), không vẽ số ở bất cứ
     đâu.
  5. **Cài đặt** gọn, không khoảng trống lớn (2 cột cố định); thẻ MIDI ở CUỐI; bỏ thẻ "Phím tắt".
  6. **Âm thanh** là nhóm "Âm thanh" hiện sẵn (không còn giấu trong "Nâng cao"); mặc định vẫn TẮT, bật giai điệu
     vẫn hỏi xác nhận bản quyền, huy hiệu đỏ "Đang phát giai điệu" giữ nguyên.
  7. **Thư viện → "Thêm bài"** theo thứ tự: 01 Tạo bài với AI · 02 Tạo bài từ file MIDI / MusicXML · 03 Nhập file
     ký tự (.harm / .txt / .json) · 04 Tự chơi để tạo bài. "Tạo bài mới thủ công" thành link nhỏ "hoặc tự gõ từ
     đầu" trong trang AI.
  8. **"Tạo bài với AI"** (`#/ai`) thay "Tạo bài mới thủ công": từng bước — sao chép prompt (VI / EN theo ngôn ngữ),
     dán vào ChatGPT / Claude / Gemini kèm ảnh sheet hoặc tên bài (mẹo tìm nguồn), ô lớn "Dán kết quả của AI vào
     đây" tự đổi sang phím `.harm` (tông dễ nhất chọn sẵn), "Lưu" = xong (vào Thư viện), "Mở trong Editor" = bản
     nháp. Câu trả lời nhiều phần (bài dài) dán tiếp vào cuối ô, app ghép theo thứ tự. Người dùng không phải thấy
     do1 / do2 hay tìm công cụ ẩn.
  9. **Editor:** "Nhập cảm âm" ra khỏi Công cụ, thành ô "Dán kết quả của AI vào đây" ngay TRÊN ô `.harm`; dán là
     tự đổi (đổi tông tùy chọn), rồi Lưu. Dán vài dòng nốt không đổi tên / tempo / nhịp của bài.
  10. **iPhone — "Cửa sổ video nổi":** chuẩn bị video trước, xin PiP ngay trong cú chạm (không chờ gì trước); trình
      duyệt vẫn từ chối / không hỗ trợ → câu dễ hiểu "iPhone chưa hỗ trợ cửa sổ video nổi cho trang web này".
  11. **Trang mini:** nút nhỏ "◂" về màn chơi của bài, chỉ hiện lúc đang dừng.
  12. **Hướng dẫn** (`#/guide`) ngắn: bắt đầu nhanh → "Những chỗ hay nhầm" → mục ngắn; phần tham khảo dài (cú pháp
      `.harm` đầy đủ, bảng lỗi, tham số URL overlay, giới hạn, phím tắt…) dời sang `docs/REFERENCE.md`.
  13. **Bài mẫu:** "Quốc ca Việt Nam" (Văn Cao) và "TAKEDISKRUSH!" (N2UtheHartlocker) — người dùng tự tạo trong app —
      thành bài mẫu đứng đầu Thư viện; màn đầu mở "Quốc ca Việt Nam". Hai bài mẫu cũ tạm giữ nhưng **bỏ trước khi
      deploy** (CLAUDE.md → Deploy).
- **2026-10-15 — Góp ý sau khi test local (ghi đè các mục cũ bên dưới nếu mâu thuẫn).**
  - **Bỏ hoàn toàn lời / karaoke** ở mọi nơi: dải lời trong Player, nút "Lời", công cụ "Dán lời và chia chữ", lời
    trong prompt AI và định dạng cảm âm, nhập lời từ MIDI / MusicXML, lời trong donate text, tham số `lyrics` của
    overlay. File `.harm` cũ có `lời:` ở đầu dòng vẫn mở được (phần đó bị bỏ qua), app không ghi ra nữa.
  - **Tên app góc trên trái:** ở trang Player là nút "◂ Thư viện" (như cũ); ở mọi trang khác thành nút quay lại Player
    chính (bài vừa mở; chưa mở bài nào thì bài mẫu).
  - **Màn đầu = Player chính** đang mở bài mẫu (không còn màn demo riêng, không còn ☰ Menu trượt bên phải). Thanh dọc
    bên phải Player, theo thứ tự: nút đổi **Kiểu điều khiển PC / Mobile**, **Cửa sổ nổi** (PC: cửa sổ luôn nằm trên;
    Mobile: trang mini / cửa sổ video), **OBS**, **Chia sẻ**, **Cài đặt**. Bỏ nút "Sửa" khỏi Player. Ngôn ngữ + sáng
    / tối ở góc trên phải như các trang khác. Thanh tiến trình xuống đáy. Cột trái hiện **danh sách phím tắt đầy đủ**.
    Đếm ngược mặc định **3 giây**.
  - **Luyện tập:** PC bỏ phím bàn phím thay chuột (Ctrl / Alt / Shift…) cho Nửa Cung / Ngẩng Lên / Cúi Xuống. Mobile
    chỉ có chạm và giữ trên bàn nút (trên PC = click chuột), không nhận bàn phím.
  - **Thư viện:** "Nhập file" ghi rõ là file ký tự (.harm / .txt / .json); "Tạo bài từ file" ghi rõ MIDI / MusicXML;
    "Bài mới" thành "Tạo bài mới thủ công" và nằm cuối. Gợi ý track / bè melody theo **mật độ nốt so với BPM** (số nốt
    mỗi phút xấp xỉ BPM mới là melody; thưa quá hay dày quá — vd. nhạc cụ đánh hợp âm — đều không phải), không theo
    "nhiều nốt nhất". **Gộp nốt vượt tầm luôn bật** (bỏ công tắc). Ngắt dòng / số ô nhịp mỗi dòng / mỗi section do
    máy tự chọn tối ưu (bỏ các ô chỉnh). Bài vừa tạo mở trong Editor dưới dạng nháp: **chưa sửa gì thì không lưu**
    vào Thư viện.
  - **Cài đặt:** chiều Nửa Cung chốt là **thăng (+1)**, bỏ lựa chọn thăng / giáng. Nhãn phụ trên tile mặc định **ẩn**.
  - **OBS = chỉ hiển thị, theo Player chính.** Kiểu điều khiển, đếm ngược, tự chạy, chạy lại, đếm vào… lấy từ Player
    chính (bỏ khỏi hộp thoại "Tạo link OBS"); hạn chế tối đa chỉnh trùng. Overlay tự khớp đúng chỗ bảng phím game,
    không bắt người dùng kéo / căn tay.
- **2026-10-14 — Deploy trên Vercel, từ máy local, không dùng GitHub.** Bản web chính thức deploy bằng Vercel
  CLI: `npm run deploy` (preview) / `npm run deploy:prod` (chạy `npm run check` trước; cấu hình `vercel.json`,
  base `/`). Không có `pages.yml` / `release.yml`; `ci.yml` chỉ để sẵn nếu sau này có GitHub. Người dùng cuối
  chỉ mở link Vercel (kể cả OBS Browser Source) — **không phải tải/cài gì**; không đăng tải zip / HTML 1 file
  (`npm run build:single` vẫn có cho chủ dự án dùng offline). `npm run release` chỉ tăng version + CHANGELOG +
  tag local. Mọi chỗ "GitHub Pages" / "GitHub Release" bên dưới (mục 7, DoD mục 12, README) hiểu theo thay đổi này.
- **2026-10-13 — Không làm tính năng tự động chơi** (gửi phím/chuột vào game): người dùng đã hủy.
- **2026-10-14 — Kiểu điều khiển Mobile** (không cần overlay). Setting "Kiểu điều khiển: PC / Mobile". Bản mobile
  của game (theo ảnh người dùng gửi, xem `docs/GAME-UI-REFERENCE.md`): 8 nút tròn số giản phổ (chấm trên/dưới theo
  quãng), hàng nút chế độ "Nửa Cung · Ngẩng Lên · Ngẩng Tự Nhiên · Cúi Xuống" là **chạm để chọn (giữ trạng thái)**,
  không phải giữ chuột; Nửa Cung mặc định chạm bật/tắt (chưa xác nhận — có setting "chỉ áp 1 nốt"). Mobile: tile
  hiện số giản phổ có chấm, game bar mô phỏng bố cục mobile, nhắc "CHẠM: …" tại lúc đổi chế độ (rest không làm mất
  chế độ), banner hiện chế độ hiện tại, donate text có thể xuất kiểu mobile, optimizer có cost model mobile
  (chạm đổi chế độ). Người dùng chỉnh được tên gọi 4 nhãn. Định dạng `.harm` không đổi.
- **2026-10-14 — Import mở rộng (Phase 2c).** (a) Wizard MIDI cho **chọn nhiều track rồi gộp** trước khi trích
  melody (giai điệu chia ở nhiều track). (b) **MusicXML** (`.musicxml`, `.xml`, `.mxl` nén) trong cùng wizard
  "Tạo bài từ file": chọn part + voice, nốt/nghỉ/tie/chùm ba chính xác theo `divisions`, lời gắn từng nốt, tempo /
  time signature / rehearsal mark → section; hợp âm lấy nốt cao nhất (theo option như MIDI). Parse hoàn toàn trong
  trình duyệt (DOMParser + giải nén .mxl bằng DecompressionStream), không thêm dependency. Vùng thả file nhận file
  kéo thẳng từ thanh download của trình duyệt. **Không** tải từ URL musescore.com (CORS, không có API công khai,
  điều khoản cấm scraping, spec không backend).
- **2026-10-14 — Âm thanh mặc định TẮT, giấu trong Cài đặt** (tránh streamer vô tình phát giai điệu có bản quyền
  lên stream). Mặc định không có tiếng nào (cả click metronome; đếm vào chỉ bằng hình). Bỏ nút âm thanh / metronome
  khỏi thanh điều khiển Player; mọi tùy chọn âm thanh nằm trong mục "Nâng cao" (thu gọn) cuối Cài đặt. Bật "Phát
  giai điệu mẫu" phải xác nhận qua hộp thoại cảnh báo bản quyền; khi đang bật, Player hiện huy hiệu "Đang phát giai
  điệu". Nút "Nghe giai điệu mẫu" trong practice chỉ hiện khi đã bật; tiếng phản hồi khi bấm mặc định tắt. Settings cũ
  được migrate tắt âm thanh một lần. Overlay luôn im lặng. Ghi đè phần "Audio" mục 5 (vẫn giữ engine + scheduler).
- **2026-10-14 — Ghi rõ định dạng riêng + chia sẻ dễ hơn + prompt AI cho cảm âm (Phase 2c/3).**
  (a) Ở nút "Nhập file" và trong README: ghi rõ `.harm` / `.json` / `.txt` là **định dạng riêng của app này**
  (không phải chuẩn chung), file đúng cú pháp có được bằng nút Xuất của app; file nhạc chuẩn (MIDI, MusicXML) dùng
  "Tạo bài từ file". (b) Thêm nút **"Chia sẻ"** (tạo + copy link `#/s/…`) trên thẻ bài ở Thư viện và trong Player,
  không chỉ trong Editor. (c) Prompt cho AI (`docs/AI-PROMPT-CAM-AM.md`) đưa vào README và có nút **"Sao chép
  prompt cho AI"** trong hộp thoại Nhập cảm âm (mặc định chọn quy ước "Chỉ hậu tố số" khi dùng prompt).
- **2026-10-14 — Màn hình đầu = chơi thử ngay (giữ chân user 30 giây đầu).** Route `#/` là màn demo toàn màn hình:
  bài mẫu đã hiện sẵn ô ở khung hình đầu + MỘT nút ▶ lớn; chạm một lần là ô rơi ngay (không đếm vào, không đếm
  ngược, không âm thanh trừ khi đã bật trong Cài đặt). Không có thư viện / import / editor / settings trên màn đầu —
  tất cả nằm sau một nút Menu (góc màn hình). Thư viện chuyển sang `#/library`. Link chia sẻ `#/s/…`, `#/play/:id`,
  overlay giữ nguyên hành vi mở thẳng.
- **2026-10-14 — "Tự chơi để tạo bài" (Phase 3b).** Menu → màn thu riêng: chọn BPM / nhịp / lưới; đếm vào 1 ô nhịp
  bằng hình; người dùng bấm như trong game — PC: phím `Z X C V B N M ,` + giữ chuột trái/phải/nút cuộn (hoặc phím thay
  thế Ctrl/Alt/Shift); Mobile scheme: 8 nút số + 4 nút chế độ trên màn hình (chạm chọn chế độ, Nửa Cung theo setting)
  — ô hiện ngay khi bấm (piano-roll trực tiếp); ghi thời điểm từng nốt, quantize theo lưới, đơn âm (nốt mới cắt nốt
  cũ); (key, octave, sharp) lấy thẳng từ phím + modifier nên không cần optimizer (vẫn có "Tối ưu tông" sau); Thu lại /
  Hoàn tác; kết quả mở trong Editor (thêm lời bằng "Dán lời và chia chữ"). Âm thanh vẫn mặc định tắt; có toggle "tiếng
  phản hồi khi bấm" riêng cho màn thu, kèm nhắc không bật khi stream.
- **2026-10-15 — Mobile: bố cục giống màn chơi kèn + luyện cảm ứng + trang mini (Phase 4m).** Theo nghiên cứu
  `docs/RESEARCH-MOBILE-FLOATING.md` (bản mobile = 8 nút nốt + 4 nút chế độ, chạm chế độ TRƯỚC rồi chạm nốt).
  (a) Khi Kiểu điều khiển = Mobile, màn chơi (Player, màn đầu demo) dùng **bố cục giống màn chơi kèn trên điện thoại**
  (ảnh tham chiếu trong `docs/GAME-UI-REFERENCE.md`): hàng 8 nút tròn lớn số giản phổ trải hết chiều ngang ở đáy, hàng 4
  nút chế độ tròn nhỏ (Nửa Cung · Ngẩng Lên · Ngẩng Tự Nhiên · Cúi Xuống) phía trên ở giữa, nút đang chọn sáng như
  game; ô rơi thẳng xuống đúng tâm từng nút tròn; ưu tiên màn ngang (gợi ý xoay ngang trên điện thoại dọc). PC giữ
  nguyên. (b) **Luyện tập cảm ứng (C):** trong chế độ Mobile, bật Luyện tập thì 8 + 4 nút bấm được bằng chạm/chuột y
  như game (chạm chế độ giữ trạng thái, Nửa Cung theo setting, đa chạm), chấm Perfect / Good / Miss, combo, hiệu ứng
  khi trúng, rung nhẹ khi chạm (Android, tắt được); chặn cuộn/zoom/menu nhấn giữ. (c) **Trang mini cho cửa sổ nổi
  Android (D, nhãn "Thử nghiệm"):** route gọn chỉ có làn + bố cục nút mobile thu nhỏ, đọc được ở ~300×300 dp, đếm ngược
  rồi tự chạy, giữ màn hình sáng (Wake Lock), hướng dẫn mở cửa sổ nổi theo hãng (Samsung, Xiaomi/HyperOS,
  Huawei/Honor, OPPO/realme/OnePlus; vivo/iPhone → dùng màn phụ) + lưu ý tắt con quay hồi chuyển, không mở qua Game
  Booster/Gaming Hub; kèm **thử nghiệm cửa sổ video nổi (Picture-in-Picture)**: ô rơi phát dưới dạng video trong khung
  PiP luôn nằm trên (canvas stream trực tiếp và/hoặc video dựng sẵn để vẫn chạy khi Chrome xuống nền). Không âm thanh.
- **2026-10-14 — "Cửa sổ nổi" cho người chơi 1 màn hình** (không bắt tải gì). Dùng Document Picture-in-Picture
  (Chrome/Edge 116+, Firefox 151+; không có thì nút giải thích 1 dòng): cửa sổ nhỏ LUÔN NẰM TRÊN mọi cửa sổ, chỉ chứa
  8 làn + hit line (bố cục "khớp bảng phím game": mép dưới đặt sát mép trên bảng phím game, giãn cho 8 cột thẳng 8
  phím), banner giữ/chế độ nhỏ, nút ▶/❚❚, chơi lại, đếm ngược trước khi chạy (để kịp click vào game), chế độ "Căn
  chỉnh" hiện 8 vạch dẫn Z…, + mép dưới. Kích thước gợi ý 1080p 576×600 / 1440p 768×800, nhớ kích thước lần trước.
  Vòng render chạy bằng requestAnimationFrame của CHÍNH cửa sổ nổi (tab gốc có thể bị ẩn sau game). Cửa sổ đục
  (trình duyệt không cho cửa sổ trong suốt), có thanh tiêu đề, trang không tự đặt vị trí; game phải Borderless/Windowed.
  Mở từ nút "Cửa sổ nổi" ở Player và mục Menu. Không can thiệp vào game. Bản trong suốt thật = Tauri (tùy chọn, sau).
- **2026-10-14 — Giao diện "vibe Delta Force"** (tactical HUD): theo `docs/DESIGN.md` — lấy cảm giác, không sao chép
  tài sản của game; có dòng fan-made trong Menu và README.
- **2026-10-14 — KHÔNG có gallery / community catalog.** Site không liệt kê, lưu, hay gợi ý link chia sẻ / bài của
  người khác; không trang "bài phổ biến", không danh sách công khai. Chia sẻ chỉ là người dùng tự tạo link và tự gửi
  cho nhau. Thư viện chỉ chứa bài mẫu đóng gói sẵn + bài trong localStorage của chính người dùng.

Bạn là senior full-stack engineer. Build web app "Delta Force Harmonica Tiles": hiển thị guide thổi harmonica trong game Delta Force theo kiểu Piano Tiles / Synthesia - các ô phím rơi xuống theo nhịp, người chơi nhìn màn hình app và bấm phím thật trong game. Làm end-to-end: code, test, docs, CI, phát hành dạng static (GitHub Pages + PWA + single-file HTML), không có backend. Làm tuần tự theo phase, tự chạy kiểm tra, commit sau mỗi phase, chỉ hỏi khi thật sự bị block.

## 1. Domain: harmonica trong Delta Force

- 8 phím nốt: Z X C V B N M , tương ứng 1 2 3 4 5 6 7 1̇ (Đồ Rê Mi Fa Sol La Si Đố). Dấu phẩy là phím thật.
- 3 modifier dạng giữ (hold) bằng chuột rồi bấm phím nốt:
  - [chuột trái] = "Cúi Xuống" = hạ 1 quãng tám
  - [chuột phải] = "Ngẩng Lên" = lên 1 quãng tám
  - [scroll] (bấm nút cuộn, mouse button 1) = "Nửa Cung" = thăng nửa cung. Mặc định +1 semitone, phải có setting đổi thành -1 vì chiều này chưa xác nhận.
- Trái và phải không giữ cùng lúc. Scroll có thể kết hợp với trái hoặc phải.
- Nhạc cụ đơn âm, mỗi lúc 1 nốt. Âm thanh trong app: Z = C4 (setting đổi base octave), trái -12, phải +12, scroll ±1.
- User: streamer và người xem. Guide hiện đang gửi qua donate text theo format mục 3; app phải import/export đúng format đó.

## 2. Ràng buộc kiến trúc (non-server)

- Vite + React 18 + TypeScript strict. State: zustand. Routing: hash-based (HashRouter) để chạy được trên GitHub Pages và file://.
- Khu tiles render bằng Canvas 2D (requestAnimationFrame, devicePixelRatio aware, giữ 60fps với bài 500+ nốt). UI chrome bằng React + CSS (Tailwind ok).
- Không backend, không API, không CDN, không font qua network, không analytics. Mọi asset bundle trong dist. Chạy offline hoàn toàn (PWA).
- Dữ liệu: seed songs bundle trong code; bài user thêm lưu localStorage (schema có version + migrate). Chia sẻ bài bằng URL hash nén lz-string, không server.
- Deps tối thiểu: react, react-dom, zustand, lz-string, vite-plugin-pwa, vite-plugin-singlefile, vitest, @testing-library/react, eslint, prettier, playwright (smoke e2e, skip nếu không cài được browser), @tonejs/midi (chỉ khi làm MIDI import ở Phase 2), pngjs (chỉ để generate icon). Không native deps.
- UI tiếng Việt mặc định, string gom trong 1 file i18n, có toggle EN.
- Node 20+, npm. Scripts: dev, build, build:single, preview, test, lint, typecheck, format, check (= lint + typecheck + test + build), release.

## 3. Format file bài hát `.harm` (plain text, UTF-8)

Dòng:
- Bắt đầu bằng `@` = directive: `@title`, `@artist`, `@bpm` (số, mặc định 90), `@time` (mặc định 4/4, chỉ dùng vẽ vạch nhịp), `@scroll` (+1 | -1), `@repeat <tên section>` (chèn lại toàn bộ dòng nốt của section đã định nghĩa trước đó, dùng được nhiều lần).
- Bắt đầu bằng `#` = tên section, ví dụ `# ĐIỆP KHÚC`. Chưa có section thì mặc định "Main".
- Bắt đầu bằng `//` = comment. Dòng trống bỏ qua.
- Dòng nốt: `lyric: tokens` hoặc chỉ `tokens`. Tách lyric tại `: ` đầu tiên. Lyric tách syllable theo khoảng trắng để highlight karaoke; nếu số syllable khác số đơn vị nốt (rest không tính, cặp luyến tính 1) thì vẫn parse ok, chỉ tắt highlight từng chữ cho dòng đó.

Tokens, cách nhau bởi khoảng trắng:
- Nốt: KEY với KEY thuộc {Z, X, C, V, B, N, M, ,}. Đọc không phân biệt hoa thường, ghi ra chữ hoa.
- Độ dài: `KEY*dur`, dur là số beat dương (0.25, .5, 1, 1.5, 2, 4...). Mặc định 1.
- Nghỉ: `_` hoặc `_*dur`.
- Luyến: `KEY-KEY` (được 3 nốt `KEY-KEY-KEY`) = 1 chữ, tổng độ dài = dur ghi sau cặp (mặc định 1), chia đều. Ví dụ `X-C`, `X-C*2`.
- Modifier dạng hold: `[giữ chuột trái]` `[thả chuột trái]` `[giữ chuột phải]` `[thả chuột phải]` `[giữ scroll]` `[thả scroll]`. Viết tắt chấp nhận: `[L]` `[/L]` `[R]` `[/R]` `[S]` `[/S]`. Có thể đứng riêng 1 dòng. Trạng thái hold là tuyến tính trên chuỗi đã expand @repeat, kéo dài qua nhiều dòng tới khi thả; hết bài tự thả.
- Modifier dạng prefix cho 1 nốt: `L:KEY`, `R:KEY`, `S:KEY`, `LS:KEY`, `RS:KEY`, dùng cho nốt lẻ hoặc trong cặp luyến, ví dụ `Z-L:N`. Prefix cộng dồn với hold đang giữ; L và R xung đột là lỗi.

Lỗi parse (báo số dòng + cột, không crash): thả khi chưa giữ, giữ trái khi đang giữ phải và ngược lại, giữ lặp, token lạ, dur <= 0, @repeat section không tồn tại. Hold mở qua nhiều dòng mà chưa thả tới hết bài: warning, không lỗi.

Serialize (model ra text): luôn dạng hold/release với nhãn đầy đủ tiếng Việt, gom các nốt liên tiếp cùng modifier thành 1 cặp giữ/thả, nốt lẻ cũng thành `[giữ chuột trái] N [thả chuột trái]`; dur = 1 thì bỏ `*1`; option bỏ lyric, bỏ dur, bỏ section header. `parse(serialize(song))` phải ra model giống hệt (round-trip test).

Model nội bộ: `Song { id, title, artist?, bpm, timeSig, scrollDir, sections[] }`, `Section { name, lines[] }`, `Line { lyric?, units[] }`, `Unit = Note | Rest | Slur`, `Note { key, octave: -1|0|1, sharp: boolean, beats }`, `Slur { notes[] }`. Từ model tính Timeline: mỗi note có startBeat, endBeat, midi, modifiers; hold runs = các dải liên tiếp có cùng (octave, sharp) khác (0, false), có startBeat/endBeat để vẽ ribbon.

## 4. Phase 0: scaffold

Khởi tạo repo, Vite + React + TS strict, ESLint + Prettier, Vitest, cấu trúc `src/{core,audio,player,editor,library,overlay,ui,i18n}`, `CLAUDE.md` (commands, cấu trúc, conventions, cách thêm bài), `docs/DECISIONS.md`, `CHANGELOG.md`. `npm run check` xanh với 1 test placeholder.

## 5. Phase 1: MVP Player

Core:
- Parser + serializer theo mục 3, tests đầy đủ. Timeline builder.
- Library: seed 2 bài ở mục 10, bài user trong localStorage. Danh sách, search, mở, nhân bản, xóa (chỉ user songs), import file .harm/.json, export.

Màn hình Player (route `/#/play/:id`):
- Layout dọc: header (tên bài, bpm, section hiện tại, progress bar), khu canvas 8 lane theo thứ tự Z X C V B N M ,, dưới cùng là "game bar" mô phỏng UI gợi ý phím của game: hàng số `1 2 3 4 5 6 7 1̇`, hàng phím `Z X C V B N M ,`, hàng modifier `Cúi Xuống [chuột trái] | Nửa Cung [scroll] | Ngẩng Lên [chuột phải]`. Phím và modifier đang cần bấm sáng lên khi tile tới hit line.
- Canvas: tiles rơi từ trên xuống, hit line ở ~82% chiều cao, tile cao = beats × pxPerBeat (min 28px), nhãn phím to (>= 28px), nhãn phụ nhỏ (solfège hoặc số, bật/tắt). Màu: thường xám trắng, chuột trái xanh dương, chuột phải cam, scroll xanh lá; kết hợp thì nền theo trái/phải + badge `#`. Rest không vẽ tile. Vạch nhịp mờ theo @time, nhãn section ở biên trái khi section bắt đầu.
- Hold ribbon: mỗi hold run vẽ 1 dải dọc ở gutter phải (rộng ~56px) từ top nốt đầu tới bottom nốt cuối, màu theo modifier, chữ `GIỮ CHUỘT PHẢI` ở đầu dải, `THẢ` ở cuối. Khi run đang cắt qua hit line, hiện banner lớn phía trên game bar: `ĐANG GIỮ: CHUỘT PHẢI`. Ribbon chạy cùng tiles.
- Lyrics karaoke: dòng hiện tại (chữ đang hát highlight) + dòng kế, bật/tắt.
- Transport: Play/Pause (Space), Restart (R), seek theo dòng (← →), nhảy section (dropdown), loop A-B theo dòng (L), count-in 1 bar có metronome, BPM override (slider 40-200, phím [ ] bước 2), lookahead = số beat hiện trên màn (4-12), tốc độ cuộn suy từ bpm + lookahead.
- Clock: audio bật thì dùng AudioContext.currentTime làm master clock, tắt thì performance.now. Pause/resume giữ offset chính xác, seek không lệch.
- Audio (Web Audio, lookahead scheduler tick 25ms / schedule trước 100ms): timbre "harmonica" tổng hợp (2 osc sawtooth detune ±6 cent, lowpass 2.2kHz, vibrato 5Hz nhẹ, ADSR 10/80/0.7/120ms), option sine. Metronome click bằng noise burst. Volume riêng cho nhạc và click. AudioContext chỉ tạo sau user gesture; bị block thì vẫn chạy visual.
- Settings (persist localStorage, có nút reset): theme dark/light, tile scale, hiện solfège/số, lyrics, âm thanh, timbre, base octave, scroll direction, ngôn ngữ.
- Phím tắt app không được đụng Z X C V B N M , (dành cho practice mode).
- Responsive 1080p và 1440p; mobile dọc chỉ cần xem được.

## 6. Phase 2: Editor, import/export, practice, timing, optimizer

- Editor (route `/#/edit/:id`): split view. Trái: textarea .harm monospace có số dòng. Phải: preview parse (list dòng, lỗi/warning theo dòng, tổng nốt, tổng beat, số lần giữ chuột, số nốt scroll). Debounce parse 150ms. Nút: Play từ dòng con trỏ, Lưu, Export .harm/.json, Share link (`#/s/<lz-string>` mở thẳng bài), Copy donate text.
- Donate text modal: option có/không lyric, có/không dur, có/không section header; chia nhỏ theo giới hạn ký tự N (mặc định 200) tại ranh giới dòng, đánh số `1/5 ...`; copy từng phần hoặc tất cả.
- Tap timing: chọn section hoặc cả bài, bấm "Tap mode": nốt hiện lần lượt, user bấm Space đúng nhịp theo bài gốc mở ở chỗ khác; app ghi khoảng cách giữa các tap, quy đổi theo bpm, quantize về bội 0.25 beat (bật/tắt), nốt cuối lấy dur mặc định; ghi dur vào text, có undo.
- Practice mode trong Player: bật thì lắng nghe phím thật KeyZ KeyX KeyC KeyV KeyB KeyN KeyM Comma + mouse button 0/1/2 qua pointerdown/pointerup; chặn contextmenu, auxclick và autoscroll chuột giữa; phím thay thế cho modifier cấu hình được (mặc định Ctrl = trái, Alt = phải, Shift = scroll). Hai chế độ: "chờ" (dừng ở mỗi tile tới khi bấm đúng phím + modifier) và "chấm điểm" (chạy theo nhịp, ±100ms perfect, ±220ms good, còn lại miss; combo, % cuối bài). Ghi rõ trong UI: practice chỉ nhận input khi tab app đang focus.
- Transpose optimizer: input melody cao độ tuyệt đối (midi). Thử 12 shift × các octave placement; ràng buộc mọi nốt nằm trong C3..C6 (trái / thường / phải). Cost = 10 × số nốt scroll + 4 × số hold run + 1 × số nốt có modifier; hòa thì ưu tiên shift 0, rồi shift nhỏ nhất. Trả top 3 kèm thống kê, user chọn 1, sinh .harm.
- Cảm âm importer: parse Do Re Mi Fa Sol La Si (chấp nhận Đô Rê Mi..., Sib, Fa#...), convention preset: chữ thường = quãng 1, viết hoa = quãng 2, hậu tố 3 (Do3, Re3) = quãng 3; token dính như `Dola`, `solfa` tách thành luyến. Preview rồi chạy optimizer.
- MIDI import (tùy chọn): @tonejs/midi, chọn track, khi chồng lấy nốt cao nhất, quantize 0.25 beat, chạy optimizer.

## 6b. Phase 2b: MIDI

### A. Khởi tạo bài từ file MIDI (Library → "Tạo bài từ MIDI")

Flow 5 bước, tất cả chạy trong browser, không server:

1. Chọn file: file picker + drag-drop `.mid/.midi`, giới hạn 2MB, parse bằng @tonejs/midi. File lỗi thì báo rõ, không crash. Hỗ trợ MIDI type 0 và 1.
2. Chọn track: bảng các track có nốt (ẩn track rỗng và kênh 10 drum), mỗi dòng: tên, instrument, số nốt, tầm cao độ, % monophonic. Auto gợi ý track melody theo heuristic: nhiều nốt, >= 90% monophonic, cao độ trung bình cao nhất trong nhóm đó. Mỗi track có nút nghe thử (synth) và mini piano-roll.
3. Trích melody: khi nốt chồng nhau giữ nốt cao nhất (option: thấp nhất / dài nhất), cắt độ dài tới nốt kế, gộp tie, bỏ nốt < 1/32 beat. Độ dài tính bằng beat từ tick (PPQ), nên tempo change trong file không ảnh hưởng dur; bpm playback lấy tempo đầu tiên, cho sửa. @time lấy từ time signature event đầu tiên. Quantize start/dur về grid (mặc định 1/4 beat; option 1/8, 1/3 cho triplet, tắt); khoảng trống >= grid thành rest.
4. Chọn cung và quãng: chạy transpose optimizer (mục 6) trên melody midi, hiện top 3 (số nốt scroll, số hold run, số nốt có modifier). Mặc định chọn tối ưu, có nút "giữ cung gốc". Nốt vẫn vượt tầm C3..C6 sau khi đặt: option gập về quãng gần nhất, đánh dấu warning trong editor.
5. Chia dòng và section: ngắt dòng tại rest >= 1 beat hoặc mỗi 2 bar (cấu hình). Section lấy từ marker meta event nếu có, không thì mỗi 8 bar một section "Phần N". Lyric lấy từ lyric/text meta event gắn theo nốt nếu có, không thì để trống. Kết quả mở trong Editor dưới dạng .harm, prefill @title từ tên file, @bpm, @time; user sửa rồi lưu.

Tests: fixture MIDI tự sinh trong test (monophonic đơn giản, hợp âm chồng, triplet, tempo change giữa bài, có lyric event, có marker), kiểm tra .harm đầu ra từng case.

### B. Live MIDI input (Web MIDI API)

- Không thêm dep, dùng `navigator.requestMIDIAccess` trực tiếp. Feature-detect: Chromium và Firefox 108+ có, Safari không; không có thì ẩn mục MIDI và giải thích 1 dòng. Chỉ xin quyền khi user bật MIDI trong Settings (lazy), không xin lúc load app.
- Thiết bị: danh sách input, hot-plug qua `statechange`, chọn thiết bị, nhớ lựa chọn trong localStorage, hiện trạng thái kết nối + đèn nháy khi nhận note.
- Mapping cao độ: midi note → (key, octave, sharp) theo base octave (Z = C4 mặc định) cộng offset transposition cấu hình được (bán cung và quãng tám) để keyboard thật khớp tầm harmonica. Nốt ngoài tầm C3..C6 bỏ qua và báo nhẹ.
- Dùng 1: Practice mode nhận MIDI note on/off thay cho bàn phím + chuột. So khớp theo midi pitch tuyệt đối (option nới: chỉ cần đúng pitch class). Dùng timestamp của MIDI event để chấm điểm, không dùng thời điểm xử lý. Velocity 0 coi như note off.
- Dùng 2: "Thu melody" để tạo bài: count-in 1 bar metronome, thu note on/off kèm timestamp, quantize theo bpm và grid đã chọn, nốt chồng xử lý như mục A bước 3, sinh .harm mở trong Editor, chạy optimizer được luôn. Có nút thu lại, undo.
- Tiếng phản hồi khi bấm: option bật tắt (synth của app), mặc định tắt để tránh trễ.
- Lyric chưa có thì để trống; Editor có công cụ "Dán lời và chia chữ": dán lyric, app phân phối syllable lần lượt vào các nốt theo dòng, cho chỉnh tay.

Thêm vào mục 9: test mapping midi → key/modifier với offset, test quantize record. Thêm vào DoD: file MIDI monophonic bất kỳ tạo được bài chơi ngay sau 5 bước; keyboard MIDI cắm vào chơi được practice mode trên Chrome.

## 7. Phase 3: Overlay/OBS, PWA, CI/CD, release

- Overlay (route `/#/overlay/:id` hoặc `?overlay=1`): ẩn toàn bộ chrome, body nền trong suốt (option nền chroma #00FF00), scale lớn (`?scale=1.4`), option lane ngang (`?lanes=horizontal`: tiles chạy phải sang trái, hit line bên trái, hợp dải dưới màn hình). Params: `song`, `bpm`, `autoplay=1`, `countin=1`, `loop=1`, `lookahead`, `lyrics=0|1`. Overlay mặc định tắt audio (OBS Browser Source không có user gesture), chỉ visual. README hướng dẫn thêm Browser Source, kích thước đề xuất, dùng hotkey "Refresh browser source" của OBS để chạy lại.
- PWA: vite-plugin-pwa, manifest, icon SVG + PNG 192/512 generate bằng script pngjs, precache toàn bộ dist, offline hoàn toàn, có prompt cập nhật.
- `vite.config.ts`: `base` lấy từ env `VITE_BASE`, mặc định `/`.
- `.github/workflows/ci.yml`: push/PR → npm ci → `npm run check`.
- `.github/workflows/pages.yml`: push main → build với `VITE_BASE=/<repo>/` → deploy GitHub Pages (configure-pages, upload-pages-artifact, deploy-pages).
- `.github/workflows/release.yml`: tag `v*` → build dist với base `./` (chạy ở mọi static host) + `build:single` (vite-plugin-singlefile inline hết JS/CSS thành 1 index.html, mở được bằng file://, tắt PWA plugin ở build này) → zip dist → GitHub Release đính kèm `harmonica-tiles-vX.Y.Z.zip` và `harmonica-tiles-vX.Y.Z.html`, body lấy từ CHANGELOG.
- Script `release`: `npm version <patch|minor|major>` + push tag.
- Docs: README.md tiếng Việt đủ cho streamer không biết code (giới thiệu, link demo Pages, cách dùng, format .harm đầy đủ, OBS setup, phím tắt, cách thêm bài và share link, build/release, giới hạn đã biết: practice mode cần focus tab, chiều Nửa Cung chưa xác nhận). Cập nhật CLAUDE.md, DECISIONS.md, CHANGELOG.md.

## 8. Phase 4 (tùy chọn): Tauri desktop overlay

Chỉ làm nếu có Rust toolchain; nếu không thì viết `docs/TAURI.md` hướng dẫn và để sẵn cấu hình. Tauri v2 wrap cùng dist: cửa sổ always-on-top, transparent, decorations off, toggle click-through, global shortcut (tauri-plugin-global-shortcut) mặc định Ctrl+Alt+P play/pause, Ctrl+Alt+R restart, Ctrl+Alt+→ dòng kế, để điều khiển khi đang trong game. Workflow riêng build .exe/.msi khi tag (tauri-action).

## 9. Chất lượng

- Vitest: parser (mọi token, mọi lỗi, @repeat, hold qua dòng, prefix, round-trip), timeline (startBeat, hold runs, midi với modifier, scrollDir), optimizer (test case một bài dài — nay là fixture `src/test/fixtures/bai-thu-nhip-dieu.harm`: pitch set không có Fa nên chỉ shift 0 và 5 không cần scroll; kết quả tối ưu là shift 0, mỗi đoạn hold ngắn, điệp khúc 1 hold dài), donate export chunking, cảm âm parser, localStorage migrate. (+ Phase 2b: mapping midi → key/modifier với offset, quantize record.)
- Playwright smoke nếu cài được browser: mở app, mở 2 bài seed, play 3 giây không lỗi console, overlay route render nền trong suốt.
- Lint + typecheck zero warning. Bundle < 400KB gzip. Không leak khi play/pause/seek lặp (cleanup rAF, audio nodes, listeners).
- A11y cơ bản: focus ring, aria-label cho control, contrast đạt AA.

## 10. Seed data

Bài mẫu lưu ở `src/library/seeds/<slug>.harm`, bundle qua `?raw` import (CLAUDE.md → "Thêm bài seed"). Hai bài mẫu của spec gốc đã bỏ trước khi deploy; app có hai bài mẫu "Quốc ca Việt Nam" và "TAKEDISKRUSH!" (mục 2026-10-16 ở đầu file), test dùng hai bài tự soạn ở `src/test/fixtures/` (DECISIONS D-443).

## 11. Cách làm việc

- Khởi tạo git, commit theo conventional commits sau mỗi phase, ghi CHANGELOG ngắn.
- `npm run check` phải xanh trước khi sang phase sau.
- Gặp quyết định thiết kế không có trong spec: chọn phương án đơn giản nhất, ghi vào DECISIONS.md, đi tiếp. Chỉ hỏi khi bị block thật (ví dụ không cài được deps).
- Cuối mỗi phase: in tóm tắt đã làm gì, cách chạy thử, còn thiếu gì.

## 12. Definition of done

- `npm run check` xanh. `npm run dev` mở được 2 bài seed, play đúng nhịp, hold ribbon, banner và game bar đúng spec.
- Paste donate text của Seed 2 vào editor ra đúng model; export lại ra text đúng format mục 3.
- Overlay route chạy trong OBS Browser Source với nền trong suốt.
- GitHub Pages deploy thành công từ workflow. Tag `v0.1.0` tạo Release có zip + single-file HTML; file HTML mở từ file:// chạy được.
- README đủ để một streamer không biết code dùng được.
- (Phase 2b) File MIDI monophonic bất kỳ tạo được bài chơi ngay sau 5 bước; keyboard MIDI cắm vào chơi được practice mode trên Chrome.
