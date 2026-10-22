# Design decisions

Các quyết định không có (hoặc mơ hồ) trong spec. Nguyên tắc: chọn phương án đơn giản nhất, ghi lại, đi tiếp.

## Tooling

- **D-001 — CSS thuần thay Tailwind.** Spec cho phép Tailwind nhưng ưu tiên deps tối thiểu; theme bằng CSS
  custom properties trong `src/ui/app.css` (dark/light).
- **D-002 — Router hash tự viết thay `react-router`.** Danh sách deps tối thiểu không có react-router;
  `src/ui/router.ts` (~100 dòng, `useSyncExternalStore`) đủ cho các route và chạy trên mọi static host (Vercel) / file://.
- **D-003 — Phiên bản.** React 18.3 (theo spec), Vite 8, Vitest 5, ESLint 10 (flat config),
  TypeScript 5.9 (typescript-eslint chưa hỗ trợ TS ≥ 6.1 / TS 7). Node ≥ 20.19 (yêu cầu của Vite 8).
- **D-004 — ESLint chỉ bật 2 rule cổ điển của react-hooks** (`rules-of-hooks`, `exhaustive-deps`), không bật
  preset React Compiler (quá chặt cho code canvas/rAF dùng ref).
- **D-005 — Playwright dùng Microsoft Edge có sẵn** (`channel: 'msedge'`) khi chạy local để khỏi tải browser;
  `test:e2e` không nằm trong `check` (spec: check = lint + typecheck + test + build).
- **D-006 — Smoke e2e chạy trên bản build** (`vite preview --port 4173`); `PW_CHANNEL` đổi browser (CI dùng
  `chromium`). Tới Phase 3 (icon PWA), favicon là SVG data-URI inline trong `index.html` để trình duyệt không
  request `/favicon.ico` (404 = lỗi console, smoke yêu cầu console sạch). _Phase 3: thay bằng link tới
  `/icons/*` (D-224) — vẫn không có request `/favicon.ico`._
- **D-007 — Deploy: Vercel từ máy local, không GitHub** (yêu cầu người dùng 2026-10-14, xem đầu `docs/SPEC.md`).
  `npm run deploy` (preview) / `npm run deploy:prod` = `scripts/deploy.mjs`: chạy `npm run check` rồi
  `npx vercel@64.0.2 deploy` (Vercel build lại từ source theo `vercel.json`: preset Vite, `npm run build`, `dist`,
  base `/`; cache dài cho `/assets/*`, luôn revalidate `sw.js` / `manifest.webmanifest` — Phase 3 bỏ dòng
  `registerSW.js` vì file này không còn được sinh, D-216).
  `.vercelignore` loại build cũ, node_modules, file local. Không có `pages.yml` / `release.yml`; `ci.yml` để sẵn
  cho trường hợp sau này có GitHub (nay chạy thật trên kho mã nguồn công khai — D-445; deploy vẫn từ máy). Người dùng cuối chỉ mở link (kể cả OBS) — không đăng tải zip / HTML 1 file;
  `npm run build:single` vẫn giữ cho chủ dự án. `npm run release` = tăng version + chuyển mục `[Unreleased]` của
  CHANGELOG thành version + tag local (push nếu có remote). Hash router nên Vercel không cần rewrite.

## Định dạng `.harm`

- **D-010 — `@repeat` expand lúc parse.** Các dòng token của section nguồn (kể cả dòng chỉ có modifier) được
  parse lại tại vị trí `@repeat` với trạng thái hold hiện tại (đúng ngữ nghĩa "hold tuyến tính trên chuỗi đã
  expand"). Model không giữ tham chiếu repeat; serialize xuất các dòng đã expand. Bài người dùng được lưu
  dưới dạng **văn bản nguồn** nên `@repeat` và comment không mất khi sửa.
- **D-011 — Lỗi trong dòng được repeat.** Lỗi token (token lạ, dur sai) chỉ báo một lần ở dòng gốc; lỗi trạng
  thái hold phát sinh do ngữ cảnh mới báo tại dòng `@repeat` (kèm số dòng gốc).
- **D-012 — `@repeat` chỉ tới section đã bắt đầu phía trên** (kể cả section hiện tại với các dòng tới thời điểm
  đó). Không tìm thấy → lỗi `unknown-repeat`. So tên section: khớp chính xác trước; không có thì so khóa chuẩn
  hóa (NFC, chữ thường, gộp mọi khoảng trắng kể cả NBSP và tab thành một dấu cách, trim). Nhiều section trùng
  khóa thì lấy section bắt đầu gần nhất.
- **D-013 — Dòng không có đơn vị nốt nào không vào model** (vd. dòng chỉ có `[giữ chuột phải]`). Nếu dòng đó có
  lời → warning `lyric-without-notes`. Section rỗng (vd. `# RAP` chỉ có comment) vẫn giữ trong model.
- **D-014 — Luyến trong model** là `Slur { notes }` với các nốt có `beats` bằng nhau; tổng = n × beats.
- **D-015 — Độ dài dạng phân số `a/b`** (vd. `X*1/3`) được chấp nhận để biểu diễn chùm ba (MIDI import grid
  1/3). Serializer ghi số thập phân hữu hạn (`0.5`, `0.25`, `0.125`) và ghi phân số cho giá trị như 1/3, 2/3.
- **D-016 — Đọc khoan dung.** KEY, prefix (`l:n`, `SL:`/`SR:` tương đương `LS:`/`RS:`), viết tắt (`[l]`) và nhãn
  đầy đủ (`[Giữ Chuột Trái]`, cả khi mất dấu: `[giu chuot trai]`) không phân biệt hoa thường. Dòng CRLF được
  chấp nhận. Ghi ra luôn chuẩn: chữ hoa, nhãn tiếng Việt có dấu.
- **D-017 — Diagnostic dùng `code` + `params`**, thông điệp do i18n (`diag.<code>`) render; core không phụ thuộc UI.
- **D-018 — `//! text`** là comment đặc biệt sinh warning `annotation` (dùng để đánh dấu nốt bị gập quãng khi
  import MIDI, hiện trong editor).
- **D-019 — Lyric mismatch là `info`**, không phải warning: parse vẫn ok, chỉ tắt highlight từng chữ. _Góp ý 2026-10-15: thay / sửa bởi D-311._

## Parser (chi tiết)

- **D-040 — Prefix xung đột.** `LR:`/`RL:` → lỗi `prefix-conflict` nhưng nốt vẫn giữ (bỏ L/R, S vẫn áp); là lỗi
  token nên không báo lại khi replay `@repeat`. Prefix ngược với hold đang giữ: báo một lần mỗi token (kể cả
  trong luyến), hold thắng.
- **D-041 — Vị trí diagnostic.** `lyric-mismatch` / `lyric-without-notes` trỏ cột đầu của lyric (độ dài = lyric).
  `invalid-directive-value` / `unknown-repeat` gạch chân giá trị (trống → cả directive). Hold mở và lỗi trạng
  thái phát sinh khi replay `@repeat` báo tại dòng `@repeat`, cột 1, kèm `params.fromLine` (dòng gốc); UI
  hiển thị qua `diag.fromRepeat` với `{ line: fromLine }`.
- **D-042 — Giới hạn `@repeat`.** `Main` chỉ là đích `@repeat` khi đã có ít nhất một dòng. Mỗi lần parse chèn
  tối đa `MAX_REPEAT_CHARS` (100 000) ký tự nguồn (mỗi dòng replay tốn độ dài dòng + 1). Ngân sách đo theo ký
  tự, không theo dòng, để chặn đúng khối lượng việc: một dòng rất rộng nhân đôi bằng repeat lồng nhau vẫn bị
  chặn, và phần mở rộng không bao giờ tốn hơn một file 100 KB viết thẳng. Khi dòng replay đầu tiên không vừa
  ngân sách thì dừng chèn tại đó và bỏ mọi `@repeat` sau đó (kể cả repeat nhỏ); báo warning `repeat-limit` một
  lần tại dòng `@repeat` ấy, gạch chân tên section, params `{ name, limit }`. Section được tra bằng bảng băm
  (tên chính xác, rồi khóa chuẩn hóa — D-012), nên nhiều header cộng nhiều `@repeat` vẫn chạy tuyến tính.
- **D-043 — Dạng chuẩn khi ghi model ngoài** (`canonicalSong`, src/core/serializer.ts). `serializeHarm(song)` ghi
  `canonicalSong(song)`. Với mọi `Song` đúng kiểu, `parseHarm(serializeHarm(song)).song` deep-equal
  `canonicalSong(song)`, không có diagnostic lỗi hay cảnh báo, không mất nốt. Với model do parser đọc ra thì
  `canonicalSong` không đổi gì (đây là round-trip của spec mục 3). CR lẻ là xuống dòng: D-148. Quy tắc chuẩn
  hóa:
  - Lời: `:` theo sau khoảng trắng được chèn U+2060 WORD JOINER ngay sau; lời bắt đầu bằng `@`, `#`, `//` được
    chèn U+2060 phía trước. Ký tự này vô hình và không phải `\s`, nên số chữ karaoke không đổi.
  - Text (title, artist, tên section, lời): xuống dòng thành dấu cách, rồi trim. Lời hoặc artist rỗng thì bỏ;
    tên section rỗng thành `Main`.
  - Luyến 1 nốt thành nốt; luyến rỗng bị bỏ; luyến có nốt dài khác nhau thì giữ tổng và chia đều (khớp D-068).
  - Dòng không có đơn vị nào bị bỏ cùng lời của nó (D-013).
  - `@time` ngoài miền parser chấp nhận (`isValidTimeSig`: tử 1..32, mẫu 1/2/4/8/16/32) thành 4/4; bpm không
    dương hoặc không hữu hạn thành 90.

## Timeline / hold

- **D-020 — Rest phá vỡ hold run; xuống dòng thì không.** Spec định nghĩa run là "dải liên tiếp có cùng
  (octave, sharp) ≠ (0, false)" nhưng không nói về rest. Chọn "rest phá run" vì đó là cách duy nhất khớp kết quả
  optimizer mà spec mục 9 yêu cầu cho bài test dài (nay là fixture `src/test/fixtures/bai-thu-nhip-dieu.harm`,
  D-443): với rest _không_ phá run, phương án (shift 0, hạ 1 quãng) có cost 75 < 81 của phương án gốc; với rest phá
  run, phương án gốc (cost 81) thắng (hạ quãng = 86), đúng "shift 0, mỗi đoạn hold ngắn, điệp khúc 1 hold dài".
- **D-021 — Hold run theo tổ hợp (octave, sharp)** đúng spec (dùng cho ribbon, banner, cost optimizer).
  Serializer thì gom theo từng chiều (octave và scroll riêng, lồng nhau) để văn bản gọn và không bao giờ thả
  rồi giữ lại cùng một nút giữa hai nốt liền nhau.
- **D-022 — Nốt trong luyến có modifier khác nhau**: serializer dùng prefix (`Z-L:N`) cho nốt lệch khỏi trạng
  thái chung của cả cụm, vì không thể đặt `[giữ]` giữa một token luyến.
- **D-023 — Ribbon trải từ `startBeat` nốt đầu tới `endBeat` nốt cuối của run**; chữ "GIỮ …" ở đầu dải
  (phía chạm hit line trước), "THẢ" ở cuối.
- **D-024 — Truy vấn timeline.** `nextLineStart` trả `totalBeats` khi không còn dòng sau; `sectionIndexAt` bỏ qua
  section rỗng (`endBeat ≤ startBeat`, vd. `# RAP`); `syllableAt` = null trước nốt đầu của dòng (dòng mở đầu
  bằng rest). Số lần bấm mỗi nút (`songStats.presses`) = số nhóm nốt liên tiếp cần nút đó, ngắt bởi rest
  (khoảng trống thời gian) hoặc nốt không cần nút.
- **D-025 — Count-in** dài 1 ô nhịp (`beatsPerBar`), chạy mỗi lần Play (kể cả resume) và Restart khi bật; chỉ có
  click — nốt có `startBeat` trong vùng count-in không phát. Pause giữa count-in → về điểm định bắt đầu. Trong
  count-in, game bar/banner hiện thứ cần bấm ở điểm bắt đầu, lyrics không highlight. _Phase 2c: "chỉ có click" =
  không phát nốt; bản thân click cũng chỉ có khi bật "Tiếng click metronome / đếm vào" — mặc định đếm vào chỉ bằng
  hình (D-183)._
- **D-026 — Transport.** `play()` khi đang phát mà không có `fromBeat` = không làm gì. `epoch` chỉ tăng khi vị
  trí gián đoạn (play, pause, seek, loop wrap, đổi clock, hết bài); `setBpm` và `setLoop` không tăng epoch (vị
  trí liên tục) nhưng có notify. Loop end kẹp theo `endBeat`. Wrap chỉ khi `segmentStart` (vị trí bắt đầu đoạn
  phát, không tính ô nhịp đếm vào; lúc đặt loop là vị trí hiện tại) < loop end (`wrapEndOf`, transport và
  scheduler dùng chung) — play/seek từ loop end trở đi chạy tiếp tới hết bài, có hay không count-in; loop đặt
  sau playhead chỉ áp từ lần phát sau. Scheduler lên lịch TRƯỚC vòng loop kế tiếp (tối đa 1 vòng) theo anchor
  transport sẽ dùng khi wrap; wrap khớp dự đoán thì giữ nguyên voice → nốt ở loop.start đúng giờ với mọi output
  latency (wrap khác dự đoán, vd. tab bị treo, thì coi là gián đoạn). Loop ngắn hơn khoảng L + 25 ms (vd. dòng
  0.25 beat ở 200 BPM) vẫn có thể trễ ở vòng sau nữa.
- **D-027 — Điều hướng Player.** → ở dòng cuối không làm gì; ← về dòng trước nếu playhead trong
  max(0.5 beat, 0.6 s) đầu dòng hiện tại. Loop L: A rồi B, không phụ thuộc thứ tự (loop = [min.start, max.end]).
  BPM override chỉ sống trong Player đang mở (không persist); `[` `]` không bước ra ngoài 40..200.
- **D-028 — `hitLinePos` đo từ biên sinh tile**: 0.82 = 82% từ trên (dọc) = 18% từ trái (ngang), nên một giá trị
  mặc định đúng cho cả hai hướng. Overlay chỉ đổi `orientation`.
- **D-029 — Lead khi bắt đầu đoạn phát.** Audio clock đọc thời điểm nghe thấy (currentTime − output latency L),
  nên đoạn phát mới trên audio clock (play, seek khi đang phát, đổi clock khi đang phát) neo tại `now + lead` với
  `lead = L + 25 ms` (`Clock.lead()`): hình đứng ở điểm bắt đầu khoảng đó (thường 35–85 ms) để click/nốt đầu được
  `start()` ở tương lai và nghe đúng lúc chạm hit line (trước đây bị kẹp trễ L, bỏ hẳn khi L > 0.2 s). Không áp
  cho loop wrap (đã lên lịch trước) và đổi bpm.

## Âm thanh / settings

- **D-030 — `settings.scrollDir` là chiều Nửa Cung thực tế trong game** (chưa xác nhận, mặc định +1): dùng cho
  âm thanh và khi sinh bài (optimizer/import ghi `@scroll` theo setting). `@scroll` của bài là giả định của người
  soạn; Player cảnh báo khi hai giá trị khác nhau và bài có nốt scroll. _Góp ý 2026-10-15: thay / sửa bởi D-314._
- **D-031 — Settings và thư viện persist bằng zustand `persist`** (có `version` + `migrate`), hàm migrate là hàm
  thuần được export để test.
- **D-032 — Mở khóa âm thanh.** AudioContext chỉ tạo sau user gesture: trong gesture Play/Restart, hoặc khi
  Player mount (và khi bật âm thanh trong Player) nếu trang đã có user activation
  (`navigator.userActivation.hasBeenActive`, vd. vừa bấm bài ở Library) — tạo trong idle callback
  (`AudioEngine.warm()`) vì constructor của Chromium mở thiết bị đồng bộ 0.5–1 s; không resume ngoài gesture
  (Safari vẫn unlock khi Play). Play khi context chưa chạy: chờ unlock (≤ 1 s; UI hiện đang phát, bấm lại = hủy)
  rồi mới bắt đầu đoạn phát thẳng trên audio clock (đếm vào đủ 4 click, nốt đầu không mất); bị chặn/quá hạn →
  vẫn chạy hình + toast một lần, các lần Play sau không chờ nữa (bật lại âm thanh thì chờ lại). Context giữ
  running khi rời Player (vào lại gắn audio clock không cần gesture). Context bị suspend/đóng từ ngoài → về
  performance clock (hình không đứng).
- **D-033 — Phím tắt** (`useHotkeys`) bỏ qua khi focus trong input (mọi type, kể cả range)/textarea/select/
  contenteditable, trong dialog `aria-modal`, khi IME đang gõ (Telex) hoặc có Ctrl/Meta/Alt. Bind phím nốt →
  throw ở dev, warn ở prod. Slider/select tự blur sau thao tác chuột để Space vẫn là Play/Pause. Ctrl / Alt đang là phím thay modifier
  practice: D-152.
- **D-034 — Scheduler.** Đổi bpm khi đang phát: nốt đang ngân giữ nguyên (ring out theo độ dài cũ, không cắt,
  không kích lại); voice chưa start bị hủy và lên lịch lại theo tempo mới. Pause/seek: voice mà phần đầu chưa
  tới tai (onset trong output latency) cắt với fade 3 ms; phần đã render (≤ L) không thu hồi được — chấp nhận.
  Interval 25 ms chỉ chạy khi đang phát; pause/hết bài thì nghỉ, `poke()` (mỗi thay đổi transport) đánh thức.

## Thư viện

- **D-050 — Bài seed chỉ đọc**: `updateSong`/`removeSong` trên seed trả false; muốn sửa thì nhân bản. Import
  không khử trùng lặp, giới hạn 2 MB/file, `.mid` báo lỗi (chỉ tới "Tạo bài từ MIDI" khi đã có — D-060). Chưa
  đồng bộ giữa các tab.
- **D-066 — Directive lặp: dòng cuối thắng ở mọi nơi.** Parser lấy directive viết sau cùng; `getDirective` /
  `setTitleInSource` (src/library/songSource.ts) cũng vậy: Nhân bản đổi dòng `@title` cuối, title rỗng thì bỏ
  mọi dòng `@title` (bỏ mỗi dòng cuối sẽ làm dòng phía trên có hiệu lực lại).
- **D-067 — Độ dài bài làm tròn xuống** (`formatDuration` = `formatClock` của Player, +1e-6 bù float) để thẻ thư
  viện và thanh seek hiện cùng một con số.
- **D-068 — Nhập JSON chỉ có model** (không có `source`): luyến có nốt dài khác nhau được chia đều theo tổng
  (D-014), dòng không có nốt bị bỏ (D-013), nhịp ngoài miền `@time` của parser (vd. 5/3) là sai định dạng
  (`importErrorShape`, không âm thầm đổi thành 4/4). Serializer ghi dạng chuẩn (D-043); sau đó phải parse lại
  không lỗi và ra đúng `canonicalSong(model)` (`sameSongContent`: bỏ qua id, khoảng trắng thừa, sai số float),
  không thì báo `importErrorSerialize` thay vì lưu bài đã bị đổi. Nhờ dạng chuẩn, lời chứa `: ` hoặc mở đầu bằng
  `#` `@` `//` nhập được (chèn U+2060 vô hình), luyến 1 nốt nhập thành nốt. JSON do app xuất có `source` nên
  không đi nhánh này.

## UI chung / phase

- **D-060 — Cờ tính năng theo phase** (`src/ui/features.ts`: `editor`, `share`, `midiImport`, đều `false` ở
  Phase 1). Cờ tắt thì ẩn mọi lối vào (nút "Bài mới", link "Sửa", "Tạo bài từ MIDI", gợi ý "mở Sửa" trong thông
  báo, lỗi nhập `.mid` không chỉ tới nút MIDI; trong Player: link "Sửa", nút "Mở trình soạn" của bài rỗng, chip
  lỗi cú pháp thành chữ thường kèm gợi ý xem thẻ thư viện và lỗi đầu tiên) và route `#/edit`, `#/s`, `#/midi`
  hiện trang "sắp có" đã dịch (App.tsx) thay cho view placeholder. "Bài mới" lưu bản nháp ngay khi bấm là đúng
  thiết kế khi đã có Editor, nên chỉ ẩn nút chứ không đổi hành vi. Phase làm xong tính năng thì bật cờ (có sẵn
  bản `library.subtitleWithEditor`, `player.parseErrorsHintEditor`).
- **D-061 — Modal** render qua portal vào `<body>`; khi mở, các con khác của `<body>` (gồm `#root`) bị `inert`,
  Tab / Shift+Tab vòng trong dialog, focus đầu vào `[data-autofocus]` nếu có (nút Hủy của hộp xác nhận xóa /
  đặt lại), không thì vào dialog; đóng thì trả focus. Nút đóng có nhãn `common.close`. Modal chồng nhau và
  bấm nền: D-144.
- **D-062 — Bài có lỗi cú pháp hiện danh sách lỗi trên thẻ thư viện** (`<details>` "Xem dòng bị lỗi", tối đa 5
  lỗi kèm dòng/cột, thông điệp qua `formatDiagnostic` ở src/ui/diagnostics.ts) — Phase 1 chưa có Editor nên đây
  là nơi duy nhất người dùng biết dòng nào hỏng để sửa file và nhập lại.
- **D-063 — Toast trong Player ở đỉnh màn hình** (`<ToastRegion placement="top" max={1}>`, click xuyên qua):
  không che hàng modifier của game bar / hit line. Không xóa hàng đợi khi đổi route (toast đẩy ngay trước khi
  `navigate` sẽ mất); toast cũ từ thư viện chỉ hiện cái mới nhất rồi tự hết hạn.
- **D-064 — Số ít trong i18n:** `t(key, { n: 1 })` dùng `<key>_one` nếu có (useT.ts `translateCount`). Type buộc
  `vi` có cùng key nên `_one` bên `vi` lặp lại câu gốc. Tham số đếm khác `n` / câu nhiều số đếm: `{x:một|nhiều}`
  (D-143).
- **D-065 — Persist không bao giờ throw** (`createGuardedStorage`, src/ui/storage.ts, dùng cho settings và thư
  viện): quota đầy / storage bị chặn / JSON hỏng → thao tác vẫn áp trong bộ nhớ, `console.warn` và một toast cho
  mỗi chuỗi lỗi liên tiếp. Settings không có dữ liệu lưu khi rehydrate thì giữ state hiện tại.
- **D-069 — Theme trước khung hình đầu:** script inline trong `index.html` đọc `dfht-settings` (shape persist
  `{ state: { theme, language } }`) và đặt `data-theme`, `lang`, `meta[theme-color]` trước khi vẽ; React áp lại
  bằng layout effect. Test `src/ui/themeBoot.test.ts` chạy đúng script đó để giữ đồng bộ với settings.

## Player (hiển thị)

- **D-070 — Canvas lúc đếm vào** (bổ sung D-025): khi `beat < countIn.end`, nốt/run kết thúc trước hoặc đúng
  điểm bắt đầu (ô nhịp được tua lại, không phát) vẽ mờ (~22% alpha) và không bao giờ "sáng"; chỉ nốt tại điểm
  bắt đầu (thứ game bar / banner đang hiện) chạm hit line khi hết đếm. Engine chỉ truyền `RenderFrame.countIn`
  trong lúc đếm.
- **D-071 — Canvas khi có loop A-B** (bổ sung D-026): khi transport sẽ wrap (cùng điều kiện `wrapEndOf`) và
  playhead trước loop end, không vẽ gì từ loop end trở đi (nốt, run, vạch nhịp, nhãn section); thay vào đó vẽ
  lại [start, end) dời +k × (end − start) (tối đa 64 vòng), nên đầu loop cuộn vào với lead-in bình thường. Tile
  bị cắt tại loop end, run cắt qua loop start có lại nhãn GIỮ ở mỗi vòng, vạch đứt (`loopLine`) đánh dấu điểm
  wrap. Playhead đã qua loop end, hoặc đoạn phát bắt đầu từ loop end trở đi (kể cả lúc đếm vào trước loop end)
  → vẽ như không loop. Vùng "đã qua" sau khi wrap vẫn là timeline thật trước loop start. Bản vẽ lại không mang
  trạng thái practice: D-151.
- **D-072 — Cỡ chữ phím trên tile** (spec §5): mọi tile không bị rút ngắn bởi luật khoảng cách có nhãn ≥ 28px,
  kể cả khi `tileScale` < 1 (sàn = max(28, 28 × tileScale)). Chỉ tile bị rút ngắn (nốt ngắn lặp lại ở lookahead
  cao) dùng bậc nhỏ hơn (28/21/16/12/9px), chọn sao cho nhãn liên tiếp cùng lane không chồng nhau; cụm quá dày
  kể cả với 9px thì chỉ tile đầu cụm có nhãn. Trên các tile đó mũi tên bị bỏ, huy hiệu # thu nhỏ (quá nhỏ thì
  thành chấm). Nốt giữ dài: nhãn bám mép canvas để luôn thấy.
- **D-073 — Nhãn phụ (solfège / số) trên tile ngắn** nằm cùng hàng với nhãn phím (bên phải, bị chặn thì bên
  trái); lane hẹp (mobile) chỉ hiện khi tile đủ cao để xếp chồng. Bậc `1̇` vẽ bằng "1" + chấm (canvas và game
  bar) vì U+0307 lệch tâm trên nhiều font.
- **D-074 — THẢ trên run ngắn**: run không đủ chỗ cho cả hai nhãn → THẢ vẽ ngay sau đầu cuối của dải (cách 2px,
  có viền) nếu còn chỗ trước run kế / loop end; không thì GIỮ dạng gọn (↓ / ↑ / #) + THẢ trong dải.
- **D-075 — Nhãn section (hướng dọc)** xoay 90° đọc từ dưới lên, nằm trong lề trái, vẽ sau tile (vạch section
  vẽ dưới tile): pill ngang sẽ che nhãn phím của tile lane Z ở đầu section. Hướng ngang giữ pill ở dải nhãn
  phía trên.
- **D-076 — Dải lời** nằm trong luồng layout phía trên canvas (không đè lên tile) nên thấy đủ lookahead; cao cố
  định 2 dòng khi bài có lời (canvas không đổi cỡ giữa bài). Dòng hiện tại rộng hơn khung thì trượt ngang giữ
  chữ đang hát ở ~40% bề rộng, mép mờ; dòng không có karaoke từng chữ thì co tới 72%. Dòng kế vẫn cắt bằng "…". _Góp ý 2026-10-15: thay / sửa bởi D-311._
- **D-077 — Dropdown section là lệnh "nhảy tới"** (bổ sung D-033): mở bằng chuột và chọn lại đúng section đang
  hiện → phát lại từ đầu section đó. Focus đến từ chuột mà đóng popup không chọn → phím tắt Player gõ trên
  select được trả về Player (blur + phát lại sự kiện). Select focus bằng bàn phím giữ hành vi gốc.
- **D-078 — Game bar và màu theme sáng**: mỗi nốt mới tới hit line mount lại keycap đang sáng nên hiệu ứng
  "nhấn" chạy lại kể cả cùng phím (X X X…); `prefers-reduced-motion` chỉ nháy màu. Theme sáng: keycap sáng của
  nốt thường là nền tối chữ trắng (keycap xám trắng không phân biệt được với keycap chưa sáng); viền tile theo
  màu modifier (`CanvasTheme.tileStroke`), tương phản ≥ 3:1 với nền canvas và cả hai màu lane.
- **D-079 — Backing store của canvas = hộp device-pixel của canvas**: ResizeObserver
  `device-pixel-content-box` khi khớp css × dpr (±1.5px), không thì ước lượng có snap mép từ
  `getBoundingClientRect`; layout tính theo đơn vị devW / dpr. Renderer tự vẽ lại frame cuối sau khi đổi DPR /
  cỡ device-pixel (cả lúc pause).

## Phase 2 — `.harm` mở rộng, donate, share (src/core)

- **D-080 — Dấu chunk donate `k/n`** (bổ sung D-016 / D-041). Dòng bắt đầu bằng `k/n ` được bỏ dấu trước khi
  phân loại; có thể có nhiều dấu liền nhau (`1/2 3/4 x`) và khoảng trắng hai bên. Parser thay dấu bằng khoảng
  trắng cùng độ dài (`donateMarkerLength`), nên cột của diagnostic và span vẫn tính theo dòng gốc. Áp cho
  directive, header, comment và dòng nốt, kể cả dòng được `@repeat` phát lại. Dòng chỉ có dấu (`3/5`, `3/5  `)
  bị bỏ qua. `1/3: Z` vẫn là lời `1/3` (sau số là `:` chứ không phải khoảng trắng).
  - Hệ quả: lời viết tay bắt đầu bằng `số/số` + khoảng trắng (vd. `2/9 năm ấy: Z X C`) bị đọc là dấu chunk và
    mất `2/9 ` (chỉ còn info lyric-mismatch). Để D-043 vẫn đúng với model ngoài (JSON, chia lời,
    `setLineLyrics`), `canonicalLyric` chèn U+2060 trước lời có dạng đó.
- **D-081 — Span nguồn** (`ParseResult.lineSpans` / `unitSpans`): cột 0-based UTF-16, end không tính, theo
  dòng nguồn đã bỏ BOM (tách dòng theo CRLF / LF / CR lẻ — D-148). Dòng do `@repeat` chèn trỏ về dòng và cột GỐC, `repeated: true`. `tokensStart` = cột
  ký tự không trắng đầu tiên của phần token: sau `:` tách lời nếu có (kể cả lời rỗng `: Z`), không thì sau dấu
  donate và khoảng trắng đầu dòng.
- **D-082 — `applyTextEdits`** (src/core/sourceEdit.ts): giữ BOM và kiểu xuống dòng của từng dòng (kể cả CR lẻ, D-148). Edit không
  hợp lệ bị bỏ trước khi kiểm tra chồng nhau (dòng / cột ngoài phạm vi, không phải số nguyên, start > end, text
  không phải chuỗi). Chèn đúng mép một vùng thay không tính là chồng; nhiều lần chèn cùng một chỗ giữ thứ tự đầu
  vào; chèn vào bên trong vùng thay hoặc hai vùng giao nhau → `RangeError`.
- **D-083 — `setUnitBeats` / `setLineLyrics`** (`parsed` phải là `parseHarm(source)`):
  - `setUnitBeats` thay / chèn / bỏ `*dur` của token (beats = 1 thì bỏ; luyến ghi TỔNG). Nhiều thay đổi rơi vào
    cùng token nguồn (qua `@repeat`) thì cái sau cùng thắng; chỉ số sai, beats không hữu hạn / ≤ 0 bị bỏ qua;
    dur hỏng như `Z*0` được sửa tại chỗ.
  - `setLineLyrics`: lời chuẩn hóa bằng `canonicalLyric` (CR/LF → dấu cách); parse lại ra đúng
    `canonicalLyric(lyric)`. Dòng đã có lời: chỉ thay vùng lời đã trim. Dòng chưa có lời: thay vùng [đầu nội
    dung (sau dấu donate + khoảng trắng), `tokensStart`) bằng `lời: ` (nên `: Z` thành `lời: Z`). Bỏ lời (null /
    trắng): xóa [lyric.start, tokensStart), trừ khi phần token đứng đầu dòng sẽ bị đọc khác (chứa `:` + khoảng
    trắng, mở đầu bằng `@` `#` `//`, hoặc là dấu donate — chỉ xảy ra ở dòng vốn đã lỗi token) thì giữ `: `.
    Nhiều thay đổi cùng dòng nguồn: cái sau cùng thắng.
- **D-084 — Donate text** (src/core/donate.ts). `buildDonateText` = `serializeHarm` luôn ghi directive, không
  dòng trống, không xuống dòng cuối. `chunkDonateText(text, limit)`:
  - Dọn đầu vào: bỏ BOM, CRLF → LF, trim từng dòng, bỏ dòng trống. Rỗng → `[]`; vừa giới hạn → nguyên văn, không
    tiền tố.
  - Mỗi phần = `k/n ` + các dòng nối bằng `\n`, dài ≤ limit (UTF-16, tính cả tiền tố). Ngân sách phần k trừ đúng
    độ dài tiền tố của nó; xếp lại tới khi số chữ số của n ổn định.
  - Dòng dài hơn một phần trống thì bắt đầu ở phần mới; mảnh cuối còn nhận thêm dòng sau. Dòng dài được chia
    thành nhiều dòng `.harm` cùng loại, không bao giờ cắt trong lời: lời khớp số nốt chia theo nốt (karaoke vẫn
    khớp), directive / header rút gọn bằng `…` — chi tiết D-146. Comment dài: mảnh sau thêm `// `.
  - limit < 30 dùng 30 (`MIN_DONATE_LIMIT`), NaN dùng 200, Infinity → một phần. `chunks.join('\n')` dán thẳng
    vào parser ra đúng model khi không dòng nào bị chia; dòng bị chia thành 2+ dòng model (nốt / hold / tên
    section giữ nguyên, không lỗi hay cảnh báo — D-146).
- **D-085 — Link chia sẻ** (src/core/share.ts): `#/s/<lz-string compressToEncodedURIComponent>`.
  `decodeShareData` không throw, chịu percent-encoding, `+` bị đổi thành dấu cách và khoảng trắng hai đầu; ký
  tự ngoài bảng chữ lz-string, giải nén lỗi, hoặc kết quả có ký tự điều khiển (trừ tab / xuống dòng) hay
  surrogate lẻ → `null` (heuristic: link bị cắt vẫn có thể ra rác trông hợp lệ). Link > 8000 ký tự
  (`SHARE_URL_SOFT_LIMIT`) vẫn sao chép, kèm cảnh báo. Encode dọn nguồn theo cùng luật đó (D-147).

## Phase 2 — Optimizer, melody (src/core)

- **D-086 — Optimizer: trường hợp biên.** Melody không có nốt (rỗng / toàn rest) → đúng 1 phương án transpose
  0, cost 0; `keepOriginalKey` cũng trả transpose 0. Cao độ không nguyên (NaN, 60.5, Infinity) = không bấm
  được: `evaluateTranspose` → null, `optimizeTranspose` → `[]`, `keepOriginalKey` → null. transpose /
  baseOctave không nguyên là lỗi lập trình → `RangeError`. `top` kẹp 0..12 (một phương án mỗi lớp shift), NaN
  → 3. Xét t ∈ [−48, 48] (`TRANSPOSE_LIMIT`).
- **D-087 — Optimizer: gán phím và sắp xếp.** Viterbi trên 6 trạng thái (octave, sharp), cost khớp
  `songStats(buildTimeline)` (modified +1, sharp +10, bắt đầu run +4; rest ngắt run, xuống dòng thì không). Hòa
  cost: thứ tự trạng thái của `keyChoicesForMidi` ((0), (−1), (+1), rồi (0,S), (−1,S), (+1,S)), so sánh chặt,
  truy vết từ cuối bài → tất định. Bật fold: mọi t; nốt ngoài tầm dời theo bội quãng tám tới cao độ gần nhất
  trong tầm, +1000 mỗi nốt. Mỗi lớp shift giữ phương án tốt nhất theo (cost, |t|, t); danh sách sắp theo cost →
  shift 0 trước → khoảng cách shift nhỏ → |t| → t.
- **D-088 — `melodyToSong`.** Nhóm slurId chỉ thành Slur khi ≥ 2 nốt liên tiếp và mọi nốt cùng beats; không thì
  cả nhóm thành nốt rời (không tách nhóm con). Rest (kể cả rest mang slurId) ngắt nhóm; rest có choice thừa vẫn
  là rest. Dòng không có event bị bỏ cùng lời (D-013); section rỗng vẫn giữ. Lời / artist chỉ có khoảng trắng
  thì bỏ key. Placement không khớp melody, nốt không có lựa chọn phím, hoặc beats ≤ 0 / không hữu hạn →
  `RangeError`. Song trả về không tự chuẩn hóa lời (serializer làm theo D-043).
- **D-089 — `melodyToHarm`: comment `//!`** đặt ngay trên dòng model (dòng đầu section thì nằm giữa
  `# Section` và dòng đó), vị trí lấy từ `parseHarm(text).lineSpans`. Thứ tự: câu gập quãng trước, rồi các
  warning riêng của event (bỏ trùng, xuống dòng → dấu cách, câu rỗng không chèn). Câu mặc định ghi tầm theo
  `baseOctave` (4 → "C3–C6"); UI truyền câu đã dịch.
- **D-090 — `songToMelody`**: midi = `noteMidi(…, baseOctave, scrollDir)`; slurId đánh số toàn bài từ 0; luyến
  1 nốt thành event thường, luyến rỗng bị bỏ; lời chỉ giữ ở mức dòng.

## Phase 2 — Nhập cảm âm (src/core/camam.ts)

- **D-091 — Directive và mặc định.** Chỉ đọc `@title` / `@artist` / `@bpm` / `@time` (cùng luật kiểm tra với
  `.harm`, dòng sau thắng); giá trị sai và mọi directive khác (`@scroll`, `@repeat`…) bị bỏ qua, không báo lỗi
  (`CamAmDiagnostic` chỉ có `unknown-token` | `invalid-duration`). `opts.title` / `opts.bpm` chỉ là giá trị dự
  phòng (`@title` rỗng → `opts.title`; bpm không hữu hạn / ≤ 0 → 90).
- **D-092 — Âm, dấu hóa, quãng.** Bỏ dấu bằng NFD + xóa mọi `\p{M}`; đ → d, Đ / Ð (U+00D0) → D; hoa / thường
  xét theo ký tự đầu của từng âm (quy ước `case`). Dấu hóa ngay sau âm: `#` `♯` (+1), `b` `B` `♭` (−1; B hoa
  không mơ hồ vì không âm nào mở đầu bằng b), cộng dồn. Hậu tố số 1..3, một chữ số, trước hoặc sau dấu hóa
  (`Sib3` = `Si3b`). Midi ngoài 0..127 → `unknown-token`. Không có cách ghi quãng dưới quãng 1 (optimizer
  transpose thay).
- **D-093 — Token dính và độ dài.** Tách tham lam, âm 3 chữ trước (sol/son/pha), không cần quay lui; nhận cả
  `do-re` như một luyến; sai bất kỳ phần nào thì cả token là `unknown-token`. `*dur` trên luyến là TỔNG, chia
  đều; dur sai → `invalid-duration` cả token, nốt giữ 1 beat (như parser `.harm`); base lạ chỉ báo
  `unknown-token`.
- **D-094 — Kéo dài `-`.** `-` cộng 1 beat vào đơn vị ghi gần nhất, kể cả ở dòng / section trước (`--` = +2,
  `-*dur` = +dur; `--*2` mơ hồ → `unknown-token`); luyến thì cộng vào tổng rồi chia đều lại (`Dola -` =
  `Dola*2`). `-` khi chưa có đơn vị → `unknown-token`. Dòng không có đơn vị mới (toàn token lạ hoặc chỉ `-`)
  bị bỏ cùng lời; section khai báo mà rỗng vẫn giữ, `Main` tạo lười (giống D-013).
- **D-095 — Diagnostic và đếm.** Gạch chân cả token, cột 1-based UTF-16 (như Diagnostic `.harm`), theo thứ tự
  nguồn; lỗi nội bộ trên một dòng → `unknown-token` cả dòng + `console.error`, không throw. `noteCount` đếm
  từng nốt (luyến n âm = n), không đếm nghỉ; slurId duy nhất trong một lần parse, bắt đầu từ 1. Thanh nhịp `|`,
  `(x2)`, dấu câu dính nốt, gạch dài `–` `—` và kiểu "lời một dòng, nốt dòng dưới" chưa được hỗ trợ (báo token
  lạ / đọc nhầm chữ trùng tên âm).

## Phase 2 — Tap timing, chia lời

- **D-096 — Tap timing (core, src/core/tapTiming.ts).** `label` chỉ ghi phím (`N`, `X-C`, `_`); `syllable`
  theo đúng luật karaoke (số chữ ≠ số đơn vị nốt → null). Cả bài bỏ các dòng do `@repeat` chèn; target liên
  tiếp có lineIndex cách nhau > 1 (đã bỏ dòng ở giữa) → đơn vị trước chỗ đứt tính như nốt cuối. Độ dài = khoảng
  giữa hai tap theo bpm, trừ beats của rest ở giữa; bật quantize: bội gần nhất của grid, tối thiểu 1 grid (grid
  1/k tính bằng phép chia để ra số đúng); tắt: làm tròn 0.001, tối thiểu 1/16. bpm / grid / lastBeats sai →
  90 / 0.25 / 1. Tap thừa bị bỏ; thời điểm không hữu hạn bị bỏ; tap lùi giờ kẹp bằng lần trước.
- **D-097 — Modal Tap timing.** Nốt không đo được (nốt bấm cuối, nốt ngay trước chỗ đứt) giữ nguyên độ dài
  đang có trong văn bản, không ép về 1 beat (truyền `lastBeats` canh rồi lọc bỏ) — không phá `N*4` cuối
  section. Độ dài đo trùng giá trị hiện tại thì không ghi lại (tránh đổi `*.5` thành `*0.5`); cùng dòng nguồn tap
  hai lần qua `@repeat` thì lần có thay đổi thắng. Space bắt bằng listener trên phần tử dialog, chỉ ở bước tap:
  preventDefault, bỏ `repeat`, Ctrl/Meta/Alt và IME; bỏ qua khi focus ở select / textarea / ô text (checkbox và
  nút vẫn là tap — đã kiểm trong Chromium: Space khi nút "Hoàn tác tap" đang focus là tap, không bấm nút).
  Pointerdown nút chính trên ô tap cũng là tap. Đổi phạm vi giữa chừng → về bước chuẩn bị, xóa các lần bấm. bpm
  lấy từ `@bpm`, không chỉnh trong modal.
- **D-098 — Chia lời (core, src/core/lyricsDistribute.ts).** Chữ chuẩn hóa NFC; lời dán tách dòng theo CRLF,
  CR, LF, U+2028 / U+2029. `mismatch` = số chữ ≠ unitCount (dòng có nốt mà không lời cũng là mismatch, dòng
  toàn rest không lời thì không). Flow: chữ dư nối vào dòng cuối CÓ nốt (không có thì dòng cuối); unitCount sai
  → 0, số lẻ làm tròn xuống. Lời trả ra đã escape theo D-043 (`harmLyricText` = `canonicalLyric`, D-149). _Góp ý 2026-10-15: thay / sửa bởi D-311._
- **D-099 — Modal Chia lời.** Bỏ dòng do `@repeat` chèn (sửa chúng là sửa dòng gốc). Chưa dán gì thì bảng
  hiện lời hiện tại để sửa tay; đổi lời dán hoặc cách chia thì bỏ mọi chỗ sửa tay. Chỉ ghi dòng có thay đổi
  (so qua `canonicalLyric`); ô lời trắng = bỏ lời. _Góp ý 2026-10-15: thay / sửa bởi D-311._

## Phase 2 — Editor, Share

- **D-100 — Văn bản trong Editor là LF.** Textarea chuẩn hóa CRLF / CR thành LF; bài CRLF mở ra không bị coi là
  đã sửa (so với nguồn đã chuẩn hóa); lưu thì ghi LF. Cột trên dòng 1 tính sau BOM như parser. Parse lại sau
  150 ms ngừng gõ; công cụ / Donate luôn nhận parse của văn bản hiện tại (không chờ debounce).
- **D-101 — Bài mẫu và bài tạm (link chia sẻ) chỉ đọc trong Editor.** Vẫn sửa được, có thông báo; Lưu =
  `addSong(bản sao)`, toast "Đã lưu bản sao…", rồi navigate replace sang editor của bản sao, giữ nguyên phiên soạn (D-155). Bài user: Lưu cập
  nhật tại chỗ. Ctrl+S = Lưu, bỏ qua khi có dialog `aria-modal` đang mở.
- **D-102 — Phát từ dòng con trỏ.** Dòng model đầu tiên có `(repeatLine ?? sourceLine) ≥ dòng con trỏ`, tính
  bằng parse của văn bản hiện tại: con trỏ trên `@repeat X` → dòng đầu tiên directive đó chèn; trên comment /
  header / dòng trống → dòng nốt kế; sau mọi dòng → dòng cuối; bài không có dòng nốt → phát không kèm `?line`.
  Bài user đang sửa: lưu trước; bài mẫu đang sửa: tạo bản sao, thay mục history bằng `#/edit/<bản sao>`, phát
  bản sao.
- **D-103 — Hoàn tác / Làm lại chỉ cho thao tác Công cụ.** Lịch sử là ảnh chụp văn bản, tối đa 50 bước, nhãn từ
  i18n ("Hoàn tác: Tap timing"). Hoàn tác đưa văn bản HIỆN TẠI (gồm chữ gõ sau thao tác) vào nhánh Làm lại nên
  không mất gì; gõ tay dùng undo gốc của textarea. Tab trong ô soạn chèn 2 dấu cách bằng
  `execCommand('insertText')` (giữ Ctrl+Z gốc; không được thì đặt state); Esc rồi Tab, hoặc Shift+Tab, rời ô.
- **D-104 — Chặn rời Editor khi chưa lưu.** Đóng tab / tải lại: `beforeunload`. Trong app: click link `#/…`
  cùng trang bị chặn ngay lúc click (capture ở document, không sinh mục history); Back / Forward / đổi hash khác
  bị chặn trước router (trả URL cũ bằng `history.replaceState`, xem D-142), rồi hỏi bằng Modal: Ở lại / Bỏ thay
  đổi / Lưu rồi đi. Điều hướng do chính Editor gây ra (Lưu bản sao, Phát) được cho qua theo danh sách hash.
  Back bị chặn để lại một mục history mang URL editor — chấp nhận.
- **D-105 — Donate modal:** giới hạn 30..2000 (không phải 20: core sàn 30, nhập 20 thì các phần vẫn dài tới 30);
  ô nhập sai / đang gõ dở → giữ giới hạn hợp lệ gần nhất và báo. "Sao chép tất cả" nối các phần bằng một dòng
  trống (parser bỏ qua dòng trống). Nội dung lấy từ văn bản đang sửa (chưa lưu).
- **D-106 — Bài tạm từ link chia sẻ.** id `shared-<FNV-1a 32 bit, base36>` theo nội dung (mở lại cùng link không
  nhân bản; trùng hash khác nội dung → hậu tố `-2`). Nằm ở state zustand `transient`: không persist
  (`partialize` chỉ lấy `songs`), không có trong `listSongs`, `getSong` / `useSong` vẫn tìm thấy, mất khi tải lại
  trang (Player của bài tạm sau reload báo không tìm thấy). ShareView: "Lưu vào thư viện" chỉ lưu một lần (trạng thái suy từ thư viện, D-161), sau
  đó Phát / Mở trong trình soạn dùng bài đã lưu; Phát khi chưa lưu → bài tạm; "Mở trong trình soạn" khi chưa
  lưu → `addSong` rồi mở Editor.
- **D-107 — Preview và chia sẻ.** Preview: "Số lần giữ chuột" = presses.left, presses.right (D-024) và số dải
  giữ; lỗi sắp theo dòng / cột, cùng chỗ thì nặng trước; chỉ vẽ tối đa 200 diagnostic và 400 dòng; đoạn rỗng
  (`# RAP`) vẫn hiện; bấm "Dòng N" của dòng lặp nhảy về dòng gốc. "Chia sẻ link": không sao chép được → toast
  lỗi; link > 8000 ký tự vẫn sao chép kèm toast gợi ý Donate text / file .harm. Áp D-060: "Mở trong trình soạn"
  ẩn khi cờ editor tắt, "Chia sẻ link" ẩn khi cờ share tắt.
- **D-108 — Nhập cảm âm (modal).** Tên bài và Tempo điền sẵn theo bài hiện tại, chỉ là dự phòng (`@title` /
  `@bpm` trong văn bản thắng). Mặc định "Thay toàn bộ bài" (hoàn tác được). "Chèn vào cuối" bỏ mọi dòng `@…`
  của phần mới (giữ title / bpm / `@scroll` của bài hiện tại) rồi nối sau một dòng trống — nếu `@scroll` của bài
  khác cài đặt thì nốt scroll của phần chèn nghe khác. Câu `//!` gập quãng theo ngôn ngữ UI lúc tạo.
- **D-109 — Tối ưu tông (modal).** Cao độ đọc theo `@scroll` của bài (D-030); bài mới ghi `@scroll` theo cài
  đặt. Luôn có bước xác nhận vì văn bản được viết lại dạng chuẩn; danh sách mất mát: comment (kể cả `//!`, dò
  bằng regex), `@repeat` bị trải ra, lỗi cú pháp, cách viết giữ / thả. Dòng "Bài hiện tại" lấy cost bằng
  `songStats(buildTimeline)` + `placementCost`.
- **D-110 — OptimizerPanel.** Các dòng: top 3, cộng phương án shift 0 tốt nhất nếu chưa có, cộng `value` của
  nơi gọi nếu không trùng dòng nào (hiện và đánh dấu, không ghi đè). `value` có `choices.length` khác số event
  → coi là cũ, tự chọn lại tốt nhất; nơi gọi phải reset `value` khi đổi pitches / fold (cùng độ dài thì không
  phát hiện được). "Giữ cung gốc" = shift 0 tốt nhất ở bất kỳ quãng nào (có thể ±12); nhãn transpose 0 là "Giữ
  cung gốc"; cột "Độ khó" = cost. Một radio gốc mỗi dòng, công thức cost nối qua `aria-describedby`.
- **D-111 — Modal công cụ chung.** Tự gọi `onApply(next, nhãn)` rồi `onClose`; không có gì thay đổi → toast
  "Không có gì thay đổi", không gọi `onApply`. Nhãn hoàn tác qua i18n (vi đúng nguyên văn: Tap timing, Chia
  lời, Nhập cảm âm, Tối ưu tông). Mỗi modal trả `null` khi đóng nên state reset mỗi lần mở.

## Phase 2 — Practice mode

- **D-112 — Chấm điểm (src/player/practice.ts).** Score: chọn nốt chưa chấm khớp (key, octave, sharp) có |Δ|
  nhỏ nhất trong ±220 ms (hòa → nốt sớm hơn); |Δ| ≤ 100 Perfect, còn lại Good; không khớp = bấm sai (combo về 0,
  không chấm nốt nào); `tick` báo miss cho nốt quá 220 ms. Wait: đích là nốt chưa chấm đầu tiên; bấm khớp với
  Δ ≥ −220 ms là Perfect; khớp nhưng sớm hơn 220 ms = bấm sai (không đổi combo). Đã chấm hết (`finished`) thì
  phím bấm thêm không làm gì (giữ combo cuối bài). Không có nốt: accuracy 0, finished = true. Δ =
  (beatAt(timeStamp) − startBeat) × 60000 / bpm phát; bpm sai → bpm của timeline.
- **D-113 — Phiên practice.** `reset(fromBeat)` giữ modifier đang giữ thật; nốt có startBeat < fromBeat − 1e-9
  bị bỏ khỏi lượt (không tính, không miss); NaN = 0. `setMode` giữ kết quả, chỉ xóa dấu "đang chờ". Modifier
  theo dõi theo nguồn (bàn phím, chuột) rồi gộp: chỉ nhả khi mọi nguồn đã nhả. MIDI: velocity ≤ 0 = note off
  (bỏ qua); so cao độ đúng, hoặc theo pitch class nếu bật; bỏ qua modifier bàn phím / chuột; midi phải đã
  transpose theo Cài đặt.
- **D-114 — Nhận phím / chuột (src/player/practiceInput.ts).** Bỏ qua khi focus ở ô nhập chữ (textarea,
  select, contenteditable, input khác range / checkbox / radio / button / submit / reset / color / file / image)
  hoặc trong dialog `aria-modal` — khác D-033 (useHotkeys bỏ cả range): bấm slider BPM không được làm mất phím
  practice. Phím nốt bỏ qua khi giữ Meta (Cmd / Win); Ctrl / Alt / Shift + phím nốt luôn thuộc practice
  (preventDefault). Chuột theo bitmask `e.buttons` (pointerdown trên khu tiles bắt đầu; pointermove / up /
  cancel trên window cập nhật — nút thứ hai chỉ tới qua pointermove); bỏ touch. Bấm phải bắt đầu trên khu tiles
  chặn luôn contextmenu kế tiếp trên window (Windows mở menu lúc nhả). Listener phím / chuột trên window chạy ở
  capture (con gọi stopPropagation không làm kẹt modifier). Blur / tab ẩn → nhả hết. Gỡ không phát sự kiện nhả
  (engine tự `releaseModifiers()`). Tổ hợp trình duyệt giữ: chỉ Ctrl+N (Chromium không cho chặn) → cảnh báo
  trong UI.
- **D-115 — Practice trong Player.** Bật/tắt practice và "Nghe giai điệu mẫu" chỉ sống trong phiên Player
  (không lưu); chế độ (Chờ / Chấm điểm) lưu ở `settings.practiceMode`. Trên thanh điều khiển chế độ là hai nút
  `aria-pressed`, không dùng `<select>` (select giữ focus làm practice bỏ phím nốt); `<select>` mở bằng chuột
  (đoạn, đếm ngược) trả cả phím tắt lẫn phím nốt về window. Chỉ chấm khi transport đang phát hoặc đang chờ bấm;
  lúc pause / đếm ngược chỉ có tiếng phản hồi và game bar sáng (modifier luôn được ghi nhận).
- **D-116 — Chế độ Chờ.** Giữ bài = pause + seek đúng `startBeat` của nốt; UI vẫn coi là đang phát (Space thoát
  lượt; seek thì nhảy rồi chạy tiếp). Bấm đúng → phát tiếp từ `startBeat + 1e-6` (nốt mẫu không phát lại). Đang
  bật giai điệu mẫu thì lúc dừng phát thử nốt đang chờ (≤ 1,2 s). Tắt practice / đổi chế độ khi đang chờ → chạy
  tiếp. Phát hiện nốt ở frame kế nên có thể vượt 1 frame rồi snap về (1–3 px).
- **D-117 — Lượt chơi và kết quả.** Lượt mới (`session.reset`) khi: bật practice (tại playhead), seek / dòng
  trước-sau / chọn đoạn, Restart, loop wrap (lần bấm vắt qua wrap: D-150), đổi chế độ, Play sau khi hết bài hoặc sau bảng kết quả; pause rồi
  phát tiếp giữ kết quả. Hết bài: nốt chưa chấm thành miss ngay; bảng kết quả hiện khi đã chấm hết và transport
  vừa chuyển từ phát sang dừng ở cuối bài (không hiện khi tổng nốt = 0 hoặc đang loop; đổi clock lúc đứng ở cuối
  không mở lại bảng đã đóng). Dải điểm tính % trên số nốt đã chấm; bảng kết quả dùng `accuracy` cả bài. Thời
  điểm bấm → beat: `clock.now() − (performance.now() − event.timeStamp)/1000`, trễ ngoài [0, 1 s] coi như "bây
  giờ".
- **D-118 — Phần còn lại của practice UI.** Tắt giai điệu mẫu: scheduler nhận bản timeline không nốt (đếm vào
  và metronome vẫn chạy; không sửa scheduler). Đếm ngược trước khi phát (`settings.startDelaySec`, chọn nhanh
  0/3/5/10 s, slider 0..10 trong card Âm thanh): áp cho Play (cả phát tiếp) và Restart (dừng, về beat 0 rồi
  đếm); mở khóa âm thanh ngay lúc bấm; Space / Esc / Tạm dừng hủy. Phím thay modifier trùng → phím chuyển sang
  modifier vừa chọn, modifier kia về "Không dùng", có dòng `role=status` giải thích. MIDI trong Player (câu trạng thái trên HUD: D-153): chỉ nghe
  khi practice bật + `midiEnabled` + có `midiInputId` (gọi `select`, `enable` nếu chưa có quyền); nốt ngoài
  C3..C6 sau transpose → nháy "NGOÀI TẦM", không tính sai (trừ khi bật pitch class). Card MIDI trong Cài đặt:
  `midiEnabled` bật sẵn thì xin lại quyền khi mở; bị từ chối / không hỗ trợ → tắt và hiện lý do; tắt MIDI →
  `select(null)` nhưng nhớ `midiInputId`. Dải điểm nằm trong luồng dưới thanh điều khiển (ngoài vùng nhận
  chuột); PERFECT / GOOD / MISS nháy `aria-hidden` trên hit line; live region polite ≤ 1 lần / 1,5 s. Game bar
  "đang bấm": viền `--focus` + keycap lún. Tiếng phản hồi: `playPreview` 0,35 s. _Phase 2c / 3b: slider đếm ngược
  nằm ở card **Phát bài** (không còn card Âm thanh — D-184); phím đang bấm = vòng kép tối + sáng, không dùng accent
  (D-238)._

## Phase 2b — MIDI file (src/midi/midiFile.ts, arrange.ts)

- **D-119 — Quét SMF bổ sung cạnh @tonejs/midi.** @tonejs/midi chỉ đọc meta text của track đầu, giải mã chữ
  Latin-1 (lời / tên tiếng Việt UTF-8 lỗi) và tách track theo (program, kênh) trước khi ghép note on/off (nốt
  đang ngân lúc đổi program bị mất). Nên midiFile.ts quét thêm một lượt: ghép note on/off FIFO theo (track file,
  kênh, cao độ), note on velocity 0 = note off, nốt không có note off bị bỏ; lyric / marker / tên track ở mọi
  track, UTF-8 (byte sai thì Latin-1). tonejs vẫn dùng để kiểm tra file và lấy PPQ, tempo, nhịp, tên nhạc cụ GM.
  Lượt quét lỗi (file cụt mà tonejs vẫn đọc được) → dùng dữ liệu tonejs; wizard cảnh báo file hỏng (D-169). File SMPTE (không PPQ) → `invalid`.
- **D-120 — Track trong bảng chọn = (track file, kênh) có nốt.** Hai track file cùng kênh vẫn là hai track. Tên =
  FF 03 của track file (mọi kênh dùng chung), không có → "Track N". Nhạc cụ = program lúc nốt đầu tiên của kênh.
  Track trống (kênh 10) giữ `isDrum` và UI ẩn; `velocity` 1..127.
- **D-121 — Header.** bpm = tempo event đầu tiên, làm tròn 0,01 (tempo 0 / vô hạn bị bỏ; mặc định 120), kể cả
  khi không ở tick 0; `tempoChanges` = số lần giá trị (đã làm tròn) đổi giữa hai tempo event liên tiếp. Nhịp =
  time signature đầu tiên; ngoài miền `@time` → 4/4; đổi nhịp giữa bài bị bỏ qua (vạch ô nhịp có thể lệch). Nhiều event cùng tick: D-168.
- **D-122 — Lời từ MIDI.** FF 05 ở mọi track (bỏ event rỗng); không có thì FF 01 nếu trông như karaoke `.kar`
  (bỏ header `@…`, ≥ 4 event ở ≥ 4 tick, ≥ 80% là một chữ ≤ 15 ký tự không khoảng trắng). Làm sạch: bỏ `/` `\`
  đầu chữ, ký tự điều khiển, trim; khoảng trắng bên trong → `_` (mỗi nốt đúng 1 chữ karaoke). Gắn vào nốt bắt
  đầu tại hoặc sau lời trong 1/8 beat; hợp âm → nốt cao nhất; nhiều lời một nốt thì nối. Lời tính cho cả file
  (duet có thể lẫn lời track khác). VNI / TCVN3 hiện thành rác (đọc Latin-1). _Góp ý 2026-10-15: thay / sửa bởi D-312._
- **D-123 — Chia dòng (`arrangeMelody`).** Rest nằm cuối dòng trước; dòng mới luôn bắt đầu bằng nốt, trừ dòng
  đầu có rest tính từ đầu ô nhịp chứa nốt đầu. Khoảng trống < grid (đầu vào chưa quantize) cộng vào nốt trước.
  Mốc ngắt dòng: bội `barsPerLine` ô nhịp từ ô nhịp đầu + mốc section (marker, hoặc mỗi `barsPerSection` ô
  nhịp). Nới nửa ô nhịp cho nốt đón: dòng bắt đầu trong nửa ô nhịp trước một mốc thì nuốt mốc đó và thuộc
  section mới. Nốt dài vượt mốc nằm trọn ở dòng của nó. Option không dương → mặc định; Infinity = không bao giờ. _Vòng review 3b: sửa / bổ sung ở D-277._
- **D-124 — Section từ MIDI.** Dòng trước marker đầu tiên thuộc "Main"; nhiều marker rơi vào một dòng → marker
  sau cùng thắng; marker rỗng bị bỏ, khoảng trắng gộp. Không có marker → "Phần N" (`AUTO_SECTION_PREFIX`) đánh
  số liên tục, section không có dòng bị bỏ. _Vòng review 3b: sửa / bổ sung ở D-277._
- **D-125 — `snapBeats`.** Giá trị rất gần k/d (d ≤ 192, sai số < 1e-7) thành đúng k/d, còn lại làm tròn 9 chữ
  số — serializer ghi gọn `1/3`, `0.5`, chùm ba không trôi. _Vòng review 3b: sửa / bổ sung ở D-279._

## Phase 2b — Trích melody, MIDI trực tiếp (src/midi/extract.ts, mapping.ts, webmidi.ts, recorder.ts)

- **D-126 — Dung sai legato khi trích melody.** Onset mới chỉ coi là chồng lên nốt trước khi phần còn vang của
  nốt trước > `legatoBeats` (mặc định max(1/8 beat, grid/2)); ít hơn là legato: nốt mới là nốt kế, nốt trước bị
  cắt tại onset mới. Không có dung sai thì policy `highest` xóa mọi nốt đi xuống chơi legato. Gợi ý track (`monophonicRatio`)
  dùng cùng dung sai: D-167.
- **D-127 — Chồng nốt.** Onset lệch ≤ 1/64 beat coi là cùng lúc. Onset mới cùng cao độ với nốt đang vang:
  `highest` / `lowest` bỏ (chỉ giữ khi cao hơn / thấp hơn hẳn); `longest` so độ dài gốc của hai nốt (D-165).
  Hòa trong nhóm hợp âm: highest / lowest ưu tiên nốt dài hơn, longest ưu tiên nốt cao hơn. Lời của nốt bị bỏ
  trong nhóm chuyển sang nốt được chọn (nếu nốt đó chưa có lời); nốt bị bỏ vì lý do khác: D-166.
- **D-128 — Gộp tie mặc định `auto`: CHỈ gộp vào nốt có lời** (xét từng nốt, D-164: nốt cùng cao độ, hở ≤ 1/64
  beat, không lời → gộp vào nốt trước có lời, giữ lời nốt đầu). Đoạn không lời không gộp: MIDI xuất từ bản nhạc đặt nốt lặp (C C G G)
  sát nhau, gộp sẽ mất nốt cần bấm. `mergeTies: 'always'` theo quy tắc gốc, `'never'` tắt; thu melody luôn
  `'never'`. _Góp ý 2026-10-15: thay / sửa bởi D-312._
- **D-129 — Quantize.** Trước khi làm tròn, khoảng trống < grid được lấp (nốt trước kéo tới nốt kế); chỉ khoảng
  trống ≥ grid thành rest (spec §6b A). Start và end làm tròn gần nhất; nốt co về 0 ô thì kéo thành 1 ô nếu ô
  đó trống, không thì bỏ (nốt sau thắng: nốt hoa mỹ, 1/32 dày đặc trên grid 1/4). grid ≤ 0 = không quantize.
- **D-130 — `mapMidiNote`.** Transpose trước (`transposeSemitones + 12 × transposeOctaves` từ Cài đặt); ngoài
  `playableRange(baseOctave)` (C3..C6 với base 4) → null, kể cả nốt bấm được bằng scroll (C#6, B2 với
  scrollDir −1). Trong tầm: cách bấm ít modifier nhất (quãng ≠ 0 tính 1, scroll tính 1), hòa theo thứ tự
  `keyChoicesForMidi` → C5 = `,` chứ không phải Z + chuột phải.
- **D-131 — Web MIDI.** Chỉ xin quyền trong `enable()` (`sysex: false`); gọi đồng thời dùng chung một request;
  NotSupportedError → `unsupported`, mọi lỗi khác → `denied` (thử lại được). Gắn bằng `input.onmidimessage`
  (mở cổng ngầm); đổi thiết bị / rút / dispose thì gỡ handler (chỉ khi vẫn là của mình) và `close()` cổng cũ;
  gắn lại cùng id (object mới) thì không close; `select(id)` gọi trước `enable` hoặc trước khi cắm vẫn tự gắn.
  statechange của cổng output bị bỏ qua. Note off luôn velocity 0. Listener ném lỗi không chặn listener khác
  (ném lại qua `queueMicrotask`). `dispose()` reset hẳn và xóa singleton; UI không bao giờ dispose singleton dùng
  chung (Settings / Practice / Thu melody).
- **D-132 — Thu melody (recorder).** Nốt bắt đầu sớm hơn beat 0 tối đa 1/4 beat được dời về beat 0; sớm hơn nữa
  (count-in) bị bỏ. Nốt < 40 ms bị bỏ (chạm nhầm); chồng ≤ 150 ms coi là legato; không gộp tie. Recorder lưu midi
  gốc; UI áp transpose của Cài đặt trước khi ghi.

## Phase 2b — Giao diện MIDI (src/midi/MidiImportView.tsx, RecordPanel.tsx)

- **D-133 — Wizard "Tạo bài từ MIDI".** midiFile.ts (@tonejs/midi) tải động khi chọn file đầu tiên (chunk
  riêng). Lỗi theo code: `too-large` (kiểm kích thước trước khi đọc, tối đa 2 MB), `invalid`, `no-notes`, cộng
  `drums-only` (`suggestMelodyTrack` = −1) và `read` (không đọc được file). Chọn file thành công thì tự sang
  bước 2; kéo-thả nhận trên cả trang khi ở bước 1. BPM từ file kẹp 20..400. _Vòng review 3b: sửa / bổ sung ở D-282._
- **D-134 — Phương án bước 4 gắn với khóa (cao độ, baseOctave, scrollDir, fold).** Lựa chọn của người dùng chỉ
  còn hiệu lực khi khóa không đổi; đổi grid / policy / track / fold / setting thì tự về phương án tối ưu mới.
  Melody đưa vào optimizer arrange không kèm title / artist (gõ tên không tính lại). Lúc tạo .harm, số event lệch
  thì dựng lại bằng `evaluateTranspose` cùng transpose. Câu `//!` dùng i18n `midi.foldWarning` theo ngôn ngữ
  lúc tạo.
- **D-135 — Mặc định của wizard.** Tên bài: luồng file dùng `titleFromFileName`, bản thu dùng "Bản thu MIDI"
  (theo ngôn ngữ cho tới khi sửa tay); tác giả trống thì bỏ; chọn file mới thì bước 4–5 về mặc định (gồm cả
  `breakRestBeats` / `barsPerLine` / `barsPerSection`). Nút cuối:
  cờ editor bật → "Mở trong Editor" (`addSong` + toast + `#/edit/<id>`); tắt → "Lưu và mở bài" (`#/play/<id>`,
  đúng D-060).
- **D-136 — Nghe thử track / melody.** Tối đa 12 s từ nốt đầu, synth của app trên bus nhạc (volume / timbre từ
  settings, gain 0,7), phát cả hợp âm, lên lịch dần lookahead 0,5 s. Một bản mỗi lúc; dừng khi bấm lại, đổi bước,
  ẩn tab, unmount hoặc `engine.stopAll()`. Phát cả khi `audioEnabled` tắt (hành động bấm chủ động).
- **D-137 — Thu melody.** Đếm vào 1 ô nhịp (mỗi beat đen một click, 6/8 = 3 click, click đầu có accent);
  metronome tiếp tục khi thu (toggle, mặc định bật). Beat 0 quy về trục `performance.now` qua
  `AudioContext.getOutputTimestamp()` (không có thì ước lượng outputLatency + baseLatency); không bật được âm
  thanh vẫn thu, đếm vào chỉ bằng hình. Dừng lúc đếm vào = hủy; bản thu rỗng sau quantize không lưu ("Không thu
  được nốt nào"). "Thu lại" giữ bản cũ cho "Hoàn tác" (tối đa 10). BPM / nhịp khóa khi thu; grid / policy áp lại
  ngay trên bản thu. Tự dừng sau 15 phút. Tiếng phản hồi chỉ phát lúc đếm vào hoặc thu. _Vòng review 3b: sửa / bổ sung ở D-276._
- **D-138 — Bật MIDI từ tab Thu melody.** Thành công → `settings.midiEnabled = true`; `midiEnabled` đã bật thì tự
  `enable()` khi mở tab (không xin quyền lúc tải app). Chưa nhớ thiết bị → tự chọn thiết bị đầu tiên đang cắm và
  lưu `midiInputId` (chỉ khi tab Thu đang hiện, MIDI bật và người dùng chưa chọn "— Chọn thiết bị —": D-170);
  đổi thiết bị lưu ngay. Rời `#/midi` khi có việc dở: D-171.

## Phase 2 — Tích hợp

- **D-139 — Phase 2 / 2b bật cờ** `editor`, `share`, `midiImport` (D-060): thư viện có "Bài mới", "Tạo bài từ
  MIDI", link "Sửa"; Player có link "Sửa", chip lỗi cú pháp là link tới Editor, bài rỗng có "Mở trình soạn".
  Test vẫn mock cờ để giữ cả hai nhánh; `App.test` kiểm cờ thật đều bật.
- **D-140 — Route Editor / Share / MIDI tải lười** (`React.lazy` + `Suspense`, lúc chờ hiện "Đang tải…"
  `role=status`): Thư viện và Player (dùng nhiều nhất, kể cả OBS) không phải tải code soạn bài; @tonejs/midi
  tách thêm một chunk nữa (D-133). Build Phase 2: chunk chính ≈ 125 KB gzip (tải đầu ≈ 136 KB, tính cả chunk
  parser và CSS), tổng JS + CSS ≈ 190 KB gzip (spec: < 400 KB), hết cảnh báo chunk > 500 KB. Phase 3
  (`build:single`) phải inline các chunk động. Nội dung route
  nằm trong `RouteErrorBoundary` (key = tên route): chunk không tải được (vd. tab cũ sau khi deploy bản mới, file
  chunk cũ đã mất) hoặc view ném lỗi khi render → thẻ "Không mở được trang này" + nút "Tải lại trang" (thanh
  điều hướng vẫn dùng được) thay cho màn hình trắng.
- **D-141 — Clipboard giả trong e2e.** Smoke Phase 2 (`e2e/phase2.spec.ts`) thay `navigator.clipboard` bằng bộ
  nhớ trong trang (`addInitScript`): app vẫn gọi `writeText` như thật nhưng chạy test không ghi đè clipboard hệ
  điều hành (Edge headless trên Windows dùng clipboard thật, đổi `\n` thành `\r\n`) và không cần cấp quyền. File
  MIDI của e2e tự sinh bằng `src/midi/testing/smf.ts`.
- **D-142 — Router hỏi "interceptor" trước khi báo React** (`addNavigationInterceptor`, src/ui/router.ts).
  `popstate` / `hashchange` bắn thẳng ở `window`; Chromium chạy listener ở window theo thứ tự đăng ký (capture
  KHÔNG được ưu tiên như chuẩn DOM / jsdom). Vào Editor từ thư viện thì listener của router có trước guard, và
  khi bấm Back React kịp render route mới (microtask giữa hai listener) làm gỡ luôn guard → Back không bị chặn.
  Guard của Editor (`installHashGuard`) vừa đăng ký interceptor (đường chính trên Chromium) vừa giữ listener
  capture (chuẩn DOM); hàm kiểm tra gọi lần hai cho cùng sự kiện thấy URL đã khớp nên không chặn / báo lại.
- **D-143 — Số ít cho tham số đếm bất kỳ:** `{x:một|nhiều}` trong chuỗi (vd.
  `'{tracks} {tracks:track|tracks} with notes'`) — `translateCount` (src/i18n/useT.ts) lấy chữ "một" khi
  `params.x` là 1, không thì "nhiều". Dùng
  cho câu có số đếm không tên `n` hoặc có nhiều số đếm (tóm tắt lỗi Editor / Share, bước 1 và 5 wizard MIDI,
  thống kê preview, Tối ưu lại, `diag.lyric-mismatch`, `library.countFiltered`); key `_one` (D-064) vẫn dùng cho
  câu một số đếm `n`. "Là 1" gồm cả chuỗi `"1"` vì nơi gọi hay truyền số đã định dạng (`formatBeats`) — trước
  đây `{ n: '1' }` ra "1 beats". Placeholder thay một lượt trên template nên giá trị chèn vào (tên file có dấu
  ngoặc) không bị hiểu thành placeholder. Chỉ `useT` / `tNow` / `translateCount` hiểu cú pháp này (`translate`
  thô thì không — renderer chỉ dùng nó cho chuỗi không đếm). Câu tiếng Việt không cần. `useT.test.ts` bắt chuỗi
  EN có `{x} <danh từ số nhiều>` mà thiếu dạng số ít (trừ danh sách tham số không bao giờ bằng 1).
- **D-144 — Modal chồng nhau, bấm nền.** `components.tsx` giữ ngăn xếp modal đang mở theo thứ tự mở: chỉ modal
  trên cùng xử lý Tab / Esc (listener trên window của modal dưới bỏ qua phím; Esc gọi `stopImmediatePropagation`
  nên một Esc đóng đúng một dialog), mọi con khác của `<body>` — kể cả modal bên dưới — bị `inert`. Modal trên
  đóng → modal dưới dùng lại được, focus về chỗ cũ trong nó (vd. Back khi đang mở công cụ: Esc ở "Rời trình
  soạn?" chỉ đóng hộp đó, lời đã gõ trong modal công cụ còn nguyên). Modal dưới đóng trước thì nền vẫn `inert`
  và modal trên nhận phần tử trả focus của modal dưới. Chỉ gỡ `inert` do Modal tự đặt. Bấm nền chỉ đóng khi là
  nút chính (chuột trái) — chuột phải / giữa là modifier của practice; prop `closeOnBackdrop={false}` dành cho
  dialog không được mất vì một cú bấm lỡ tay (bảng kết quả practice, người chơi còn đang bấm chuột khi bài hết).
- **D-145 — Nút đang bật (`aria-pressed`) khi hover giữ nền accent** (`--accent-strong`, chữ `--accent-text`,
  ≥ 4.5:1 cả hai theme — `contrast.test.ts`) thay vì `--surface-3` của `.btn:hover` (≈ 1.4:1 lúc chuột còn nằm
  trên nút vừa bấm). **Toggle dạng grid** (switch | nhãn, hint nằm dưới nhãn): nhãn dài xuống dòng ngay cạnh
  switch thay vì cả nhãn rơi xuống dưới switch.

## Phase 2 — Vòng sửa sau review

### Core

- **D-146 — Donate: chia dòng dài thành các dòng `.harm` CÙNG LOẠI, không bao giờ cắt trong lời** (sửa D-084,
  src/core/donate.ts). Điểm tách chỉ nằm giữa các đoạn token ngoài `[...]`; vị trí nốt lấy bằng `parseHarm` từng
  dòng (memo trong một lần gọi). Cắt cứng chỉ khi một token dài hơn cả một phần (luyến rất dài).
  - Lời khớp số nốt: chia theo nốt thành các dòng `chữ: token`, mỗi dòng mang đúng chữ của các nốt trong nó (đoạn
    chỉ có hold / rest thì không có lời) → karaoke vẫn khớp sau khi dán lại. Mảnh lời mở đầu bằng `@` `#` `//`
    hoặc `số/số ` được escape U+2060 (`canonicalLyric`). Một đoạn cùng chữ của nó vẫn không vừa thì lời đoạn đó
    rút gọn bằng `…`.
  - Lời không khớp số nốt: lời ở mảnh đầu; mảnh đầu kéo tới hết đoạn chứa đơn vị đầu tiên (không thành "lời
    không có nốt"). Lời + đoạn đó không vừa → rút gọn lời bằng `…` (cắt ở khoảng trắng nếu còn giữ được ≥ nửa
    chỗ, không thì cắt cứng, không cắt đôi surrogate); vẫn không được thì bỏ lời. Không rải lời lệch số nốt ra
    nhiều dòng (lời ngắn kiểu "(x2)" sẽ rơi vào giữa dòng).
  - Directive / header (`@title`, `@artist`, `# tên`…) dài hơn một phần: rút gọn giá trị bằng `…`, không chia
    (vd. fixture 2 ở limit 30: title "Bài thử lặp đoạn…" — D-443). `@repeat` bị rút gọn có thể không còn khớp section,
    nhưng `buildDonateText` không ghi `@repeat`. Dòng chỉ có lời mà dài: rút gọn, giữ dấu `:`. Dấu `k/n ` có
    sẵn ở đầu một dòng dài bị bỏ trước khi chia.
  - Bảo đảm (property test limit 30..80 và rải tới 420, 8 tổ hợp option, cả 2 seed): văn bản không lỗi dán lại
    không sinh lỗi hay cảnh báo, giữ nguyên dãy nốt và tên section, không thêm lyric-mismatch. Chỉ title /
    artist / header / lời có thể bị rút gọn, và chỉ ở limit rất nhỏ (seed 2: lời bị rút gọn ở limit ≤ 50; seed 1
    không bao giờ).
- **D-147 — Link chia sẻ: dọn nguồn trước khi nén** (bổ sung D-085, src/core/share.ts). `sanitizeShareSource`:
  ký tự điều khiển C0 trừ tab / LF / CR → dấu cách, surrogate lẻ → U+FFFD; `encodeShareData` nén văn bản đã
  dọn (link chở văn bản đã dọn), và heuristic "link hỏng" của `decodeShareData` là
  `sanitizeShareSource(out) === out` — encode và decode dùng chung một luật, nên mọi nguồn chia sẻ được đều ra
  link mở được.
  `isShareableSource` = nguồn đã dọn còn chữ khác khoảng trắng; Editor không sao chép link cho bài rỗng / toàn
  khoảng trắng mà toast lỗi "Bài chưa có nội dung để chia sẻ." (link như vậy chỉ mở ra màn hình "link hỏng").
- **D-148 — CR lẻ là xuống dòng ở mọi nơi trong core** (sửa D-043 / D-081 / D-082), giống Editor (D-100),
  `io.normalizeText`, melodyBuild và `setLineLyrics`. Parser tách dòng theo `LINE_BREAK_RE` (`/\r\n?|\n/`, export
  từ parser.ts); số dòng của diagnostic và span tính theo đó (CR CR LF = 2 lần xuống dòng; `@title A\rB` = title
  A + dòng nốt B). `splitSource` / `applyTextEdits` giữ `\r` lẻ làm kiểu xuống dòng của dòng; chunkDonateText
  tách cùng cách. Serializer (`oneLine`) đổi CR lẻ trong text một dòng thành dấu cách nên văn bản ghi ra không
  bao giờ có CR. Sửa cả parser chứ không chỉ serializer, vì chỉ sửa `oneLine` thì điểm bất động D-043
  ("`canonicalSong` không đổi gì với model parser đọc ra") vỡ với nguồn có CR lẻ (fuzz parser bắt được). Hệ quả:
  nguồn chưa chuẩn hóa có CR lẻ (link chia sẻ tự chế, bài lưu từ link như vậy) giờ parse đúng như Editor hiển
  thị; văn bản trong app (Editor, import, serializer) vốn không có CR lẻ nên không đổi gì. `serializer.oneLine`
  dùng regex literal giống hệt `LINE_BREAK_RE` thay vì import (test thư viện mock `../core/parser` chỉ có
  `parseHarm`, nên module core không được đọc export của parser lúc load).
- **D-149 — Lời trả ra từ chia lời escape bằng chính `canonicalLyric`** (bổ sung D-098 / D-080):
  `joinSyllables` = `canonicalLyric(words.join(' '))`, nên `harmLyricText` / `distributeLyrics` escape cả `số/số `
  đầu lời và hai luật không thể lệch nhau. Kết quả là điểm bất động của `canonicalLyric`, parse lại đúng nguyên
  văn, không diagnostic.

### Practice

- **D-150 — Loop A-B trong practice: lần bấm vắt qua wrap** (bổ sung D-112 / D-117, src/player/practice.ts).
  Khi transport sẽ wrap (`wrapEndOf`), nốt từ loop end trở đi không được chấm ở vòng đó. Bấm không khớp vòng
  hiện tại nhưng nằm trong cửa sổ good (≤ 220 ms) trước loop end và khớp nốt đầu vòng kế thì được chấm trước theo
  luật của chế độ (Chấm điểm: gần nhất ±220 ms; Chờ: nốt mục tiêu của vòng kế, Δ ≥ −220 ms là Perfect): nháy
  ngay, không đổi combo / số sai của vòng hiện tại, được tính vào lượt mới lúc wrap (`wrapLoop`). Bấm muộn ngay
  sau wrap mà khớp nốt cuối vòng trước (chưa chấm, còn trong cửa sổ lúc wrap) chỉ nháy GOOD / PERFECT: không
  tính vào lượt nào, không tính sai. Bấm sai ở cả hai vòng vẫn là SAI ngay. Phần vắt qua bị bỏ (`dropLoopCarry`)
  khi transport gián đoạn không phải wrap (pause, seek, giữ bài ở chế độ Chờ, đổi clock, hết bài) hoặc khi đổi
  loop / đổi chế độ / reset. Mỗi lần bấm nốt, engine gọi `transport.update()` trước khi chấm để wrap / hết bài đã
  tới hạn mà frame chưa chạy được áp trước. Lúc wrap: chữ nháy được giữ nếu có lần bấm chấm trước được tính vào
  lượt mới, không thì xóa như cũ. Giới hạn: lần bấm chấm trước chỉ hiện trên tile sau khi wrap (≤ 220 ms sau).
- **D-151 — Bản vẽ lại vòng kế (k ≥ 1) không mang trạng thái practice** (bổ sung D-071, `FLAG_COPY` trong
  renderer.ts): không mờ, không viền chấm, không loé, không nhấp nháy chờ — kể cả nốt đã chấm trước cho vòng kế
  (trạng thái hiện ra khi wrap). Chỉ vòng hiện tại có viền PERFECT / GOOD / MISS.
- **D-152 — Phím tắt Player khi giữ Ctrl / Alt thay modifier practice** (bổ sung D-033 / D-114,
  practiceInput.ts). Phím tắt Player (Space R ← → L [ ] và Esc, `PRACTICE_PASSTHROUGH_CODES`) bấm kèm Ctrl / Alt:
  nếu mọi cờ Ctrl / Alt đều do phím thay thế modifier practice ĐANG GIỮ thì practice chặn lệnh trình duyệt
  (preventDefault: Alt+←/→ history, Ctrl+R tải lại, Alt+Space menu) và phát lại keydown trơn trên window để
  `useHotkeys` xử lý (Alt+Space = Phát / Tạm dừng, Ctrl+R = Từ đầu). Không đụng tới, trình duyệt xử lý như cũ:
  Ctrl / Alt không phải phím thay thế, chưa giữ, có kèm Meta, phím khác (Alt+F, Ctrl+T…), hoặc focus đang ở ô
  nhập chữ / select / dialog. `useHotkeys` không đổi (D-033 vẫn đúng vì sự kiện phát lại không có modifier). _Góp ý 2026-10-15: thay / sửa bởi D-316._
- **D-153 — Câu MIDI trên HUD theo trạng thái thật** (bổ sung D-118). `PracticeUiState.midi` =
  `'off' | 'pending' | 'listening' | 'denied' | 'disconnected'`: `listening` khi đã có quyền, thiết bị đã chọn
  đang cắm và đang được chọn; `denied` khi không được cấp quyền (kết quả `unsupported` của `enable()` cũng hiện
  như denied); `disconnected` khi có quyền nhưng thiết bị đã chọn không cắm (cập nhật theo hot-plug qua
  `onDevicesChange`). Không hiện câu khi off hoặc đang xin quyền; câu trả lời muộn của `enable()` (sau khi đã tắt /
  đổi) bị bỏ nhờ token.
- **D-154 — Bố cục khi practice bật.** Khu sân khấu `user-select: none` và chặn `selectstart` trên vùng nhận chuột,
  nên bấm chuột nhanh không bôi đen lời / game bar (practice tắt thì vẫn chọn chữ như cũ). Màn thấp
  (`max-height: 800px`, vd. laptop 1366×768): trang được cuộn và khung canvas tối thiểu 320 px thay vì ép khu tiles — mở rộng
  quy tắc "màn hẹp / thấp: cho cuộn"; 1080p / 1440p không đổi (100dvh, không cuộn). HUD giữ nguyên chữ (câu nhắc
  focus là yêu cầu của spec). Bảng kết quả không đóng khi bấm nền (`closeOnBackdrop={false}`, D-144).

### Editor

- **D-155 — Lưu bài mẫu / bài tạm giữ nguyên phiên soạn** (bổ sung D-101). EditorView giữ state
  `{id, seq, handoff}`, key của EditorScreen là `seq`; `save()` báo `handoff` = id bản sao trước khi navigate
  replace, nên route đổi sang bản sao mà không mount lại: còn Hoàn tác Công cụ, undo gốc của textarea, con trỏ,
  cuộn, focus; thông báo chỉ đọc biến mất và bài thành bài user (Lưu sau đó cập nhật tại chỗ). Mở bài khác, kể
  cả chính bài mẫu, là phiên mới. "Phát từ dòng con trỏ" vẫn kết thúc phiên (sang Player luôn mount lại, giống
  bài user).
- **D-156 — Focus và menu Công cụ** (bổ sung D-061 / D-111). Mở công cụ từ menu: focus nút "Công cụ" trước rồi
  mới ẩn menu, nên Modal trả focus về nút này khi đóng (Esc / × / Hủy). Áp dụng có thay đổi → sau khi Modal đóng,
  focus về ô soạn (`preventScroll`). Menu đóng khi focus rời sang phần tử ngoài menu; `relatedTarget` null thì
  không đóng (để mousedown-ngoài xử lý, vì Safari không focus nút khi click). Màn ≤ 760px: danh sách bám theo
  cả thanh công cụ (ngay dưới thanh, rộng bằng thanh) thay vì mép trái nút; mọi bề rộng đều có
  `max-width: calc(100vw − 16px)`.
- **D-157 — Bấm lỗi / "Dòng N": cuộn ngang và cuộn trang** (bổ sung D-107, `moveCaret` trong HarmTextarea.tsx).
  Ngoài cuộn dọc còn cuộn ngang theo bề rộng ký tự monospace (đo bằng span ẩn, cache theo font, không đo được thì
  ước lượng 0.6em; cột 0 → `scrollLeft` 0, ngoài tầm thì đưa vào giữa ô). Dòng đích nằm ngoài dải [15% khung
  nhìn, đáy − 8px] thì cuộn trang, đưa dòng về khoảng 1/3 khung nhìn (15% chừa cho thanh điều hướng dính — bố cục
  xếp chồng ≤ 960px). Không có layout (jsdom) thì chỉ đặt con trỏ.
- **D-158 — Phương án cung trong Nhập cảm âm gắn với khóa nội dung cao độ** (bổ sung D-108; `pitchKey`, như
  D-134 của MIDI): đổi Tên bài / Tempo hay thêm comment không làm mất lựa chọn và không chạy lại optimizer; cao độ
  đổi thì chọn lại phương án tốt nhất.
- **D-159 — Tap timing đang tap dở (≥ 1 lần tap)** (bổ sung D-097): Esc / × / Hủy / bấm nền không đóng mà hiện
  câu hỏi `role=alert` ngay trên ô tap ("Bỏ N lần tap và đóng" / "Tiếp tục tap"), focus về ô tap. Tap tiếp (Space
  hoặc chạm) là bỏ câu hỏi và giữ các lần tap; Esc / × / nền lần nữa vẫn không đóng, chỉ nút "Bỏ … và đóng" đóng.
  Space trên nút của câu hỏi bấm nút đó, không tính là tap. Hoàn tác hết tap thì đóng không cần hỏi.
- **D-160 — Chia lời: chỉ dòng có nốt (`unitCount > 0`) nhận lời dán** (bổ sung D-099), ở cả hai chế độ: modal
  chỉ đưa các dòng đó vào `distributeLyrics` rồi map kết quả về. Dòng chỉ có nghỉ nhận "không lời" (đã dán lời thì
  lời cũ của dòng đó bị bỏ, như chế độ chảy vốn làm); dòng sau dòng nghỉ không còn bị lệch ở chế độ theo dòng.
  "dòng nốt" và "dòng lời thừa" chỉ đếm dòng có nốt.
- **D-161 — "Đã lưu" của ShareView suy từ thư viện** (bổ sung D-106): id đã lưu từ link này trong phiên (Map ở
  module; còn trong thư viện thì dùng, kể cả khi bài đã được sửa), không thì bài user có nguồn giống hệt cũng coi
  là đã lưu (không nhân bản; Phát / Mở trong trình soạn dùng bài đó). Xóa bản đã lưu thì lưu lại được. Nút "Đã
  lưu vào thư viện" dùng `aria-disabled` thay vì `disabled` (bỏ qua click) để giữ focus.
- **D-162 — Donate khi văn bản có lỗi cú pháp** (bổ sung D-105): ghi chú cảnh báo số lỗi (donate sinh từ model
  nên token lỗi bị bỏ / độ dài sai bị sửa) kèm nút "Tới lỗi đầu tiên" (đóng modal, sau khi Modal trả focus thì
  nhảy tới lỗi đầu theo dòng / cột). Không chặn sao chép.
- **D-163 — Dòng `@repeat` trong preview đánh dấu bằng vạch trái + nhãn "lặp dòng N"** (bổ sung D-107), không
  dùng opacity: chip nốt phải giữ contrast AA, nhất là theme sáng.

### MIDI

- **D-164 — `mergeTies: 'auto'` xét TỪNG NỐT, không theo cả file** (sửa D-128). Chỉ gộp nốt cùng cao độ, liền
  nhau (hở ≤ 1/64 beat), không lời vào nốt trước (hoặc đầu chuỗi đã gộp) có lời. Đoạn không lời (intro, gian tấu
  của file karaoke) giữ nguyên nốt lặp. Chấp nhận: một chuỗi nốt lặp không lời dính liền ngay sau một chữ hát vẫn
  bị gộp vào chữ đó. Không thêm toggle tie ở bước 3. `'always'` / `'never'` không đổi.
- **D-165 — Policy `longest` so độ dài GỐC** (sửa D-127). Onset mới lúc nốt trước còn vang quá dung sai legato:
  so độ dài trước khi bị cắt (`full`) của hai nốt. Nốt mới dài hơn → cắt nốt trước tại onset mới; bằng nhau → giữ
  nốt cao hơn (giống phá hòa trong nhóm hợp âm); ngắn hơn → bỏ nốt mới, và nốt đã bỏ không hiện lại sau khi nốt
  dài hết (giống `highest`). Vd. C5 4 beat trên 8 nốt móc đệm → giữ C5.
- **D-166 — Lời của nốt bị bỏ không mất** (bổ sung D-127 / D-129). Bỏ vì chồng lên nốt đang vang → lời sang nốt
  đang vang. Bỏ vì < `minBeats` hoặc quantize co về 0 ô → lời sang nốt giữ lại kế tiếp (hết nốt thì sang nốt
  trước). Nốt nhận đã có lời thì nối theo thứ tự thời gian bằng `_` (một nốt = một chữ karaoke, như D-122). Nhóm
  hợp âm cùng onset giữ luật D-127 (chỉ chuyển khi nốt được chọn chưa có lời).
- **D-167 — `monophonicRatio` dùng cùng dung sai legato với `extractMelody`** (bổ sung D-126): 1/8 beat =
  `ppq × defaultLegatoBeats(DEFAULT_EXTRACT.grid)`. Đuôi nốt vang quá onset kế ≤ 1/8 beat được cắt tại onset đó
  trước khi đo, nên melody chơi legato không bị coi là đa âm khi gợi ý track. Hợp âm cùng onset vẫn tính là
  chồng.
- **D-168 — Nhiều tempo / time signature event cùng một tick** (bổ sung D-121): event sau cùng (theo thứ tự file;
  track sau ghi đè track trước) có hiệu lực (`lastPerTick`, áp sau khi bỏ tempo không hợp lệ). `tempoChanges` đếm
  sau khi gộp. Không thêm ô chọn nhịp ở bước 3.
- **D-169 — File MIDI hỏng** (bổ sung D-119): `ParsedMidi.damaged = true` khi lượt quét chặt lỗi (phải dùng dữ
  liệu tonejs), khi có chunk khai dài quá cuối file, hoặc khi file thiếu track so với header. Wizard cảnh báo ở
  bước 1 và 2 (`midi.file.damaged`), không chặn. Thiếu End-of-Track mà độ dài chunk vẫn đúng thì KHÔNG coi là
  hỏng (tránh báo nhầm).
- **D-170 — Tự chọn thiết bị ở tab Thu melody** (sửa D-138): chỉ tự chọn và lưu thiết bị đầu tiên đang cắm khi
  đủ các điều kiện: tab Thu đang hiện, MIDI đang bật trong Cài đặt, chưa nhớ thiết bị, và người dùng chưa chủ
  động chọn "— Chọn thiết bị —" trong lần mở trang này (kể cả khi danh sách thiết bị cập nhật). Panel ẩn (đang ở
  tab File) không chọn / gắn thiết bị. MIDI tắt trong Cài đặt (dù quyền đã cấp trong phiên) → tab Thu hiện nút
  "Bật MIDI"; bấm thì `midiEnabled = true` rồi mới gắn thiết bị đã nhớ.
- **D-171 — `#/midi` chặn rời trang khi có việc dở** (theo D-104): `beforeunload` + `installHashGuard` khi đã đọc
  file (luồng file, ở mọi bước), đang đếm vào / thu, hoặc có bản thu. Hết chặn sau khi bấm "Mở trong Editor" /
  "Lưu và mở bài". Modal "Rời trang tạo bài?" có 2 nút Ở lại / Bỏ và rời đi (không có "Lưu rồi đi" vì chưa có
  bài để lưu); lời nhắc khác khi đang thu. Back bị chặn để lại một mục history — chấp nhận như Editor.
- **D-172 — Track trùng tên trong bảng chọn (a11y):** tên truy cập (radio, piano roll, nút nghe thử) thêm
  "· kênh N"; vẫn trùng (cùng tên, cùng kênh, khác track file) thì thêm "· track i". Tên hiển thị không đổi; tên
  không trùng giữ nguyên nên selector cũ (`Chọn track "Melody"`) vẫn khớp.

## Phase 2c — Kiểu điều khiển Mobile: core (src/core/mobile.ts, mobileText.ts, optimizer.ts)

- **D-173 — Kế hoạch chạm `buildMobilePlan(tl, { semitone })`.** Cue gắn với note index của timeline, beat =
  `startBeat` của nốt đổi trạng thái. Trạng thái (chế độ quãng, Nửa Cung) GIỮ qua nghỉ, ngắt dòng, ngắt section;
  đầu bài = Ngẩng Tự Nhiên, Nửa Cung tắt. Đổi thẳng Cúi Xuống ↔ Ngẩng Lên là một cue; cue quãng đứng trước cue
  Nửa Cung khi cùng nốt; cue giữa luyến được. Không phụ thuộc `baseOctave` / `scrollDir`. `MobilePlan.semitone`
  (tùy chọn, `buildMobilePlan` luôn đặt; thiếu = `'toggle'`) cho `mobileStateAt` biết Nửa Cung tự tắt sau nốt
  (`oneShot`) hay giữ tới lần chạm tắt (`toggle`) — bài kết thúc bằng nốt thăng không còn mơ hồ; khoảng bật cache
  theo object plan (WeakMap, plan coi là bất biến). `mobileStateAt` O(log n): cue đúng tại `beat` đã áp,
  `nextCue` = cue đầu có beat > `beat` (cùng object trong `plan.cues`), NaN = trước bài. _Vòng review 3b: sửa / bổ sung ở D-263._
- **D-174 — Span mobile theo spec:** từ start nốt đầu tới end nốt cuối (điệp khúc seed 1 kết thúc ở nốt cuối,
  không kéo tới `totalBeats`); "kể cả nghỉ cuối bài" do latch bảo đảm (`mobileStateAt` trong nghỉ cuối vẫn trả
  chế độ đang chọn). `semitoneSpans`: `toggle` = chuỗi nốt thăng liên tiếp (nghỉ không cắt), `oneShot` = mỗi nốt
  thăng một span.
- **D-175 — Cost model mobile của optimizer** (`OptimizerOptions.scheme = 'mobile'`, `mobileSemitone`):
  `10 × nốt Nửa Cung + 4 × lần chạm đổi chế độ quãng + 4 × lần chạm Nửa Cung + 1000 × nốt gập quãng`, không có
  cost theo nốt có modifier. Chạm quãng khi quãng khác nốt trước; chạm Nửa Cung: `toggle` khi trạng thái thăng
  đổi so với nốt trước, `oneShot` mỗi nốt thăng. Trạng thái giữ qua nghỉ, bắt đầu tự nhiên / tắt (khớp D-173).
  `MOBILE_COST`; `PlacementStats.octaveTaps / semitoneTaps` CHỈ có khi mobile, và `placementCost` chọn công thức
  theo sự có mặt của hai key đó → `Placement.cost === placementCost(stats)` cho cả hai scheme, UI tính cost bài
  hiện tại bằng `buildMobilePlan(...).stats`. Stats mobile vẫn điền `holdRuns` / `modifiedNotes` (định nghĩa PC,
  chỉ để xem). Đường PC không đổi: DP chỉ-giá-trị giữ nguyên, `solve()` tra bảng chuyển tiền tính (đã gồm cost
  từng nốt), cost nguyên, phá hòa `<` chặt → kết quả PC giống hệt bit. `mobileSemitone` bỏ qua khi scheme PC. Vd.
  giai điệu nhảy quãng có nghỉ: PC chọn t=−5, Mobile chọn t=0 (chế độ giữ qua nghỉ).
- **D-176 — Văn bản kiểu Mobile** (`serializeMobileText`, chỉ để đọc — không dán lại vào Editor được): nốt = **vị
  trí nút 1–8** từ trái sang (`Z` = 1 … `M` = 7, `,` = 8), không chấm quãng — quãng do token chạm chế độ mang (khác
  tile / game bar Mobile, nơi số giản phổ có chấm). _Sửa 2026-10-15: bản đầu mục này ghi nhầm "số giản phổ + chấm
  (U+0307 / U+0323)"; code (`button()` trong `mobileText.ts`), test và README luôn dùng vị trí nút._ Cue trên nốt
  đầu đơn vị = token riêng đứng trước (`[Cúi Xuống] 6`); cue giữa luyến dính vào nốt (`1-[Cúi Xuống]6`); nhiều cue
  cùng nốt viết liền (`2-[Ngẩng Lên][Nửa Cung]3`); `toggle`:
  chạm bật và chạm tắt đều ghi `[<tên Nửa Cung>]` (cùng một nút). Tên nút do UI truyền (useModifierLabels, ép một
  dòng). Legend (i18n) là dòng đầu `// …` (rỗng thì bỏ); directive luôn ghi; bài qua `canonicalSong` như
  `serializeHarm`; độ dài luyến hiển thị = `notes[0].beats × n`. Donate: select "Kiểu chữ" PC / Mobile, mặc định
  theo Cài đặt lúc mở; bỏ dòng trống rồi `chunkDonateText`; ghi chú "chỉ để đọc". Giới hạn chấp nhận: dòng
  Mobile quá dài bị chia thì lời chỉ còn ở phần đầu (`chunkDonateText` đọc dòng bằng `parseHarm`).

## Phase 2c — Mobile trong Player, tên gọi nút

- **D-177 — Tile Mobile:** nhãn là số giản phổ, chấm quãng vẽ bằng `arc` trên canvas (khối nhãn chừa
  `dotExtra`); bỏ mũi tên ↓/↑ (chấm đã nói quãng), giữ badge `#`, màu tile theo modifier như PC. Nhãn phụ
  `'number'` không lặp lại số (solfège giữ).
- **D-178 — Gutter Mobile:** ~70% trái = span chế độ ≠ tự nhiên (xanh dương Cúi Xuống, cam Ngẩng Lên), 30% phải =
  span Nửa Cung (xanh lá). Nhãn "CHẠM: <tên>" rộng cả gutter ở đầu span (nhãn Nửa Cung cùng beat với span quãng
  xếp sau nhãn quãng); span quá ngắn dùng ký hiệu gọn ↓ ↑ #; span bị cắt ở đầu loop không có nhãn; không có THẢ.
  Nhãn gutter nhỏ như "GIỮ" của PC (gutter 56 px); viên cue mới phóng theo lane.
- **D-179 — Vạch cue:** mỗi cue một vạch đứt `[6,4]` ngang các lane, màu chế độ đích (Ngẩng Tự Nhiên dùng màu
  viền trung tính), vẽ dưới tile; viên "CHẠM: …" vẽ trên tile, ngay phía tương lai của vạch, ở đầu hoặc cuối hàng
  lane — bên ít chồng hơn (lane nốt cue ×4, hai nốt kế ×1, hòa → trái). Cue cùng beat (quãng rồi Nửa Cung) chung
  một bên, đứng cạnh nhau; cỡ chữ theo bề rộng lane 10–18 px. Cue đã qua mờ, cue trong ô đếm vào mờ hẳn.
- **D-180 — Nhắc trước và banner Mobile:** "sắp chạm" = 1 beat trước hit line (`CUE_SOON_BEATS`); mọi cue cùng
  beat báo chung ("SẮP CHẠM: Ngẩng Lên + Nửa Cung"), các nút tương ứng trên game bar nháy. Banner Mobile luôn hiện
  "CHẾ ĐỘ: … · Nửa Cung: BẬT/TẮT" (màu theo luật PC: trái/phải thắng Nửa Cung; chỉ Nửa Cung = xanh lá; tự nhiên +
  tắt = trung tính), ≤ 720 px xuống hai dòng. Game bar Mobile: 4 nút chế độ theo thứ tự game (Nửa Cung · Ngẩng Lên
  · Ngẩng Tự Nhiên · Cúi Xuống) + 8 nút số có chấm theo chế độ hiện tại. `mobilePlanFor` (WeakMap theo timeline)
  dùng chung cho engine và renderer; `mobileUiAt` trả lại object cũ khi không đổi (React không render thừa). _Vòng review 3b: sửa / bổ sung ở D-263, D-272._
- **D-181 — Tên gọi nút (`labelOverrides`):** mọi chỗ hiện tên modifier lấy từ `useModifierLabels` /
  `currentModifierLabels` — game bar / banner / canvas, Cài đặt (phím practice, cảnh báo Ctrl+N, chiều Nửa Cung,
  gợi ý MIDI), Editor (preview, optimizer, tap timing, donate). Ribbon / banner PC vẫn ghi theo chuột ("GIỮ CHUỘT
  PHẢI"), chỉ tên modifier đổi. Cài đặt: 4 ô cho cả hai scheme (tên dùng cả ở game bar PC; "Ngẩng Tự Nhiên" ghi rõ
  chỉ có ở mobile), giữ nháp cục bộ khi đang gõ (store trim mỗi lần set sẽ nuốt dấu cách), placeholder = tên mặc
  định, maxLength 24, nút "Mặc định" tắt khi ô trống và trả focus về ô.
- **D-182 — Scheme ở các màn khác:** Optimizer / "Tối ưu lại" / Preview / wizard "Tạo bài từ file" dùng cost và cột
  theo scheme (Mobile: Nốt {Nửa Cung} · Chạm đổi chế độ · Chạm {Nửa Cung}; thiếu số → "—"); wizard truyền
  `scheme` / `mobileSemitone` cho OptimizerPanel và lựa chọn của người dùng gắn khóa theo scheme. Practice trong
  scheme Mobile VẪN nhận phím / chuột kiểu PC (game bar ánh xạ giữ trái / phải / scroll sang nút Cúi Xuống / Ngẩng
  Lên / Nửa Cung); chưa có chạm-chọn chế độ khi luyện tập. Chữ EN dạng "Notes on {scroll}" để test số nhiều không
  coi tên là số đếm.

## Phase 2c — Âm thanh mặc định tắt (src/player, src/audio, Cài đặt)

- **D-183 — Cổng âm thanh:** AudioContext chỉ unlock / làm nóng khi `audioEnabled || clickSound` (`wantsAudio`).
  Scheduler nhận timeline không nốt trừ khi `audioEnabled` (practice: thêm điều kiện "Nghe giai điệu mẫu" đang
  bật), và `{ clicks: clickSound, metronome: clickSound && metronome }` (`PlanOptions.clicks: false` = không click
  nào, kể cả đếm vào). Cả hai tắt → Play chạy ngay trên `performance.now`, đếm vào chỉ bằng hình. Đổi giữa
  "giai điệu" và "chỉ click" chỉ báo lại scheduler. Tiếng phản hồi practice theo `practiceFeedback` riêng (giai
  điệu và click đều tắt thì chỉ unlock context, không đổi clock); nốt mẫu của chế độ Chờ là giai điệu → cần
  `audioEnabled`. Migrate settings v2 → v3 ép `audioEnabled = false` một lần. Player bỏ nút âm thanh / metronome
  (key i18n cũ đã xóa); bị trình duyệt chặn thì chỉ có toast một lần. Overlay (Phase 3) luôn im lặng. _Vòng review 3b: sửa / bổ sung ở D-284._
- **D-184 — Mục "Nâng cao — âm thanh":** `<details>` rộng cả trang sau lưới card, đóng mỗi lần vào trang; 3 nhóm
  Giai điệu mẫu / Metronome – đếm vào / Tiếng khi luyện tập. Summary có huy hiệu "Đang bật giai điệu" (đỏ) và "Đang
  bật tiếng click" để streamer thấy ngay. Âm sắc / âm lượng giai điệu bị tắt khi giai điệu tắt, metronome / âm
  lượng click bị tắt khi click tắt (có ghi chú cái gì bật chúng). Bật "Phát giai điệu mẫu" CHỈ qua hộp thoại bản
  quyền (focus đầu = Hủy; Esc / bấm nền = hủy, focus về switch); tắt không hỏi. "Đặt lại mặc định" tắt mọi âm
  thanh. Thứ tự card: Kiểu điều khiển, Giao diện, Phát bài (đếm vào bằng hình, đếm ngược), Harmonica, Luyện tập,
  MIDI, Phím tắt. Khi giai điệu bật, Player và màn đầu hiện huy hiệu đỏ "🔊 Đang phát giai điệu" (tooltip chỉ
  chỗ tắt); nút "Nghe giai điệu mẫu" của practice chỉ hiện khi đã bật. _Vòng review 3b: sửa / bổ sung ở D-267, D-285._

## Phase 2c — Màn đầu, Menu, router, chia sẻ

- **D-185 — Router:** `#/` (cả `''`, `#`, `#//`, `/`, `#/?x`) = home; thư viện chuyển sang `#/library`
  (`paths.library() = '/library'`, `paths.home() = '/'`); `#/library/<x>` = not-found (trước đây rơi về thư viện).
  `?overlay=1&song=` trên path rỗng vẫn là overlay. Link "Về thư viện" (NotFound, RouteFailed, ComingSoon, Editor,
  Share, Player) trỏ `#/library`; tên app trên thanh điều hướng trỏ `#/`. `#/s/…`, `#/play/:id`, overlay mở thẳng
  như cũ. Không chỗ nào hard-code `'#/'` — luôn `href(paths.…)`.
- **D-186 — Màn đầu "chơi thử ngay"** (SPEC 2026-10-14, giữ chân 30 giây đầu): `HomeView` =
  `<PlayerView variant="demo">` với bài mẫu đầu tiên lúc đó, vừa đúng một màn (100dvh, không cuộn kể cả 375 px),
  không AppNav, toast ở đỉnh tối đa 1. Khung đầu vẽ sẵn ở beat 0 + MỘT nút ▶ "Chơi thử" lớn; chạm nút (hoặc nền quanh nút, Space,
  Enter) → `restart()` từ beat 0 với engine `instantStart` (bỏ đếm vào và đếm ngược dù Cài đặt bật; không tiếng trừ
  khi đã bật). Đang chạy: nút tạm dừng / phát nhỏ ở góc dưới trái; hết bài: "Chơi lại" + "Mở Menu để chọn bài
  khác". Chỉ có phím Space. Focus đi ▶ → nút nhỏ → "Chơi lại", không rơi về `<body>`. Nút ▶ "thở" bằng box-shadow
  (không transform) nên đứng yên khi bấm (e2e click thường) — _Phase 3b: bỏ nhịp thở, nút ▶ đứng yên (D-239)._ Một dòng tên app 12 px mờ ở trên, không đè sân khấu;
  bài demo không đổi `document.title`. `PlayerUiState.ended` = dừng ở cuối bài, không có play / đếm ngược / chờ
  nào đang treo. _Góp ý 2026-10-15: thay / sửa bởi D-306._
- **D-187 — Menu ☰** (góc trên phải, 48 px): Modal dùng chung (bẫy focus, Esc, trả focus, nền inert — phím Space
  không lọt xuống demo) vẽ thành sheet bên phải bằng `.modal-backdrop:has(> .modal .app-menu)` (trình duyệt không
  có `:has()` thấy hộp giữa màn; components.tsx không đổi). Mục: Thư viện bài hát (autofocus; gợi ý "nhập file
  .harm" để người dùng tìm thấy chỗ nhập), Bài mới (chỉ khi `FEATURES.editor`; `newSongTemplate` dùng chung với
  thư viện → `#/edit/<id>`), Tạo bài từ file (chỉ khi `FEATURES.midiImport`; "MIDI hoặc MusicXML"), Cài đặt; hai
  nhóm `aria-pressed` Ngôn ngữ, Giao diện. Mở Menu khi demo đang chạy → tạm dừng (không chạy canvas sau hộp
  thoại); đóng Menu, nút nhỏ phát tiếp. _Góp ý 2026-10-15: thay / sửa bởi D-306._
- **D-188 — "Chia sẻ" ngoài Editor:** nút trên thẻ bài Thư viện (đầu hàng nút phụ; ẩn khi `FEATURES.share` tắt vì
  link `#/s/` khi đó chỉ mở trang "sắp có") và trên header Player (mọi bài, kể cả bài tạm từ link — chia sẻ lại
  được). Hành vi như Editor: bài rỗng → toast lỗi, không sao chép; clipboard lỗi → toast lỗi; thành công → toast;
  `isShareUrlLong` → thêm cảnh báo; không điều hướng. Không gallery / danh sách công khai (SPEC). _Vòng review 3b: sửa / bổ sung ở D-266._
- **D-189 — Định dạng riêng và "Tạo bài từ file":** wizard đổi tên "Tạo bài từ MIDI" → "Tạo bài từ file" (MIDI +
  MusicXML; `common.feature.midiImport` cũng vậy). Thư viện hiện hint ngay dưới "Nhập file" / "Tạo bài từ file"
  (nối bằng `aria-describedby`): `.harm` / `.json` / `.txt` là định dạng riêng của app (lấy từ nút Xuất), file nhạc
  chuẩn dùng "Tạo bài từ file"; cờ `midiImport` tắt thì bản ngắn không nhắc nút ẩn (D-060). "Nhập file" gặp
  `.mid/.midi/.kar/.rmi` hoặc `.musicxml/.xml/.mxl` → lỗi chỉ sang "Tạo bài từ file" (cờ tắt: MIDI báo "chưa hỗ
  trợ", MusicXML báo lỗi đuôi thường). Thanh điều hướng ≤ 480 px thu gọn chữ / khoảng cách để giữ một hàng.

## Phase 2c — Import mở rộng (src/midi: musicxml.ts, zip.ts, fileLoad.ts, wizard)

- **D-190 — Thời gian MusicXML:** tick = BCNN mọi `<divisions>` nguyên trong file → vị trí là số nguyên, chùm ba
  đúng 1/3. Độ dài ô nhịp = vị trí xa nhất mọi part đạt được (khớp theo chỉ số ô); ô rỗng lấy độ dài theo nhịp
  đang hiệu lực; ô đầu ngắn hơn một ô (anacrusis) dời cả bài để vạch nhịp sau rơi đúng bội số ô.
- **D-191 — Dấu lặp trải theo thứ tự chơi:** barline forward / backward, `times` (tối đa 16; 0 hoặc 1 = không lặp),
  volta `'1'`, `'1, 2'`, `'1-3'`. Backward trong nhóm volta chơi `max(times, số volta lớn nhất)` lần; rời nhóm volta
  thì lượt về 1; có chặn vòng lặp. D.C. / D.S. / To Coda (từ `<sound>` hoặc `<words>`) KHÔNG trải, chỉ cảnh báo
  `'jumps'`. Đổi nhịp giữa bài: dùng nhịp đầu, cảnh báo `'time-changes'`.
- **D-192 — Lời MusicXML:** `<lyric number>` = lượt lời; mỗi `<lyric>` một chữ karaoke; elision nối bằng `_`;
  chuẩn hóa NFC. Lời theo lượt lặp: lượt k dùng verse (chọn + k − 1) nếu có, không thì verse đã chọn; verse 0 =
  không lời. Nốt nối (tie) giữ lời của nốt đầu. _Vòng review 3b: sửa / bổ sung ở D-280._ _Góp ý 2026-10-15: thay / sửa bởi D-312._
- **D-193 — Marker → section:** rehearsal mark; không có thì `<words>`, bỏ chữ tempo (metronome / sound tempo),
  chữ nhảy (D.C.…) và danh sách thuật ngữ biểu cảm (rit., dolce, cường độ…). Khử trùng (beat, text) giữa các part,
  trên timeline đã trải lặp.
- **D-194 — Tempo:** `<sound tempo>` thắng `<metronome>` cùng direction; metronome đổi ra bpm nốt đen (beat-unit
  có chấm); nhiều tempo cùng beat → cái sau cùng (như D-168); mặc định 120. Cả bài dùng một tempo
  (`tempoChanges` chỉ đếm).
- **D-195 — Voice / nối / nốt đặc biệt:** id voice = số `<voice>`; một số voice có ≥ 25% nốt ở khuông thứ hai thì
  tách theo khuông (id `'v/staff'`), dưới ngưỡng coi là nốt vắt khuông của cùng voice. Tie gộp theo voice + cao
  độ, liền khít; không có thì lấy nốt cùng cao độ đang mở kết thúc đúng chỗ đó (đổi voice ở vạch nhịp). Nốt hoa
  mỹ (grace) bỏ; cue chiếm thời gian nhưng không phát; part dịch giọng đổi về cao độ thật bằng
  `chromatic + 12 × octave-change` (theo khuông nếu có `number`).
- **D-196 — Gợi ý part / voice / verse:** part có lời lên trước; trong các part có ≥ 30% số nốt lớn nhất, chọn
  cao độ trung bình cao nhất. Voice mặc định: voice đầu (khuông 1, số nhỏ nhất) nếu có ≥ 30% số nốt của voice
  đông nhất, không thì voice đông nhất. Verse mặc định = verse nhỏ nhất. _Góp ý 2026-10-15: thay / sửa bởi D-320._
- **D-197 — Trích melody từ MusicXML:** `mergeTies: 'never'` (tie đã gộp; nốt lặp là nốt thật), `legatoBeats`
  1/256 (chỉ bù sai số float); grid mặc định Tắt (MIDI vẫn 1/4); BPM kẹp 20..400. Bước 5: tên bài từ
  work-title → movement-title → credit 'title' → tên file; nghệ sĩ điền sẵn từ composer (sửa được, nạp file mới
  thì đặt lại). Nhãn bước 2 là "Chọn track / bè" tới khi có file.
- **D-198 — Nhận dạng file và giới hạn:** loại file theo đuôi trước, rồi byte đầu (MThd / RIFF-RMID, PK, `<` sau
  BOM / khoảng trắng, BOM UTF-16); nội dung trái đuôi thì theo nội dung. Kiểm kích thước TRƯỚC khi đọc (MIDI 2 MB,
  .mxl 5 MB, .musicxml / .xml 20 MB) và kiểm lại khi loại đổi. `.mxl`: `zip.ts` tự viết (stored + deflate qua
  `DecompressionStream('deflate-raw')`, kiểm CRC, giới hạn 20 MB giải nén áp ngay khi inflate kể cả header nói
  dối), rootfile từ `META-INF/container.xml`, không có thì \*.musicxml / \*.xml đầu tiên ngoài META-INF. ZIP64, mã
  hóa, phương thức nén khác: báo lỗi rõ; trình duyệt không có `DecompressionStream` (Safari cũ) báo riêng cho
  .mxl, .musicxml vẫn dùng được. Không thêm dependency. _Vòng review 3b: sửa / bổ sung ở D-281._
- **D-199 — Kéo thả:** cả trang ở bước 1 nhận kiểu `Files` / `application/x-moz-file` hoặc item kind `file`; đọc
  `dataTransfer.files`, không có thì `items[].getAsFile()` (kéo từ thanh download của trình duyệt). Thả chỉ có
  `text/uri-list` → hướng dẫn tải file về rồi thả (không để trình duyệt điều hướng); kéo chữ thường bỏ qua. Nhiều
  file → file đầu có đuôi biết. Không tải từ URL musescore.com (SPEC). _Vòng review 3b: sửa / bổ sung ở D-282._
- **D-200 — MIDI nhiều track:** checkbox (tên truy cập như radio cũ `Chọn track "X"`), track gợi ý chọn sẵn, bấm
  dòng để bật / tắt, "Tiếp" tắt khi không chọn gì. Track đã chọn gộp bằng `tracksNotesInBeats` (lời gắn một lần
  trên tập đã gộp nên không nhân đôi chữ) rồi mới trích, nên policy chồng nốt áp cả giữa các track. Luôn có dòng
  tóm tắt (số nốt + tầm); ≥ 2 track thì thêm piano roll + nghe thử bản gộp.
- **D-201 — Tách module wizard:** MidiImportView.tsx tách thành wizardUi / finishSteps / FileWizard / TrackTable /
  ScorePicker / fileLoad. `musicxml.ts` và `zip.ts` import tĩnh trong chunk lười `#/midi`; @tonejs/midi vẫn import
  động. `src/midi/testing/{musicxml,zipBuild}.ts` sinh fixture cho test / e2e (app không import).

## Phase 2c — Editor (cảm âm + prompt AI)

- **D-202 — "Sao chép prompt cho AI" trong Nhập cảm âm:** khung AI (một dòng hint, nút sao chép, "Hướng dẫn đầy
  đủ: docs/AI-PROMPT-CAM-AM.md") nằm trên ô văn bản. Quy ước chuyển sang "Chỉ hậu tố số" khi (a) sao chép prompt
  thành công (SPEC), hoặc (b) văn bản dán đổi từ "chưa mọi âm có số" sang "mọi âm có số" (`camamDigits.ts`, quét
  token như `parseCamAm`); không lấy lại lựa chọn tay khi văn bản vẫn toàn số, không bao giờ tự đổi về "hoa /
  thường". Hint giải thích lý do nối bằng `aria-describedby`; phản hồi sao chép là đoạn `aria-live` (không
  `role=status` để khỏi trùng với status sẵn có). `aiPrompt.ts` chứa 2 khối PROMPT của doc dạng chuỗi literal
  (sinh bằng script) để doc 25 KB không vào bundle; test so khớp với doc (`?raw`) bắt lệch. _Vòng review 3b:
  "docs/AI-PROMPT-CAM-AM.md" là đường dẫn repo, người dùng web không mở được — còn mở, xem D-257._ _Đã xong: trang Hướng dẫn trong app (D-260)._

## Phase 2c — Tích hợp

- **D-203 — Kích thước bundle sau Phase 2c:** chunk chính `index-*.js` ≈ 148 KB gzip (476 KB thô, dưới ngưỡng cảnh
  báo 500 KB) + CSS chính ≈ 8 KB; tổng JS + CSS ≈ 231 KB gzip (spec < 400 KB). Mobile core và màn đầu nằm ở chunk
  chính (màn đầu là route mặc định); văn bản Mobile theo chunk Editor; MusicXML / zip theo chunk `#/midi`.
- **D-204 — E2e Phase 2c:** `e2e/first-run.spec.ts` (màn đầu: chỉ ▶ + canvas + Menu, một chạm là ô rơi trong
  1 s, Space tạm dừng, Menu, 375 px) và `e2e/phase2c.spec.ts` (âm thanh mặc định tắt + hộp thoại bản quyền + huy
  hiệu, scheme Mobile trong Player, "Chia sẻ" ở Thư viện, MusicXML qua 5 bước, Menu tạm dừng demo). Mọi spec
  dùng clipboard giả của `e2e/helpers.ts` (D-141).

## Phase 3 — Overlay OBS (src/overlay)

- **D-205 — OverlayEngine gọn riêng** (`src/overlay/overlayEngine.ts`) thay vì dùng lại PlayerEngine:
  PlayerEngine đọc count-in / đếm ngược / âm thanh từ Cài đặt và có thể mở / làm nóng AudioContext, overlay thì
  không bao giờ được. Đồng hồ luôn là `performance.now`, mọi tùy chọn chỉ lấy từ URL; module không import
  `src/audio` (test kiểm không AudioContext nào được tạo kể cả khi Cài đặt bật âm thanh).
- **D-206 — Đọc tham số overlay** (`parseOverlayParams`): `data=` thắng id bài; mặc định theo layout (`game`:
  gamebar 0, lyrics 0, opacity 0.85, banner 1; `full`: gamebar 1, lyrics 1, opacity 1); bật / tắt nhận
  1/true/yes/on và 0/false/no/off (không phân biệt hoa thường, bỏ khoảng trắng), enum không phân biệt hoa thường;
  bpm 20..400 (≤ 0 / sai = tempo của bài); delay 0..10 và lookahead 4..12 làm tròn; scale 0.5..3; opacity 0.3..1;
  nhận dấu phẩy thập phân; tham số / giá trị lạ bỏ qua. README "Tham số URL của overlay" là bảng cho người dùng —
  đổi một bên thì sửa bên kia (CLAUDE.md). _Vòng review 3b: sửa / bổ sung ở D-268._
- **D-207 — Chạy trong overlay:** đếm ngược `delay` trước mỗi lần người dùng / autoplay bắt đầu (chạy / tiếp tục,
  R, lệnh restart) nhưng KHÔNG trước lần lặp lại; `loop=1` = hết bài chạy lại từ 0 (kèm đếm vào bằng hình nếu
  `countin=1`), không phải loop A-B của transport. Bấm / chạm chỉ chạy / tiếp tục, không bao giờ tạm dừng (focus
  vào cửa sổ Window Capture không được làm dừng bài); Space bật / tắt, R chạy lại, ← / → đổi dòng (cùng ân hạn
  D-027); tạm dừng lúc đang đếm vào thì về điểm bắt đầu. Gợi ý nhỏ "Bấm vào đây hoặc nhấn Space để chạy" chỉ hiện
  trước lần chạy đầu khi `autoplay=0` (nằm trên stream tới lúc đó — OBS cần "Interact" để bấm). Hết bài mà không
  lặp thì đứng ở cuối. _Góp ý 2026-10-15: thay / sửa bởi D-326._
- **D-208 — Tùy chọn thêm của renderer** (bổ sung, mặc định giống hệt Player): `lanePadding: 'none'` = không lề /
  dải nhãn section, hit line lên tới `HIT_LINE_MAX_EDGE` 0.99 (Player giữ kẹp 0.95; đổi lại thì kẹp lại base);
  nhãn section (nếu bật) vẽ đè mép trái lane Z. `tileOpacity` chỉ nhân alpha thân ô (viền / nhãn giữ nguyên; 1 =
  Player từng byte). `gridStyle: 'subtle'` = vạch ô nhịp / beat / section alpha 0.45, nhãn section 0.7. Preset game
  = lanePadding none + hit line 0.97 + grid subtle + opacity 0.85.
- **D-209 — Nền chroma ép ô đậm 100%** (`effectiveTileOpacity`): ô nửa trong suốt trộn với #00FF00 sẽ bị Chroma
  Key ăn mất; hộp thoại khóa thanh "Độ đậm của ô" kèm ghi chú (chỉnh bằng Opacity của filter OBS). Chroma sơn xanh
  cả html / body / #root (cả cửa sổ key được). Ribbon giữ (alpha 0.25–0.75) và ô đã qua (mờ dần) vẫn nửa trong suốt
  như renderer cũ — chấp nhận.
- **D-210 — Vị trí banner:** layout game (dọc) = banner nhỏ nổi ngay trên hit line (`bottom: calc(3% + 6px)`, giữa
  `--lane-left` / `--lane-right`, `pointer-events: none`); full dọc = nằm giữa canvas và game bar; ngang = nằm trên
  các lane (dải ở đáy source). Game bar ở kiểu ngang căn giữa, tối đa 640 px.
- **D-211 — Link overlay và vị trí Browser Source:** bài mẫu → `#/overlay/<id>?…`; bài người dùng / bài tạm LUÔN
  `#/overlay?…&data=<lz>` (không id — OBS có bộ nhớ riêng); chỉ ghi tham số khác mặc định, `layout` luôn đầu,
  `data` (ký tự lz, không encode) cuối. Vị trí đề xuất (1080p; 1440p = ×4/3 làm tròn, scale đề xuất 1 / 1.33):
  game 576×600 @700,150 (số đo `docs/GAME-UI-REFERENCE.md`) → 768×800 @933,200; dải ngang 1140×440 @370,310 (đáy 750
  ngay trên bảng phím game, mép phải < 1510 tránh webcam / chat, 8 lane ≥ 38 px) → 1520×587 @493,413; full 600×940
  @660,70 (game bar của app nằm đè bảng phím game) → 800×1253 @880,93. Dải ngang / full suy ra từ tài liệu, chưa đo
  trong OBS thật. _Vòng review 3b: sửa / bổ sung ở D-268._ _Góp ý 2026-10-15: thay / sửa bởi D-327._
- **D-212 — Hộp thoại "Tạo link OBS"** (`ObsLinkModal`): phản hồi sao chép / mở là dòng `aria-live` trong hộp
  (toast nằm sau modal bị `inert`); "Mở thử" = `window.open(url, '_blank', 'popup=yes,width=W,height=H')` theo kích
  thước 1080p của preset, `opener` gán null, trả null → dòng "chặn pop-up". Nút tắt khi bài không có nốt; trạng thái
  giữ trong lúc nơi mở còn mount. Mặc định: preset game, nền trong suốt, scale 1, lookahead và kiểu điều khiển
  theo Cài đặt, "Tự chạy khi mở" BẬT (tham số URL `autoplay` mặc định vẫn 0 — README ghi cả hai). _Góp ý 2026-10-15: thay / sửa bởi D-323._
- **D-213 — Tiêu đề cửa sổ overlay** = `"<tên bài> — Overlay OBS"` (trả lại khi unmount) để chọn đúng cửa sổ
  trong Window Capture.
- **D-214 — Thẻ lỗi overlay** (`role=alert`, `data-error`): `noSong`, `notFound` (id không có trong bộ nhớ của
  CHÍNH trình duyệt này — giải thích OBS có bộ nhớ riêng), `badData`, `empty`; đều nhắc tạo lại link bằng nút OBS /
  Menu.
- **D-215 — Lối vào và lệnh ngoài:** Menu "Tạo link OBS" đóng menu rồi mở hộp thoại có ô chọn bài (focus trả về
  ☰); Player có nút "OBS" trên header (bài cố định). `dfht:command` (`src/overlay/commands.ts`) chỉ được Player đầy
  đủ và overlay nghe — màn demo `#/` thì không (chỉ ▶) — và bị chặn đúng như phím tắt (đang mở trợ giúp / hộp OBS /
  kết quả luyện tập).

## Phase 3 — PWA (vite-plugin-pwa, src/ui/pwa.ts, UpdatePrompt)

- **D-216 — Cấu hình PWA:** `registerType: 'prompt'`, `injectRegister: null` (tự đăng ký trong `src/ui/pwa.ts`
  qua `virtual:pwa-register`, không có `registerSW.js`); glob precache
  `**/*.{js,css,html,svg,png,ico,webmanifest,woff2}` (cả chunk lười → offline hoàn toàn),
  `includeManifestIcons: false` và `globIgnores` có `manifest.webmanifest` (plugin tự thêm kèm revision — tránh
  khai hai lần), `cleanupOutdatedCaches`, `navigateFallback: 'index.html'`, `clientsClaim: true` (lần cài đầu nhận
  luôn trang đang mở; bản cập nhật vẫn chờ "Tải lại", không skipWaiting tự động). `start_url` / `scope` `'./'`,
  `src` icon tương đối → đúng với mọi `VITE_BASE` (đã thử `/sub/`). Dòng
  `/// <reference types="vite-plugin-pwa/vanillajs" />` đặt đầu `pwa.ts`.
- **D-217 — Cập nhật chỉ tải lại tab đã bấm:** `onNeedReload` chỉ reload tab có người bấm "Tải lại"; tab khác chỉ
  hiện lại lời nhắc (mặc định của plugin reload mọi tab — kể cả bài đang chạy hay editor chưa lưu). Dự phòng
  reload sau 2.5 s nếu SW chờ đã được kích hoạt ở tab khác; chưa đăng ký / lỗi thì reload ngay.
- **D-218 — Nơi không đăng ký service worker:** route overlay (không mount UpdatePrompt — OBS không bao giờ thấy
  lời nhắc), bản 1 file / file://, dev và test (module ảo rỗng), cửa sổ Tauri (`window.__TAURI__` — SW sẽ giữ app
  desktop ở file cũ sau khi nâng cấp).
- **D-219 — Màn đầu `#/`:** thông báo "Đã sẵn sàng dùng offline" được giữ lại, hiện ở route kế tiếp người dùng mở
  (30 giây đầu chỉ ▶ / Menu). Lời nhắc "Có bản mới" vẫn hiện ở `#/` (tạm thời; khách mới không bao giờ thấy vì chưa
  có SW cũ).
- **D-220 — Vị trí lời nhắc:** giữa đỉnh màn hình ở home / play (khoảng trống trên header, không che ☰, game bar,
  hit line); góc dưới phải ở các trang có app shell (trên toast dưới đáy của điện thoại). `z-index` 95: dưới modal
  (100) và toast (200). Không autoFocus, không gọi `focus()`.
- **D-221 — Bản 1 file** (`npm run build:single`): `publicDir: false` nên `dist-single/` chỉ có `index.html`; plugin
  nhỏ `transformIndexHtml` (order `pre`) đổi link `/icons/*` thành data URI base64. vite-plugin-singlefile 2.3.3 tự
  đặt `codeSplitting = false` cho Vite 8 nên mọi import động (Editor, Share, MIDI, OptimizerPanel, @tonejs/midi,
  overlay) được inline. VitePWA vẫn nạp với `disable: true` để `virtual:pwa-register` resolve ra hàm rỗng.
- **D-222 — Vitest:** module runner không nạp được id ảo của vite-plugin-pwa (`/@vite-plugin-pwa/…` bị hiểu là
  đường dẫn file) → dưới `VITEST` config thay VitePWA bằng plugin stub `\0virtual:pwa-register`; test cần hành vi
  thì `vi.mock('virtual:pwa-register')`.
- **D-223 — E2e và service worker:** `playwright.config.ts` đặt `use.serviceWorkers: 'block'` cho mọi spec (không có
  thông báo offline chen vào, request không đi qua SW; app chỉ `console.warn` khi đăng ký bị chặn, không
  `console.error`); `e2e/pwa.spec.ts` bật lại bằng `test.use({ serviceWorkers: 'allow' })` và tự build bản 1 file
  trong `beforeAll` (node + bin vite, không phụ thuộc PATH). Offline kiểm bằng `setOffline` +
  `response.fromServiceWorker()` + `navigator.onLine` (giả lập offline của Chromium có thể không áp cho fetch của
  chính SW). Luồng "bản mới đang chờ → Tải lại" thật cần hai lần deploy — chỉ có unit test (module ảo mock).
- **D-224 — Icon PWA** (`npm run icons` = `scripts/gen-icons.mjs`, pngjs, khử răng cưa bằng signed distance field,
  ra byte giống hệt mỗi lần chạy): ô vuông bo góc #0f1115, 4 lane, ô trắng / xanh dương / cam / xanh lá, hit line
  sáng #f2f6ff. Maskable full-bleed, nội dung scale 0.7 (trong vòng an toàn 40%); apple-touch full-bleed scale 0.86.
  `icon.svg` viết tay cùng tọa độ. Thay favicon data URI của D-006: `index.html` link `/icons/icon.svg`,
  `icon-192.png`, `apple-touch-icon-180.png`; plugin chèn link manifest. _Phase 3b: màu thay theo D-244 (nền
  `#0a0c0e`, lane `#151b21`, hit line `#effff7` + glow xanh neon)._

## Phase 4 — Overlay desktop Tauri (tùy chọn; src-tauri, src/desktop, docs/TAURI.md)

- **D-225 — Chưa build thử:** máy không có Rust nên chỉ viết `docs/TAURI.md` + cấu hình sẵn theo tài liệu Tauri v2
  (SPEC mục 8). Vài chi tiết API có thể cần sửa nhỏ khi build lần đầu (ghi ở đầu `docs/TAURI.md`).
- **D-226 — Cầu nối dùng lại contract overlay:** `src/desktop/tauriBridge.ts` (import một lần trong `main.tsx`) có
  `window.__TAURI__` thì nghe sự kiện Tauri `"dfht-command"` (payload = chuỗi lệnh, hoặc `{ command }`) và phát lại
  `dfht:command`; danh sách lệnh / kiểu import từ `src/overlay/commands.ts` (thêm lệnh không phải sửa bridge). Cài
  một lần mỗi target, `listen` lỗi thì cảnh báo một dòng. Tên sự kiện khai ở cả `main.rs` (`COMMAND_EVENT`) và
  bridge (`TAURI_COMMAND_EVENT`).
- **D-227 — Phím tắt toàn cục:** Ctrl+Alt+P chạy / dừng, Ctrl+Alt+R chạy lại, Ctrl+Alt+→ / ← đổi dòng, Ctrl+Alt+T
  click xuyên qua (`set_ignore_cursor_events`), thêm Ctrl+Alt+D hiện / ẩn khung cửa sổ (`set_decorations` — cửa sổ
  không viền thì không kéo / đổi cỡ được). Không phím nào dùng Z X C V B N M ,.
- **D-228 — Chọn bài cho bản desktop:** cửa sổ mặc định `index.html?overlay=1&song=<id bài mẫu>&layout=game` (nay `seed-quoc-ca-viet-nam`, D-372)
  (576×600 tại (700,150) như preset game). Đổi bài không cần build lại: đối số dòng lệnh đầu tiên không bắt đầu bằng
  `-` là link overlay — link http(s) đầy đủ từ "Sao chép link" (chỉ chép query + fragment, origin không đổi) hoặc
  dạng tương đối `?…` / `#…`. Link `data=` dài để trong file .bat (shortcut .lnk giới hạn ~260 ký tự). Kích thước /
  vị trí không được nhớ giữa các lần chạy; x / y là pixel logic (scale màn hình làm lệch).
- **D-229 — Quyền tối thiểu:** `capabilities/default.json` chỉ có `core:event:allow-listen` /
  `core:event:allow-unlisten` cho cửa sổ `main`; phím tắt và đổi trạng thái cửa sổ chạy ở Rust.
- **D-230 — Không thêm Tauri CLI vào package.json:** docs và workflow dùng `npx --yes @tauri-apps/cli@2` (docs ghi
  rõ lệnh này tải CLI — chỉ chủ dự án; người dùng web không phải tải gì). Version lấy từ `../package.json`; target
  msi + nsis; icon sinh bằng `tauri icon public/icons/icon-512.png` (workflow chỉ chạy khi thiếu
  `src-tauri/icons/icon.ico`).
- **D-231 — `.github/workflows/tauri.yml` "ngủ"** như `ci.yml`: chỉ chạy nếu sau này repo lên GitHub; tag `v*` →
  windows-latest, Node + Rust stable + cache, `npm ci`, sinh icon, `tauri-action@v0` (`releaseDraft: true`). _Từ khi
  mã nguồn công khai: chỉ chạy tay, không theo tag — D-445._

## Phase 3 — Docs và tích hợp

- **D-232 — README:** link web là token `https://VERCEL_URL_TODO` (cả ví dụ link chia sẻ / overlay — một lần thay
  là xong). Phần OBS khuyên MỘT source: Window Capture + Chroma Key trên cửa sổ "Mở thử" (bạn và người xem thấy
  cùng một overlay); Browser Source ghi là chỉ người xem thấy. Tên nút / nhãn trong README phải có trong
  `src/i18n/strings.ts`; kích thước, vị trí, mặc định tham số lấy từ `src/overlay/overlayParams.ts`. Ảnh ở
  `docs/images/` (≤ 5 ảnh, mỗi ảnh < 300 KB, 1600×900 từ dev server); ảnh hộp thoại OBS thay ảnh Cài đặt.
- **D-233 — Quy trình phát hành** (CLAUDE.md): xong phase → người dùng tự test local → sửa theo phản hồi → chỉ khi
  người dùng đồng ý mới `npm run deploy:prod`.
- **D-234 — Overlay tải lười, kích thước bundle sau Phase 3:** Phase 3 đẩy chunk chính lên 514 KB thô (quá ngưỡng
  cảnh báo 500 KB của Vite). `App.tsx` tải `OverlayView` bằng `React.lazy` (fallback `null` — không "Đang tải…" lên
  stream; lỗi chunk → `RouteErrorBoundary`), app thường không tải OverlayEngine / overlay.css. `ObsLinkModal` vẫn
  tĩnh (nhỏ, mở ngay khi bấm). Rolldown tách phần dùng chung thành chunk `store-*` + `parser-*` (modulepreload): tải
  đầu ≈ 504 KB thô / ≈ 167 KB gzip gồm CSS (index 342 KB + store 150 KB + parser 12 KB, không chunk nào > 500 KB);
  chunk overlay 12 KB + CSS 2.6 KB; tổng JS + CSS ≈ 245 KB gzip (spec < 400 KB). Precache SW ≈ 22 mục / 795 KB.
  Bản 1 file (`dist-single/index.html`) ≈ 795 KB thô / ≈ 247 KB gzip, mọi chunk inline.
- **D-235 — Class overlay đặt sớm:** script inline trong `index.html` (sau đoạn theme D-069) nhận route overlay đúng
  như `parseLocation` (`#/overlay…`, hoặc `?overlay=1` khi hash rỗng / `#/`; query hash thắng search) và `bg` như
  `parseOverlayParams` (trim + chữ thường; khác chroma / theme = transparent), rồi thêm `overlay-mode` +
  `overlay-bg-<bg>` vào `<html>`. Luật nền (trong suốt / chroma / theme) chuyển từ overlay.css sang app.css (CSS
  chính, có ngay khung hình đầu) — mỗi lần OBS refresh source không còn nháy nền app (hay trắng) trước khi React
  và chunk overlay chạy. OverlayView bỏ class nền lệch trước khi đặt class của mình. Test chạy chính script đó so
  với router + overlayParams (`src/overlay/earlyOverlayClass.test.ts`); e2e giữ chunk JS lại và kiểm nền chroma.
- **D-236 — E2e Phase 3:** `e2e/overlay.spec.ts` (nền trong suốt + góc canvas alpha 0 + ô rơi khi autoplay, chroma
  cả trang + canvas, nền chroma trước khi JS chạy, layout game, link `data=` từ nút OBS mở ở context mới storage
  trống, id lạ → thẻ lỗi) và `e2e/pwa.spec.ts` (SW nhận trang → offline → tải lại: màn đầu, ▶, thư viện, chunk
  Editor / overlay / MIDI + @tonejs/midi từ precache; bản 1 file qua file://: màn đầu, ▶, thư viện, Editor, overlay
  chroma, MIDI, không request nào ngoài index.html). `test.skip` overlay cũ trong `smoke.spec.ts` đã bỏ. Chạy cả
  suite: `npx playwright test --workers=1` (một Edge headless).

## Phase 3b — Giao diện Tactical HUD, "Tự chơi để tạo bài", "Cửa sổ nổi"

Giao diện:

- **D-237 — Thứ tự CSS:** `main.tsx` nạp `app.css` TRƯỚC `App` → CSS của view (import tĩnh qua App) ghi đè được
  app.css ở cùng độ ưu tiên selector, giống chunk tải lười (trước đó view tĩnh nạp trước nên thua app.css). So pixel
  19 ảnh trước / sau khi đổi: chỉ 3 chỗ đổi, đều đúng ý view (link `◂ THƯ VIỆN` màu muted, chữ cảnh báo Ctrl đậm
  hơn, nút **Mở thử** lệch 8 px). Các chỗ đã tăng độ ưu tiên trước đó (`.card.settings-advanced`, `.library-count.tag`)
  giữ nguyên, vô hại. Không dùng `@layer`.
- **D-238 — Accent chỉ cho khung UI:** xanh neon `#0ff796` chỉ 1.6:1 so với tile Nửa Cung `#22c55e` → không bao giờ
  tô tile, keycap, nút game bar, nốt trong cuộn nốt bằng accent; phím người chơi đang giữ (practice, màn thu) = vòng
  kép tối + sáng / outline màu chữ (vòng xanh sẽ biến mất trên phím Nửa Cung). Hổ phách `--warn` chỉ cho cảnh báo,
  sọc hazard, "SẮP CHẠM", ghi chú cửa sổ nổi. Perfect / Good / Miss trên canvas = trắng-mint / xanh nhạt / đỏ (bỏ vàng).
- **D-239 — Nhẹ:** không `backdrop-filter` (làm mờ canvas đang chạy mỗi frame); kính modal / drawer 95% đục nên
  contrast như nền đặc. Không animation lặp ngoài canvas (bỏ nhịp thở nút ▶ và nhấp nháy "SẮP CHẠM" — còn làm chữ
  dưới AA). Glow hit line = hai vạch bán trong suốt dưới lõi trắng, không `shadowBlur`; tile gom thành 2 lệnh vẽ /
  frame. Đo Edge headless 600 frame: tổng mỗi frame giảm ở mọi kịch bản trừ chroma (+7%, trong ngân sách 10%).
- **D-240 — Chroma đặc hoàn toàn:** nền `#00FF00` không cho bán trong suốt → bảng màu trộn sẵn trên đen (màu
  modifier + viền × 33 mức) tính một lần mỗi lần đổi palette; tile mờ dần dưới hit line thành khối tối đặc thay vì
  biến mất; không glow xanh, hit line lõi trắng + viền tối đặc.
- **D-241 — Chữ:** tên bài, tên section trên canvas và tên nút trong "CHẠM: …" giữ hoa / thường (DESIGN.md), chỉ
  condensed; nhãn / nút / chip in hoa bằng CSS. Font canvas ghi độ rộng ngay trong chuỗi font (vd.
  `800 condensed 28px Bahnschrift`) vì gán `ctx.font` reset `fontStretch`. Hộp có cắt chữ đủ line-height cho dấu
  chồng của chữ in hoa tiếng Việt (Ẩ, Ế, Ử…). Chấm quãng giản phổ luôn là phần tử / pseudo-element riêng.
- **D-242 — Token game bar ở `:root`:** `--gb-panel` / `--gb-cap` / `--gb-cap-border` (dark + light) khai báo ở `:root`
  trong player.css thay vì `.player`, vì GameBar dùng chung với màn thu `#/record` (ở đó keycap từng mất nền / viền).
  Overlay vẫn ghi đè trên `.overlay`.
- **D-243 — Menu:** số thứ tự 01… bằng CSS counter (không vào tên truy cập); accent 72% ở dark (7.1:1), accent đặc ở
  light (72% chỉ 3.35:1). Nút × đóng và EN / ☀ trên thanh app viền `--control-border` (≥ 3:1).
- **D-244 — PWA:** manifest `theme_color` / `background_color` = `#0a0c0e` (khớp meta theme-color dark); icon
  (`scripts/gen-icons.mjs` + `public/icons/icon.svg`) nền `#0a0c0e`, lane `#151b21`, hit line lõi trắng `#effff7` +
  glow xanh neon 30%; ô giữ màu modifier.
- **D-245 — Contrast:** script đo (đọc token app.css, trộn các lớp alpha: lưới, scanline, vignette, kính, kính trên tile)
  191 cặp đạt AA ở cả dark và light — thêm keycap / game bar, banner trên sọc hazard (thấp nhất 4.54:1: chữ trên cam +
  sọc đen 20%, dark), nhãn cuộn nốt màn thu (≥ 5.4:1), ghi chú / đếm ngược cửa sổ nổi; viền control 3.43–4.18:1.
  `src/ui/contrast.test.ts` khóa các cặp token chính + giá trị token theo DESIGN.md; `canvasTheme.test.ts` khóa màu canvas.

"Tự chơi để tạo bài" (`src/record`, route `#/record`):

- **D-246 — Cuộn nốt riêng (RecordRoll):** canvas nhỏ 8 làn theo bàn phím game xoay ngang, tô theo màu modifier —
  không dùng PianoRoll của MIDI. Vẽ lại theo nhịp 50 ms (20 fps) khi đang thu. Kết quả 32 px / beat. _Vòng review 3b: sửa / bổ sung ở D-265, D-283._
- **D-247 — Nhập:** PC dùng phím thật + giữ chuột trong khung thu (trái / phải / giữa) hoặc phím thay thế của Luyện tập;
  giữ cả hai chuột cùng lúc → bỏ lần bấm; Mobile dùng bàn nút riêng (8 số + 4 chế độ, JianpuDigit; GameBar mobile chỉ
  hiển thị), nút số chỉ nhận chạm / chuột (`tabIndex -1`), chế độ giữ qua các lần thu như trong game. Hai lần bấm cách
  nhau < 40 ms (FLAM_MS) coi là bấm đúp nhầm, bỏ lần đầu. Đơn âm: nốt mới cắt nốt cũ. _Vòng review 3b: sửa / bổ sung ở D-264._ _Góp ý 2026-10-15: thay / sửa bởi D-316._
- **D-248 — Đếm vào bằng đèn nhịp** (luôn hiện, không có cài đặt ẩn), đếm 4-3-2-1 sau 0.12 s chuẩn bị; click chỉ khi
  bật ở Cài đặt; **Tiếng phản hồi khi bấm** là toggle riêng của màn này, mặc định tắt, kèm nhắc không bật khi stream.
- **D-249 — Kết quả:** đổi lưới sau khi thu → quantize lại bản đang hiện và `.harm` tạo ra; hỏi trước khi rời trang khi
  đang thu hoặc còn bản thu chưa mở trong Editor (như Thu melody); trang dùng bề rộng chuẩn 1280 px.

"Cửa sổ nổi" (`src/pip`, Document Picture-in-Picture):

- **D-250 — Lối vào:** nút **Cửa sổ nổi** trong nhóm nút header Player (sau OBS; mở xong `engine.pause()` vì hai player
  dùng chung một engine âm thanh) và mục ☰ Menu **Cửa sổ nổi (1 màn hình)** (`menu.pip`, gợi ý dùng lại
  `pip.buttonHint`) mở `FloatingWindowLauncher` sau khi đóng Menu (như Tạo link OBS: đóng hộp thoại → focus về ☰).
  Nút vẫn hiện ở trình duyệt không hỗ trợ — bấm thì một dòng giải thích (SPEC). Không thêm cờ FEATURES, không thêm gì
  vào màn đầu.
- **D-251 — Engine theo cửa sổ chủ:** `usePlayerEngine` nhận `hostWindow` (rAF, timer, ResizeObserver, matchMedia,
  phím practice của cửa sổ nổi; scheduler âm thanh được bơm bằng interval 25 ms của cửa sổ nổi khi đang phát có tiếng —
  tab gốc thường bị ẩn sau game nên timer của nó bị bóp), `rendererOptions` cố định (không lề lane, hit line 0.97, ô
  đục) và `setStartDelay()` (đếm ngược riêng, `dfht-pip-delay`, mặc định 5 s). Không có `hostWindow` → gọi đúng các
  hàm cũ.
- **D-252 — Renderer theo cửa sổ chứa canvas:** canvas nằm trong document khác → DPR, `matchMedia(resolution)`,
  `ResizeObserver(device-pixel-content-box)` lấy từ `ownerDocument.defaultView`; cùng document → `window` global như
  cũ (giữ stub trong test). Canvas cửa sổ nổi nét theo DPR màn hình chứa nó, và vẫn đo được khi tab gốc bị ẩn.
- **D-253 — Kích thước / style:** preset theo chiều cao màn hình vật lý (≥ 1440 px → 768 × 800, còn lại 576 × 600, chia
  lại theo devicePixelRatio), nhớ kích thước (`dfht-pip-size`) 250 ms sau khi ngừng kéo và khi đóng. Style của tab gốc
  được chép sang (link tuyệt đối, `<style>` từ CSSOM, constructed stylesheet) và đồng bộ tiếp (chunk lười, HMR, đổi
  theme / ngôn ngữ). Một cửa sổ duy nhất: mở lại = đổi bài + focus; hai click nhanh = một request. _Vòng review 3b: sửa / bổ sung ở D-269._
- **D-254 — Nạp tĩnh:** FloatingWindow / FloatingStage nằm trong chunk chính (index ≈ 360 KB thô, tải đầu ≈ 180 KB gzip
  gồm CSS) vì `requestWindow` phải gọi ngay trong click (user activation) — không chờ import động trước nó. Nếu bundle
  chạm ngưỡng thì tách FloatingStage ra import động SAU khi `requestWindow` trả cửa sổ.

Docs / test:

- **D-255 — README:** 5 ảnh chụp lại cùng tên (1600 × 900, dark, dev server, một Edge headless; < 300 KB), dòng
  fan-made (vi + en) ở đầu, mục **f) Tự chơi để tạo bài**, mục **Cửa sổ nổi (1 màn hình)** + nhắc ở cách OBS Window
  Capture, thêm hai dòng giới hạn. `obs-link.png` vẫn hiện link localhost — chụp lại sau khi có domain.
- **D-256 — E2e Phase 3b:** `record.spec.ts` (thu thật bằng bàn phím + chuột phải → Editor) và `pip.spec.ts` — Edge
  headless có Document PiP: cửa sổ nổi là page mới của context (`context.waitForEvent('page')`), kiểm canvas vẽ và đổi
  khung bằng rAF của cửa sổ nổi, Căn chỉnh 8 vạch, đóng từ tab gốc, mở từ Menu với bài đã chọn; nhánh không hỗ trợ xóa
  `window.documentPictureInPicture` bằng `addInitScript`. Cả suite: `npx playwright test --workers=1`.

## Vòng review Phase 3b — tài liệu

- **D-257 — Hướng dẫn người dùng chỉ dựa vào thứ có trong bản web:** người dùng cuối chỉ có link Vercel (SPEC
  2026-10-14), `dist/` không chứa README hay `docs/`. Vì vậy phần README cho người dùng (trước mục "Cho người phát
  triển") không link tới file trong repo, trừ `docs/AI-PROMPT-CAM-AM.md` (hướng dẫn người dùng thứ hai) và ảnh
  `docs/images/`; link tới `docs/TAURI.md`, `docs/GAME-UI-REFERENCE.md`, CLAUDE.md, SPEC, DECISIONS chỉ nằm ở mục
  "Cho người phát triển". Bản desktop Tauri không được giới thiệu như lựa chọn cho streamer (chưa build thử, chưa có
  bản cài). **Còn mở:** đưa phần người dùng của README + `docs/AI-PROMPT-CAM-AM.md` vào bản build (trang "Hướng dẫn"
  sau ☰ Menu, màn đầu không đổi) và đổi dòng "Hướng dẫn đầy đủ: docs/AI-PROMPT-CAM-AM.md" của Nhập cảm âm (D-202)
  thành link tới mục "Tìm nguồn ở đâu" của trang đó — cần code ngoài phần docs. _Đã xong: trang Hướng dẫn trong app (D-260)._
- **D-258 — Ví dụ cảm âm viết thường:** trợ giúp trong hộp thoại Nhập cảm âm và README ghi ví dụ `fa#`, `sib`,
  `dola`, `đô`, `rê` (không viết hoa) và nói rõ chữ HOA là quãng 2 với quy ước mặc định "chữ thường / chữ hoa" —
  `Dola` cũ đọc thành Đô quãng 2 + La quãng 1 (nhảy xuống một quãng sáu). Placeholder vẫn dùng `Do*2` có chủ ý (đô
  cao).
- **D-259 — README, cách Window Capture:** hướng dẫn cắt thanh tiêu đề + thanh địa chỉ (chỉ đọc) của cửa sổ pop-up
  **Mở thử** bằng filter Crop/Pad (hoặc Alt + kéo mép) vì chúng không bị Chroma Key xóa; kích thước / vị trí trong
  bảng tính sau khi cắt (màn hình Windows 125 % / 150 % thì thu source về đúng cỡ bảng); nền chroma luôn ô đậm 100%
  (D-209) — mờ thì chỉnh Opacity của filter Chroma Key; ghim trên cùng màn hình thì người chơi thấy nền xanh.

## Vòng review Phase 3b — sửa code và tích hợp

### Tích hợp

- **D-260 — Trang "Hướng dẫn" trong bản web** (đóng phần còn mở của D-257): route lười `#/guide` (phần người dùng
  của README) và `#/guide/cam-am` (`docs/AI-PROMPT-CAM-AM.md`, bỏ "Ghi chú cho người phát triển"), mở từ ☰ Menu →
  **Hướng dẫn** (mục cuối; màn đầu không đổi). Nội dung nạp nguyên văn bằng `?raw` vào chunk của route — một nguồn
  duy nhất, sửa tài liệu là trang đổi theo. `src/guide/markdown.ts` là bộ đọc markdown tối giản tự viết (không thêm
  dependency, không HTML thô / `dangerouslySetInnerHTML`): tiêu đề ATX, đoạn văn, danh sách lồng / có số, bảng GFM,
  code có rào 3 / 4 backtick, trích dẫn, kẻ ngang, đậm / nghiêng / code / link / ảnh / URL trần; id tiêu đề = slug
  kiểu GitHub (trùng tên → `-1`). Link: `#mục` → `#/guide…?s=mục` (không đi qua router như route lạ; bấm lại mục
  đang ở thì tự cuộn), file tài liệu kia → trang tương ứng, https → tab mới, file repo / mục đã cắt → chữ thường.
  Token `https://VERCEL_URL_TODO` hiện thành địa chỉ app đang mở. Ảnh `docs/images` là asset của chunk, không
  precache PWA (`globIgnores: assets/*.png`, ~600 KB; offline hiện chú thích thay ảnh; bản 1 file không nhúng ảnh).
  Khối code có nút **Sao chép**. Giao diện tiếng Anh: một dòng báo tài liệu viết tiếng Việt + link "English version"
  của prompt AI. Lối vào khác: dòng "Hướng dẫn đầy đủ và nơi tìm nguồn bài" của Nhập cảm âm (D-202) là link tới mục
  "Tìm nguồn ở đâu" / "Where to find a source" (tab mới — không rời Editor đang sửa), và "Cú pháp .harm" ở ghi chú
  Nhập file của Thư viện. Slug mà app link tới (`định-dạng-harm-đầy-đủ`, `tìm-nguồn-ở-đâu`,
  `where-to-find-a-source`, `english-version`) được `src/guide/guideContent.test.ts` giữ — đổi tên các tiêu đề đó
  thì sửa cả code.
- **D-261 — Tauri: link dạng hash bắt đầu từ query sạch** (`open_link_argument`, thay chỗ `base.join`): router web gộp
  `location.search` với query trong hash (khóa thiếu lấy từ search), nên `#/overlay/<id>?…` từng kế thừa
  `overlay=1&song=…&layout=game` mặc định của cửa sổ. Đối số `#…` → bỏ query, đặt fragment; `?…` (có thể kèm `#…`) →
  thay query; link đầy đủ như cũ. TAURI.md ghi rõ. Chưa build thử (không có Rust).
- **D-262 — Editor theo tên gọi nút** (D-181): nhãn directive `@scroll` trong Xem trước là "{tên Nửa Cung}
  (@scroll)"; cảnh báo của Tối ưu lại gọi đúng tên cài đặt "Chiều {tên} (scroll)".

### Player, overlay, cửa sổ nổi, màn thu

- **D-263 — Cue "vào lại" Mobile** (bổ sung D-173 / D-180): game giữ chế độ qua các lần chơi. `MobileEntryTracker`
  (`src/player/mobilePlan.ts`) nhớ chế độ người chơi đang giữ, lấy theo kế hoạch tại vị trí cuối cùng thật sự đã chơi
  tới; lần mở đầu = Ngẩng Tự Nhiên / Nửa Cung tắt; Nửa Cung "chỉ áp 1 nốt" luôn coi là tắt. Mỗi lần nhảy (chạy lại,
  phát lại sau khi hết bài, seek / đổi dòng / section, vòng overlay `loop=1`, wrap loop A-B) sinh `MobileEntry` ở nốt
  đầu từ điểm bắt đầu: khác quãng → chạm nút quãng đích; khác Nửa Cung → chạm Nửa Cung; không bao giờ chạm mò. Cue
  này THAY các cue của kế hoạch tại nốt đó (rỗng = bỏ cue thừa). Tới hết beat của nốt đó (kể cả đang đứng / đếm vào
  đúng tại nốt) banner / game bar hiện chế độ đang giữ, cue là lần chạm kế (SẮP CHẠM). Pause / phát tiếp tại chỗ
  (lệch ≤ 1e-3 beat) và transport chờ bấm ở practice không tính là nhảy. Seek khi đang dừng giữ nguyên chế độ đang giữ
  (không coi như đã chạm mọi cue tới chỗ mới). Loop A-B: SẮP CHẠM không báo cue từ loop end trở đi; lần chạm kế tính
  qua wrap. Canvas vẽ cue vào lại ở vòng hiện tại và ở mọi bản vẽ lại của vòng kế.
- **D-264 — Quantize màn thu: hai nốt rơi cùng ô** (bổ sung D-247): ô kế còn trống → dời nốt sau sang đó (như cũ);
  ô kế là ô của lần bấm tiếp theo → giữ nốt bấm sát mốc ô hơn (hòa → nốt sau), bỏ nốt kia — không đẩy dây chuyền cả
  đoạn legato trễ một ô.
- **D-265 — RecordRoll theo kiểu điều khiển** (bổ sung D-246): Mobile ghi số giản phổ ở cột làn và trên ô, chấm quãng
  vẽ bằng arc riêng (không dấu kết hợp), giữ `#`; PC giữ `Z X C…`.
- **D-266 — "Chia sẻ" ở Player: một toast** (bổ sung D-188): vùng toast của Player chỉ giữ 1 toast, nên link dài cho
  MỘT toast (kiểu info) vừa xác nhận đã sao chép vừa khuyên gửi `.harm` (`player.shareCopiedLong`), thay vì toast lỗi
  đè mất xác nhận.
- **D-267 — Huy hiệu "Đang phát giai điệu" ở Cửa sổ nổi** (bổ sung D-184 / D-251): góc trên phải, luôn hiện khi
  `audioEnabled` bật, ngoài thanh công cụ tự ẩn (thanh dời xuống 26 px). Component dùng chung
  `src/player/MelodyBadge.tsx`.
- **D-268 — Link overlay mang cách Nửa Cung và tên nút** (bổ sung D-206 / D-211): `semitone=oneshot` (chỉ khi
  `scheme=mobile`) và `nl` / `nr` / `nn` / `ns` (tên Cúi Xuống / Ngẩng Lên / Ngẩng Tự Nhiên / Nửa Cung, URI-encoded,
  ≤ 24 ký tự). URL là nguồn duy nhất cho hai thứ này: overlay không đọc Cài đặt của trình duyệt đang mở nó (OBS có bộ
  nhớ riêng); không có tham số → toggle và tên mặc định theo ngôn ngữ. "Tạo link OBS" lấy cả hai từ Cài đặt, không
  thêm control mới.
- **D-269 — Cửa sổ nổi: `tileScale = (1440p ? 4/3 : 1) / dpr`** (sửa D-253): gutter co giãn cùng vùng lane nên 8 cột
  thẳng 8 phím ngay lần mở đầu ở Windows 125 / 150 % và 1440p (lệch ≤ 2 px vật lý). Kích thước 576 × 600 / 768 × 800
  giữ nguyên; "Cỡ tile và nhãn" của Cài đặt không áp vào cửa sổ nổi.
- **D-270 — Lưới mờ trên nền chroma** (thực hiện đúng D-240): vạch nhịp, vạch section và nhãn section là màu trộn sẵn
  trên `opaqueBase`, không dùng `globalAlpha` (không pixel bán trong suốt trộn với #00FF00).
- **D-271 — Game bar của overlay luôn dùng bộ màu tối** (bổ sung D-242): `.overlay .game-bar` ghim `--text`,
  `--text-muted`, `--border-strong`, `--warn`, `--warn-text`; trong overlay bỏ ghi đè "nốt thường nền đậm" của theme
  sáng (overlay `bg=theme` + theme sáng: contrast nhỏ nhất 7.88:1, trước 1.02:1).
- **D-272 — Nút chế độ sắp chạm: vòng hổ phách TĨNH** `0 0 0 3px var(--warn)` (sửa D-180; theo D-239 / D-240): bỏ
  `@keyframes gbm-cue`; nền chroma cũng giữ vòng đặc.
- **D-273 — Renderer tôn trọng `prefers-reduced-motion`** của cửa sổ chứa canvas (DESIGN.md nguyên tắc 4; nghe thay
  đổi, dọn khi dispose): tile chờ bấm có viền tĩnh. HUD luyện tập đổi "nốt đang nhấp nháy" thành "nốt có viền vàng" /
  "amber-outlined note".
- **D-274 — Hộp thoại "Tạo link OBS" theo README** (D-232, D-259): Window Capture + Chroma Key là "Cách 1 (khuyên
  dùng)" (4 bước, có bước cắt thanh tiêu đề / địa chỉ của cửa sổ Mở thử bằng Crop/Pad), Browser Source là "Cách 2 …
  chỉ người xem thấy". Nền mặc định vẫn trong suốt (D-212). _Góp ý 2026-10-15: thay / sửa bởi D-323._
- **D-275 — Hàng nút header Player xuống dòng** (flex-wrap, căn phải): không cuộn ngang ở 320–375 px.

### Tạo bài từ file (MIDI / MusicXML)

- **D-276 — Thu melody theo cổng âm thanh như `#/record`** (sửa D-137; theo D-183, D-248): click đếm vào /
  metronome chỉ khi `clickSound` bật; tắt → đếm vào chỉ bằng hình, bắt đầu ngay (không "Đang chuẩn bị âm thanh…"),
  không tạo / unlock AudioContext, không báo noAudio. Toggle "Metronome trong lúc thu" (cục bộ, mặc định bật) chỉ có
  tác dụng khi `clickSound` bật; tắt → hiện tắt + disabled + hint dẫn tới Cài đặt → Nâng cao. "Tiếng phản hồi khi
  bấm" là toggle riêng của màn này (mặc định tắt, không lưu, không đụng `practiceFeedback`), có nhắc không bật khi
  stream; bật thì unlock âm thanh trong gesture. noAudio chỉ hiện khi click bật mà không bật được âm thanh.
- **D-277 — Dòng đầu neo ở nốt đầu** (sửa D-123 / D-124): nốt đón đầu bài theo luật nới nửa ô nhịp; marker ở ô nhịp
  1 hay ngay trên ô nhịp đón đều nhận dòng nốt đón (không còn section "Main" lạc, không tách nốt đón). Nốt đầu ở nửa
  sau ô nhịp = nốt đón → lưới dòng / section "Phần N" tính từ ô nhịp đủ đầu tiên (dòng 1 = nốt đón + barsPerLine ô
  nhịp); rest đầu bài vẫn tính từ đầu ô nhịp chứa nốt đầu. Áp cả cho `#/record` (recorder.ts dùng `arrangeMelody`).
- **D-278 — Luyến theo lời khi import:** ở dòng có lời, nốt có chữ + các nốt không chữ liền sau (không rest xen giữa)
  thành một cụm luyến (`X-C` = 1 chữ) nếu cụm có 2–3 nốt (`MAX_MELISMA_NOTES = 3`, theo SPEC §3) cùng độ dài; cụm lệch
  độ dài hoặc dài hơn (thường do lời MIDI thưa) giữ nốt rời. Karaoke từng chữ không bị tắt ở dòng có luyến. _Góp ý 2026-10-15: thay / sửa bởi D-312._
- **D-279 — `snapBeats` thử mọi mẫu số d ≤ 64** (như `formatBeats`) rồi 96 / 128 / 192 (sửa D-125): chùm 5, chùm 7 ghi
  đúng 1/5, 1/7.
- **D-280 — Lời theo lượt lặp quyết định theo LẦN GHÉ Ô NHỊP** (sửa D-192): lần lặp k dùng lượt (chọn + k − 1) nếu ô
  nhịp đó (lần ghé đó, voice đã chọn) có chữ nào của lượt ấy — khi đó nốt không có chữ lượt ấy là luyến, không mượn chữ
  lượt khác; ô nhịp không có chữ nào của lượt ấy (lời chung ghi một lượt) dùng lượt đã chọn. `ScoreNote.visit` mới. _Góp ý 2026-10-15: thay / sửa bởi D-312._
- **D-281 — `.rmi` (RIFF-RMID)** (bổ sung D-198): `parseMidiFile` bóc chunk `data` (bỏ chunk khác, đệm byte lẻ; chunk
  khai dài hơn file thì cắt theo phần có); không có `data` → `invalid`; giới hạn 2 MB tính trên cả file; ô chọn file
  nhận thêm `.rmi`.
- **D-282 — Wizard chặn kéo-thả ở mọi bước** khi tab File đang hiện (sửa D-199 / D-133): trình duyệt không mở file
  trong tab; thả file ở bước 2–5 = chọn file mới (về bước 1, đọc xong sang bước 2); thả chỉ có đường dẫn → về bước 1
  hiện hướng dẫn.
- **D-283 — PianoRoll của MIDI / MusicXML** (bổ sung D-238 / D-246): nốt màu `--text` (trung tính), playhead màu
  `--accent` (chỉ báo tiến độ của khung UI); không dùng accent cho nốt, không dùng `--warn`.

### Cài đặt và giao diện

- **D-284 — Migrate settings v2 → v3 tắt cả `practiceFeedback`** (bổ sung D-183): ở v2 `audioEnabled` là công tắc tổng
  (previewMidi thoát sớm khi tắt), nên "audio tắt + feedback bật" vẫn im lặng; v3 tách feedback ra, nên phải tắt luôn
  để cấu hình im ở v2 vẫn im sau migrate ("migrate tắt âm thanh một lần").
- **D-285 — Nhóm "Synth của app"** (sửa D-184): Âm sắc và **Âm lượng synth** (đổi tên từ "Âm lượng giai điệu") không
  còn bị khóa khi giai điệu tắt; nhóm thứ 4 sau "Tiếng khi luyện tập", luôn chỉnh được, ghi chú luôn hiện liệt kê mọi
  tiếng chúng áp vào (giai điệu mẫu, tiếng khi bấm phím / nốt ở luyện tập, màn thu, Thu melody, và "Nghe thử"). Lý do:
  `AudioEngine.playPreview` dùng bus nhạc + timbre cho cả feedback và Nghe thử (D-136 phát cả khi giai điệu tắt), khóa
  theo giai điệu sẽ đẩy người dùng bật toggle có rủi ro bản quyền. Chỉnh hai control này không tự phát tiếng. Nhóm
  metronome / âm lượng click giữ hành vi khóa.
- **D-286 — Tương phản cao Windows (forced colors):** trạng thái vẽ bằng nền / gradient / box-shadow phải vẽ lại bằng
  màu hệ thống trong `@media (forced-colors: active)` (vẫn theo theme của người dùng). Switch: chốt ButtonText; bật =
  nền Highlight + chốt HighlightText; disabled = GrayText. Nút `aria-pressed`, keycap / nút số đang cần, nút chế độ đang
  chọn, tag modifier đang giữ, nút của bàn Mobile ở màn thu: nền Highlight + chữ HighlightText + `forced-color-adjust:
none` (không thì Chromium vẽ tấm nền Canvas sau chữ và HighlightText biến mất ở theme tối). Chấm quãng (`1̇`, số giản
  phổ) = CanvasText (HighlightText trên nút đang sáng); nút chế độ sắp chạm = outline nét đứt; thanh vị trí / Tempo /
  Lookahead vẽ rãnh lại bằng gradient màu hệ thống (`forced-color-adjust: none`). Kiểm e2e bằng PIXEL
  (`e2e/forced-colors.spec.ts`), không bằng computed style (computed style không thấy tấm nền).

## Phase 4m — Mobile: bố cục giống màn chơi kèn, luyện chạm, trang mini Android

- **D-287 — Bố cục kiểu game khi Kiểu điều khiển = Mobile** (Player + màn đầu `#/`; SPEC 2026-10-15 a): `MobilePad`
  thay game bar, đặt trong hộp canvas (đáy); canvas dùng `lanePadding: 'pad'` (8 cột bằng nhau, không gutter ribbon,
  không lề nhãn section). Một hàm thuần `padGeometry(w, h)` (layout.ts) cho cả renderer lẫn DOM — vị trí nút là % của
  cùng hộp nên tâm lane = tâm nút tròn (test ở 7 kích thước). Ø nút theo tỉ lệ game (số 0.68 × cột, chế độ 0.45 ×
  cột) nhưng có trần theo chiều cao khung (0.22·H / 0.19·H — điện thoại ngang thấp) và trần tuyệt đối (112 / 72 px —
  desktop rộng). 4 nút chế độ có tâm trên MÉP cột 3|4, 4|5, 5|6, 6|7 (= nhóm căn giữa cột 3…7 như game) nên tile rơi
  lọt khe giữa chúng: tile "viên thuốc" rộng min(0.86 × Ø số, cột − Ø chế độ − 2), tối thiểu nửa cột. Hit line = đỉnh
  nút số; tile, vạch `CHẠM` và nhãn section bị cắt tại hit line ("đáp" vào nút). PC, overlay, cửa sổ nổi không đổi.
- **D-288 — Nhãn nút chế độ:** Ø ≥ 40 px → hai dòng trong hình tròn; nhỏ hơn (điện thoại dọc, trang mini) → dưới hình
  tròn, **xếp so le hai dòng** (Nửa Cung / Ngẩng Tự Nhiên dòng trên, Ngẩng Lên / Cúi Xuống dòng dưới), mỗi nhãn MỘT
  dòng rộng tới 2 cột − 8 px ("…" nếu tên tự đặt quá dài); phần tràn ra ngoài nút không nhận chạm. Lý do: xuống dòng
  trong một cột làm hai nhãn kề nhau đọc dính ("NGẨNG TỰ" + "CÚI XUỐNG"), và font dự phòng trên Android (không có
  Bahnschrift) rộng hơn → dòng thứ ba bị cắt mất.
- **D-289 — Trạng thái nút:** nút chế độ đang chọn tô màu chế độ (dùng lại `.gbm-*` / `.gb-tone-*` và luật forced
  colors của game bar; Ngẩng Tự Nhiên sáng ở theme tối, đậm ở theme sáng); sắp chạm = vòng hổ phách tĩnh (D-272) +
  "ping" MỘT lần. Ping, tia sáng khi trúng, chữ kết quả, loé khi sai chế độ đều chạy một lần (không animation lặp —
  DESIGN.md); giảm chuyển động → chỉ mờ dần. Accent neon không tô nút.
- **D-290 — Banner gọn ngay dưới dải lời, CAO CỐ ĐỊNH** (38 px; màn ≤ 720 px rộng: 48 px, đủ hai dòng): banner cao
  lên khi `SẮP CHẠM` hiện làm khu tiles co lại → hit line và bàn nút nhảy theo nhịp chạm (đo được 16 px ở 390 × 844).
- **D-291 — Điện thoại** (`(max-height: 520px), (max-width: 720px)`): bấm Phát → trang cuộn cho khu tiles + bàn nút
  nằm trọn trong màn (`block: 'end'`; giảm chuyển động → không cuộn mượt) và hiện nút tạm dừng nhỏ ở góc trên trái
  khu tiles (thanh điều khiển đã khuất phía trên); màn thấp (ngang) thì khu tiles cao đúng một màn. Không thu gọn
  thanh điều khiển thành một hàng (cuộn lên là thấy). Điện thoại dọc: chip "Xoay ngang để giống màn hình game" (đóng
  được, nhớ ở `dfht-rotate-hint-dismissed`); ở màn đầu chip không có nút đóng và ẩn khi bắt đầu (màn đầu chỉ có ▶ /
  tạm dừng / Menu — D-186). Màn đầu kiểu game: nút tạm dừng lên góc trên trái (đáy là bàn nút); lời (đối xứng) và
  banner (bên phải) chừa chỗ cho ☰ Menu.
- **D-292 — Luyện chạm = sự kiện riêng** `PracticeInputEvent` `'tap-down' | 'tap-up'` mang (key, octave, sharp) ĐÃ
  CHỐT lúc chạm + `timeStamp` của PointerEvent; `PracticeSession` chấm lựa chọn của chính lần chạm (bỏ qua modifier PC
  đang giữ), cả Chờ lẫn Chấm điểm. Chốt như game: quãng giữ tới lần chạm nút khác; Nửa Cung theo `mobileSemitone`
  ('toggle' chốt; 'oneShot' áp cho nốt kế, chạm lại trước nốt đó là hủy). Đa chạm theo `pointerId`; mất focus / ẩn
  tab thả mọi ngón. Bàn phím + MIDI vẫn chấm kiểu PC song song. `pointerdown` trên bàn nút không lan lên stage (không
  kích hoạt modifier chuột PC). Không tiếng trừ khi `practiceFeedback` bật (D-183).
- **D-293 — Nhắc nút chế độ khi luyện** so với chế độ ĐANG CHỐT trên bàn chạm và nốt chưa chấm kế tiếp
  (`PracticeUiState.next`), không theo kế hoạch tại hit line → đổi sớm lúc nghỉ không bị nhắc sai. Chạm sai chế độ →
  loé nút mà nốt engine nói là đang chờ cần (`handlePracticeInput` trả `{ kind, expected }`).
- **D-294 — Kết quả cạnh nút:** PERFECT / GOOD / MISS / SAI PHÍM bật lên ở hit line của cột vừa chấm (thay chữ lớn
  giữa hit line ở bố cục kiểu game); không rõ cột (MIDI ngoài tầm) → giữa. Combo nhỏ ở góc trên phải khu tiles
  (`aria-hidden`; screen reader đọc ở HUD).
- **D-295 — Rung + chặn cử chỉ:** "Rung khi chạm" là công tắc cục bộ trong HUD (không vào settings.ts), khóa
  `dfht-pad-vibrate`, mặc định bật trên máy cảm ứng, chỉ hiện khi có Vibration API; 10 ms. Bàn nút chặn cuộn / zoom /
  chạm đúp phóng to / menu nhấn giữ / chọn chữ (`touch-action: none` + `preventDefault` touchstart không passive làm
  dự phòng cho iOS). HUD trên điện thoại (`pointer: coarse`) + Mobile: bỏ ghi chú "tab phải focus" và cảnh báo
  Ctrl + N (chỉ áp cho bàn phím), giữ trạng thái MIDI — dải điểm ngắn lại, khu tiles lên cao hơn.
- **D-296 — Trang mini Android `#/mini/:id?delay=0|3|5|10`** (SPEC c, thử nghiệm): route tải lười, không nav app,
  không "Có bản mới" (như overlay). Dùng `OverlayEngine` (không có code âm thanh → luôn im lặng, kể cả khi bật giai
  điệu mẫu); countdown riêng `MiniController` (mặc định 3 s, nhớ ở `dfht-mini-delay`; chạy tiếp sau tạm dừng cũng
  đếm lại để kịp quay về game), count-in hình 1 ô nhịp. Lớp chạm phủ cả khung là nút tạm dừng (lúc panel hiện thì chỉ
  là nền, ra khỏi Tab và screen reader). Wake Lock khi đếm / chạy, xin lại khi trang hiện lại. Mobile → `MobilePad`
  chỉ hiển thị + `lanePadding: 'pad'`; PC → `GameBar` gọn một hàng. Engine dựng lại khi đổi bài / kiểu điều khiển /
  kiểu Nửa Cung. Banner chế độ ở ĐỈNH làn (khung ~300 px: banner trên hit line che đúng ô sắp tới).
- **D-297 — Cửa sổ video nổi** (Picture-in-Picture của `<video>` — Document PiP không có trên Android; thử nghiệm):
  "Trực tiếp" = `canvas.captureStream()` → video muted (đứng khi Chrome xuống nền — hộp thoại nói rõ); "Dựng sẵn" =
  WebCodecs VP8 (VP9 dự phòng), 24 fps, ~0.7 Mbps, keyframe mỗi 2 s, 480 × 360, ghép WebM bằng muxer tự viết
  (`src/pip/webm.ts`, không thêm dependency; ghép sau khi mã hóa xong nên mọi phần tử biết trước kích thước, Cues sau
  cluster). Video có đếm ngược ≥ 3 s. Mở video dựng sẵn bằng một chạm mới (PiP cần user gesture, dựng lâu hơn hạn của
  gesture cũ). Khung vẽ bàn nút cùng `padGeometry`, ghi chế độ hiện tại + lần chạm kế bằng chữ to bên trái thay tên
  dưới từng nút (PiP thu nhỏ video). Đổi theme / ngôn ngữ / tên nút → bỏ video đã dựng. Rời trang → đóng PiP, hủy dựng.
- **D-298 — Menu "Cửa sổ mini (Android, thử nghiệm)"** ngay sau "Cửa sổ nổi (1 màn hình)": hộp thoại chọn bài + LINK
  thật tới `#/mini/<id>` (mở được trên điện thoại), dùng lại chuỗi chọn bài của cửa sổ nổi. Hướng dẫn theo
  hãng + lưu ý (tắt con quay hồi chuyển, không mở qua Game Booster / Gaming Hub, cảnh báo bảo mật, lời đồn khóa tài
  khoản chưa kiểm chứng) theo `docs/RESEARCH-MOBILE-FLOATING.md`, có ở nút ⓘ của trang mini và README. _Góp ý 2026-10-15: thay / sửa bởi D-309._

## Vòng review Phase 4m — sửa code

- **D-299 — Hiệu ứng một lần không được dựa vào CSS để biến mất.** Kết quả cạnh nút, tia sáng và vòng "cần chạm" của
  `MobilePad` tự gỡ khỏi state sau `PAD_POP_MS` (900 ms) / `PAD_NEED_MS` (1000 ms) bằng hẹn giờ (dọn khi unmount).
  Giảm chuyển động: app.css tắt MỌI animation bằng `* { animation: none !important }`, nên luật thay thế phải khai cả
  shorthand kèm `!important` (`animation: mpad-fade … forwards !important` — selector lớp thắng `*`), không thì hiệu
  ứng `forwards` đứng yên mãi (Android "Xóa hiệu ứng" bật prefers-reduced-motion). Áp cả cho `.practice-flash` (PC).
  Test bất biến CSS: `src/player/mobilePadCss.test.ts`.
- **D-300 — Tia sáng nằm cạnh hình tròn, không trong nó:** hình tròn nút số có key theo nốt ở hit line (remount để
  "nhấn lại" cùng phím), phần tử con bị gắn lại và chạy lại animation → mỗi nốt tới / rời cột hiện một lần trúng giả.
  Tia sáng là anh em trong ô nút, key theo `seq` của lần chấm, đặt theo `--mpad-digit-d` / `--mpad-digit-top`.
- **D-301 — Chữ trên bàn chạm theo cảm ứng:** `PracticeFlash.rightKey` (engine: bấm sai nhưng đúng phím của nốt lẽ ra
  phải bấm) → bàn chạm ghi "SAI CHẾ ĐỘ" thay "SAI PHÍM" (PC giữ "SAI PHÍM" cho sai modifier, D-294). HUD ở kiểu Mobile:
  "Chờ: … chạm đúng nút chế độ rồi chạm nốt" (`practice.mode.waitHintTouch`); tooltip nút Chờ của thanh điều khiển
  (thuần props) giữ câu PC.
- **D-302 — Chữ tile không chui dưới tên nút chế độ:** tên nằm DƯỚI hình tròn (Ø < 40 px — điện thoại dọc, trang mini,
  video) chiếm dải ngay trên hit line, rộng ~2 cột → nhãn tile (bám mép gần, dính đáy phần còn thấy khi tile dài) dừng ở
  `tileLabelFloor(L)` = đỉnh dải tên (hit line − (digitTop − modeTop − modeD) − 1) tới khi đầu trên của tile đi qua.
  Tên trong hình tròn / không bàn nút: như cũ. Bố cục không lề nhãn ('pad' / 'none') có nhãn section: viên "CHẠM: …"
  phía đầu hàng lùi qua tag section dọc (`pillLead`), không bị che chữ C.
- **D-303 — `OverlayEngine.setRendererOptions` cập nhật `--lane-left/right` ngay** (renderer tính lại layout đồng bộ):
  trang mini đổi `tileScale` (useLaneScale) sau khi ResizeObserver của engine đã chạy → keycap PC lệch tới 0.6 làn ở
  300 px. Cũng đúng cho overlay đổi scale.
- **D-304 — Cửa sổ video nổi:** (1) "Trực tiếp": Chrome ẩn nút ▶ / ❚❚ của khung PiP cho nguồn MediaStream trừ khi trang
  đăng ký Media Session `play` / `pause` → đăng ký trong lúc phiên mở (gỡ = `null` khi đóng); hết bài thì dừng video
  (khung hiện ▶) và ▶ chơi lại từ đầu; đứng yên (dừng / hết) không vẽ lại khung. (2) "Dựng sẵn" chỉ bật khi `<video>`
  phát được WebM (`canPlayType` của `video/webm; codecs="vp8"` hoặc `"vp9"` khác '') — chọn codec cũng bỏ codec không phát
  được, trước khi dựng. (3) Nhường luồng khi dựng bằng task MessageChannel (setTimeout của trang nền bị hãm ~1 lần /
  giây); giữ màn hình sáng (Wake Lock) khi đang dựng; câu "giữ trang này mở cho tới 100 %". Tiến độ chỉ cập nhật state
  khi số % đổi, chữ % không là live region (đọc `<progress>`). (4) Canvas nguồn vẽ ở DPR 1 (`TilesRendererInit.dpr`,
  tham số thứ 3 của `TilesRenderer` — không thêm vào RendererOptions / overlay).
- **D-305 — Hướng dẫn trang mini:** lưu ý chung "không mở cửa sổ qua tiện ích chơi game của hãng (Game Booster, Gaming
  Hub, Game Turbo, Game Space…); chạm vào game bị chặn → gỡ DF khỏi các tiện ích đó" (`mini.tip.gameTools`, không chỉ
  trong mục Samsung — RESEARCH (b), (d)). vivo / iQOO: có cửa sổ nhỏ nhưng không phóng to được và có thể treo game
  (không phải "không có cửa sổ nổi").

## Vòng sửa theo góp ý test local (2026-10-15)

Người dùng test bản local và gửi góp ý A–E (nguyên văn tóm tắt ở đầu `docs/SPEC.md`, mục 2026-10-15). Các mục dưới ghi
cách hiểu đã thống nhất và những chọn lựa khi làm.

### Màn chơi, điều hướng (A2, B1–B4)

- **D-306 — Màn đầu = màn chơi đầy đủ** (B1; thay D-186, D-187, phần Menu của D-204 / D-215 / D-243 / D-298):
  `#/` = `HomeView` = `<PlayerView songId={DEMO_SONG_ID} home />` — cùng màn với `#/play/:id`, mở sẵn bài mẫu
  `DEMO_SONG_ID` (nay `seed-quoc-ca-viet-nam`, D-364). Xóa DemoScreen (variant 'demo', `instantStart`), `home.css`, ☰ AppMenu (+ CSS, test). Mục của
  Menu chuyển chỗ: Thư viện → nút góc trên trái; Bài mới / Tạo bài từ file / Tự chơi để tạo bài → trang Thư viện (D-319);
  OBS, Cửa sổ nổi, Cài đặt → thanh dọc phải (D-309); Hướng dẫn → link trên thanh điều hướng + link "Hướng dẫn đầy đủ"
  cuối cột phím tắt; ngôn ngữ + theme → góc trên phải header màn chơi; dòng fan-made → chân trang Thư viện.
  `DEMO_SONG_ID` chuyển sang `src/home/demoSong.ts` (để `src/ui/lastPlayed.ts` không phải import cả Player — vòng
  import). `HomeView` giữ làm vỏ mỏng để route `#/` vẫn có component riêng. Thông báo "Đã sẵn sàng dùng offline" vẫn
  không hiện ở `#/` (D-219: màn đầu của người mới) — chờ trang kế tiếp.
- **D-307 — Thanh điều hướng: nút "◂ Về màn chơi"** (A2): mọi trang có thanh điều hướng (Thư viện, Cài đặt, Hướng
  dẫn, trình soạn, Tạo bài từ file, Tự chơi, Bài được chia sẻ…) thay tên app bằng link "◂ Về màn chơi" (en "◂ Back to
  player"); tooltip + tên truy cập "Về màn chơi — {tên bài}". Đích = bài mở ở màn chơi gần nhất trong phiên (còn tồn
  tại: bài mẫu, bài thư viện, bài tạm / bản nháp còn trong bộ nhớ — `getSong()`) → `#/play/<id>`; không có thì `#/`.
  PlayerView ghi trong effect: `#/play/<id>` nhớ id, `#/` (home) xóa (nút quay về `#/`). Lưu sessionStorage
  `dfht-last-played` (mỗi tab một phiên), bị chặn thì nhớ trong bộ nhớ; hook tính lại khi thư viện đổi (xóa / đổi
  tên). Giữ class `app-brand`, ô accent thay bằng ◂. Thanh có thêm link "Hướng dẫn" cạnh Thư viện / Cài đặt. Điện
  thoại (≤ 560 px): thanh xuống hai hàng ("Về màn chơi" + ngôn ngữ / theme ở trên, ba link ở dưới) — một hàng tràn
  14 px ở 375 px. Màn chơi giữ "◂ Thư viện" (tên truy cập "Về thư viện"). Trang mini / overlay không có thanh.
- **D-308 — Bố cục màn chơi** (B2–B4): header "◂ Thư viện" · tên bài · chip (BPM, đoạn, giai điệu mẫu, cảnh báo) ·
  góc phải `PrefButtons` (ngôn ngữ VI ↔ EN, theme — component dùng chung với thanh điều hướng, CSS chuyển từ
  `.app-nav .btn-ghost` sang `.pref-buttons .btn-ghost`); thanh điều khiển ngay dưới; thân 3 cột: TRÁI danh sách phím
  tắt (D-310), GIỮA sân khấu, PHẢI `PlayerSideBar`; ĐÁY `PlayerSeekBar` trải hết bề ngang (thanh tiến độ rời khỏi
  thanh trên). Bỏ nút "Sửa" khỏi màn chơi (chip lỗi cú pháp vẫn là link tới Editor; thẻ "bài rỗng" vẫn có "Mở trình
  soạn"). Ngưỡng: cột trái hiện ở ≥ 1200 px, CSS ẩn nút "?" (`.transport-help`) cùng ngưỡng; 721–1440 px khoảng cách
  và thanh trượt của thanh điều khiển co lại (92 px) để 1280×720 vẫn một hàng; cao ≤ 820 px thì cột trái ở chế độ gọn
  (khoảng cách + cỡ chữ nhỏ hơn) nên ở 1280×720 cả danh sách và link "Hướng dẫn đầy đủ" vừa cột, không phải cuộn. Thanh dọc rộng 104 px, icon trên nhãn; cao ≤ 520 px hoặc rộng ≤ 720 px → nhãn ẩn bằng mắt (vẫn là
  tên truy cập); dọc ≤ 720 px → một hàng icon phía trên sân khấu; điện thoại ngang → cột icon 60 px cạnh sân khấu.
  Làn và bàn nút vẫn thẳng vì cùng dựa hộp canvas. Sáu icon vẽ tay mới (pc, mobile, pip, obs, share, settings) trong
  `Icon` của TransportBar (even-odd cho icon viền); bỏ icon 'menu'.
- **D-309 — Thanh dọc phải** (B2), trên → dưới: nhóm `role=group` "Kiểu điều khiển" gồm hai nút `aria-pressed`
  **PC** | **Mobile** (ghi thẳng `settings.controlScheme` — cùng store với Cài đặt, đổi bố cục ngay), **Cửa sổ nổi**,
  **OBS** (`aria-haspopup`, mở "Tạo link OBS" cho bài đang mở, không ô chọn bài), **Chia sẻ**, **Cài đặt** (link).
  Cửa sổ nổi: kiểu PC = `FloatingWindowButton` viết lại thành MỘT nút bật / tắt (`aria-pressed`; mở khi tắt, đóng khi
  bật), nhãn nhỏ "Đang mở" + trạng thái chỉ cho screen reader "Đang mở cửa sổ nổi"; "Chuyển sang bài này" chỉ hiện
  khi cửa sổ đang mở bài khác; ghi chú "không hỗ trợ" / "bị chặn" là bong bóng bên trái thanh (dưới thanh trên điện
  thoại), tự ẩn sau 8 s (`PIP_NOTE_MS`). Bỏ nút "Đóng cửa sổ nổi" riêng. Kiểu Mobile = mở `MiniLauncher` cho bài đang
  mở (prop mới `songId`: "Bài: {tên}", không ô chọn bài); hộp thoại video nổi vẫn mở từ trong trang mini. Màn chơi
  theo dõi trạng thái mở của hộp thoại mini để tạm ngưng phím tắt khi nó mở. Tooltip: `pip.buttonHint` (PC) /
  `player.floatMobileHint` (Mobile; `mini.menuHint` đã xóa cùng Menu). Điện thoại không có Document PiP ở kiểu PC: D-339.
- **D-310 — Một danh sách phím tắt cho cột trái, hộp thoại "?" và Cài đặt** (B3): `ShortcutsHelp` nhận `scheme` (mặc
  định theo Cài đặt), `hideFocusHint`, `hideGuideLink`; ba nhóm — **Phím tắt** (Space, R, ← / →, L, [ / ], Esc hủy
  đếm ngược), **Phím game** / **Nút game** (8 phím `Z … ,` kèm số 1 … 1̇ và Đồ … Đố — chấm của Đố vẽ bằng CSS, không
  U+0307 trong DOM), **Chuột** (PC: giữ chuột trái / phải, chuột giữa / cuộn = tên từ modLabels, ô màu modifier) /
  **Chạm** (Mobile: chạm chế độ rồi nốt, chạm Nửa Cung, giữ nút số cho nốt dài) — rồi một câu luyện tập theo kiểu điều
  khiển, ghi chú focus và link "Hướng dẫn đầy đủ". Hàng chuột / chạm xếp dọc cho vừa cột hẹp.

### Bỏ lời / karaoke (A1)

- **D-311 — Bỏ hoàn toàn lời / karaoke** (thay D-019, D-041, D-076, D-098, D-099, D-149, D-160, phần lời của D-083 /
  D-146 / D-290): bỏ dải lời của Player (`Lyrics.tsx`), nút "Lời", công cụ "Dán lời và chia chữ" (`LyricsModal`,
  `lyricsDistribute*.ts`), lời trong prompt AI, cảm âm, donate ("Có lời"), MIDI / MusicXML, tham số overlay `lyrics`,
  setting `showLyrics`. Model bỏ `Line.lyric`, `TimelineLine.lyric / syllables`, `TimelineNote.syllableIndex`,
  `MelodyEvent.syllable`, `MelodyLine.lyric`, `SerializeOptions.lyrics`, `LineSpan.lyric`; bỏ diagnostic
  `lyric-mismatch` / `lyric-without-notes`. **File cũ vẫn chạy:** parser giữ luật tách cũ (dấu `:` đầu tiên theo sau
  là khoảng trắng hoặc hết dòng — `LEGACY_LYRIC_SPLIT_RE`, export từ parser.ts), phần trước bị bỏ, lời thật thì không
  diagnostic (phần bị bỏ trông như nốt / không còn gì sau `:` → cảnh báo, D-342);
  dòng chỉ có tiền tố (`lời bài:`) không thành dòng nốt nhưng giữ / thả của nó vẫn áp; `L:N`, `RS:X` không phải tiền tố
  (sau `:` không có khoảng trắng); `tokensStart` trỏ token đầu sau tiền tố. Cảm âm (camam.ts, camamDigits.ts) dùng cùng
  luật nên văn bản dán có `chữ: ` vẫn đọc được. Serializer không bao giờ ghi lời; `canonicalSong` / `serializeHarm` bỏ
  khóa `lyric` lạ, `toLine` của nhập JSON bỏ qua `lyric` kể cả sai kiểu (trước đây từ chối file) → file .json cũ nhập
  sạch. Seeds bỏ tiền tố lời (đã kiểm: seed cũ và mới parse ra cùng bài).
- **D-312 — Hệ quả ở donate, MIDI, MusicXML:** donate bỏ chia theo lời; dòng dài có tiền tố cũ thì tiền tố bị bỏ khi
  tách, dòng chỉ có tiền tố dài bị bỏ; `DonateOptions` / `MobileTextOptions` bỏ `lyrics`. MIDI không quét FF05 / FF01
  nữa (`ParsedMidi.lyrics`, `BeatNote.lyric`, `MonoNote.lyric` bị bỏ). `extractMelody` bỏ chế độ gộp tie 'auto' (chỉ
  gộp vào nốt có lời — thay D-128 / D-164 / D-166): `TieMerge` = 'always' | 'never', mặc định 'never' (giống hành vi cũ
  với file không lời). Bộ chia dòng không còn luyến các nốt ngân theo chữ (thay D-278). MusicXML: bỏ chọn lượt lời,
  cột lời, `ScorePart.hasLyrics / lyricVerses` (thay D-192, D-280, phần verse của D-196); thay bằng cờ nội bộ
  `sung: boolean` (bè có `<lyric>` có chữ thật; `<extend/>` không tính) — chỉ dùng cho gợi ý bè (D-320);
  `ScoreNote.pass / visit / lyrics` bỏ, `ScorePartNoteOptions` = `{ voice }`. Fixture test (`midi/testing`) vẫn sinh
  được event lời / `<lyric>` vì mô phỏng file thật (test "bỏ qua lời" và cờ `sung`).
- **D-313 — Prompt AI và chuỗi giao diện:** `docs/AI-PROMPT-CAM-AM.md` (+ `aiPrompt.ts` đồng bộ) bỏ quy tắc lời và
  quy tắc dấu cách chữ Hán, đánh số lại 1–17; quy tắc 3 giữ "(không ghi lời)" / "(no lyrics)" để AI không tự thêm lời
  khi đọc sheet; quy tắc 13 thành "nốt nối bằng dấu luyến"; ví dụ không có lời; slug tiêu đề mà app link tới không đổi.
  Xóa các key vi / en về lời, chiều Nửa Cung, phím thay chuột không còn dùng; `record.created` bỏ tham số
  {tools}/{lyrics}; viết lại `record.subtitle`, `library.newSongComment`, `overlay.preset.fullHint`, trợ giúp cảm âm,
  lời mở của Tối ưu tông, `midi.score.intro`, `selectionRollAria`, chuỗi lệch `@scroll`.

### Cài đặt, Nửa Cung, luyện tập (B5, B6, D1, D2)

- **D-314 — Nửa Cung cố định thăng** (D1; thay D-030, phần `scrollDir` của D-090 / D-109 / D-134): hằng
  `GAME_SCROLL_DIR: ScrollDir = 1` (core/keys.ts) thay setting `scrollDir` ở timeline của Player / cửa sổ nổi /
  overlay / trang mini, ánh xạ MIDI (`midiMapOptionsFromSettings` luôn 1), OptimizerPanel (bỏ prop `scrollDir`),
  finishSteps, Nhập cảm âm, Tối ưu lại (vẫn đọc cao độ theo `@scroll` của bài, luôn ghi `+1`), Tự chơi và template bài
  mới (luôn `@scroll +1`). Bỏ ô "Chiều Nửa Cung". Bài `@scroll -1` vẫn parse; chip cảnh báo của màn chơi chỉ hiện khi
  bài `@scroll -1` có nốt Nửa Cung: "{mod}: bài viết cho giáng (−1), game là thăng (+1)", tooltip chỉ cách sửa bằng
  Tối ưu lại cung / quãng (chuỗi dùng tham số {mod, song, game}). Chip là link tới trình soạn: D-341.
- **D-315 — Settings v4** (B5, D2): bỏ `showLyrics`, `scrollDir`, `practiceKeys` (cùng kiểu AltModifierKey /
  ALT_MODIFIER_KEYS / PracticeKeys); mặc định mới `startDelaySec` 3, `subLabel` 'none'. Migrate dữ liệu < v4:
  `sanitizeSettings` bỏ trường đã xóa, đếm ngược 0 s → 3 s, nhãn phụ → 'none' (một lần — người dùng đổi lại sau đó thì
  giữ: dữ liệu đã ở v4 giữ 0 s / nhãn phụ đang hiện). Luật < v3 cũ giữ nguyên. Test Player / engine nào bấm Phát với
  cài đặt mặc định đặt `startDelaySec: 0` trong beforeEach; test đếm ngược tự đặt giá trị.
- **D-316 — Luyện tập kiểu PC: chỉ chuột cho modifier** (B6; thay phần phím thay thế của D-114, D-152, D-247 / D-264):
  `practiceInput` chỉ nhận phím nốt KeyZ…Comma từ bàn phím; Cúi Xuống / Ngẩng Lên / Nửa Cung chỉ bằng nút chuột 0 / 2 /
  1 trên khu tiles (mọi sự kiện modifier có source 'mouse'). Phím nốt bấm kèm Ctrl, Alt hoặc Meta bị bỏ qua để phím tắt
  trình duyệt (Ctrl+C, Ctrl+N…) chạy bình thường; Shift + phím nốt vẫn là nốt. Xóa: phát lại phím tắt,
  `PRACTICE_PASSTHROUGH_CODES`, `altKeyMatches`, helper tổ hợp giữ chỗ, `PracticeKeyWarning`, `assignPracticeKey`,
  chuỗi `practice.ctrlNWarning` / `practice.changeKeys` / `settings.altKey.*` / `settings.practiceKey*` /
  `record.altKeys`. Thẻ Luyện tập ở Cài đặt chỉ còn câu `settings.practiceMouseHint` (tên lấy từ modLabels). Tự chơi để
  tạo bài cũng chỉ còn chuột trong khung thu.
- **D-317 — Luyện tập kiểu Mobile: chỉ bàn nút trên màn hình** (B6): `PlayerEngine.connectPracticeInputs` không gắn
  input bàn phím / chuột lẫn MIDI khi Kiểu điều khiển = Mobile; MobilePad gọi `handlePracticeInput` trực tiếp và
  pointer của nó nhận cả click chuột. Đổi kiểu điều khiển giữa lúc luyện tập → nối lại input. HUD kiểu Mobile bỏ ghi chú
  focus bàn phím và trạng thái MIDI; máy không cảm ứng thêm câu `practice.touchOnly`; tooltip nút Luyện tập dùng
  `practice.toggleHintTouch`; Cài đặt → Luyện tập thêm `settings.practiceTouchHint`.

### Thư viện và tạo bài (C1–C5)

- **D-318 — Bản nháp: chưa sửa thì không lưu** (C5): "Tạo bài từ file" (file hoặc Thu melody), "Tự chơi để tạo bài",
  "Tạo bài mới thủ công" mở bài bằng `openDraftSong(source)` → id `draft-<uuid>` (mỗi lần tạo một id mới, kể cả cùng
  nội dung) trong bảng bài tạm trong bộ nhớ: không vào localStorage, không vào danh sách Thư viện, còn tới khi tải lại
  trang (Back về `#/edit/draft-…` vẫn mở được; "◂ Về màn chơi" vẫn tìm thấy bản nháp đã phát — đã Lưu thì về bài đã
  lưu, D-336; màn chơi của bản nháp có chip + link về trình soạn, D-335). Editor: sửa được, mở ra
  ở trạng thái chưa bẩn, trạng thái "Bản nháp — chưa lưu" (kiểu hổ phách của "chưa lưu") + một dòng giải thích. Rời đi
  khi chưa sửa → không hỏi, không lưu ("bỏ" = không vào Thư viện; bản nháp không bị xóa khỏi bộ nhớ). Sửa → bẩn → hộp
  rời trang như cũ. **Lưu / Ctrl+S khi chưa sửa vẫn lưu** (bấm Lưu là ý muốn giữ bài rõ ràng — vd. kết quả MIDI đã ưng).
  `saveDraftSong` nhớ bản nháp đã thành bài nào: lưu lần nữa cập nhật đúng bài đó (không nhân đôi); `draftSavedAs` cho
  Editor chuyển URL bản nháp đã lưu sang bài đã lưu (history replace, cùng phiên soạn). `isTransientSong` vẫn đúng với
  bản nháp; `isDraftSong` phân biệt với bài từ link chia sẻ (vẫn chỉ đọc). Phát từ Editor: bản nháp chưa sửa phát thẳng
  `#/play/draft-…?line=N`; đã sửa thì lưu rồi phát bài đã lưu (như sửa bài mẫu). Wizard / màn thu không còn toast "Đã
  tạo bài…" (bài chưa được tạo); toast + `addSong` cũ chỉ còn cho nhánh `FEATURES.editor = false`. Mở lại URL bản nháp
  sau khi tải lại trang → thông báo rõ "bản nháp không còn" (`editor.draftGone`).
- **D-319 — Thư viện: mục "Thêm bài"** (C1): dưới tiêu đề trang, `h2` "Thêm bài" + danh sách có thứ tự (tên truy cập
  "Các cách thêm bài") gồm 4 ô đánh số: "Nhập file ký tự (.harm / .txt / .json)" (kèm link "Cú pháp .harm"), "Tạo bài
  từ file MIDI / MusicXML", "Tự chơi để tạo bài" (link `#/record` — trước chỉ có trong Menu), "Tạo bài mới thủ công"
  (cuối; chỉ khi `FEATURES.editor`). Mỗi ô = nút / link + một dòng gợi ý nối bằng `aria-describedby`; lưới 2×2 (mỗi ô
  tối thiểu 440 px, nút rộng theo chữ, được xuống dòng), màn hẹp xếp chồng. Kéo thả file vào trang vẫn nhập. Dòng
  fan-made là chân trang Thư viện, key riêng `library.fanMade` (không phụ thuộc khối `menu.*`). Thông báo lỗi nhập MIDI
  / MusicXML trỏ tới tên nút mới.

- **D-320 — Gợi ý track / bè giai điệu theo mật độ nốt so với tempo** (C2; thay D-196 và tiêu chí "nhiều nốt" của
  D-200): module thuần `src/midi/melodySuggest.ts`. Mật độ = số nốt của track ÷ độ dài CẢ BÀI tính bằng beat (nốt đầu
  của mọi track — kể cả trống — tới hết nốt cuối) ≡ nốt/phút ÷ BPM; đo theo beat nên đổi tempo giữa bài không lệch.
  Điểm (thấp = giống giai điệu) là tổng của: |log2(mật độ)|; 1,5 × phần vượt ra ngoài dải 0,4–2,5 (log2); 3 × (1 − tỉ
  lệ đơn âm); 2 cho mỗi quãng tám cao độ trung bình dưới G3 (MIDI 55); ± 0,3 theo âm vực trong C3–C6 (bè trên thắng
  khi hai bè giống nhau); −0,75 nếu tên gợi ý giai điệu (melody / vocal / voice / lead / solo / giai điệu / 主旋律 /
  人声…); +0,5 nếu tên kiểu đệm (bass / chord / pad / backing / đệm / hợp âm / 伴奏 / 贝斯… — thêm ngoài brief); −1 nếu
  bè MusicXML có lời (`sung`). Hòa thì giữ thứ tự file; trống bị loại; không ai trong dải vẫn chọn điểm thấp nhất. MIDI
  track có thêm `notesPerBeat`; MusicXML part / voice có `notesPerBeat` + `monophonicRatio` (dung sai legato 1/64
  beat). `suggestScorePart` và `defaultScoreVoice` cùng cách chấm (giọng đầu được lợi 0,5). Hiển thị
  "≈ N nốt/phút · BPM M" (`midi.track.density`, N = mật độ × BPM của wizard = tempo đầu file) thành dòng mờ trong ô tên
  track và đầu phần chi tiết bè — không thêm cột cho bảng gọn. Lời giới thiệu / tooltip gợi ý giải thích luật nốt/phút
  so với BPM. Trên hai bài mẫu và một MIDI thử, gợi ý chọn giai điệu thay vì piano hợp âm, bass, pad, trống.
- **D-321 — Gộp nốt vượt tầm luôn bật** (C3; sửa D-134): OptimizerPanel luôn gập (bỏ công tắc và nút "Bật gập quãng" ở
  wizard, Editor Tối ưu lại, Nhập cảm âm); cột "Nốt gập quãng", gợi ý `editor.optimizer.foldHint` (viết lại) và dòng
  `//!` chỉ hiện khi có phương án thật sự gập nốt. Prop `fold` / `onFoldChange` của OptimizerPanel và state `fold` của
  CamAmModal đã xóa hẳn (integrator). Xóa key `editor.optimizer.fold / emptyFoldHint / enableFold`.
- **D-322 — Tự chia dòng và section** (C4; thay các ô của D-123 / D-124 / D-277 trong wizard): bỏ "Ngắt dòng tại chỗ
  nghỉ", "Mỗi dòng tối đa", "Mỗi section", "Section theo marker". Module mới `src/midi/autoArrange.ts` (quy hoạch động),
  dùng ở finishSteps cho cả file lẫn Thu melody; `arrangeMelody` cũ giữ nguyên cho `src/record/recorder.ts` (Tự chơi
  vẫn chia cố định 2 ô nhịp / dòng, 8 ô nhịp / section — test đang ghim). Luật event như cũ (nghỉ ở cuối dòng, dòng mới
  bắt đầu bằng nốt, khoảng trống < grid cộng vào nốt trước, mỗi nốt vào = đúng một event, giữ thứ tự). Dòng: ưu tiên
  ngắt ở chỗ nghỉ (≥ 1 beat), rồi vạch nhịp (mốc 2 / 4 ô nhịp tốt hơn) và sau nốt dài cuối câu; nhắm 0,75–2,25 ô nhịp,
  4–12 nốt (lý tưởng 8, tối đa 24); chỗ nghỉ rõ nằm GIỮA dòng bị phạt → nốt đón sau chỗ nghỉ tự mở dòng mới. Section:
  marker của file khi hợp lý — ≥ 2 section và trung bình ≥ 1,5 ô nhịp mỗi section (thử 3 ô nhịp thì mất dấu tập A / A / B
  của bản 5 ô nhịp; marker mỗi ô nhịp kiểu tên hợp âm vẫn bị loại; một marker ở beat 0 bị bỏ). Marker ép ngắt dòng ở nốt
  có chỗ nghỉ dài nhất trong nửa ô nhịp trước marker (nốt đón; hòa thì nốt gần marker), dòng trước marker đầu → "Main".
  Không dùng marker: ~4 dòng mỗi section, ưu tiên chỗ nghỉ dài / mốc 4 ô nhịp, nghỉ ≥ 2 ô nhịp luôn mở section mới, tên
  "Phần N". Trả `markerSections` để bước 5 giải thích. Bước 5 đổi tên "Xem trước và tạo bài" (en "Preview and
  create"): tên bài, tác giả, gợi ý `midi.arrange.auto` / `autoMarkers`, tóm tắt, xem trước, `midi.arrange.draftHint`.
  Trên bài mẫu soạn tay lúc đó bộ chia ra đúng các dòng soạn tay. Xóa key `midi.arrange.breakRest`, `barsPerLine`,
  `barsPerSection`, `useMarkers(_one)`, `autoSections(_one)`.

### OBS: chỉ hiển thị, theo màn chơi, tự khớp bảng phím (E1–E3)

- **D-323 — Hộp thoại "Tạo link OBS" chỉ còn tùy chọn hiển thị** (E1; thay D-212, D-274, phần hộp thoại của D-211 /
  D-268): bài luôn là bài đang mở ở màn chơi (prop `song`; không có bài → `overlay.modal.noSong`). Thứ tự: lời mở
  ("Overlay chỉ hiển thị — chạy theo màn chơi… Chỉnh ở màn chơi"), tên bài, **Kiểu overlay** (Khớp bảng phím game / Dải
  ngang trên bảng phím / Cột đầy đủ có game bar), **Hiển thị** (Độ đậm của ô; Cỡ giao diện game (tinh chỉnh) 70–130 %),
  rồi ba cách theo thứ tự: **Gửi thẳng vào OBS (khuyên dùng)** (`ObsConnectPanel overlayUrl`), **Browser Source thủ
  công** (ô link, "Sao chép link", 4 bước với ví dụ 1920 × 1080 / 2560 × 1440, ghi chú chạy một mình), **Window Capture
  (màn hình thứ 2)** (4 bước, "Mở thử"). Bỏ khỏi hộp: chọn bài, kiểu điều khiển, lookahead, chờ trước khi chạy, tự
  chạy, chạy lại, đếm vào, hiện lời, chọn nền (nền theo cách: Browser Source = trong suốt, "Mở thử" = chroma), bảng
  kích thước / vị trí (D-327). Link luôn `fit=canvas` và mang ảnh chụp Cài đặt của Player (D-326). "Mở thử" mở link
  chroma trong popup 960×540 (`opener` null); dòng "đã sao chép" / "bị chặn pop-up" nằm cạnh đúng nút. Xóa key
  `overlay.startHint`, `overlay.menu.*`, `overlay.bg.*`, `overlay.scheme.*`, `overlay.howto.*`, `overlay.modal.*` của
  nền / tỉ lệ / lookahead / kiểu điều khiển / tự chạy / chạy lại / đếm vào / chờ / bảng cỡ (`bg`, `scale`, `lookahead`,
  `opacityChroma`, `scheme`, `autoplay`, `autoplayHint`, `loop`, `countIn`, `delay`, `delayHint`, `seconds`, `sizes`,
  `canvasCol`, `sizeCol`, `posCol`, `scaleCol`); thêm `overlay.waiting`, `overlay.fullscreen(Hint)`,
  `overlay.modal.noSong / look / opacityHint / uiScale / uiScaleHint / direct / directHint / manual / window`,
  `overlay.manual.step1-4 / note`, `overlay.window.step1-4`. Ba tùy chọn hiển thị được nhớ: D-343.
- **D-324 — Overlay là màn hiển thị của Player: contract và đường truyền** (E2): `src/overlay/follow.ts` — tin
  `song` / `state` / `hello` / `bye` (v = 1, id người gửi). Player (`useFollowBroadcast` → lớp `FollowBroadcaster`, gọi
  một lần trong PlayerScreen sau `usePlayerEngine`) gửi qua BroadcastChannel `dfht-follow` (overlay cùng trình duyệt:
  "Mở thử" / Window Capture) VÀ `relayToObs()` (obs-websocket → obs-browser `emit_event` → `window` CustomEvent
  `dfht-follow` trong Browser Source). Nhịp: `song` khi mount / đổi bài, lặp mỗi 5 s; `state` mỗi lần transport, đếm
  ngược, đếm vào, tempo, loop hay hiển thị đổi + nhịp tim 1 s (cả khi dừng) + khi `visibilitychange`; `hello` → trả
  ngay song + state; `bye` khi unmount / `pagehide`. Beat lấy từ đồng hồ transport thật; còn trong khoảng audio lead
  thì `sentAt` là lúc đoạn bắt đầu trong tương lai; loop wrap / hết bài chưa kịp áp (tab ẩn, không có rAF) được tính từ
  ảnh chụp. Đồng hồ chung = `Date.now()` (`followNow`), không dùng `performance.timeOrigin` — Player và Browser Source
  (CEF của OBS) là hai tiến trình, chỉ đồng hồ hệ thống là chung. Trường tùy chọn thêm vào contract: `state.countIn`
  = `{startBeat, endBeat}` hoặc null (đếm vào không bắt đầu ở beat 0), `state.hidden` (tab Player đang ẩn), `cause` =
  'change' / 'tick' / 'reply' / 'announce' (thiếu = 'change'; 'announce' = mount / bài đổi tại chỗ / bfcache, D-337).
  Sau `pagehide` bộ phát gửi `bye` rồi im hẳn (D-334). `parseFollowMessage` chặt: đúng v, đúng loại, kiểm từng trường, kẹp
  số (bpm 20..400, lookahead 4..12, tileScale 0,5..3), làm sạch nhãn, luôn trả object mới.
- **D-325 — Overlay nhận tin** (`followReceiver.ts`, thuần): chế độ `waiting` → `follow` / `standalone` / `lost`; nghe
  BroadcastChannel + CustomEvent, gửi `hello` khi mở. Theo người gửi gần nhất, nhưng người gửi KHÁC chỉ giành quyền
  bằng tin `cause: 'change'` (người dùng thao tác ở tab đó), hoặc khi chưa có / đã mất người gửi — hai tab Player mở
  cùng lúc không giành nhau mỗi nhịp tim, tab mới mở (`announce`) không giành (D-337). Mất Player = `bye` hoặc ~4 s im lặng; nếu tin cuối báo tab Player đang ẩn
  thì chờ 90 s (trình duyệt hãm timer tab ẩn: 1 lần / giây, sau 5 phút 1 lần / phút — streamer Alt-Tab vào game), trong
  lúc đó chạy tiếp theo tempo đã biết. `OverlayEngine.applyFollow` tính beat mong đợi (bù trễ), chỉ chỉnh khi lệch quá
  0,05 beat (nhịp tim đều không làm giật), giữa các tin chạy theo tempo đã chép; chỉnh quá 0,5 beat mới tính là "nhảy"
  cho cue vào lại kiểu Mobile. Chép đếm vào, đếm ngược (`countdownEndsAt`), bpm, loop A-B (vẽ cả vòng kế). Hiển thị
  (kiểu điều khiển, tên nút, Nửa Cung mobile, lookahead, cỡ ô, nhãn phụ, ngôn ngữ, theme) theo Player; `followPause`,
  `setScheme`. Đang theo thì tắt điều khiển tại chỗ (phím, bấm, `dfht:command`); overlay luôn im lặng.
- **D-326 — Overlay tự chạy một mình, ảnh chụp Cài đặt trong link** (E2): mở overlay mà ~2 s không nghe thấy Player
  (vd. Browser Source thủ công không nối OBS) → `standalone`: chạy bài trong link sau đếm ngược của ảnh chụp, đếm vào
  theo ảnh chụp, không lặp; bấm / Space / R / ← → / `dfht:command` dùng được. Tin của Player tới sau → chuyển sang theo.
  Tham số mới: `fit=canvas|source` (mặc định source = hành vi cũ), `tilescale`, `sublabel`, `lang`, `theme` (thiếu thì
  theo trình duyệt đang mở link); hộp thoại luôn ghi `sublabel` / `lang` / `theme` và `countin` / `delay` theo Cài đặt
  Player. `autoplay`, `loop` giờ bị bỏ qua như `lyrics` (tự chạy luôn bắt đầu sau đếm ngược, không lặp — thay D-207);
  `layout=` vẫn đứng đầu. Thẻ lỗi của link (data hỏng, id lạ, bài rỗng) chỉ hiện sau mốc 2 s (Player có thể gửi bài
  tới); đang theo Player thì không bao giờ hiện. Đang theo mà chưa nhận tin `song`: chỉ hiện bài của link nếu songKey
  (FNV-1a + độ dài) trùng của Player, không thì để trống. **Overlay không bao giờ ghi Cài đặt:** ngôn ngữ / theme của
  Player áp vào store của trang overlay chỉ trong bộ nhớ — trang overlay thay storage của zustand persist bằng bộ ghi
  rỗng khi mount, trả lại khi unmount (cửa sổ "Mở thử" dùng chung localStorage với app; ghi cài đặt cũ của nó sẽ đè
  thay đổi mới ở tab Player). Bản desktop Tauri (`?overlay=1`): `autoplay` bị bỏ qua nên tự chạy 2 s sau khi mở nếu
  không có Player.
- **D-327 — Bố cục cả canvas `fit=canvas`** (E3 "bay thẳng vào đúng chỗ"; thay bảng kích thước / vị trí của D-211 và
  README): trang overlay = cả canvas OBS (Browser Source cỡ canvas tại 0,0, hoặc cửa sổ toàn màn hình + Window Capture +
  Fit to screen) và tự đặt khung đúng chỗ — `canvasPlacement` (overlayParams.ts), số đo `docs/GAME-UI-REFERENCE.md`
  "Bố cục cả canvas". Khung tham chiếu = hình 16:9 lớn nhất giữa viewport, k = rộng / 1920 (canvas không 16:9 thì chừa
  hai bên / trên dưới như game). Không thêm giá trị `layout` mới: preset suy từ tham số (`presetOf`: game → khớp game;
  lane ngang → dải; còn lại → đầy đủ). Khớp game: 8 làn 520·k·s × 600·k·s tại x = (960 − 260 s)·k, phóng quanh đáy-giữa
  bảng phím (960, 921)·k, kẹp không trồi khỏi mép trên; gutter ribbon = round(56 · clamp(k·s·tileScale)) thêm bên phải
  — cỡ ô của Player chỉ nới gutter, không xê dịch làn. Kết quả: 1920×1080 → 576 × 600 tại (700, 150); 2560×1440 →
  768 × 800 tại (933, 200); 1280×720 → 384 × 400 tại (467, 100); 2560×1080 → tại (1020, 150). Dải ngang 1140×440 tại
  (370, 310), neo (940, 750); cột đầy đủ 560×920 tại (1290, 80), neo (1570, 1000) — bên phải giữa màn, không đè bảng
  phím game (x 681–1241). Làm tròn px nguyên (lệch làn ≤ 0,5 px). Bỏ bảng cỡ cũ, `sourcePlacement`, `CANVAS_SIZES`,
  `recommendedScale`. Khung cửa sổ ngoài OBS: nút "⛶ Toàn màn hình" (góc trên phải; cần `requestFullscreen`, ẩn khi đang
  toàn màn hình) và trạng thái "Đang chờ màn chơi…" (góc trên trái, khi chờ / mất Player / chưa có bài; ẩn khi toàn
  màn hình — D-344) là panel HUD tối đặc; thanh accent đổi xám trắng trên nền chroma để Chroma Key không ăn; cả hai không bao giờ vẽ khi có
  `window.obsstudio`. Giới hạn: Window Capture từ màn thứ 2 không 16:9 + Fit to screen thì khung không trùng canvas.
- **D-328 — Client obs-websocket v5 tự viết** (`src/overlay/obsWebsocket.ts`, không dependency): Hello → Identify →
  Identified trên `ws://127.0.0.1:4455` (subprotocol `obswebsocket.json`); chuỗi xác thực bằng `crypto.subtle` =
  base64(sha256(base64(sha256(password + salt)) + challenge)); request op 6 / 7 — `request()` chờ trả lời, `send()`
  không chờ. Mọi lỗi là `ObsError` có `kind` ứng với một câu cho người dùng: không tới được / bị chặn / sai địa chỉ /
  mixed content (trang https tới địa chỉ không cục bộ — chặn trước khi mở socket), cần mật khẩu (trống mà OBS đòi → báo
  ngay, không gửi Identify), sai mật khẩu (4009), không có `crypto.subtle`, hết giờ, không phải obs-websocket 5 (4010,
  hoặc không có Hello — plugin 4.x cũ ở cổng 4444), dữ liệu lạ, mất kết nối, chưa kết nối, request bị từ chối / không
  trả lời, trùng tên. Hạn: 15 s mở socket (trình duyệt có thể đang hỏi quyền mạng cục bộ), 5 s bắt tay, 8 s mỗi request.
  Phiên bản OBS lấy bằng GetVersion sau bắt tay (lỗi thì hiện bản WebSocket). Mọi lỗi kết nối trình duyệt đều báo 1006
  → app hỏi quyền mạng cục bộ (thử tên 'loopback-network', 'local-network-access', 'local-network'); bị từ chối thì
  lỗi thành "bị chặn".
- **D-329 — Kết nối OBS dùng chung, nhớ, tự nối lại** (`obsBridge.ts`): một kết nối cho cả tab; trạng thái `off`,
  `connecting`, `connected`, `error` + bản OBS / WebSocket qua `useObsBridge()`; `connectObs` / `disconnectObs` không
  bao giờ throw. "Nhớ trên máy này" (mặc định bật) lưu địa chỉ + cổng + mật khẩu ở localStorage `dfht-obs-ws` CHỈ sau khi
  nối thành công (mật khẩu sai không bao giờ được lưu); bỏ tick xóa ngay và lưu `{v:1, remember:false}`; tick khi đang
  nối thì lưu kết nối hiện tại; "Ngắt kết nối" giữ mật khẩu nhưng đặt `auto: false` (lần mở app sau không tự nối tới khi
  bấm "Kết nối"). Mật khẩu lưu dạng chữ thường (chỉ mở được OBS trên máy này — README ghi rõ). Tự nối một lần mỗi lần
  mở app: lần `relayToObs` đầu (Player mount) hoặc khi panel mount, chỉ khi có thông tin đã lưu và chưa bấm Ngắt; thử
  ngay rồi sau 1, 2, 4, 8, 16, 30 s, rồi lặng lẽ về `off`. Lỗi thử lại vô ích (mật khẩu sai / thiếu, địa chỉ sai, mixed
  content, không phải v5, bị chặn) dừng ngay. Đang nối mà rớt → cùng lịch; hết lịch thì báo lỗi "closed" (chỉ trong
  panel). Nhiều tab Player có thông tin lưu đều tự nối và relay; overlay chọn người gửi theo D-325.
- **D-330 — Relay qua OBS** (`relayToObs`): `CallVendorRequest` (vendor obs-browser, `emit_event`, event
  `dfht-follow`), không bao giờ throw; tin đầu sau lúc yên gửi ngay, sau đó tối đa một lô mỗi 50 ms (~20 / giây) — hàng
  đợi giữ tin MỚI NHẤT của mỗi loại (song / state / bye) theo thứ tự tới, nên `bye` rồi `state` mới vẫn kết thúc ở chế độ
  theo; > 256 KB đang chờ trong socket thì thử lại sau 200 ms; `hello` không relay. Cache bài cuối, gửi lại ngay khi nối
  và 1,5 s sau khi thêm source (OBS tải lại trang overlay, Player chỉ lặp `song` mỗi 5 s). **OBS bỏ các trường JSON
  null** khi chuyển tin sang obs-browser → `obsSafeMessage()` gửi `countdownEndsAt: 0` (thời điểm đã qua = không đếm
  ngược), `loop: OBS_NO_LOOP` (beat −2e9..−1e9, không bao giờ wrap, `applyFollowLoop` bỏ qua) và bỏ `countIn` khi null
  (parser coi thiếu = null); test chạy qua mô phỏng bỏ-null của OBS + parser thật. `readState` cũng coi thiếu `loop` /
  `countdownEndsAt` là null (integrator, D-334) — placeholder giữ làm lớp bảo vệ thứ hai.
- **D-331 — "Thêm overlay vào OBS" và panel "Gửi thẳng vào OBS"**: đọc `baseWidth / baseHeight` (GetVideoSettings) và
  cảnh đang phát (GetCurrentProgramScene, dự phòng `currentProgramSceneName` của 5.0–5.2), tìm source bằng
  GetInputList. Tên "DF Harmonica Tiles" đã thuộc input không phải Browser Source hoặc là tên một cảnh → báo trùng tên.
  Có rồi → SetInputSettings với `overlay: true` (giữ thiết lập khác như custom CSS), tìm trong cảnh hiện tại hoặc thêm
  vào nếu chỉ nằm ở cảnh khác, bật hiện. Chưa có → tạo mới đúng URL, cỡ canvas. Transform: vị trí 0,0, scale 1, không
  bounds, căn trên-trái, xoay / cắt 0; SetSceneItemIndex lên trên cùng khi chưa ở trên cùng. Thêm vào cảnh Program (đang
  phát), không phải Preview của Studio Mode. Panel (Tactical HUD, `obsConnect.css` tự style ô mật khẩu): chưa nối = 3
  bước làm trong OBS, ô "Mật khẩu (Server Password)" (che, autocomplete off), "Nhớ trên máy này", "Nâng cao: địa chỉ
  và cổng" (thu gọn), "Kết nối"; nối xong form mật khẩu ẩn, "Thêm overlay vào OBS" (xám tới khi nối) → sau lần thêm
  đầu thành "Cập nhật overlay trong OBS"; link của hộp thoại đổi (kiểu overlay / độ đậm / cỡ UI) → dòng nhắc cập nhật;
  "Ngắt kết nối" cạnh đó (cũng hủy lượt tự nối đang chờ). Focus sang nút thêm sau khi nối, về "Kết nối" sau khi ngắt;
  lỗi / kết quả trong vùng `aria-live` polite. Accent chỉ ở số bước, focus, caret, mũi tên mục mở (`obsConnectCss.test.ts`).
  OBS giả cho test: `src/overlay/testing/fakeObs.ts` (app không import).

### Kiểm thử và tài liệu của vòng này

- **D-332 — Kiểm thử:** unit test mới cho tiền tố lời cũ, serializer không ghi lời, seed không tiền tố, settings v4,
  luyện tập chỉ chuột / chỉ bàn nút, `GAME_SCROLL_DIR`, follow (contract, broadcaster, receiver), canvasPlacement,
  obs-websocket / bridge / panel qua OBS giả, bản nháp (store + Editor), melodySuggest, autoArrange, bố cục màn chơi
  (`PlayerView.layout.test.tsx` thay `PlayerView.demo.test.tsx`), lastPlayed. Hai snapshot (serializer, mobileText) cập
  nhật sau khi kiểm từng dòng đổi chỉ là bỏ tiền tố lời (63 / 63). E2e viết lại theo điều hướng mới (không ☰ Menu): đếm
  ngược mặc định 3 s (chờ tới 10 s), tên truy cập của thanh dọc ("Công cụ màn chơi", "Kiểu điều khiển", "Cửa sổ nổi",
  /^OBS/, "Chia sẻ", "Cài đặt"), nút "Phím tắt" ẩn ở ≥ 1200 px, URL `#/edit/draft-…`; overlay.spec thêm ca theo Player +
  bố cục cả canvas (ca "mất Player": `page.close()` của Playwright có bắn `pagehide` → `bye` → "Đang chờ…" — cần sửa
  `departed` của D-334; integrator viết lại ca này, đo lệch ≤ 0,1 beat qua `.overlay[data-beat]`). Vòng R5 thêm ca
  "tab app mới không giành overlay" (D-337) và các ca bản nháp / bài tạm / Tab + Space trong `round5.spec.ts`.
- **D-333 — Tài liệu:** README viết lại cho UI mới (màn đầu = màn chơi, thanh dọc, cột phím tắt, "◂ Về màn chơi", 4
  cách thêm bài + bản nháp, gợi ý theo mật độ, tự chia dòng, gập quãng luôn bật, OBS 3 cách + overlay theo màn chơi,
  bảng tham số khớp `overlayParams.ts`, `.harm` không lời); ảnh `docs/images/` chụp lại (thêm `library.png`);
  `docs/LOCAL-TEST-CHECKLIST.md` viết lại theo góp ý A–E; CLAUDE.md cập nhật route / cấu trúc / quy ước.

### Vòng sửa R5 (sau review của vòng góp ý 2026-10-15)

Integrator + docs + review tìm thêm lỗi / chỗ chưa khớp góp ý; các mục dưới ghi cách sửa. Test: unit mới cạnh từng
module + e2e `round5.spec.ts`.

- **D-334 — Sửa của integrator (ghi lại cho đủ):** (1) bộ phát của Player gửi `bye` lúc `pagehide` rồi IM HẲN (cờ
  `departed`): trình duyệt bắn `visibilitychange` SAU `pagehide` — tin `state` (hidden) lúc đó kéo overlay về `follow`
  với hạn 90 s thay vì "Đang chờ…"; `pageshow` từ bfcache (`persisted`) mở lại. (2) `follow.ts readState` coi thiếu
  `countdownEndsAt` / `loop` là null (obs_data bỏ JSON null). (3) Mỗi khung vẽ của overlay đặt `data-beat` (3 số lẻ) trên
  phần tử `.overlay` — chỉ cho e2e đo độ lệch với Player, CSS không đọc. (4) Xóa code chết: `src/pip/FloatingWindowLauncher.tsx`
  (+ CSS `.pip-launch` / `.pip-help`), chuỗi `pip.open`, `pip.launcherTitle`, `pip.intro`, `pip.helpTitle`,
  `menu.fanMade`, `mini.menuHint`, `editor.tools.noSpans`; prop `passive` của `MobilePadRotateHint`; `fold` của
  CamAmModal / OptimizerPanel (D-321). (5) Cột phím tắt chế độ gọn ở cao ≤ 820 px (D-308). (6) Thanh điều hướng / header
  màn chơi xuống 2 hàng trên điện thoại thì bỏ vạch accent ngắn (nó nằm dưới link "Thư viện", trông như trang hiện tại).
  (7) Lời giới thiệu chọn bè MusicXML không nhắc lời nữa: "bè hát (giọng ca) được ưu tiên" / "a sung (vocal) part is
  preferred". (8) Vitest 5 cache module trên đĩa (`node_modules/.vitest-cache`) giữ kết quả `import.meta.glob` cũ: thêm
  ảnh vào `docs/images` thì chạy `npx vitest --clearCache` (không thì `guideContent.test` báo "thiếu ảnh").
- **D-335 — Màn chơi của bài chưa nằm trong Thư viện** (review UX-1): bỏ nút "Sửa" (B2) + bản nháp (C5) tạo ngõ cụt —
  phát bản nháp chưa sửa (`#/play/draft-…`) hay "Phát ngay" từ link chia sẻ (`#/play/shared-…`) thì màn chơi không còn
  đường nào giữ bài lại ngoài nút Back của trình duyệt. Thêm `TransientNotice` ở header (cạnh chip): bản nháp → chip hổ
  phách **"Bản nháp — chưa lưu"** + link **"Mở trình soạn để lưu"** (`#/edit/<draft>`; Lưu ở đó); bài tạm từ link →
  chip **"Bài tạm từ link — chưa lưu"** + nút **"Lưu vào thư viện"** (lưu MỘT lần như thẻ chia sẻ — `saveSharedSong` /
  `sharedSavedId` chuyển từ ShareView vào `store.ts`, ShareView dùng lại — rồi màn chơi chuyển sang bài đã lưu bằng
  history replace). Bài mẫu / bài thư viện: không hiện gì. Vẫn không có nút "Sửa" cho bài thư viện.
- **D-336 — Bản nháp đã Lưu thì "◂ Về màn chơi" / Forward mở bài đã lưu** (review R5-COR-01): bản nháp còn trong bộ nhớ
  giữ nội dung LÚC PHÁT. `useBackToPlayer` giải id nhớ qua `resolvePlayedId` = `draftSavedAs(id) ?? id` trước khi kiểm
  tồn tại; `PlayerView` (như EditorView) thấy `draftSavedAs(songId)` → `navigate(paths.play(saved) + ?line=…, replace)` và
  không vẽ nội dung cũ. `saveDraftSong` ghi `savedDrafts` TRƯỚC khi thêm bài (một `setState`) để selector chạy lại
  đúng lúc thư viện đổi đã thấy ánh xạ.
- **D-337 — Mở thêm tab app không giành overlay** (review R5-COR-02): từ B1, `#/` là màn chơi đầy đủ → tab mới (bookmark,
  PWA, tab tra cứu) mount một bộ phát; trước đây nó gửi `cause: 'change'` lúc mount nên giành mọi overlay đang theo tab
  khác (kể cả Browser Source trong OBS vì tab nào cũng tự nối OBS). Thêm cause `announce` (không giành) cho: mount,
  `setSong` (nguồn bài đổi tại chỗ), `pageshow` từ bfcache, và lúc một bộ phát được nói lại (D-338). Chỉ thao tác thật
  (transport / hiển thị đổi) gửi `change`. Overlay chưa theo ai / mất Player / đang theo chính tab đó vẫn nhận ngay.
  Receiver nhớ tin `song` gần nhất của tối đa 8 người gửi (kể cả người đang bị bỏ qua) → khi một tab giành bằng tin
  `state` thì có bài ngay, không chờ lần nhắc lại 5 s; `bye` xóa mục của người gửi đó.
- **D-338 — Overlay theo Cửa sổ nổi khi nó đang mở** (review R5-COR-04): FloatingStage chạy engine riêng còn Player
  chính bị tạm dừng lúc mở cửa sổ → overlay đứng hình. `useFollowBroadcast(engine, entry, { priority })`: FloatingStage
  dùng `FLOAT_FOLLOW_PRIORITY` = 1, cùng id tab với Player chính. Mỗi id tab chỉ MỘT bộ "nói" (`speaking`: priority cao
  nhất, bằng nhau thì bộ start sau cùng); bộ khác chạy timer / nghe engine nhưng không gửi gì (cả `hello` reply). Bộ đang
  nói dừng mà tab còn bộ khác → không `bye`, bộ kia nói lại ngay (`announce`: bài + trạng thái); không còn ai → `bye`.
  `pagehide`: chỉ bộ đang nói gửi `bye`, mọi bộ đánh dấu `departed`. Số thứ tự `seq` dùng chung cả module (overlay bỏ
  tin có `seq` không tăng). Player chính mount lại (đổi bài) khi cửa sổ nổi đang mở → vẫn im tới khi cửa sổ đóng.
- **D-339 — "Cửa sổ nổi" trên điện thoại ở kiểu PC** (review UX-3): hồ sơ mới luôn là PC, Android Chrome không có
  Document PiP → trước đây chỉ hiện "dùng Chrome hoặc Edge trên máy tính" trong khi máy có đường cửa sổ nổi riêng (trang
  mini). PlayerSideBar: `scheme === 'mobile'` HOẶC (không có Document PiP VÀ `(pointer: coarse)`) → nút mở MiniLauncher
  (như kiểu Mobile). Máy tính không có Document PiP (Firefox / Safari) giữ nút bật / tắt + ghi chú cũ (đúng với máy tính).
- **D-340 — Đếm ngược mặc định của Cửa sổ nổi = 3 giây** (review UX-4 / R5-COR-05; B5): `PIP_DEFAULT_DELAY` 5 → 3 (như
  màn chơi và trang mini). Giá trị người dùng đã chọn (`dfht-pip-delay`) giữ nguyên.
- **D-341 — Chip cảnh báo / lỗi của màn chơi không chỉ tới nút "Sửa"** (review UX-5 / R5-DOCS-1): chip `@scroll −1` là
  link tới `#/edit/<id>` như chip lỗi (focus được, chạm được); tooltip + chữ cho screen reader: "… Bấm vào đây để mở
  trình soạn → Công cụ → Tối ưu lại cung / quãng." (en "Click to open the editor → Tools → Re-optimize key / octave.");
  `player.parseErrorsHintEditor`: "… Bấm vào đây để mở trình soạn và xem chi tiết." Bài mẫu / bài tạm mở trình soạn ở
  chế độ chỉ đọc (Lưu = bản sao) như trước.
- **D-342 — Tiền tố lời cũ: cảnh báo khi nuốt nốt** (review R5-COR-03): bỏ diagnostic lời (D-311) làm dấu `:` gõ lạc
  xóa nốt im lặng (`Z X C V B N M ,:` mất cả dòng; `Z X C: V B` còn V B) trong khi `;` lạc vẫn báo lỗi. Diagnostic mới
  `legacy-prefix-ignored` (warning, cột = ký tự đầu của phần bị bỏ, dài tới hết dấu `:`, tham số `text` cắt 24 ký tự):
  khi phần bị bỏ toàn là token nốt / nghỉ / giữ hợp lệ (không token lạ, không ngoặc hở) HOẶC sau `:` không còn token
  nào. Lời thật ("Đồ rê mi:", "Một hai:", "La si Do:") vẫn im lặng; dòng `@repeat` chèn lại không báo trùng. Chuỗi
  `diag.legacy-prefix-ignored` (vi + en), hàng mới trong bảng lỗi của README.
- **D-343 — Hộp thoại OBS nhớ tùy chọn hiển thị** (review UX-6): kiểu overlay, độ đậm, cỡ giao diện game lưu ở
  localStorage `dfht-obs-display` (`src/overlay/obsLinkPrefs.ts`, mọi truy cập try/catch, dữ liệu lạ → mặc định từng
  trường, số kẹp vào khoảng hợp lệ); mở lại hộp thoại (vd. để nối lại OBS) giữ đúng giá trị đã căn nên "Thêm / Cập nhật
  overlay trong OBS" không ghi đè source đã căn bằng mặc định. Không đọc ngược URL từ OBS (đơn giản hơn, đủ cho một máy).
- **D-344 — Cửa sổ "Mở thử" toàn màn hình không hiện chữ trạng thái** (review UX-7): khung toàn màn hình chính là khung
  Window Capture đang lên stream; "Đang chờ màn chơi…" (nền tối — Chroma Key không xóa) ẩn khi `document.fullscreenElement`
  như nút "⛶ Toàn màn hình". Ra khỏi toàn màn hình thì hiện lại.
- **D-345 — Space trên control được Tab tới = bấm control** (review R5-A11Y-2): `useHotkeys` nhớ phần tử người dùng TỰ
  Tab tới (keydown Tab → focusin; chuột / chạm / phím khác trước focusin → không tính, nên focus app tự chuyển sau Space
  không đổi gì); Space khi focus đang ở control bấm được (`button`, `summary`, role button / switch / checkbox / radio /
  tab / menuitem) được Tab tới → không chặn, trình duyệt bấm control (PC | Mobile, Cửa sổ nổi, OBS…). Focus tới bằng
  chuột (bấm Phát rồi nhấn Space) giữ D-033: Space là Phát / Tạm dừng. Link (`a`) không đổi (Space không bấm link).
  Listener theo dõi ở pha capture, không phụ thuộc `enabled`, dọn khi unmount.
- **D-346 — Chữ giao diện** (review UX-2 / UX-8 / R5-I18N-4 / R5-I18N-5, uiWordingProblems của docs): chuỗi vi dùng
  "màn chơi" thay "Player" (tiêu đề hộp thoại "?" = "Phím tắt của màn chơi", "Đang chờ màn chơi…", các câu OBS /
  obsws); `practice.focusNote` = "Luyện tập chỉ nhận phím / chuột khi tab app đang được chọn…" (cùng lúc
  `shortcuts.practicePc` / `record.focusNote`: "đang được focus" → "đang được chọn"); `midi.title` +
  `common.feature.midiImport` = "Tạo bài từ file MIDI / MusicXML" / "Create from a MIDI / MusicXML file" (giống nút ở
  Thư viện); placeholder Nhập cảm âm chỉ còn dòng nốt (`# Điệp khúc / do re mi fa sol / la si Do*2`), README §f bỏ câu
  "dán cảm âm có lời ở đầu dòng" (parser vẫn nhận tiền tố cũ). Lời mở hộp thoại OBS thêm "cả Cửa sổ nổi khi đang mở".
  Tiếng Anh giữ "Player".
- **D-347 — Tài liệu của vòng R5:** `docs/DESIGN.md` bỏ màn demo / ☰ Menu / quy tắc font lời, thêm thanh điều hướng
  "◂ Về màn chơi", bố cục màn chơi (cột phím tắt, thanh dọc, tiến độ ở đáy), mục "Thêm bài" của Thư viện, khung cửa sổ
  overlay; README, CHANGELOG, `docs/LOCAL-TEST-CHECKLIST.md` (mục 30–37) theo các mục trên.

## Vòng sửa 6 theo góp ý test local (2026-10-16)

Người dùng test bản 7291dc3 (vòng 5) trên PC và iPhone, gửi góp ý bằng tiếng Việt; lead gom thành 13 mục, người dùng
duyệt nguyên văn (kể cả các đề xuất của lead cho câu hỏi còn mở). Các mục dưới ghi cách hiểu đã thống nhất và chọn
lựa khi làm. Thứ tự theo số mục được duyệt (1–13).

### OBS (mục 1)

- **D-348 — Hộp thoại OBS chỉ còn 2 cách, bỏ Window Capture** (mục 1; thay phần Window Capture / "Mở thử" của D-323 và
  D-344): trên máy 2 màn hình, màn thứ 2 đã hiện màn chơi chính nên Window Capture thừa. Hộp thoại **Tạo link OBS**:
  lời mở, bài, 01 **Kiểu overlay**, 02 **Hiển thị**, 03 **Gửi thẳng vào OBS (khuyên dùng)** (ObsConnectPanel, tự căn,
  theo màn chơi), 04 **Browser Source thủ công** (3 bước — bước 4 cũ gộp vào bước 3; ghi chú nói thật: phát bài một
  lần mỗi khi OBS tải / refresh source, không theo Phát / tạm dừng trừ khi đang kết nối "Gửi thẳng"), rồi một hàng
  cuối KHÔNG đánh số **Xem trước** (nút + một dòng gợi ý qua `aria-describedby`) vì đó không phải cách đưa overlay vào
  OBS. Bỏ: mục Window Capture, nút / chữ "Mở thử", lựa chọn nền chroma, nút "⛶ Toàn màn hình" của trang overlay (cùng
  hook fullscreen, CSS, chuỗi, test), mọi hướng dẫn Window Capture (hộp thoại, overlay, README / Hướng dẫn, checklist).
  Gợi ý độ đậm không nhắc Chroma Key nữa ("Thấp hơn = thấy hình game phía sau ô rõ hơn."). Chuỗi bỏ:
  `overlay.fullscreen*`, `overlay.modal.window`, `overlay.modal.open*`, `overlay.window.step1–4`,
  `overlay.manual.step4`; thêm `overlay.modal.preview*`, `overlay.preview.*`; đổi `overlay.modal.opacityHint`,
  `overlay.manual.step3`, `overlay.manual.note`.
- **D-349 — "Xem trước" = link Browser Source + `preview=1`** (mục 1): popup 960 × 540. Tham số mới `preview`
  (`OverlayParams.preview`; link builder chỉ thêm cho cửa sổ Xem trước, không bao giờ cho link sao chép / link gửi
  OBS). Trang overlay với `preview=1`: `html.overlay-preview` = nền tối thường `#050607` (canvas vẫn trong suốt như
  trong OBS), khung 16:9, bảng phím game vẽ minh họa (hàm thuần `gameKeyboardBox()` trong overlayParams.ts, số đo từ
  GAME-UI-REFERENCE: khung x 681–1241, y 758–921; keycap 22 px thẳng tâm 8 làn; phóng theo thanh "Cỡ giao diện game"
  quanh (960, 921)), nhãn "Xem trước · không dùng để quay", tiêu đề cửa sổ "Xem trước overlay (không dùng để quay) —
  <bài>". Keycap minh họa màu xám trung tính, không bao giờ dùng accent (DESIGN). Vẫn theo màn chơi qua
  BroadcastChannel. Nhãn và chữ trạng thái ẩn trong OBS (`window.obsstudio`).
- **D-350 — Link cũ `bg=chroma` vẫn chạy; quy tắc "Đang chờ màn chơi…"** (mục 1): `bg=chroma` vẫn đọc và vẽ được (CSS
  chroma + `effectiveTileOpacity` giữ, ghi "link cũ"); chỉ phần UI tạo ra nó bị bỏ. "Đang chờ màn chơi…" hiện ở mọi cửa
  sổ trình duyệt thường (kể cả Xem trước) khi overlay đang chờ / mất màn chơi; không bao giờ trong OBS. Điều kiện
  fullscreen của D-344 bỏ cùng nút toàn màn hình. Script sớm của `index.html` đặt thêm class `overlay-preview` khi
  `preview=1` và app.css tô nền tối `html.overlay-mode.overlay-preview` ngay từ khung hình đầu (popup không chớp nền
  trắng trước khi chunk overlay tải xong).

### Kiểu Mobile, đếm, lookahead (mục 2–4)

- **D-351 — Nhắc chạm chế độ = thanh "CHẠM" ngắn rơi xuống nút chế độ** (mục 2; thay vạch đứt nét + pill "CHẠM: …" của
  Phase 2c / 4m): mỗi lần chạm một thanh, **rộng đúng đường kính nút chế độ**, dày vừa chữ `CHẠM` (en `TAP`, chuỗi mới
  `player.mobile.tapBar`; không có tên chế độ), rounded rect ≤ 4 px, nền = `MOD_COLORS[mode].fill`, viền = `tileStroke`
  của theme (≥ 3:1 ở theme sáng), chữ = cặp màu AA của ô. Chữ vừa đường kính (tối thiểu 7 px, tối đa ~0,26 × đường kính,
  trần 15 px); dày = cỡ chữ × 1,2 + lề. Rơi cùng tốc độ ô, trong cột của nút chế độ; mép dưới chạm đỉnh nút đúng beat
  phải chạm, lúc đó sáng như ô trên vạch rồi bị cắt ở đích và biến mất. Hai lần chạm cùng nút gần hơn một thanh → thanh
  trước ngắn bằng khoảng cách − 2 px, không chữ, không chồng. Đích: có bàn nút → đỉnh nút chế độ theo `padGeometry`
  (hình học chung của MobilePad, trang mini, painter video PiP) qua `cueTargets(L)` mới trong layout.ts; không bàn nút
  (overlay, Cửa sổ nổi, Player làn ngang) → cột nút chế độ của game theo 8 làn (ranh giới 3|4, 4|5, 5|6, 6|7; thứ tự
  game Nửa Cung · Ngẩng Lên · Ngẩng Tự Nhiên · Cúi Xuống), rộng = đường kính một nút pad sẽ có ở bề rộng làn đó
  (`padModeDiameter` dùng chung), đáp xuống vạch sáng — chọn cách suy ra được thay vì thêm dải chế độ để overlay không
  che thêm gì trên game; tên chế độ vẫn ở chữ lề `CHẠM: <tên>` của các bố cục đó. Làn ngang: chữ vẫn nằm ngang, chiều
  dài thanh theo thời gian = bề rộng chữ. Thanh của phần đếm vào mờ như ô đếm vào. Cue vào lại khi loop / chơi lại /
  nhảy dòng vẫn thay cue của kế hoạch ở nốt đó. Bỏ code chết: layout pill, vạch đứt nét, `pillLead` / `pillSide`, mask
  làn theo cue, `bitCount`. **Vòng sửa R6 đổi phần "không bàn nút" (D-366):** overlay lane dọc + Cửa sổ nổi kiểu Mobile
  dùng bàn nút như màn chơi, không còn gutter / chữ lề `CHẠM: <tên>` ở bố cục nào; dải ngang tự vẽ 4 vòng chế độ.
- **D-352 — Thứ tự vẽ và vòng vàng của nút chế độ** (mục 2): thân ô → thanh CHẠM → nhãn ô (số, chấm quãng, solfège,
  huy hiệu #) — `drawTiles` tách thành `drawTileBodies` + `drawTileLabels`, thanh không bao giờ che chữ. Vòng vàng
  "chạm kế tiếp" và cú ping một lần của MobilePad giữ nguyên: đó là trạng thái nút DOM (cũng dùng cho phản hồi "sai chế
  độ" khi luyện tập và trong e2e), không phải bản sao của cue canvas — thanh cho biết **khi nào** chạm, vòng cho biết
  **nút nào** kế tiếp. Ghi chú trong MobilePad.tsx: vị trí nút DOM phải luôn khớp `padGeometry`. Canvas không bị
  forced-colors tô lại nên thanh vẫn thấy được với nền / viền / chữ riêng.
- **D-353 — Lookahead mặc định 6 beat; settings v5** (mục 3): `SETTINGS_VERSION` = 5, `DEFAULT_SETTINGS.lookahead` = 6.
  `migrateSettings`: `fromVersion < 5` và lookahead === 8 (mặc định cũ, hằng riêng `LEGACY_LOOKAHEAD_DEFAULT`) → 6; giá
  trị khác người dùng đã chọn giữ nguyên; blob v5 giữ 8 nếu người dùng chọn 8. `OVERLAY_LOOKAHEAD_DEFAULT` = 6 nên link
  không có `lookahead` chạy 6 và link dựng từ cài đặt mặc định vẫn bỏ tham số này. Lookahead chỉ chỉnh ở thanh điều
  khiển của Player; trang Cài đặt không còn ô Lookahead (chuỗi `settings.lookahead*` bỏ). Mặc định riêng của renderer
  (`DEFAULT_RENDERER_OPTIONS.lookahead`) và fallback của `computeLayout` cũng thành 6 cho đồng bộ (mọi nơi gọi trong
  app vốn đều truyền lookahead).
- **D-354 — Đếm vào / đếm ngược chỉ ở Cài đặt; không đếm hai lần** (mục 4): TransportBar bỏ công tắc **Đếm vào** và ô
  **Đếm ngược** (props `countIn` / `onCountIn` / `startDelay` / `onStartDelay`; `START_DELAY_CHOICES` của
  usePlayerEngine xóa; chuỗi `player.countIn*`, `player.startDelayHint` bỏ). Hai cài đặt còn ở Cài đặt → **03 Phát
  bài**; `settings.countInHint` ghi rõ "Ô rơi chạy trước 1 ô nhịp rồi mới tới nốt đầu, không hiện số đếm". Số to chỉ hiện
  trong đếm ngược (ô đứng yên; `state.countdown` của engine đã null khi transport bắt đầu đếm vào) — Player, Cửa sổ nổi,
  overlay, trang mini. Canvas không bao giờ vẽ số đếm vào: xóa `drawCountIn`, font đếm và `countText` / `countStroke`
  của CanvasTheme; `RenderFrame.countInRemaining` giữ làm trường có ghi chú "renderer bỏ qua" vì usePlayerEngine /
  overlayEngine vẫn đặt nó; painter video PiP không truyền nữa (đếm ngược `drawCountdown` của video giữ). Thanh nhỏ
  của Cửa sổ nổi và trang mini vẫn có ô **Đếm ngược** riêng của từng cửa sổ (pipPrefs / miniControl) vì mục 4 chỉ yêu
  cầu bỏ khỏi thanh điều khiển của Player; trang mini vẫn luôn chạy 1 ô nhịp đếm vào bằng hình (không số). **Vòng sửa
  R6 đổi (D-367):** hai ô riêng đó bỏ, Cửa sổ nổi / trang mini / video PiP theo Cài đặt → Phát bài.

### Cài đặt (mục 5–6)

- **D-355 — Trang Cài đặt: hai cột cố định, trường xếp ngang, MIDI cuối, bỏ thẻ Phím tắt** (mục 5): `.settings-grid`
  auto-fit cột ≥ 460 px chứa hai `.settings-col`: trái 01 Kiểu điều khiển, 02 Giao diện, 03 Phát bài, 04 Harmonica;
  phải 05 Âm thanh, 06 Luyện tập, 07 MIDI. Chọn cột cố định thay CSS columns để thẻ không nhảy cột khi nội dung đổi (vd.
  chọn Mobile thêm fieldset Nửa Cung). Trong thẻ: prop `SettingsGroup grid` → `.settings-fields.is-grid` (auto-fill cột
  ≥ 240 px, `.settings-span` cho mục rộng hết), radio card nằm cạnh nhau, 4 ô tên nút thành lưới 2 × 2 thẳng đáy. Bỏ
  thẻ **Phím tắt** (cột trái màn chơi đã có danh sách; chuỗi `settings.group.shortcuts` bỏ). Khung rộng theo app-main (tới
  1280), bỏ max-width 1080 cũ. Số 01–07 theo bộ đếm `.hud-numbered` theo thứ tự DOM. Màn hẹp: hai cột xếp chồng, giữ thứ
  tự 01–07. Đo được hai cột cao 1026 / 1075 px ở 1280–1920 px, không cuộn ngang.
- **D-356 — "Âm thanh" là thẻ thường** (mục 6; thay phần "Nâng cao — âm thanh" thu gọn của D-183 / D-184):
  AdvancedSoundSettings (`<details>`) thay bằng SoundSettings — thẻ luôn hiện, cùng các control: giai điệu mẫu (hộp
  thoại bản quyền giữ nguyên), âm sắc + âm lượng synth, tiếng click, metronome, âm lượng click, tiếng khi luyện tập; bốn
  nhóm con xếp thành hai cột con (giai điệu + click | synth + luyện tập). Mặc định vẫn tắt hết; bật giai điệu vẫn hỏi
  xác nhận; huy hiệu đỏ **🔊 Đang phát giai điệu** của màn chơi giữ. Nhãn **Đang bật giai điệu** / **Đang bật tiếng
  click** nằm cạnh h2 trong `.settings-card-head` (ngoài heading, tên vùng vẫn là "Âm thanh"). Chuỗi: `settings.advanced*`
  → `settings.group.sound`, `settings.soundIntro`, `settings.soundMelodyOn`, `settings.soundClickOn`,
  `settings.sound.{melody,click,practice,synth}`; `player.melodyBadgeHint` và hai chuỗi của màn thu
  (`record.clickOff`, `midi.record.clickOff`) trỏ "Cài đặt → Âm thanh" / "Settings → Sound".

### Tạo bài với AI, Thư viện, Editor (mục 7–9)

- **D-357 — Thứ tự "Thêm bài" của Thư viện** (mục 7; thay thứ tự của D-319): 01 **Tạo bài với AI** (`#/ai`, theo
  `FEATURES.editor`) → 02 **Tạo bài từ file MIDI / MusicXML** → 03 **Nhập file ký tự (.harm / .txt / .json)** → 04
  **Tự chơi để tạo bài**. Nút "Tạo bài mới thủ công" và chuỗi `library.newSong*` bỏ; đường bản nháp trống chỉ còn là
  link nhỏ **hoặc tự gõ từ đầu** ở `#/ai` (vẫn `openDraftSong`, D-318).
- **D-358 — Trang `#/ai` "Tạo bài với AI"** (mục 8): route lười mới (`paths.ai()`, chunk riêng trong App). Link **Thư
  viện** của thanh điều hướng có `aria-current=page` khi ở `#/ai` (trang con của Thư viện — xấp xỉ có chủ ý). Bốn bước
  đánh số: (1) **Sao chép prompt** theo ngôn ngữ giao diện (clipboard bị chặn → ô prompt mở ra, chữ đã chọn sẵn;
  **Xem prompt**); (2) link tab mới tới ChatGPT (chatgpt.com), Claude (claude.ai/new), Gemini (gemini.google.com/app) +
  3 mẹo **Tìm bài ở đâu?** + link `#/guide/cam-am?s=tìm-nguồn-ở-đâu`; (3) ô lớn có nhãn **Dán kết quả của AI vào đây** +
  dòng kết quả trực tiếp ("N nốt · tông dễ chơi nhất · 0 lỗi", hoặc "tông: <key>" khi chọn tông khác) và câu thân
  thiện cho ô trống / dán nhầm prompt / không đọc được / lỗi theo dòng; select **Tông** chỉ hiện với cảm âm có hơn một
  phương án; (4) **Tên bài** lấy từ `@title` + **Lưu** gọi `addSong` thẳng — ngoại lệ D-318 được người dùng duyệt (người
  dùng bấm Lưu rõ ràng) — rồi hiện xác nhận với **Phát** / **Sửa trong Editor** / **Thư viện** / **Tạo bài khác** (focus
  chuyển tới đó); **Mở trong Editor** mở bản nháp. Người dùng không bao giờ phải thấy cú pháp do1 / do2 hay tìm công cụ
  ẩn (chỉ token không đọc được hiện nguyên văn trong dòng lỗi).
- **D-359 — Bộ chuyển dùng chung `src/editor/camamConvert.ts`** (mục 8–9): hàm thuần (không React), không bao giờ
  throw. Bỏ BOM + CRLF, lấy khối ` ``` ` / `~~~` đầu tiên nếu có (số dòng trong thông báo = dòng của văn bản đã dán);
  phát hiện prompt bị dán nhầm (kind `prompt`); văn bản đã là `.harm` parse không lỗi → giữ nguyên (kind `harm`); còn
  lại đọc như cảm âm: dòng có ít hơn nửa token đọc được = chữ giải thích, bỏ qua kèm issue `prose` (vd. "… do Văn Cao
  sáng tác" — "do" trông như nốt); quy ước = hậu tố số nếu mọi âm tiết có số quãng, không thì hoa / thường. Optimizer
  chọn tông dễ nhất theo cost model của kiểu điều khiển trong Cài đặt, gập quãng luôn bật (như OptimizerPanel); 3
  phương án đầu cùng tông gốc vào select. Ghi chú `//` của AI → `MelodyEvent.warning` → `melodyToHarm` ghi `//! …` ngay
  trên dòng nốt kế tiếp (cảnh báo trong Editor, không hiện ở màn chơi). Luôn `@scroll +1`. Bài 480 nốt ~25 ms. Bài không
  có `# section` nhận tên mặc định của core (`# Main`) như trước.
- **D-360 — Editor: ô dán thay công cụ "Nhập cảm âm"** (mục 9): "Nhập cảm âm" rời menu **Công cụ** (CamAmModal + 2 file
  test xóa; chuỗi `editor.menu.camam`, `editor.tools.camam.*` bỏ). AiPasteBox nằm trên textarea `.harm` trong khung
  nguồn, nhãn riêng không tính vào bộ đếm 01 / 02 của các khung. Sự kiện paste → chuyển và **thay** bài ngay, không hỏi
  (Hoàn tác thay cho hỏi trước; nhãn hoàn tác "Dán kết quả AI"); chữ gõ / kéo thả chỉ xem trước, có nút **Áp dụng**;
  đổi **Tông** ngay sau khi áp dụng thì áp lại, không thêm bước hoàn tác (một lần **Hoàn tác** về văn bản trước khi
  dán); văn bản dán không có `@title` → giữ tên bài hiện tại; **Xóa ô dán**; **Lấy prompt cho AI** mở `#/ai` ở tab mới
  (Editor và hashGuard không bị rời). **Lưu** / Ctrl+S như cũ, cả bản nháp. `docs/AI-PROMPT-CAM-AM.md`: bước dùng (VI +
  EN) và ghi chú người phát triển cập nhật; khối PROMPT và tiêu đề giữ nguyên byte.

### iPhone, trang mini (mục 10–11)

- **D-361 — Cửa sổ video nổi: chuẩn bị trước, vào PiP ngay trong lần chạm** (mục 10): lỗi iPhone "The request is not
  triggered by user activation" vì `enterPip` `await session.video.play()` trước `requestPictureInPicture()` — Safari
  mất transient activation (Chrome bỏ qua). `prepareLiveVideoPip` (canvas stream trên `<video>` muted / playsinline, đã
  chạy) và `prepareVideoBlobPip` (nạp blob, mồi: play muted → pause → seek 0 vì iOS không nạp video chưa từng phát) trả
  `PreparedVideoPip` (ready, whenReady, entered, `enter(hooks)`, close). `enter()` gọi `requestVideoPip()` ĐỒNG BỘ ngay
  câu đầu: API chuẩn trước; chỉ có `webkitSetPresentationMode` thì đợi `webkitpresentationmodechanged`, 1,5 s
  (`WEBKIT_PIP_TIMEOUT_MS`) không đổi = NotAllowedError; `play()` gọi sau, không await. `openLiveVideoPip` /
  `openVideoBlobPip` xóa (chỉ VideoPipDialog dùng). Đồng hồ, Media Session ▶/❚❚, interval vẽ chỉ chạy khi đã vào PiP; nhận
  diện hỗ trợ tính cả `webkitSetPresentationMode`. `useVideoPip(options, hostRef)` giữ chữ ký: thân hộp thoại gọi
  `pip.arm()` khi mount; mỗi video chuẩn bị nằm trong effect riêng (khóa: armed, options / blob, bộ đếm thế hệ) — dùng
  xong thì tăng bộ đếm để có video mới cho lần chạm sau; đóng hộp thoại hủy video chưa dùng nhưng giữ cửa sổ PiP đang
  mở; mở video mới khi đang PiP thì đóng phiên cũ sau khi phiên mới vào (không gọi `exitPictureInPicture`). Nút mở
  không bao giờ bị disable lúc chuẩn bị (iOS có thể không nạp video → nút chết); chạm sớm → "Video chưa sẵn sàng — chờ
  một giây rồi chạm lại."; nút có `data-ready` cho e2e. Lỗi → `videoPipErrorKind` (NotSupported → unsupported;
  NotAllowed / Security → notAllowed; InvalidState → notReady; còn lại failed); iPhone / iPad (`isAppleMobile`, cả
  iPadOS báo "Macintosh" có cảm ứng) → unsupported / notAllowed đều hiện "iPhone chưa hỗ trợ cửa sổ video nổi cho
  trang web này." (ghi chú đầu hộp thoại khi không có PiP cũng vậy); không bao giờ hiện lỗi thô (alert có
  `data-error=<kind>`). Chuỗi: bỏ `mini.video.failed`; thêm `mini.video.errorIos`, `errorBlocked`, `errorNotReady`,
  `errorFailed`. Chưa thử trên iPhone thật (xem "Còn mở").
- **D-362 — Trang mini có nút "◂" về màn chơi** (mục 11): `#/mini/:id` không có nav app và Safari ngang giấu thanh công
  cụ → không có lối ra. `<a class="btn btn-secondary btn-sm btn-icon mini-back">◂</a>` là mục đầu của hàng `.mini-top`
  trong MiniPanel, `href(paths.play(id))`, aria-label / title `mini.back` ("Về màn chơi" / "Back to player"), nền kính
  để đọc được trên ô rơi. Chỉ hiện khi panel hiện — `isMiniStopped(phase)` mới (ready / paused / ended) trong
  miniControl.ts điều khiển `running` của MiniView. Lúc đếm ngược và lúc ô đang rơi không thêm gì.

### Hướng dẫn, bài mẫu, tài liệu (mục 12–13)

- **D-363 — Trang Hướng dẫn ngắn; chi tiết sang `docs/REFERENCE.md`** (mục 12; bổ sung D-257 / D-260): phần người dùng
  của README (= `#/guide`) viết lại còn ~290 dòng (trước ~840): tóm tắt tiếng Anh → **Bắt đầu nhanh** (5 bước) → **Những
  chỗ hay nhầm** (màu ô / giữ chuột kiểu PC, thanh CHẠM kiểu Mobile, số 3-2-1 và đếm vào, Cửa sổ nổi cần Borderless /
  Windowed, OBS chỉ hiển thị, bản nháp tới khi Lưu, tạo bài bằng AI, không có tiếng mặc định, iPhone, bài ở máy khác) →
  các mục ngắn (Thêm bài — AI trước, Luyện tập, Stream với OBS — 2 cách + Xem trước, Cửa sổ nổi trên game, Điện thoại,
  Chia sẻ link, Cài đặt). Tách ra `docs/REFERENCE.md` (file mới, app không hiện): cú pháp `.harm` đầy đủ + bảng lỗi,
  phím tắt, tham số URL của overlay, cách overlay theo màn chơi, chi tiết âm thanh / đếm vào / Tạo bài từ file / Thu
  melody / Tự chơi / Donate text / Cửa sổ nổi / trang mini theo hãng / video PiP / Cài đặt / cài offline, giới hạn đã
  biết. Phần người dùng vẫn chỉ link `docs/AI-PROMPT-CAM-AM.md` + `docs/images/`, vẫn có token `VERCEL_URL_TODO`, mục lục
  có "Chia sẻ link" (test GuideView / e2e guide). Mục "Định dạng .harm đầy đủ" (slug `định-dạng-harm-đầy-đủ`, link "Cú
  pháp .harm" của Thư viện) KHÔNG còn trong Hướng dẫn; thay bằng mục ngắn **Cú pháp .harm** (slug `cú-pháp-harm`: ví
  dụ 3 dòng + bảng 6 dòng hay dùng) — link "Cú pháp .harm" của Thư viện (`GUIDE_HARM_SECTION` trong LibraryView) và
  `guideContent.test.ts` / `LibraryView.test.tsx` trỏ slug mới. Ảnh mới: `ai.png`, `settings.png`.
- **D-364 — Bài mẫu vòng 6; bỏ hai bài cũ trước khi deploy** (mục 13): hai bài người dùng tự tạo trong app thành bài
  mẫu, đứng ĐẦU Thư viện: `seed-quoc-ca-viet-nam` ("Quốc ca Việt Nam", Văn Cao) và `seed-takediskrush` ("TAKEDISKRUSH!",
  N2UtheHartlocker) — chép nguyên byte (đã đối chiếu với trình duyệt của người dùng; `*.harm` nằm trong
  `.prettierignore`). `DEMO_SONG_ID` = `seed-quoc-ca-viet-nam` (màn `#/`). Hai bài mẫu cũ tạm
  giữ sau hai bài mới, đánh dấu "remove before deploy (owner 2026-10-16)" trong `seeds.ts` và test; **phải bỏ trước khi
  deploy** (CLAUDE.md → Deploy → checklist). Test ghim danh sách seed giờ đọc `SEED_SONGS` / `SEED_TITLES` /
  `SEED_COUNT` nên lúc bỏ chủ yếu là xóa mục; nhiều test core / editor / player / overlay / mini và e2e còn dùng hai file
  hay hai id cũ làm fixture — chuyển sang hai bài mới hoặc dời hai file sang thư mục fixture. Bản sao "Quốc ca Việt Nam"
  / "TAKEDISKRUSH!" trong thư viện của người dùng giờ trùng bài mẫu (người dùng tự xóa nếu muốn; app không tự gộp).
- **D-365 — Tài liệu của vòng 6:** README (phần người dùng viết lại theo D-363, phần người phát triển trỏ
  `docs/REFERENCE.md` + checklist trước deploy), `docs/REFERENCE.md` (mới), CLAUDE.md (route `#/ai`, nút "◂" trang mini,
  cấu trúc `src/ai`, camamConvert, AiPasteBox, seeds, settings v5, OBS 2 cách + `preview`, checklist trước deploy),
  CHANGELOG "Vòng sửa 6 (2026-10-16)", `docs/LOCAL-TEST-CHECKLIST.md` viết lại (Phần 1 = mục 1–13, Phần 2 = iPhone qua
  Wi-Fi, Phần 3 = hồi quy), ảnh `docs/images/` chụp lại (home, player-pc, player-mobile, library, ai, editor, obs-link,
  settings).

### Vòng sửa R6 (sau review của vòng 6)

- **D-366 — Kiểu Mobile: bàn nút ở mọi bố cục dọc; không còn gutter "CHẠM: <tên chế độ>"** (review R6-OWN-1,
  R6-CORR-01, R6-DOCS-A11Y-04; sửa phần "không bàn nút" của D-351): mục 2 nói rõ overlay và Cửa sổ nổi, nhưng ở đó
  thanh đáp xuống hit line (không có nút) còn gutter vẫn ghi "CHẠM: Ngẩng Lên"; overlay "Cả cột" còn vẽ nhóm nút chế độ
  của game bar ở chỗ khác. Giờ: **overlay lane dọc** (mọi preset — khớp bảng phím game, cả cột, cả canvas / Xem trước)
  và **Cửa sổ nổi** ở kiểu Mobile dùng `lanePadding: 'pad'` + `MobilePad` chỉ hiển thị ở đáy khu làn như màn chơi /
  trang mini (overlay: thay game bar, tên nút theo Player / link qua prop mới `labels` của MobilePad; banner lên đầu khu
  làn; Xem trước không phác keycap PC). `usePlayerEngine` `mobilePad`: Mobile → 'pad' thắng `lanePadding` cố định của
  `rendererOptions`, PC → `lanePadding` cố định đó (Cửa sổ nổi: 'none') hoặc 'normal'. Renderer: kiểu Mobile **không
  có gutter ribbon ở bố cục nào** (`layoutOptionsOf` tắt `showRibbons` khi Mobile; `scheme` vào `LAYOUT_KEYS`) — xóa
  `drawMobileGutter` / `drawMobileSpan` / `prepareMobileLabels` và chuỗi `player.mobile.tap`; chế độ đang bật đọc ở
  bàn nút + banner. Bố cục không bàn nút duy nhất còn lại (overlay **dải ngang**): renderer tự vẽ 4 vòng chế độ ngay
  sau hit line (`CueTargets.targets` / `targetAxis`, Ø = bề ngang thanh, ký hiệu ↓ ↑ • # để không chỉ dựa vào màu, vòng
  đang bật tô đặc) — thanh đáp đúng mép vòng. Vì sao không vẽ vòng dưới hit line của bố cục khớp game: hit line sát đáy
  (0,97) không có chỗ; bàn nút dùng chung `padGeometry` nên thanh và nút khớp tuyệt đối (e2e round6 overlay + pip
  Mobile). Đổi lại overlay kiểu Mobile có dải bàn nút ở đáy (như game bar của preset cả cột).
- **D-367 — Đếm ngược của Cửa sổ nổi / trang mini theo Cài đặt → Phát bài** (review R6-OWN-3, R6-CORR-06; đọc mục 4
  đúng chữ "chỉ còn ở Cài đặt", sửa D-354): bỏ ô **Đếm ngược** ở thanh Cửa sổ nổi (pipPrefs bỏ khóa `dfht-pip-delay` +
  `readStartDelay` / `rememberStartDelay`; engine đọc `settings.startDelaySec` như màn chơi) và ở panel trang mini
  (miniControl bỏ `dfht-mini-delay`; panel chỉ nhắc "Đếm ngược: 3 giây · đổi ở Cài đặt → Phát bài" — trang mini không
  có nav nên ghi rõ chỗ đổi). `?delay=` của link mini vẫn đè (giây nguyên 0..10, link cũ / test). Trang mini và video
  PiP theo Cài đặt → **Đếm vào** (trước luôn 1 ô nhịp): OverlayEngine `countIn` từ Cài đặt, tham số mới `countIn` của
  `guideVideoTiming` → `leadBeats` 0 khi tắt (đếm ngược tối thiểu 3 s của video giữ). Mặc định không đổi (3 s, đếm
  vào bật).
- **D-368 — Ô dán AI: ghép mọi khối code** (review R6-OWN-2): `extractPasted` lấy MỌI khối ``` / ~~~ theo thứ tự (dòng
  ngoài khối + hàng rào thành dòng trống nên số dòng của "chỗ không đọc được" vẫn trỏ đúng văn bản đã dán), trước chỉ
  khối đầu → phần 2 của câu trả lời dài mất mà vẫn "✓ 0 lỗi". `PasteConversion.blocks` → dòng kết quả thêm "ghép N phần"
  khi > 1. Cách ghép bài nhiều phần = dán tiếp phần sau vào CUỐI ô (gợi ý trong `ai.step3.body` / `editor.aiPaste.hint`)
  — cả bài đi qua optimizer một lần nên một tông chung; không thêm nút "Thêm vào cuối bài" kiểu Nhập cảm âm cũ (mỗi phần
  tự chọn tông dễ nhất riêng sẽ lệch tông giữa hai phần).
- **D-369 — Ô dán AI: nhận "dán" đúng lần nhập, trạng thái theo ô soạn, giữ header của bài, live region có sẵn**
  (review R6-CORR-03, R6-CORR-05, R6-DOCS-A11Y-01, R6-DOCS-A11Y-06): (a) "dán" = `inputType === 'insertFromPaste'` của
  chính lần nhập (AiPasteBox + trang `#/ai`) — bỏ cờ `onPaste`, vì lần dán không đổi gì (dán ảnh / dán đè cùng chữ) để
  cờ sống sang lần gõ tay sau (bị áp dụng ngay / tên bài bị trả về `@title`). (b) AiPasteBox nhận `source` (ô soạn) và
  `onApply(harm, pasted)` trả nội dung ô soạn sau đó: "✓ Đã đưa N nốt vào bài" chỉ khi ô soạn còn đúng nội dung đó —
  Hoàn tác / sửa tay → dòng đó tắt, "Áp dụng" hiện lại; đổi tông chỉ tự áp dụng lại khi bài vẫn là kết quả của ô.
  (c) Văn bản dán không có `@title` / `@artist` / `@bpm` / `@time` thì giữ của bài hiện tại (`setDirectiveInSource`
  mới ở songSource.ts) — dán vài dòng nốt không đổi tempo 132 → 90 như trước (Nhập cảm âm cũ lấy BPM của bài).
  (d) Dòng kết quả (PasteSummary, prop `quietEmpty`) và dòng "Đã đưa …" là live region luôn có trong DOM (sr-only khi
  trống) → lần dán đầu cũng được trình đọc màn hình đọc.
- **D-370 — Video PiP: không bắt "chạm lại" mãi** (review R6-CORR-02, bổ sung D-361): video chuẩn bị ném lỗi lúc dựng,
  hoặc quá `PREPARE_STALL_MS` (4 s) chưa có metadata (vd. iOS chặn phát video ẩn) → chạm nút báo "không hỗ trợ" (iPhone:
  "iPhone chưa hỗ trợ cửa sổ video nổi cho trang web này", máy khác: "Trình duyệt này không hỗ trợ…") và KHÔNG dùng mất
  video; iPhone báo "chưa sẵn sàng" lần thứ hai liên tiếp → câu iPhone. Nút vẫn bấm được (khóa nút chờ `data-ready` sẽ
  treo vô hạn mà không giải thích).
- **D-371 — Chữ / a11y nhỏ của vòng 6** (review R6-OWN-5…7, R6-DOCS-A11Y-07…10, góp ý chữ của docs writer): link cuối
  cột phím tắt "Hướng dẫn đầy đủ" → **"Xem hướng dẫn"** / "Open the guide" (trang Hướng dẫn giờ cố ý ngắn; khác nhãn
  "Hướng dẫn" của nav); `settings.clickSoundHint` "Tắt thì đếm vào chỉ là ô chạy trước 1 ô nhịp, không có tiếng." (đếm
  vào không có số / hình đếm nào — D-354); hộp thoại của nút Cửa sổ nổi kiểu Mobile **"Cửa sổ mini / video nổi (thử
  nghiệm)"** (đường duy nhất tới "Cửa sổ video nổi" của iPhone — không ghi riêng "Android"); `#/ai`: link Thư viện của
  nav `aria-current="true"` (mục cha) thay vì "page", CSS sáng như nhau. Giữ hai chữ "Đang phát giai điệu" (huy hiệu màn
  chơi = đang phát) / "Đang bật giai điệu" (thẻ Cài đặt = đang bật) — hai ngữ cảnh khác nhau.
- **D-372 — Tài liệu + Tauri của vòng sửa R6** (review R6-CORR-04, R6-OWN-4, R6-DOCS-A11Y-02/03/05): cửa sổ Tauri mở
  `song=seed-quoc-ca-viet-nam` (trước còn bài cũ sẽ bị xóa); lệnh grep của checklist trước deploy tìm cả `src-tauri` +
  `scripts`; `docs/SPEC.md` có mục "2026-10-16" (13 mục, ghi đè mục cũ); `docs/DESIGN.md` theo thứ tự Thư viện mới,
  trang AI, Cài đặt 2 cột, OBS 2 cách + Xem trước, Mobile không gutter; checklist: mục 2 (overlay / Xem trước kiểu Mobile
  có bàn nút), mục 9 (sửa bài "Thử AI" của mục 8, "Xóa ô dán" trước khi dán lại — không đè bài của người dùng), Phần 2
  (http qua Wi-Fi không phải "ngữ cảnh an toàn": "Dựng sẵn" / WebCodecs và giữ màn hình sáng không có — không phải lỗi).
  Ảnh `docs/images/home.png` chụp lại (link "Xem hướng dẫn"). e2e overlay "Xem trước": chờ khung hình ổn định qua hơn
  một nhịp tin `state` (1,2 s) vì Chrome chuyển canvas sang vẽ CPU sau vài lần `getImageData` (cùng lệnh vẽ, khác vài
  điểm ảnh) — trước chỉ chờ 0,3 s nên thỉnh thoảng đỏ.

### Còn mở sau vòng 6

- Cửa sổ video nổi trên iPhone thật chưa thử (D-361, D-370): chưa biết Safari có cho PiP với video MediaStream từ canvas
  không. Cách "Dựng sẵn" (WebCodecs) chỉ thử được qua **https** (vd. bản preview Vercel) — link `http://<IP-LAN>:4173`
  không phải ngữ cảnh an toàn nên trình duyệt ẩn `VideoEncoder` (và Wake Lock): đừng kết luận gì về "Dựng sẵn" từ bài
  test qua Wi-Fi.
- Bỏ hai bài mẫu cũ trước khi deploy (D-364, CLAUDE.md → Deploy).

## Vòng sửa 7 + chuẩn bị deploy (2026-10-16)

Người dùng test bản f851e4a (vòng 6) trên PC và iPhone (qua `http://<địa chỉ IP máy tính>:4173`), gửi góp ý tiếng Việt; lead
gom thành 8 mục R7-1 … R7-8 và 5 mục trước deploy P1 … P5, người dùng duyệt cùng câu "lên Vercel luôn". Bản sẽ deploy
lên Vercel project `df-harmonica-tiles` → **https://df-harmonica-tiles.vercel.app** (lead deploy sau vòng này). Các
mục dưới ghi cách hiểu đã thống nhất và lựa chọn của từng người làm.

### Kiểu Mobile: vòng "CHẠM" và overlay (R7-1, R7-4)

- **D-373 — Nhắc chạm chế độ = vòng trong suốt, nhanh 1,75 lần ô, đồng tâm với nút đúng beat phải chạm** (R7-1; thay
  thanh ngắn của D-351 / D-366): mỗi cue là một vòng KHÔNG tô — viền 2–3 px màu chế độ + quầng tương phản hai bên viền,
  chữ `CHẠM` / `TAP` (`player.mobile.tapBar`, giữ tên khóa cũ) ở tâm kèm quầng chữ. Đường kính ngoài = Ø nút chế độ
  (hình học bàn nút dùng chung). Tâm vòng đi `CUE_RING_SPEED` = 1,75 × tốc độ px của tile
  (`cueRingAxis(T, cueBeat, curBeat, L)` trong layout.ts) → vòng vào sân khấu muộn hơn tile cùng beat (bị cắt ở mép trên) và đồng tâm với nút
  chế độ đúng beat của cue; sau đó đứng yên trên nút và mờ dần trong `CUE_RING_HOLD_BEATS` = 0,25 beat, nên khung hình
  của cú chạm vẫn thấy vòng "khóa" trên nút. Cue vào lại (chơi lại, nhảy dòng, vòng loop sau) và vòng mờ của phần đếm
  vào giữ như cũ. Bỏ hết mã thanh của vòng 6 (trường thanh, tính độ dài, clip, font thanh, dữ liệu mode-span không còn
  dùng). `CueTargets` = `{cross, size, axis, targets}` (bỏ `land`, `targetAxis`). Nhanh hơn ô theo đúng góp ý: vòng
  to bằng nút và đáp vào TÂM nút (ô đáp mép trên), nên xuất hiện muộn, ít che ô cùng beat trên đường rơi rồi "đáp"
  vào nút.
- **D-374 — Vòng vẽ trên lớp canvas trong suốt phủ TRÊN bàn nút DOM:** nút chế độ DOM đục, vòng vẽ trên canvas tiles
  sẽ biến mất dưới nút đúng lúc đáp. MobilePad render con cuối `canvas.mpad-cues[data-cue-layer]` phủ cả hộp canvas
  (`pointer-events: none`, `aria-hidden`, cao theo `--mpad-box-h`). Renderer tìm `canvas[data-cue-layer]` trong cha
  của canvas tiles, đặt cùng cỡ + DPR, chỉ xóa khi đã vẽ gì đó, vẽ vòng lên đó; không tìm thấy thì vẽ lên canvas tiles.
  Bộ vẽ video nổi (`videoPip.ts`) tạo lớp cùng kiểu trong host ẩn và dán lên bàn nút nó tự vẽ (đã kiểm trên khung hình
  thật: vòng đồng tâm nút Ngẩng Lên). `CUE_LAYER_ATTR` nằm ở layout.ts để MobilePad không phải import renderer. Màn chơi,
  Cửa sổ nổi (style chép sang cửa sổ nổi mang theo lớp) và trang mini có lớp này tự động. Chưa đo trên điện thoại thật:
  thêm một canvas trong suốt cỡ cả khung tốn thêm một ít compositing GPU mỗi khung; chữ `CHẠM` chỉ ~7 px trên nút chế
  độ 22 px ở màn rộng 360 px.
- **D-375 — Overlay OBS kiểu Mobile: không bàn nút, 4 vòng đích mờ** (R7-4; thay phần overlay của D-366): option
  renderer mới `modeTargets: 'pad'` (mặc định — màn chơi, Cửa sổ nổi, trang mini, video: bàn nút vẽ nút) | `'outline'`.
  OverlayView luôn truyền `'outline'`; kiểu Mobile + lane dọc giữ `lanePadding: 'pad'` (làn thẳng nút, hit line = đỉnh
  hàng nút số — trên stream nút thật của game nằm ngay dưới) nhưng không render MobilePad (`OverlayMobilePad` bỏ) và
  không game bar (`gamebar` bỏ qua). Renderer chỉ vẽ 4 vòng mờ ở vị trí hàng nút chế độ của bàn nút: viền mảnh màu chế
  độ alpha 0,5 + quầng 0,45, không tô, không ký hiệu, không vòng nút số. Bố cục không bàn nút (overlay dải ngang) dùng
  cùng 4 vòng mờ đó sau hit line — bỏ 4 vòng tô đặc có ký hiệu ↓ ↑ • # (chế độ đang bật) của D-366. Tên chế độ giờ chỉ
  ở banner của overlay (hoặc game bar của lane ngang). Màn chơi, Cửa sổ nổi, trang mini giữ bàn nút đầy đủ. Vì sao bỏ
  ký hiệu: vòng đích chỉ là "chỗ đáp" — thứ tự 4 vòng cố định như game và banner ghi tên chế độ, nên không chỉ dựa vào
  màu.
- **D-376 — Token màu vòng theo theme** (`canvasTheme.ts`, có test tương phản): `cueRing` — tối / overlay: màu chế độ
  của palette (trùng `--mod-*` của nút DOM; xanh dương ~3,6:1 trên làn tối nhất), sáng: bản đậm như `tileStroke`
  (≥ 3:1 trên nền cát); `cueHalo` — `rgba(0,0,0,0.72)` tối / overlay, `rgba(251,249,242,0.85)` sáng, `#0c1013` đặc trên
  chroma; `cueText` — `#ffffff` tối, `#1b1e18` sáng. Trên chroma vòng dùng màu đặc đã trộn sẵn (cache theo màu × bước
  alpha). Forced colors không đổi điểm ảnh canvas; ảnh chụp xác nhận vòng vẫn thấy trên nút màu hệ thống ở cả hai theme
  tương phản cao.

### Bắt đầu phát không giật (R7-3)

- **D-377 — Đếm ngược vẽ đúng khung bắt đầu của đếm vào (pre-roll)** (R7-3): điều tra (đọc mã) không thấy đồng hồ bị
  giữ với cài đặt mặc định, nhưng lúc chuyển đếm ngược → đếm vào `transport.play` đặt mốc lùi một ô nhịp
  (`anchorBeat = from − 4`) nên canvas NHẢY LÙI một ô nhịp: ô thấy trong lúc 3-2-1 biến mất khỏi mép trên, và với _Quốc ca_ (nốt đầu
  ở beat 2,75) làn trống ~0,56 s trước khi ô đầu vào — cảm giác "khựng 1/3 giây". Đo (Playwright + Edge headless, bản
  production, CPU chậm 4 ×, 1366 × 860): trước sửa không khung nào được vẽ trong lúc đếm ngược (canvas giữ khung beat 0);
  lúc chuyển, Quốc ca mọi biến thể (PC, Mobile, có tiếng, overlay tự chạy, mini, overlay theo màn chơi) mất 5–10 ô rồi
  549–595 ms làn trống; TAKEDISKRUSH ô thấp nhất nhảy lên 281 px (PC) / 374–382 px (Mobile). Sửa: trong lúc đếm ngược
  (và lúc chờ mở khóa âm thanh) `drawFrame` vẽ beat = `from − countIn` với khoảng ghost của đếm vào `{from − n, from}`;
  `from` chuẩn hóa như `Transport.play` (âm → 0, ở cuối bài → 0). Transport vẫn dừng ở `from`, nên trạng thái UI (game
  bar, banner, tiến độ, noteIndex) không đổi. Hết đếm ngược transport chạy từ đúng khung đó. Getter `preRoll` ở
  PlayerEngine và OverlayEngine; `requestFrame` gọi cả lúc đếm ngược bắt đầu / hủy / hủy chờ. Sau sửa (9 kịch bản):
  0 chỗ đứt; TAKEDISKRUSH 6 ô ở khung đếm ngược và 6 ô ở khung chạy đầu (bước đầu +2–3 px); Quốc ca: khung pre-roll
  không có ô (nốt đầu cách 6,75 beat, lookahead 6), ô đầu vào sau 0,56 s chạy liên tục, không ô nào biến mất. Ý cũ giữ
  nguyên: số to chỉ khi ô đứng yên, đếm vào không số. **Thứ tự lúc hết đếm ngược:** `onCountdownTick` gọi `start()`
  (`transport.play` / `playPending`) TRƯỚC khi xóa `state.countdown` — không có thông báo nào mang trạng thái "dừng ở
  `from`" thiếu khung pre-roll (overlay theo màn chơi sẽ lóe khung `from` một khung).
- **D-378 — Follow: `countIn` khi `playing = false` = đếm vào đang chờ; overlay chờ độ trễ âm thanh** (bổ sung
  contract `src/overlay/follow.ts`, file không sửa): FollowBroadcaster gửi `countIn` = khoảng pre-roll trong tin `state`
  có `playing = false` lúc màn chơi chờ phát (đếm ngược / mở khóa âm thanh); pre-roll nằm trong chữ ký thay đổi.
  `OverlayEngine.applyFollow` coi `!playing && countIn` là khung pre-roll cần vẽ; `followPause` xóa nó. Overlay cũ vốn
  bỏ qua `countIn` khi không chạy nên tương thích. `PlayOptions.startDelaySec` mới của Transport (cộng vào
  `clock.lead()`): tin `state` có `sentAt` ở tương lai (màn chơi còn chờ độ trễ ra loa) → overlay chờ chừng đó (tối đa
  1 s) rồi mới chạy — trước đó nó chạy trước rồi bị kéo lùi ở nhịp tim sau (tai nghe Bluetooth: ~0,4 beat). Đo: overlay
  theo màn chơi trước sửa còn một cú nhảy khớp ở +4,5 s và một khung hở 776 ms; sau sửa không nhảy, khung hở lớn nhất
  22 ms. Doc comment của `countIn` trong follow.ts nên nhắc nghĩa mới này (việc của người sửa mã).
- **D-379 — Trang mini / overlay tự chạy: `MiniTarget.prepare`:** MiniController gọi `target.prepare?(action)` khi
  đếm ngược của nó bắt đầu (`'play'` | `'restart'`) và `prepare(null)` khi hủy / dispose; `OverlayEngine.prepare` vẽ
  khung pre-roll từ vị trí hiện tại (`'play'`) hoặc từ 0 (`'restart'`). Đếm ngược của overlay tự chạy dùng
  `countdownFrom` theo cùng cách.
- **D-380 — Làm nóng hiệu ứng phát sáng trước nốt đầu** (`src/player/glowWarmup.ts`): đo thấy khung hở ≥ 100 ms đúng
  lúc nốt đầu chạm vạch sáng khi máy bận (Quốc ca +5,06 s: 101 / 84 / 78 ms, một lần 281 ms; trình duyệt mới 49–91 ms);
  trace CDP cho ~100 ms raster ở GPU process, A/B chỉ ra lần DÙNG ĐẦU của hiệu ứng blur — `shadowBlur` của tile sáng
  và CSS `drop-shadow` của keycap đang sáng (keycap sáng lần đầu đúng lúc đó). Không có long task ở main thread lúc
  hết đếm ngược. Hai bước làm nóng: (1) `warmTileGlow` — ở ≤ 6 khung đứng yên đầu tiên mỗi lần attach (PlayerEngine
  và OverlayEngine), SAU `renderer.render` vẽ một rrect cỡ tile sáng với `shadowBlur` 18 × `layout.scale`, màu
  `rgba(0,0,0,0.004)` (vẽ sau khung để thật sự được raster — tối ưu "ghi đè cả canvas" bỏ các lệnh xếp trước một lần vẽ
  lại); (2) `warmKeycapGlow` (PlayerEngine.attach) — đọc `filter` thật của một mẫu tạm
  `.gb-key.is-active.gb-tone-normal` (gỡ ngay trong cùng task, không có `.gb-key` thừa nào được vẽ / lọt vào e2e); là drop-shadow thì
  hiện một ô `.glow-warmup` 48 px `aria-hidden` mang filter đó ở opacity 0,01 trong 600 ms (timer của host; detach
  gỡ). Filter `none` (theme sáng, overlay, mini, jsdom) thì không làm gì. Hằng số phải theo `drawTileBodies` của
  renderer.ts (bán kính, 18 × s). Sau sửa, trình duyệt mới: 35–50 ms (chỉ làm nóng canvas: 66–68 ms; tắt hẳn cả hai
  hiệu ứng: 23–55 ms → phần còn lại là nhiễu GPU lần đầu, dưới ngưỡng 100 ms). Có tiếng: ô đứng ở khung pre-roll thêm
  61–79 ms (lead độ trễ ra loa) rồi chạy, không giữ nào sau khi đã chạy — không sửa (bắt đầu `lead` sớm hơn sẽ bỏ được).
  Cửa sổ nổi (Document PiP) không đo được bằng harness (không gắn được vào canvas của cửa sổ PiP); dùng cùng mã
  PlayerEngine, có unit test. Số đo headless nhiễu (bốn builder chạy cùng lúc); các cặp so sánh chạy liền nhau.

### Đếm ngược, cập nhật (R7-5, R7-2)

- **D-381 — Cửa sổ nổi + trang mini: đếm ngược tối thiểu 3 giây** (R7-5; sửa D-367): `floatingCountdownSec(v)` ở
  pipPrefs.ts = clamp(round(v), 3, 10), giá trị hỏng → 3 (Tắt → 3, 5 → 5). FloatingStage gọi
  `engine.setStartDelay(floatingCountdownSec(settings.startDelaySec))` và áp lại khi Cài đặt đổi; MiniView dùng
  `urlDelay ?? floatingCountdownSec(settings)` — `?delay=` trong link vẫn thắng (link cũ, test dùng `?delay=0`);
  MiniLauncher không thêm `delay`. Video nổi Apple (`songVideoCountdown`, MiniLauncherVideo.tsx) cùng luật (video vốn kẹp
  `MIN_VIDEO_COUNTDOWN` = 3 trong guideVideoTiming) — hai hàm có thể gộp sau. Màn chơi vẫn dùng đúng giá trị Cài đặt.
  Chuỗi mới `settings.startDelayFloatingHint` (vi + en) là dòng `.field-hint` thứ hai dưới thanh trượt ở 03 Phát bài;
  `aria-describedby` của thanh trượt liệt kê cả hai dòng.
- **D-382 — Tự kiểm tra bản mới** (R7-2): trình duyệt chỉ tự hỏi lại `sw.js` khi điều hướng — app một trang mở cả buổi
  stream thì không bao giờ thấy bản mới. `watchForUpdates(registration)` ở pwa.ts, khởi động một lần từ `onRegisteredSW`
  của registerSW: tab hiện lại (`visibilitychange` → visible) → `registration.update()`, giãn tối thiểu
  `UPDATE_CHECK_MIN_GAP_MS` = 5 phút (lần đăng ký tính là một lần kiểm tra); cứ `UPDATE_CHECK_INTERVAL_MS` = 45 phút khi
  tab đang hiện. Offline thì bỏ lượt, không chạy hai lần cùng lúc, lỗi mạng im lặng (không `console.error`).
  `resetPwaForTests` dừng nó. Overlay và trang mini không mount UpdatePrompt nên không đăng ký SW, không chạy bộ này.
  Có bản mới → "Có bản mới → Tải lại" như cũ (không tự tải lại).

### Cửa sổ nổi trên điện thoại (R7-6, R7-7)

- **D-383 — Hỏi "Apple hay Android" một lần, nhớ theo máy; lựa chọn đã lưu luôn thắng** (R7-6): module nhẹ
  `src/pip/phonePref.ts` (không import videoPip, bundle màn chơi không lớn thêm) giữ `'apple' | 'android'` ở
  localStorage `dfht-phone-kind` (đọc / ghi trong try/catch; bị chặn thì nhớ trong bộ nhớ cho phiên; sự kiện `storage`
  cập nhật tab khác). User-agent chỉ dùng để chọn sẵn nút trong hộp thoại hỏi (nút chính + autofocus), không bao giờ bỏ
  qua câu hỏi. Ngoại lệ: hộp thoại video của trang mini, khi người dùng chưa chọn bao giờ, `useIsApplePhone` lấy đoán
  theo UA — iPhone mở thẳng link trang mini vẫn được cách chỉ dựng sẵn (lưu 'android' trên iPhone thì thấy Trực tiếp;
  muốn chỉ theo lựa chọn đã lưu thì đổi `useIsApplePhone` thành `kind === 'apple'`). `isAppleMobile` chuyển sang
  phonePref.ts (videoPip.ts re-export). MiniLauncher có `songId` (nút Cửa sổ nổi của màn chơi ở kiểu Mobile, và cả kiểu
  PC trên máy cảm ứng không có Document PiP — vốn đã mở MiniLauncher) luôn hỏi trước, nên trên điện thoại nút này như
  nhau ở mọi kiểu điều khiển; Document PiP của PC máy tính không đổi. MiniLauncher không `songId` (ô chọn bài) không hỏi.
  Props PlayerView ↔ MiniLauncher không đổi. Hộp thoại hỏi: "Cửa sổ nổi trên điện thoại" — "Điện thoại của bạn: Apple
  (iPhone / iPad) hay Android?", nút "Apple — iPhone / iPad" / "Android" (mỗi nút một dòng gợi ý), dòng "App nhớ lựa
  chọn trên máy này…"; chân hộp thoại Android / Apple: "Điện thoại: … · Đổi loại điện thoại". Chữ đổi theo:
  `player.floatMobileHint` = "Cửa sổ nổi trên điện thoại: Android = trang mini, iPhone / iPad = video nổi của bài này";
  `mini.launcherNoFloat` không còn nhắc iPhone ("…hoặc máy không có?").
- **D-384 — Apple: dựng ngay khi hộp thoại mở, một cú chạm để mở, phần video tải lười và sống cùng màn chơi:** module
  lười mới `src/mini/MiniLauncherVideo.tsx` (`SongVideoPip`, `AppleVideoBody`, `useSongVideoOptions`,
  `songVideoCountdown`) dựng `GuideVideoOptions` như trang mini (kiểu điều khiển, Nửa Cung, theme, ngôn ngữ, nhãn phụ,
  lookahead, đếm vào, tên nút, timeline với `GAME_SCROLL_DIR`), đếm ngược = Cài đặt → Phát bài tối thiểu 3 giây. Mở hộp
  thoại = dựng ngay + giữ màn hình sáng trong lúc dựng; `.mini-video-host` gắn cạnh hộp thoại như trang mini. Nút
  "Mở video nổi" khóa tới khi dựng xong rồi nhận focus; click gọi `pip.openBuilt` → PiP xin ĐỒNG BỘ trong cú chạm
  (D-361 giữ nguyên). Sau lần mở đầu component sống suốt đời màn chơi: đóng hộp thoại không đóng phiên PiP; đóng lúc
  đang dựng = hủy dựng; video đã dựng được giữ, option đổi thì dựng lại. Không dựng được (không WebCodecs / không phát
  được WebM) → "Cập nhật iOS / Safari…" và không có nút mở. Lỗi chỉ hiện câu dễ hiểu, lỗi gốc nằm ở `data-reason`.
  Hộp thoại giữ tiêu đề "Cửa sổ video nổi (thử nghiệm)", trạng thái "Video nổi đang mở — chuyển sang game ngay…", nút
  đóng "Đóng cửa sổ video". Kiểm trong jsdom (bộ mã hóa giả + user activation giả) và Edge headless với lựa chọn
  'apple'; `webkitSetPresentationMode` của WebKit chưa chạy thật.
- **D-385 — Ẩn "Trực tiếp" trên máy Apple, "Trực tiếp" là mặc định ở máy khác; dựng sẵn chạy cả qua http trên iPhone**
  (R7-7; bổ sung D-361 / D-370): người dùng thấy câu "không hỗ trợ" thân thiện với Trực tiếp trên iPhone, còn Dựng sẵn
  CHẠY trên iPhone của họ kể cả qua `http://<địa chỉ IP máy tính>:4173` — ghi chú "Dựng sẵn cần https" của vòng 6 sai với Safari
  (Safari có WebCodecs ở trang http; Chrome thì ẩn ở trang http không phải localhost). `useVideoPip` thêm `apple` và
  `liveOffered` (= `support.live && !apple`): máy Apple không chuẩn bị luồng canvas, ẩn mục "Trực tiếp", hộp thoại của
  trang mini tự dựng một lần mỗi lần mở ("Hủy dựng" không khởi động lại). Máy khác giữ cả hai cách, "Mở video trực tiếp"
  là nút chính khi trình duyệt hỗ trợ. Câu lỗi riêng của Apple theo cùng cờ `apple`. Effect "option đổi → bỏ video đã
  dựng" của `useVideoPip` bỏ qua lần chạy đầu, để lượt tự dựng của hộp thoại con trong cùng lần mount không bị hủy.

### Trước deploy (P1, R7-8, P2–P5)

- **D-386 — Hai bài mẫu cũ thành fixture của test** (P1; khép D-364; trước khi mở mã nguồn thay bằng hai bài tự
  soạn — D-443): hai file `.harm` của chúng chuyển nguyên byte sang `src/test/fixtures/` (app không import; `.vercelignore` vẫn tải
  lên, vô hại). `SeedId` chỉ còn `seed-quoc-ca-viet-nam` | `seed-takediskrush`, `SEED_COUNT` 2. Test core chi tiết
  (optimizer §9 của spec, cấu trúc parse, tap timing, timeline, snapshot donate) giữ assertion trên fixture, id parse
  đổi thành `fixture-…`; test chỉ cần "một bài mẫu" dùng hai bài thật; PlayerView.test và các test `@repeat` của
  EditorView.test thêm fixture vào thư viện như bài người dùng (`addSong`); các danh sách `it.each` chung (round-trip,
  spans, sourceEdit, melodyBuild round trip, không lời) chạy thêm trên cả hai bài mẫu; store.test kiểm id cũ không còn
  là bài mẫu (`getSong` → null). e2e: `SEED1` = Quốc ca, `SEED2` / `OTHER` = TAKEDISKRUSH (màn `#/` là Quốc ca nên bài
  thứ hai luôn là TAKEDISKRUSH); ca "điệp khúc = Ngẩng Lên" cũ (`?line=8` / ĐIỆP KHÚC) thành Quốc ca dòng 4 / đoạn
  "Phần 2" (mọi nốt Ngẩng Lên, vào từ Ngẩng Tự Nhiên phải chạm Ngẩng Lên — ghim bằng test mới ở mobilePlan.test.ts;
  phase2c dùng hằng `UP_SECTION`); round5 `SEED_COUNT` = 2. Id cũ chỉ còn ở test phủ định của store.test và nhãn /
  import fixture, nên lệnh grep của checklist cũ vẫn ra file test — đúng ý.
- **D-387 — Trang "Dev notes" `#/dev`** (R7-8): route lười mới `{ name: 'dev' }`, `paths.dev(section?)`,
  `?s=<id tiêu đề>` cuộn tới mục; `src/dev/DevNotesView.tsx` ở chunk riêng. `docs/REFERENCE.md` + `CHANGELOG.md` nạp
  `?raw` (~110 KB chữ, chỉ tải khi mở trang), đọc bằng bộ markdown của trang Hướng dẫn: `parseMarkdown` nhận thêm bộ
  đếm slug dùng chung để id tiêu đề không trùng giữa hai tài liệu; tiêu đề hạ một bậc (trang có một h1 "Dev notes"); `withAppUrl`
  vẫn áp. Đầu trang: vùng "Bản đang chạy" — Phiên bản (package.json) / Commit / Ngày build (UTC), thiếu thì "không rõ
  (bản dev / test)" — rồi mục lục hai link tới tiêu đề đầu của từng tài liệu; tài liệu giữ `lang="vi"` (intro EN nói
  vậy). Nav chính không có link, không mục nào sáng ở route này. **Link:** MarkdownBlocks nhận `resolve: LinkResolver`
  thay `doc`; `LinkTarget` thêm kind `'dev'`; ở guideContent link tới `docs/REFERENCE.md` → `#/dev`; `repoPath()` mới
  chuẩn hóa `./` `../`; tra `DOC_FILES` bằng `Object.hasOwn` ('constructor' không còn khớp). `resolveDevLink`
  (devContent.ts) đọc link của REFERENCE tương đối từ `docs/` (`../README.md` → `#/guide`); `#mục` ở lại trang, chỉ
  thành link khi tiêu đề có thật. **Commit / ngày build:** vite.config.ts định nghĩa `__BUILD_COMMIT__` /
  `__BUILD_DATE__` (khai báo ở `src/env.d.ts`): commit lấy `DFHT_COMMIT`, rồi `VERCEL_GIT_COMMIT_SHA`, rồi
  `git rev-parse --short HEAD` (+ `-dirty` khi `git diff --quiet HEAD` báo có thay đổi), không có thì ''; ngày = giờ build ISO; dưới
  Vitest luôn '' (test ổn định). Vercel build source tải lên không có `.git` nên `scripts/deploy.mjs` tính commit cùng
  cách và truyền `--build-env DFHT_COMMIT=<sha>` cho `vercel deploy` (thay đổi duy nhất của script). **Link chân trang:**
  `src/dev/DevNotesLink.tsx` (eager, CSS riêng `devNotesLink.css` — app.css / settings.css không đổi): chữ "Dev notes"
  (giữ tiếng Anh, `lang="en"`, `title` = `dev.linkTitle`), căn giữa, 0,78rem, `--text-muted` (AA trên mọi nền theo
  contrast.test, ~7:1), gạch chân, cao ≥ 24 px, hover `--text`, focus ring chung — là phần tử cuối của bài Hướng dẫn (cả
  hai tài liệu) và nằm sau dòng "Đặt lại mặc định" của Cài đặt. **Cuộn trên điện thoại:** ở ≤ 560 px nav xuống hai
  hàng (85–89 px) nên tiêu đề đích `?s=` bị nav che (trang Hướng dẫn vốn đã vậy): guide.css dùng `scroll-margin-top`
  104 px ở ≤ 560 px và cho cả h5 / h6 72 px (tiêu đề CHANGELOG bị hạ bậc). Chuỗi mới: khối `dev.*` (vi + en).
- **D-388 — Tài liệu của vòng 7 + chuẩn bị deploy** (P2–P5): mọi `VERCEL_URL_TODO` trong tài liệu cho người dùng
  (README, `docs/REFERENCE.md`, `docs/TAURI.md`) thành **https://df-harmonica-tiles.vercel.app**; nhắc lịch sử trong
  DECISIONS / CHANGELOG cũ giữ nguyên. `withAppUrl` vẫn thay token cũ, nhưng URL thật thì không đổi — trang Hướng dẫn /
  Dev notes của bản local / preview cũng hiện link production (chấp nhận được: đó là link người dùng cần). Ảnh README
  chụp lại từ dev server riêng (1600 × 900, theme tối, < 300 KB): `player-mobile.png` (vòng CHẠM), `library.png` (chỉ
  còn 2 bài mẫu), `obs-link.png` (link Browser Source) và `settings.png`. Ở `obs-link.png` gốc của dev server trong ô
  link được thay bằng `https://df-harmonica-tiles.vercel.app` trước khi chụp (chỉ phần chữ hiển thị — đúng thứ bản
  deploy sẽ hiện; chụp lại từ production sau deploy nếu muốn ảnh "thật" 100 %). `docs/LOCAL-TEST-CHECKLIST.md` viết lại
  thành checklist **sau deploy** (giữ tên file vì CLAUDE.md / README trỏ tới). README: Guide chỉ thêm đúng phần vòng 7
  đổi (vòng CHẠM, overlay Mobile 4 vòng mờ, iPhone → Apple → Mở video nổi, đếm ngược tối thiểu 3 giây, tự kiểm tra bản
  mới); link Dev notes không nhắc trong Guide (đã có ở chân trang). `docs/REFERENCE.md` (giờ hiện ở `#/dev`) cập nhật
  mọi mục vòng 7; CLAUDE.md mục Deploy ghi project, URL, cách deploy lại và bỏ các mục checklist đã xong; SPEC có mục
  "2026-10-16 — Góp ý vòng 7"; CHANGELOG "Vòng sửa 7 + chuẩn bị deploy (2026-10-16)".

### Sửa sau review vòng 7 (người sửa mã)

- **D-389 — Bấm Phát / hủy đếm ngược: trượt mượt vào / ra khung pre-roll, không nhảy** (R7-3 sau review; bổ sung
  D-377): D-377 chỉ dời cú nhảy một ô nhịp từ lúc hết đếm ngược sang lúc BẤM Phát — khung đứng yên vẽ ở `from`, khung
  đếm ngược ở `from − n`, nên bấm Phát mọi ô nhảy lên một ô nhịp (màn đầu Quốc ca: cả 5 ô biến mất ngay), Esc nhảy
  ngược lại, overlay theo màn chơi / tự chạy / trang mini y như vậy; đếm ngược = Tắt mà đếm vào bật thì khung chạy đầu
  tiên đã ở `from − 4` (R7C-1). Ba cách review đưa ra: (a) khung đứng yên vẽ luôn ở `from − n` — bỏ: màn đầu (Quốc ca,
  nốt đầu ở beat 2,75 + 4 beat đếm vào > lookahead 6) sẽ là làn TRỐNG ngay từ lúc mở app, nhảy dòng (← →) sẽ hiện dòng
  lệch một ô nhịp, và dừng giữa bài sẽ nhảy lúc dừng; (b) chỉ áp (a) khi đứng ở đầu bài — cùng vấn đề màn đầu trống;
  (c) trượt — CHỌN. `src/player/preRollGlide.ts` (thuần): `PreRollGlide.beatFor(target, mode, span, now)` mỗi khung ở
  `PlayerEngine.drawFrame` và `OverlayEngine.drawFrame` (đồng hồ: `baseClock` / clock của transport overlay — test dùng
  ManualClock). Kiểu khung `idle | pre | countIn | play`; đổi kiểu giữa ba kiểu đầu (trừ `pre → countIn`, vốn liền mạch
  từ D-377) mà khoảng nhảy ≤ độ dài ô nhịp đếm vào → phần bù `lastBeat − target` mờ dần theo smoothstep trong
  `PRE_ROLL_GLIDE_SEC` = 0,36 s, nên KHUNG ĐẦU sau khi bấm luôn đúng là khung đứng yên. Đếm ngược Tắt: phần bù cộng
  vào beat đang chạy của transport (ô lùi mượt rồi rơi) — transport, âm thanh, nốt đầu không đổi giờ. Hủy đếm ngược /
  dừng giữa lúc đếm vào → trượt ngược về `from`; đang trượt mà đổi hướng → trượt tiếp từ chỗ đang vẽ. Có `play` (chơi
  lại khi đang phát, dừng), khoảng nhảy > một ô nhịp (chơi lại từ giữa bài, tua) hay đích nhảy > 0,75 beat giữa hai
  khung cùng kiểu → nhảy thẳng như cũ. Engine xin thêm khung khi `glide.active`. Overlay theo màn chơi nhận cùng tin
  `state` nên trượt y như màn chơi (stream không thấy cú nhảy); `.overlay[data-beat]` = beat đang vẽ (gồm phần trượt).
  Số to vẫn chỉ hiện lúc đếm ngược; 0,36 s đầu của số "3" ô đang trượt về khung pre-roll rồi đứng yên. Test:
  preRollGlide.test, usePlayerEngine.preroll.test (khung đầu = khung đứng yên, đơn điệu, Esc trượt về, đếm ngược Tắt),
  overlayEngine.test (tự chạy, prepare của trang mini, theo màn chơi), e2e round7 (khung đầu sau khi bấm = khung đứng
  yên; lúc trượt ô chỉ dời lên, chỉ ra qua mép trên; đếm ngược Tắt; overlay "Xem trước" theo màn chơi đi qua các beat
  trung gian 0 → −4). Muốn kiểu (a) thì đổi điều kiện của getter `preRoll` (chủ dự án quyết).
- **D-390 — Vòng CHẠM: chữ mờ trước khi đáp; tên nút không cắt giữa từ; overlay Mobile không game bar** (review vòng 7):
  (1) chữ `CHẠM` ở tâm vòng đè lên tên chế độ in trong nút (`data-label="inside"`, vd. "NGẨNG LÊN" — EN thành "LTAPP")
  đúng lúc phải đọc nút nào, kể cả lúc dừng trên cue; tương phản cao thì hai chữ trắng dính nhau. Giờ chữ mờ dần khi
  tâm vòng còn cách tâm nút `CUE_TEXT_FADE_FAR` = 1 → `CUE_TEXT_FADE_NEAR` = ½ Ø và không có lúc đồng tâm / đứng trên
  nút; viền vòng vẫn "khóa" vào nút. Review đề nghị bỏ hẳn chữ ở vòng < ~28 px (nút chế độ 22 px: điện thoại dọc, trang
  mini, Xem trước / overlay canvas 720p, chữ ~7 px) — KHÔNG làm: R7-1 đòi chữ "CHẠM" ở mọi nơi kiểu Mobile vẽ nhắc
  chạm, và chủ dự án kiểm overlay qua cửa sổ Xem trước (nút ~22 px) — bỏ chữ ở đó trông như mất tính năng; ở cỡ đó tên
  nút nằm DƯỚI hình tròn (`data-label="below"`) nên không bị che (chủ dự án quyết nếu muốn bỏ). Chữ mờ hẳn (alpha
  < 0,02) thì không vẽ (nền chroma trộn màu sẵn → vẽ alpha ~0 = tô màu nền). e2e nhận vòng không chữ nhờ lớp
  `.mpad-cues` / nét ≥ 2 px (vòng đích mờ 1,5 px). (2) EN `SEMITONE` bị
  `overflow-wrap: anywhere` cắt thành "SEMITON / E" trong nút 40 px: nhãn trong hình tròn chỉ xuống dòng ở dấu cách,
  MobilePad đặt `--mpad-name-ch` = số ký tự của từ dài nhất, CSS `font-size: min(1em, Ø × 0,84 / (ch × 0,72))` — tên tiếng
  Việt (từ ≤ 5 ký tự) giữ cỡ cũ. (3) Overlay kiểu Mobile lane ngang với `gamebar=1` (link tự sửa; preset "Dải ngang" ghi
  `gamebar=0`) vẫn vẽ game bar Mobile = 4 nút chế độ + 8 nút số, trái R7-4: OverlayView chỉ render game bar khi
  `scheme !== 'mobile'`; tên chế độ ở banner trên dải lane (D-375 ghi "hoặc game bar của lane ngang" — bỏ ý đó).
- **D-391 — Trước deploy: commit "sạch" thật, phiên bản, xem trước link, chữ** (review vòng 7): (1) `-dirty` của Dev
  notes dùng `git diff --quiet HEAD` → không thấy file MỚI chưa add (vòng 7 có 12 đường dẫn mới mà app cần) — commit
  thiếu chúng rồi deploy thì Dev notes ghi một SHA "sạch" không build lại được. `scripts/deploy.mjs` và `vite.config.ts`
  dùng `git --no-optional-locks status --porcelain` (gồm file mới, không ghi index). (2) CLAUDE.md → Deploy: lần
  deploy production đầu bắt buộc `git add -A && git commit` → `git status` trống → `npm run release -- major` (1.0.0;
  CHANGELOG `[Unreleased]` → `[1.0.0] - ngày`, commit + tag local) → `npm run deploy:prod`; checklist Phần 1 mục 5 ghi
  phiên bản mong đợi (không `0.0.0`, không `-dirty`). Người sửa mã không chạy lệnh git đổi trạng thái nên việc này là
  của lead. (3) index.html có thẻ Open Graph / `twitter:card summary` tĩnh (tiêu đề, mô tả VI, `og:url` production,
  `og:image` = `icons/icon-512.png` tuyệt đối 512 × 512) để link chia sẻ có ô xem trước — chỉ là chữ, app không tải gì
  (test: src/ui/indexMeta.test.ts). (4) Chữ: dòng nhắc Cài đặt "Cửa sổ nổi, trang mini và video nổi luôn đếm ít nhất 3
  giây…" (video nổi Apple cùng luật `floatingCountdownSec`); `mini.video.errorIos` "iPhone / iPad chưa hỗ trợ…" (hộp
  thoại hỏi "Apple — iPhone / iPad"); `mini.help.other` chỉ đường mới cho iPhone / iPad (màn chơi → Cửa sổ nổi →
  Apple). (5) Hộp thoại Apple: lúc còn dựng nút "Mở video nổi" khóa trông như nút phụ viền nét đứt (trước: gần giống nút
  chính), `aria-describedby` = dòng "Đang dựng video… N%" + lời nhắc giữ trang mở. Khóa chuỗi `player.mobile.tapBar`
  giữ tên cũ (chỉ là tên nội bộ).

### Còn mở sau vòng 7

- Chưa thử trên máy thật: trang mini Android; vòng CHẠM trên điện thoại 360 px (chữ ~7 px) và chi phí GPU của lớp vòng
  trong suốt; `webkitSetPresentationMode` của "Mở video nổi" (luồng Apple mới) trên iPhone; hình học overlay kiểu Mobile
  so với bàn nút thật của game mobile trên ảnh quay điện thoại (giữ preset như vòng 6).
- e2e mới của vòng 7 (round6 / pip / mini viết lại cho vòng CHẠM, câu hỏi Apple / Android, đếm ngược 3 s) do người sửa
  mã chạy; "Gửi thẳng vào OBS" với OBS thật + lời hỏi quyền mạng cục bộ trên bản https chưa thử — checklist sau deploy.
- `package.json` còn version `0.0.0` cho tới khi lead chạy `npm run release` trước lần deploy production đầu (D-391).
- Trượt pre-roll (D-389) chưa xem trên máy thật / OBS thật; nếu chủ dự án thích ô đứng sẵn ở khung đầu đếm vào ngay
  từ lúc dừng (kiểu (a)) thì đổi getter `preRoll`.

## Bổ sung trước deploy (chủ dự án duyệt, 2026-10-16)

Sau vòng 7 chủ dự án duyệt các bổ sung phải có trong lần deploy đầu: (A) nút loa trên thanh điều khiển màn chơi, (B)
trang mini Android khớp nút game thật, rồi thêm (B6–B7) đúng tỉ lệ thật + chiều cao của trang mini và (C) cỡ Cửa
sổ nổi PC cho mọi màn hình (D-405 – D-411); sửa sau review 2: D-412 – D-420. Hai người sửa mã làm song song, lead gộp và kiểm (check, e2e, tài
liệu). Số đo game lấy từ ảnh chụp màn hình game của chủ dự án 2026-10-16 — ảnh chỉ dùng để đo, không nằm trong repo
hay app.

### A. Nút loa trên thanh điều khiển

- **D-392 — Nút loa của giai điệu mẫu trên thanh điều khiển** (ghi đè một phần D-183 và mục SPEC 2026-10-14 "bỏ nút
  âm thanh khỏi thanh điều khiển Player"): nút icon ngay trước nhóm Tempo (`.transport-group.transport-sound`), mặc
  định tắt tiếng. Tên = hành động ("Bật tiếng giai điệu" / "Tắt tiếng"; en "Turn on the melody" / "Mute"),
  `aria-pressed` = giai điệu đang bật, `aria-describedby` = câu trạng thái (`player.soundStateOff` / `soundStateOn`,
  vì tên đổi theo trạng thái cộng `aria-pressed` dễ đọc nhập nhằng), `aria-haspopup="dialog"` chỉ khi đang tắt. Đang
  tắt → bấm = hộp cảnh báo bản quyền (đúng hộp của Cài đặt): "Tôi hiểu, bật" → bật; Hủy / Esc / nền → giữ tắt, focus về
  nút. Đang bật → bấm = tắt ngay, không hỏi. Cùng setting `audioEnabled` với Cài đặt → Âm thanh nên hai nơi luôn khớp.
  Quy tắc mới (CLAUDE.md): **mọi đường BẬT giai điệu phải qua `MelodyConfirmDialog`**, không thêm đường bật nào khác.
  Không khóa khi bài rỗng (là một setting). Space theo D-345 (bấm chuột rồi Space = phát / dừng; Tab tới nút thì Space
  bấm nút); không thêm phím tắt. Phím tắt + lệnh `dfht:command` tạm nghỉ khi hộp đang mở (`dialogOpen`). Overlay, trang
  mini, Cửa sổ nổi không render TransportBar → vẫn im lặng.
- **D-393 — Hộp cảnh báo + logic dùng chung `src/ui/MelodyConfirm.tsx`:** `MelodyConfirmDialog` (tiêu đề / chữ / nút /
  `.settings-warning` như cũ, focus đầu = Hủy) + `useMelodyToggle(apply?)` (bật → mở hộp, không hỏi lại nếu đã bật ở
  tab khác; tắt → ngay). SettingsView dùng `apply` mặc định (ghi settings — hành vi + test không đổi); PlayerView
  truyền `engine.setAudioEnabled` để chính cú bấm "Tôi hiểu, bật" mở khóa AudioContext khi bài đang chạy (hàm đó vẫn
  ghi `settings.audioEnabled` — một nguồn sự thật). TransportBar chỉ nhận prop (`onSound`; không có prop = không nút).
- **D-394 — Giao diện nút loa:** icon SVG inline như các nút khác (loa + dấu × / loa + 2 sóng), không dùng emoji. Đang
  bật = đỏ (`--danger` viền / chữ trên `--danger-bg`) như huy hiệu "Đang phát giai điệu" để nhắc nguy cơ bản quyền,
  thay vì nền accent của nút bật / tắt thường; luật nằm trong `@media (forced-colors: none)` nên tương phản cao giữ kiểu
  Highlight chung. CSS riêng `src/player/TransportBar.css`. Màn 721–1080 px: thanh trượt Tempo / Lookahead 92 → 76 px để
  thanh điều khiển vẫn một hàng từ ~1015 px; điện thoại vốn xuống dòng (844×390 không đổi, 390×844 cao thêm 3 px).
  `player.melodyBadgeHint` nhắc thêm nút loa (vẫn chứa "Cài đặt → Âm thanh").

### B. Trang mini Android "Khớp nút game"

- **D-395 — Hai bố cục trang mini, mặc định "Khớp nút game"** (mặc định theo kiểu điều khiển từ D-402): cửa sổ nổi Android ĐỤC nên không đặt đè lên nút được →
  người chơi đặt nó ngay TRÊN bảng nút kèn: 8 làn rơi thẳng 8 nút số thật, hit line = mép dưới cửa sổ, vòng "CHẠM" đáp
  sát mép dưới ở cột nút chế độ thật (nút thật nằm ngay dưới). Không bàn nút / game bar riêng; nhãn làn nhỏ, mờ ở đỉnh
  (`MiniFitLabels`). "Thu nhỏ" = trang mini cũ (MobilePad / game bar), không đổi. Lựa chọn nhớ ở localStorage
  `dfht-mini-layout` (nhóm 2 nút `aria-pressed` trong bảng lúc dừng). Đếm ngược tối thiểu 3 s, nút "◂", wake lock và
  cả hai kiểu điều khiển như cũ; trang mini vẫn luôn im lặng (OverlayEngine). e2e cũ cần bàn nút đặt sẵn "Thu nhỏ".
- **D-396 — Renderer `lanePadding: 'fit'` + `laneFit`** (layout.ts `LaneFit`, `fitGeometry(w, h, fit)`, `Layout.fit`):
  một hàm thuần cho cả canvas lẫn vạch DOM nên hai bên luôn trùng. Lane rộng đúng một bước cột `s`, tâm nội suy đều giữa
  tâm nút 1 và nút 1̇ (được tràn mép; `laneArea` cắt theo khung); tile rộng 0,69 s; không gutter / lề nhãn / bàn nút;
  hit line ở H − 2 (bỏ qua `hitLinePos`); `cueTargets` = cột 4 nút chế độ, Ø 0,60 s (≥ 12 px, trần 0,42 × H), tâm đặt
  sao cho mép dưới vòng cách hit line 1 px; `targets: true` → 4 vòng đích mờ vẽ trên canvas tile (không lớp cue, không
  clip). Chỉ hướng dọc; ngang = 'none'. `laneFit` nằm trong LAYOUT_KEYS, giá trị bằng nhau giữ identity (không dựng
  lại layout). Các chế độ cũ có `fit: null`, không đổi.
- **D-397 — Số đo bảng nút mobile** (ảnh 1371 × 633, ±2 px; docs/GAME-UI-REFERENCE.md mục "Bản mobile — số đo bảng
  nút"): `GAME_MODE_COLUMNS` = 1,947 / 3,182 / 4,098 / 5,025 bước tính từ tâm nút 1 (Nửa Cung, Ngẩng Lên, Ngẩng Tự
  Nhiên, Cúi Xuống = MOBILE_BUTTONS); `DEFAULT_LANE_FIT` first 0,0443 / last 0,9563 (cửa sổ kéo đúng mép ngoài hàng nút,
  205 → 1165 px); `FIT_NOTE_DISC_RATIO` 0,69, `FIT_MODE_DISC_RATIO` 0,60, `FIT_MODE_MAX_HEIGHT` 0,42 và
  `FIT_HIT_INSET` = 2 px. Chỉ có một ảnh, một tỉ lệ màn (≈ 19,5 : 9) — máy / UI scale khác dựa vào Căn chỉnh.
- **D-398 — Căn chỉnh + hướng dẫn kéo cửa sổ** (bố trí bảng + bước − / + thay bởi D-399, D-400): chỉ ở "Khớp nút
  game", chỉ khi đang dừng, thay bảng ▶: 8 vạch (số /
  phím), 4 vòng màu chế độ đúng chỗ vòng đáp (chỉ kiểu Mobile; tên ẩn khi Ø < 40 px), vạch mép dưới. Thanh trượt + nút
  − / + (dùng được bằng bàn phím, chỉnh tinh trên cảm ứng — thay cho hai tay nắm kéo): Nút 1 (−0,2…0,35 bề ngang, bước
  0,0001, −/+ 0,001 ≈ 1 px ở 960), Nút 1̇ (0,65…1,2), Hàng chế độ: dời (±1 cột, −/+ 0,02), giãn (0,7…1,3 quanh Ngẩng Tự
  Nhiên — khe Nửa Cung giãn theo); 1̇ luôn cách 1 ≥ 0,3 bề ngang. Kiểu PC chỉ có hai thanh đầu. Lưu
  `dfht-mini-calibration` (try/catch, lỗi → nhớ trong phiên); bằng mặc định thì xóa khóa ("Đặt lại mặc định"). Đang
  căn: lớp chạm khóa, Space / R không chạy bài (chạm nhầm lúc kéo cửa sổ), Esc / "Xong" thoát, focus vào thanh đầu /
  về nút "Căn chỉnh". ⓘ của Căn chỉnh mở MiniHelp `section="fit"`: phần "Đặt cửa sổ khớp nút game" theo hãng (Samsung
  pop-up, Xiaomi / HyperOS, hãng khác — cùng markup VendorStep) lên đầu; ⓘ thường giữ phần mở cửa sổ trước. Component ở
  `src/mini/MiniCalibrate.tsx` (không đặt `MiniAlign.tsx`: Windows không phân biệt hoa thường, trùng `miniAlign.ts`).

### Gộp + kiểm (lead)

- e2e mới `e2e/predeploy.spec.ts`: A (PC, bàn phím, kiểu Mobile 844×390 / 390×844) và B (960×300: Căn chỉnh khác mặc
  định → tải lại vẫn giữ → trên canvas mọi ô thẳng tâm vạch đã chỉnh, 4 vòng đích đúng cột và sát mép dưới; chạy bài
  `?delay=0` → vòng Ngẩng Lên rơi trong cột đã chỉnh, không xuống dưới chỗ đáp, đáp ≈ 5,25 s = beat 7; kiểu PC chỉ 2
  thanh trượt, không vòng; "Thu nhỏ" vẫn chạy). Số đo mặc định so với ảnh game: e2e/mini.spec.ts (960×300, 720×240).

### Sửa sau review (2026-10-16)

Hai bản review (UX + correctness) đo trang mini ở cỡ cửa sổ nổi THẬT: bảng nút kèn của game bắt đầu ở 0,327 H nên cửa sổ
đặt trên nó chỉ cao ~80–150 px CSS (màn ngang 780 × 360 → ≤ 118 px, 915 × 412 → ≤ 135 px, chưa trừ thanh của cửa sổ
nổi) và rộng 0,70 W (~546–640 px) — QA cũ chạy 960×300 / 720×240 / 360×360, không cỡ nào đặt vừa trên bảng nút.

- **D-399 — Bảng Căn chỉnh cho cỡ cửa sổ nổi thật** (thay phần bố trí của D-398): bảng cũ (4 thanh trượt, cao 83–128
  px) cao hơn cả cửa sổ, nút của hàng chế độ ra ngoài khung, che vạch / vòng. Bảng mới chỉnh MỘT số mỗi lúc: nhóm nút
  chọn `aria-pressed` [Nút 1 | Nút 1̇ | Dời | Giãn] (PC: 2 nút; tooltip = tên đầy đủ) + − / thanh trượt / giá trị / + của
  số đang chọn + ⓘ / Đặt lại / Xong. Cao ≤ 220 px: một hàng ~36 px ở đỉnh, nền gần trong suốt, không tiêu đề / lời
  nhắc (tên đầy đủ là nhãn của thanh trượt và của nút − / +); rộng < 620 px thì bỏ thanh trượt (chỉ − giá trị +);
  < 470 px hai hàng, < 380 px ba hàng. Cửa sổ cao: thêm tiêu đề + lời nhắc. Mở Căn chỉnh → focus nút chọn đầu (luôn
  thấy, kể cả khi thanh trượt bị ẩn). Nhãn số của vạch đặt ngay trên hàng vòng và chỉ hiện khi còn chỗ dưới đáy bảng
  (`guideKeyTop`; đáy bảng đo bằng ResizeObserver) — không bao giờ nằm sau bảng. Chữ ngắn trên nút ("Đặt lại", "Video
  nổi", "Khớp nút") luôn nằm trong `aria-label` = chữ dài (WCAG 2.5.3). Hộp thoại ở khung cao ≤ 240 px phủ cả khung, đầu
  gọn (app.css) — thân ⓘ ở cửa sổ 80–130 px từ 32 px lên ~65–95 px, cuộn được.
- **D-400 — Nút − / + theo px, giữ để lặp:** mỗi chạm dời 1 px CSS của khung (Nút 1 / 1̇: 1 / bề ngang; dời: 1 / bước
  cột; giãn: vòng xa nhất — Nửa Cung — dời 1 px; `nudgeCalibration(c, field, dir, widthPx, px)`); giữ 400 ms thì lặp mỗi
  80 ms, từ lần thứ 7 mỗi lần 5 px; nhả / trượt ra / pointercancel thì dừng và click ngay sau lần giữ bị bỏ; chạm /
  Enter / Space / TalkBack = đúng một bước (qua `click`). Độ phân giải lưu 0,0001 bề ngang (Nút 1 / 1̇) và 0,001 (dời /
  giãn); bước thanh trượt 0,001 bề ngang (≈ 0,6 px ở 620 px — phím mũi tên chỉnh tinh) / 0,01. Nút − / + ≥ 34 × 30 px ở
  cửa sổ thấp, 40 × 36 px ở cửa sổ cao; `touch-action: none` + chặn menu ngữ cảnh khi giữ. Giá trị giãn hiện 1 chữ số
  thập phân (một chạm ≈ 0,4–0,6 %).
- **D-401 — Panel ▶ (lúc dừng) theo cỡ cửa sổ:** cao ≤ 220 px: lưới với hàng cao theo nội dung, dư chỗ thì giãn đều
  (trước đó hàng giữa `minmax(0, 1fr)` co lại → ▶ đè lên hàng bố cục); rộng < 480 px: mỗi thứ một hàng. Cao ≤ 130 px: 2
  hàng [◂ huy hiệu tên … ⓘ (+ Đổi sang Mobile)] và [▶ (+ ↺) | Khớp nút · Thu nhỏ | Căn chỉnh | Video nổi], chữ ngắn,
  nền đều; dòng "Tạm dừng" / "Hết bài" bỏ dưới 180 px cao (chữ trên ▶ đã nói "Chạy tiếp" / "Chơi lại"). e2e/mini.spec.ts
  kiểm 546×90, 546×119, 624×100, 640×80 (vi + en, cả Căn chỉnh từng số + hộp ⓘ) và 300×150, 300×200, 360×200, 480×100
  (cả hai bố cục, lúc dừng + tạm dừng): không control nào ra ngoài cửa sổ, chồng nhau hay bị phần tử khác che; bảng
  Căn chỉnh không che hàng vòng / mép dưới.
- **D-402 — Bố cục mặc định theo kiểu điều khiển + nhắc đổi sang Mobile** (ghi đè "mặc định Khớp nút game" của D-395):
  máy chưa chọn bố cục → Mobile = "Khớp nút game", PC = "Thu nhỏ" (trang mini cũ có game bar — bản PC của game không có
  nút trên màn hình để khớp; `defaultMiniLayout`); lựa chọn đã lưu thắng. Cài đặt mặc định là PC mà trang mini là cho
  điện thoại → kiểu PC thì panel lúc dừng có "Chơi bản điện thoại? [Đổi sang Mobile]" (ghi `settings.controlScheme`
  như nút PC | Mobile của màn chơi; cửa sổ thấp chỉ còn nút, câu giải thích ở tooltip). Đổi xong, máy chưa chọn bố cục
  thì vào thẳng "Khớp nút game". Không ép kiểu Mobile trong "Khớp nút game" (yêu cầu: bố cục chạy với nhãn của cả hai
  kiểu); người dùng PC cố ý (điện thoại làm màn phụ cho bản PC) bỏ qua dòng nhắc là được.
- **D-403 — Không banner chế độ ở "Khớp nút game" kiểu Mobile:** banner "CHẾ ĐỘ: … · Nửa Cung: …" (luôn hiện ở kiểu
  Mobile, nền đặc, z-index trên canvas) nằm ngang đường rơi của vòng Ngẩng Lên / Ngẩng Tự Nhiên — ở cửa sổ ~100 px che
  ~21 % chiều cao làn. Vòng `CHẠM` + nút thật của game (nút đang chọn sáng viền) đã cho biết chế độ, chủ dự án muốn nhãn
  nhỏ không vướng → bỏ. Kiểu PC giữ banner "ĐANG GIỮ: …" (chỉ hiện lúc giữ, PC không có vòng); "Thu nhỏ" giữ như cũ.
- **D-404 — Bật giai điệu trong lúc đếm ngược mở khóa âm thanh ngay trong cú bấm:** `setAudioEnabled(true)` gọi
  `ensureAudio(true)` khi đang trong một lượt phát — đang phát, đang đếm ngược, đang chờ unlock hay đang chờ bấm (luyện
  tập) — chứ không chỉ khi transport chạy. Trước đó: bấm Phát rồi bật bằng nút loa trong 3 s đếm ngược thì unlock dời
  tới `start()` chạy từ hẹn giờ, không còn user activation → Safari / iOS chặn (toast lỗi, chạy câm, hình có thể trễ tới
  `UNLOCK_TIMEOUT_MS`). Đứng yên thì vẫn không mở khóa (lần Phát sau tự mở trong cú bấm của nó). Test:
  `usePlayerEngine.test.tsx` "D-404".
- **Không sửa (ghi lại để chủ dự án quyết):** (1) vòng `CHẠM` / vòng đích ở cột Nửa Cung, Ngẩng Tự Nhiên, Cúi Xuống đáp
  trùng chỗ ô lane 3 / 5 / 6 ở mép dưới — mép dưới cửa sổ thay cho cả hàng chế độ lẫn hàng nút số, đúng số đo; xem trên
  máy thật rồi mới chọn (nâng vòng ~0,15 bước, hoặc ô ở 4 cột đó mảnh / mờ hơn gần mép). (2) Nút loa giữ tên đổi theo
  trạng thái + `aria-pressed` như chủ dự án yêu cầu (D-392); WAI-ARIA khuyên tên cố định — chỉ đổi nếu chủ dự án đồng
  ý.

### B6–B7. Trang mini: đúng tỉ lệ thật + chiều cao (chủ dự án, sau review)

Chủ dự án: "để user chỉ cần kéo qua, hạn chế phải căn chỉnh trừ khi cần" và "vụ căn chỉnh có cả độ dài nữa, để cho độ
dài chạm rìa trên màn hình luôn".

- **D-405 — Đúng tỉ lệ thật bằng `LaneFit.stepPx` / `shiftPx`:** trang không đặt được cỡ cửa sổ nổi nhưng đọc được cỡ
  màn hình. `trueScaleOf(screen, viewW)` (miniAlign.ts) dùng `window.screen` khi: hai số dương và hữu hạn, màn NGANG
  (`screen.orientation.type`, không có thì width > height; trình duyệt báo cỡ dọc mà orientation nói ngang thì cạnh
  dài là W), bề ngang trang ≤ `SCREEN_CLEAR_RATIO` 0,95 × cạnh dài (không thì trang đang chiếm cả màn). Khi đó bước
  cột = `GAME_NOTE_STEP_W` 0,0912 × W × "Bước" (`stepScale`, mặc định 1, 0,5…2) px CSS, hàng nút căn giữa khung cộng
  "Ngang" (`shift`, px, ±400); `fitGeometry` bỏ qua first / last khi có `stepPx`. Renderer tính lại từ cỡ canvas của
  chính nó nên khoảng cách giữ nguyên trong lúc kéo giãn cửa sổ (không vòng qua React). Không có `stepPx` thì y hệt
  trước (`isLaneFit` / `sameLaneFit` / `sanitizeLaneFit` nhận hai trường mới). Không dùng được cỡ màn: kiểu cũ
  "cửa sổ = hàng nút" (Nút 1 / Nút 1̇, không chỉ báo). Căn chỉnh ở đúng tỉ lệ thật: [Ngang | Bước | Dời | Giãn]
  (PC: Ngang | Bước), − / + 1 px ("Bước": lane ngoài cùng dời 1 px), cùng khóa `dfht-mini-calibration` (bản lưu cũ thiếu trường thì
  lấy mặc định; "Đặt lại mặc định" xóa hết). Hằng số `GAME_NOTE_STEP_W`, `GAME_PANEL_TOP_H` 0,327, `NOTE_ROW_STEPS`
  7,69 ở miniAlign.ts; số đo ở docs/GAME-UI-REFERENCE.md "Đúng tỉ lệ thật". Giả định chưa kiểm trên máy thật: Chrome
  trong cửa sổ nổi báo `screen` = cả màn hình, hãng không thu nhỏ trang (HyperOS có thể — "Bước").
- **D-406 — Chỉ báo "Rộng" / "Cao", làn phủ cả chiều cao:** `fitStatusOf` (`MiniFitStatus`, `role=status` chỉ đọc
  trạng thái — không đọc lại mỗi px khi kéo). Rộng cần `NOTE_ROW_STEPS × bước + 2 × |Ngang|` (≈ 0,70 W): hẹp hơn quá
  0,15 bước là "Hẹp quá — kéo giãn thêm", rộng hơn quá 0,6 bước là "Rộng hơn cần thiết", còn lại "Rộng: vừa". Cao: cả
  cửa sổ (trang cộng `outerHeight − innerHeight` khi 0 < d ≤ 0,25 H) so với `GAME_PANEL_TOP_H × H` (mép trên màn tới
  mép trên khung kèn): cao hơn quá max(4 px, 1 % H) là "Cao quá — đang che khung kèn"; thấp hơn quá 36 px
  (`FLOAT_BAR_MAX` — thanh kéo của cửa sổ nổi, trang không đo được) cộng sai số là "Thấp quá — kéo mép trên lên chạm mép
  màn hình"; còn lại "Cao: vừa". Chỗ đặt: panel lúc dừng — hai chip ở hàng đầu ngay trước ⓘ (tên bài co lại, dưới 420
  px rộng thì xuống hàng riêng); bảng Căn chỉnh — hàng cuối riêng, chỉ khi có chỉ báo (bảng cũ không đổi), cửa sổ thấp
  12 px không viền, chữ 9 px dưới 95 px cao để bảng vẫn ở trên hàng vòng; dưới 760 px rộng dùng chữ ngắn; dòng số px
  chỉ ở panel lúc dừng khi cửa sổ cao hơn 220 px (tooltip luôn có số). Màu: vừa = `--success`, cần làm = `--warn`,
  rộng hơn cần = `--text-muted`, không accent. Làn và hit line vẫn phủ cả chiều cao trang (hit line = mép dưới) — cửa
  sổ cao tới mép màn là làn dài nhất. Trợ giúp (`mini.help.fitIntro`, `mini.align.helpScale` / `helpScalePc`, ghi chú
  Xiaomi "Bước", hãng khác "Ngang" / "Bước") vi + en. e2e: mini.spec.ts (màn 915 × 412 / 780 × 360 / 800 × 360 qua
  `screen` của Playwright, đổi cỡ bằng CDP mà giữ cỡ màn), predeploy.spec.ts (màn 1371 × 633 = ảnh game, cửa sổ 960 ×
  300 đặt giữa: vạch / vòng trùng tâm nút của ảnh ±1,5 px, vòng "CHẠM" đáp sát mép dưới ở cột Ngẩng Lên, "Cao quá",
  kéo thấp còn 960 × 200 thì "Cao: vừa"). Sửa kèm một kỳ vọng e2e cũ phụ thuộc tốc độ máy (bước cột đo trước lần
  giữ-để-lặp).

### C. Cửa sổ nổi PC — cỡ chuẩn theo màn hình

Trước đó `pipPrefs.ts` chỉ có hai preset (1080p: 576 × 600, 1440p: 768 × 800, chia dpr): màn 768p / 900p / 1200p / 4K
nhận cỡ 1080p và 8 cột lệch 8 phím; chiều cao không tới mép trên màn hình.

- **D-407 — Cỡ chuẩn theo chiều cao màn hình thật:** giả định UI game phóng theo CHIỀU CAO (`k = cao px thật / 1080` —
  quy tắc DPI "cạnh ngắn" mặc định của Unreal Engine); px CSS: `k / dpr = screen.height / 1080`. Rộng =
  `round(520·k/dpr)` (8 làn × bước phím 65·k) cộng `round(56 · tileScale)` với tileScale = k/dpr kẹp 0,5…3 — 8 làn
  đúng bề ngang 8 phím kể cả khi tileScale bị kẹp (768p @150 %). Cao NGOÀI = `750·k/dpr` (đáy source overlay khớp game
  y = 750 = mép trên bảng phím): mép dưới đặt trên bảng phím thì mép trên chạm mép trên màn hình; cao trong
  (`requestWindow`) = cao ngoài trừ thanh tiêu đề. Ô / làn rộng như cũ, chỉ đường rơi dài ra (hit line 0,97 H). 16:10
  theo chiều cao (1920 × 1200: k = 1,11) — nếu game thật giữ khung 16:9 theo bề ngang thì 8 cột rộng hơn phím ~11 %,
  người dùng kéo giãn (nhớ theo màn); ultrawide như 16:9 cùng chiều cao. Bảng 768p … 2160p và giả định ở
  docs/GAME-UI-REFERENCE.md "Cửa sổ nổi PC — cỡ theo màn hình". Unit test 768p / 900p / 1080p / 1200p / 1440p / 2160p ×
  dpr 1 / 1,25 / 1,5 bằng chính `computeLayout`.
- **D-408 — Thanh tiêu đề đo rồi nhớ, chỉnh khi trình duyệt cho:** chưa mở thì không biết thanh tiêu đề, lần đầu đoán
  `PIP_CHROME_GUESS` 34 px CSS. Mở xong đo `outerHeight − innerHeight`, nhớ ở `dfht-pip-chrome` (0…120); cao ngoài lệch
  quá 2 px và cửa sổ PiP còn `navigator.userActivation.isActive` thì `resizeTo(outerWidth, mục tiêu)` ngay; không có
  activation thì bỏ qua (tránh lỗi "requires user activation" trên console), lần mở sau dùng số đo. Chưa đo được lúc
  mount thì thử lại một lần sau 300 ms; resize nào cũng đo lại. Trình duyệt có thể giới hạn cỡ tối đa của PiP (ghi ở
  tài liệu).
- **D-409 — Cỡ đã nhớ gắn với màn hình:** `dfht-pip-size` = `{ width, height, screen: { width, height, dpr } }`, chỉ
  dùng lại khi px thật rộng / cao và dpr đều trùng (đổi tỉ lệ Windows = màn khác). Bản lưu vòng 7 không có `screen` bị
  bỏ qua — cố ý, để 576 × 600 cũ của chủ dự án không chặn cỡ chuẩn mới cao tới mép màn. Kéo về đúng cỡ chuẩn (hoặc cỡ
  đã xin khi mở) thì xóa khóa thay vì lưu, lần sau tính lại với thanh tiêu đề đã đo.
- **D-410 — Nút "Đặt lại cỡ chuẩn" trên thanh nhỏ của cửa sổ nổi** (sau "Căn chỉnh", tooltip `pip.resetSizeHint`):
  `resetToStandardSize(hostWindow)` quên cỡ đã nhớ, đo thanh tiêu đề, `resizeTo` (không có thì `resizeBy`) cỡ ngoài
  chuẩn của màn hình ĐANG chứa cửa sổ nổi — trong cú bấm nên trình duyệt cho. Không có API hoặc sau 400 ms cỡ trong
  chưa khớp ±3 px: dòng `role="alert"` `pip.resetSizeBlocked` ("đóng rồi mở lại"), tự ẩn sau 8 s; timer của cửa sổ
  nổi, dọn khi gỡ. Giới hạn đã biết: tileScale (gutter) tính một lần lúc mount — kéo cửa sổ nổi sang màn khác chiều cao
  rồi "Đặt lại" thì cỡ đúng nhưng gutter theo màn cũ tới khi mở lại (mở từ tab màn chơi ở màn đó là đúng).
- **D-411 — Gộp + kiểm (lead):** e2e riêng `e2e/pip-size.spec.ts` (không gộp vào predeploy.spec.ts vì B đang sửa file
  đó song song): cỡ app xin ở màn 1600 × 900 headless, bản lưu cũ bị bỏ qua, "Đặt lại cỡ chuẩn" (đổi được thì khớp,
  không thì dòng nhắc), cỡ đã kéo dùng lại đúng màn / không dùng ở màn khác; thêm màn giả lập (`screen` +
  `deviceScaleFactor`): 900p @100 % xin 480 × 591, 2160p @150 % xin 768 × 966, 2160p @100 % xin 1152 × 1466 (thanh
  tiêu đề đoán 34, cao ngoài 625 / 1000 / 1500 = 750·k px thật), trong cửa sổ nổi 8 cột Căn chỉnh rộng đúng
  `65·k/dpr` px CSS. Edge headless giả viewport của trang PiP nên cỡ thật sau `resizeTo` và thanh tiêu đề thật chỉ
  kiểm được trên Chrome / Edge của chủ dự án (checklist Phần 1 mục 10). Tài liệu: README (cỡ chuẩn + "Đặt lại cỡ
  chuẩn"; các bước đặt trang mini theo chỉ báo Rộng / Cao), REFERENCE, LOCAL-TEST-CHECKLIST, CHANGELOG, SPEC, CLAUDE.md.

### Sửa sau review 2 của bổ sung trước deploy (2026-10-17)

Review 2 (UX + đúng / sai) trên bản gộp D-405 – D-411: Căn chỉnh khó hiểu ở cỡ cửa sổ nổi thật, chỉ báo "Cao" / "Rộng"
mâu thuẫn với lời hướng dẫn, đúng tỉ lệ thật bật nhầm trên máy tính, hai mô hình tỉ lệ khác nhau cho hai chiều, huy hiệu
giai điệu đẩy trang điện thoại xuống, Cửa sổ nổi PC bị Chrome thu nhỏ ở màn 4:3 / 5:4. D-412 – D-419 ghi đè phần tương
ứng của D-405, D-406, D-408 – D-410.

- **D-412 — Đúng tỉ lệ thật chỉ trên máy Android cảm ứng** (ghi đè điều kiện của D-405): `trueScaleOf(screen, viewW,
androidTouch)`; `isAndroidTouch()` (miniAlign.ts) = UA có "Android" hoặc `navigator.userAgentData.platform` là
  Android, kèm `isTouchDevice` (điểm chạm / con trỏ thô — padPrefs.ts); MiniView đọc một lần lúc mount. Trước đó cửa sổ
  trình duyệt máy tính không phóng to (1280 × 720 trên màn 1920 × 1080) cũng qua điều kiện "trang ≤ 0,95 cạnh dài" →
  lane 175 px, chỉ báo "Hẹp quá / Cao quá" cho một cửa sổ không nằm trên game nào — chủ dự án thử trên PC trước nên
  thấy ngay. iPhone ngang (Safari thụt lề vùng tai thỏ, trang ≈ 0,89 × màn) cũng vậy, mà trang mini trên iPhone chỉ là
  chỗ mở Video nổi. Android bật "Trang web cho máy tính" (UA desktop) → kiểu "cửa sổ = hàng nút" như máy không báo cỡ
  màn. Test: unit 1280 × 720 / 1920 × 1080, iPhone 812 × 375 / trang 724, `isAndroidTouch` các UA; MiniView máy tính
  không `data-scale`; e2e mini.spec.ts máy tính 1280 × 720 (không chỉ báo, lane trải theo cửa sổ). e2e đúng tỉ lệ thật
  thêm `userAgent` Chrome Android.
- **D-413 — Một đơn vị cho hai chiều: UI game phóng theo chiều cao màn** (ghi đè "bước = 0,0912 × bề ngang" của D-405):
  trước đó bước cột theo bề ngang (`0,0912 W`) mà chiều cao theo `H` (`0,327 H`) — hai mô hình khác nhau cho cùng một
  UI; ở 20 : 9 (800 × 360) lane ngoài cùng lệch ≈ 6,5 px, 21 : 9 (840 × 360) ≈ 19 px (27 % một bước) — đúng chỗ "phải
  căn chỉnh" chủ dự án muốn tránh. Nay `refH = min(H, W / GAME_REF_ASPECT)` (2,166 = 1371 / 633, ảnh game) và mọi số
  theo `refH`: bước `GAME_NOTE_STEP_H` = 0,0912 × 2,166 ≈ 0,1975 × refH; mép trên khung kèn `panelTop = H − (1 − 0,327)
refH`, đỉnh nút chế độ `modeTop = H − (1 − 0,361) refH` (bảng nút bám đáy màn). Mọi điện thoại ≥ 19,5 : 9 → `refH =
H`: UI theo chiều cao, cùng giả định "cạnh ngắn" (DPI mặc định của Unreal Engine) với Cửa sổ nổi PC (D-407), số
  theo `H` y như ảnh; màn hẹp hơn (16 : 9, máy tính bảng ngang) → theo bề ngang để hàng nút luôn nằm trọn trong màn
  (chỉ theo chiều cao thì máy tính bảng 4 : 3 có hàng nút rộng hơn màn). Ở màn đúng tỉ lệ ảnh (1371 × 633) bước giữ
  nguyên 125,035 px. Chưa có ảnh thứ hai để kiểm — checklist Phần 4 mục 3 nhờ ghi tỉ lệ màn + số "Vạch · Giãn" phải
  chỉnh.
- **D-414 — "Cao: vừa" = mép dưới từ mép trên khung kèn tới đỉnh hàng nút chế độ** (ghi đè phần "Cao" của D-406): mục
  tiêu của chủ dự án là mép trên khung kèn (`0,327 H` — làn dài nhất), giới hạn là đỉnh nút chế độ (`GAME_MODE_TOP_H`
  0,361 = tâm 0,420 − Ø 75 / 633 / 2): che nút chế độ thì chạm vào game không tới nút. Thanh kéo / tiêu đề của cửa sổ
  nổi do hãng vẽ, trang không đo được: "Cao quá" tính với thanh thường gặp `FLOAT_BAR_GUESS` 24 px (trang + phần
  trình duyệt + 24 > `modeTop` + sai số `max(4 px, 1 % H)`), "Thấp quá" với thanh lớn nhất `FLOAT_BAR_MAX` 36 px (trang
  - 36 < `panelTop` − sai số). Trước đó "cao quá" không trừ thanh: hãng có thanh 24 px mà mép dưới đã che 15 px nút
    chế độ vẫn "Cao: vừa"; còn làm đúng lời hướng dẫn (mép dưới sát trên nút chế độ, không thanh) lại "Cao quá". Không
    biết thanh thì không chỉ báo nào đúng cho mọi hãng (khoảng `panelTop … modeTop` chỉ 12 px ở màn 360 px cao, thanh 0 …
    36 px) — chọn lệch về phía không che nút (che nút hỏng việc chạm; thiếu vài px chỉ ngắn làn): hãng có thanh đè lên
    trang thì "vừa" khi mép dưới cách khung kèn ≤ ~8 px. Lời hướng dẫn thống nhất một mục tiêu và để chỉ báo quyết:
    "mép dưới ngay trên khung kèn, không che hàng nút chế độ — kéo tới khi chỉ báo ghi vừa" (`mini.align.help*`,
    `mini.help.fitIntro`, README, REFERENCE, checklist). `needHeight` (số "cần ≈" ở tooltip) = `panelTop − 24`.
    Checklist nhờ ghi thanh kéo của hãng cao chừng nào và mép dưới thật ở đâu khi "Cao: vừa" — chỉnh hằng số sau lần thử
    máy thật đầu tiên.
- **D-415 — "Rộng" không cộng "Vạch · Dời"; hàng lệch ra ngoài mép → "Lệch tâm"** (ghi đè `+ 2 × |Ngang|` của D-406):
  cửa sổ đúng cỡ mà lệch tâm vẫn là đúng cỡ — trước đó chỉnh tinh 10 px (≈ 0,08 bước) đổi cửa sổ vừa khít thành "Hẹp quá
  — kéo giãn thêm" (lời khuyên sai: phải kéo cửa sổ rồi đặt về 0, không phải kéo giãn). Nay Rộng chỉ so với hàng nút
  (`NOTE_ROW_STEPS × bước`); không hẹp mà hàng nút đã dời ra ngoài mép cửa sổ quá 0,15 bước → `moveLeft` / `moveRight`
  "Lệch tâm — kéo cửa sổ sang trái / phải rồi đặt "Vạch · Dời" về 0" (màu cảnh báo như "hẹp quá"). Ở màn ảnh game,
  cửa sổ 960 px: dời ±15 px vẫn "vừa", ±25 px "lệch tâm".
- **D-416 — Căn chỉnh hiểu được ở cỡ cửa sổ nổi thật** (~550–650 × 90–140 px; bổ sung D-399, nhãn ghi đè
  [Ngang | Bước | Dời | Giãn] của D-405): ở cỡ đó tên trường,
  dòng hướng dẫn và (dưới ~620 px) thanh trượt bị ẩn, chỉ còn bốn chữ "Ngang | Bước | Dời | Giãn" (EN "Move | Step |
  Shift | Spacing" — Move / Shift đồng nghĩa), tooltip `title` không hiện khi chạm. Nay: (1) nút chọn ghi **hai dòng**
  — chỉnh CÁI GÌ (`mini.align.groupLines` "Vạch" = 8 vạch nút số, `groupRings` "Vòng" = 4 vòng nút chế độ; 10 px, mờ
  hơn) và THẾ NÀO ("Dời" / "Giãn" / "Nút 1" / "Nút 1̇"; 12–13 px) — tên đọc = chữ trên nút ("Vạch Dời"…), tên đầy đủ
  ("Vạch nút số: dời ngang", "Vòng nút chế độ: giãn khoảng cách"…) ở tooltip, thanh trượt, nút − / +; (2) thứ đang
  chỉnh **sáng lên trên vạch dẫn** (`MiniAlignGuides focus` từ `onActiveField`: vạch 3 px màu nhấn hoặc vòng viền 3 px
  phát sáng; thứ kia mờ 0,4–0,45); (3) chỉ báo Rộng / Cao trong bảng Căn chỉnh chữ 11 px (trước 9–10 px; dưới 95 px cao
  hàng chỉ báo 11 px, bảng sát đỉnh — nút vẫn 30 px — để bảng vẫn trên hàng vòng), chữ dài từ 600 px rộng (hàng riêng), chữ ngắn giữ ý của chữ dài ("Hẹp quá
  — giãn thêm", "Thấp quá — kéo mép trên lên", "Cao quá — che khung kèn"); EN "Too wide" → "Wider than needed" (trạng
  thái trung tính); (4) tên chế độ trong vòng tới Ø `GUIDE_NAME_MIN_D` 30 px (trước 40 — vòng ~38 px của cửa sổ thật
  mất tên, chỉ còn màu mà nút thật của game không có màu), chữ ≥ 10 px xuống dòng theo từ; (5) ⓘ của Căn chỉnh mở bằng
  đoạn `mini.help.fit.controls` (từng nút chỉnh gì + chỉ báo Cao đã trừ thanh kéo + "cửa sổ thấp quá để đọc thì tạm kéo
  cao hơn") — dòng đọc được ngay ở khung cuộn ~60 px. Không đổi khóa lưu / trường số.
- **D-417 — Huy hiệu giai điệu gọn ở màn hẹp / thấp:** bật giai điệu bằng nút loa trên điện thoại làm huy hiệu "🔊
  Đang phát giai điệu" đẩy EN / ☀ xuống hàng mới → cả trang (nút loa, canvas, bàn nút) tụt 22–29 px ngay sau cú chạm;
  390 × 844 bắt đầu phải cuộn. Nay ở header Player khi `(max-width: 900px), (max-height: 520px)` huy hiệu chỉ còn ô đỏ
  "[🔊]" (`.melody-badge-icon`), chữ đầy đủ vẫn là tên đọc (sr-only) + tooltip; màn rộng như cũ; Cửa sổ nổi không đổi.
  e2e predeploy 844 × 390 / 390 × 844: vị trí nút loa trên trang và chiều cao trang y nguyên khi bật / tắt.
- **D-418 — Trần 25 % diện tích màn của Chrome cho cỡ PiP trang tự xin** (bổ sung D-407, D-408): Chromium
  `kMaxSiteRequestedWindowSizeRatio` = 0,25 — cỡ TRONG `requestWindow` có diện tích quá 25 % `display.size()` bị thu nhỏ
  giữ tỉ lệ (người dùng / `resizeTo` được tới 80 %). 16 : 9 / 16 : 10 / 3 : 2 dưới trần; 4 : 3 / 5 : 4 vượt (1280 × 1024:
  546 × 677 = 28 %) → Chrome mở ~514 × 637, cột 8 lệch phím ~26 px, mỗi lần mở lại. Nay `WindowPlan` = `kind` +
  `target` (cỡ muốn có) + `size` (cỡ xin = `capRequestSize`: giữ ĐÚNG bề ngang, chiều cao `floor(trần / rộng)`, không
  dưới cỡ tối thiểu); `outerHeight` giữ cao ngoài chuẩn để `fitOuterHeight(win, outer, storage, target.width)` kéo lên
  ngay khi mở — kéo cả bề ngang (+ viền) khi trình duyệt vẫn thu nhỏ; cỡ đã nhớ vượt trần cũng xin đúng bề ngang rồi kéo
  về cao đã nhớ. "Đặt lại cỡ chuẩn" `resizeTo` `target` (đủ cao). Cỡ nào bằng `target` / `size` của cỡ chuẩn đều không
  bị nhớ như cỡ người dùng kéo. Không có activation sau khi mở → cửa sổ thấp hơn chuẩn tới khi bấm "Đặt lại cỡ chuẩn"
  (ghi ở README / REFERENCE / GAME-UI-REFERENCE). Test: unit 1280 × 1024 / 1024 × 768 / 1600 × 1200 / 1400 × 1050 /
  2560 × 2048 @125 % (xin đúng bề ngang, ≤ trần, lane 65·k), 16 : 9 / 16 : 10 / 3 : 2 / 4K không đổi, FloatingWindow
  5 : 4 (xin 546 × 600 → `resizeTo(546, 711)`, không nhớ), e2e pip-size màn 1280 × 1024.
- **D-419 — Chrome nhớ chỗ / cỡ PiP theo tab:** Chrome dùng lại bounds cửa sổ PiP lần trước của tab khi trang xin đúng
  cỡ như lần trước (bỏ qua nếu `preferInitialWindowPlacement`). (1) Cỡ xin đổi một lần (đoán thanh tiêu đề 34 → số đo)
  → lần mở thứ hai cửa sổ hiện ở chỗ mặc định của Chrome một lần: chấp nhận, ghi ở checklist Phần 1 mục 10 /
  REFERENCE. (2) "Đặt lại cỡ chuẩn" bị từ chối → dòng nhắc "đóng rồi mở lại", nhưng mở lại xin đúng cỡ chuẩn như lần
  trước nên Chrome trả lại cỡ người dùng đã kéo — nay `requestInitialPlacementOnce()` (pipPrefs, cờ trong module = theo
  tab như cache của Chrome) khi hiện dòng nhắc, `openFloatingWindow` lấy cờ (`takeInitialPlacement`) và xin
  `preferInitialWindowPlacement: true` đúng một lần (Chrome 130+; bản cũ bỏ qua tùy chọn lạ). Đổi được cỡ thì không đặt
  cờ (giữ chỗ người dùng).
- **D-420 — Kiểm (fixer):** vi + en cho mọi chuỗi mới / đổi; test mới ở miniAlign.test.ts (mô hình D-413 ở 20 : 9 /
  21 : 9 / 16 : 9 / 4 : 3, Android-only, dải "Cao", "Lệch tâm"), MiniView.align.test.tsx (nút hai dòng, `data-focus`,
  "Lệch tâm", máy tính), pipPrefs.test.ts (trần 25 %, `fitOuterHeight` bề ngang, cờ D-419), FloatingWindow.test.tsx,
  FloatingStage.test.tsx; e2e mini.spec.ts / predeploy.spec.ts / pip-size.spec.ts cập nhật theo nhãn + mô hình mới.
- **Không sửa (chủ dự án quyết):** nút loa vẫn vừa đổi tên theo trạng thái ("Bật tiếng giai điệu" / "Tắt tiếng") vừa có
  `aria-pressed` như chủ dự án yêu cầu (D-392) — trình đọc màn hình đọc "Tắt tiếng, đã nhấn" khi giai điệu ĐANG bật
  (dễ hiểu ngược). Hai cách: giữ tên hành động và bỏ `aria-pressed` (trạng thái vẫn ở `aria-describedby`), hoặc giữ
  `aria-pressed` với tên cố định "Giai điệu mẫu" / "Sample melody". Review 2 nhắc lại; chờ chủ dự án chọn. → Đã chọn
  cách 2 (review A11Y-1): D-424.

### Còn mở sau bổ sung trước deploy

- Chưa thử trên Android thật / cửa sổ nổi thật của hãng nào; hướng dẫn kéo / đổi cỡ theo hãng còn chung chung; cỡ tối
  thiểu / tối đa của cửa sổ nổi từng hãng chưa biết (checklist Phần 4 mục 3).
- "Cửa sổ video nổi" mở từ trang mini vẫn vẽ bố cục bàn nút cũ (chưa khớp nút game).
- Cửa sổ rất thấp: nhãn số của vạch ẩn khi không còn chỗ giữa bảng Căn chỉnh và hàng vòng (vạch + vòng vẫn thấy —
  D-399); dưới ~80 px cao panel ▶ hai hàng không còn vừa. Cỡ cửa sổ thật lấy từ phép tính trên ảnh game (0,327 H),
  chưa đo trên máy.
- Kiểu PC ở "Khớp nút game" (người dùng tự chọn — mặc định của PC là "Thu nhỏ", D-402) không có game bar, chỉ banner
  "ĐANG GIỮ: …" — bố cục này dành cho bản mobile của game.
- Theme sáng: 4 vòng đích mờ của "Khớp nút game" (nhất là Ngẩng Tự Nhiên xám) khó thấy — chủ dự án xem.
- Chưa nghe thật cú "Tôi hiểu, bật" lúc bài đang chạy (unit test giả âm thanh; e2e Edge headless chạy không lỗi).
- Đúng tỉ lệ thật (D-405, D-406, D-412 – D-415) chưa thử trên cửa sổ nổi Android thật: `window.screen` có đúng là cả
  màn hình, hãng có thu nhỏ trang, thanh địa chỉ có hiện / `outerHeight` có báo không, thanh kéo của cửa sổ nổi cao
  chừng nào (chỉ báo "Cao" đoán 24 px), UI game có phóng theo chiều cao ở máy 20 : 9 / 21 : 9 (D-413 — mới có một ảnh
  19,5 : 9); vị trí cửa sổ không đọc được (mặc định coi cửa sổ ở giữa màn như hàng nút). Có bước nhảy ở ngưỡng 0,95 W
  giữa hai kiểu (không phải cỡ đặt thật).
- ~~Nút loa: tên đổi theo trạng thái + `aria-pressed` (D-392) — chờ chủ dự án chọn một trong hai cách (D-420).~~ Đã
  sửa: tên cố định + `aria-pressed` (D-424).
- Cửa sổ nổi PC (D-407 – D-410, D-418, D-419): thanh tiêu đề đoán 34 px, việc `resizeTo` ngay sau `requestWindow` có
  được phép không (màn 4:3 / 5:4 cần nó để đủ cao — không thì "Đặt lại cỡ chuẩn") chưa kiểm trên máy thật; giả định
  16:10 / ultrawide chưa kiểm trong game; lần mở thứ hai hiện ở chỗ mặc định của Chrome một lần (D-419).

## Âm thanh trên iPhone / điện thoại (2026-10-17)

Chủ dự án báo (đã xác nhận): iPhone bật tiếng giai điệu bằng nút loa rồi bấm Phát — không có tiếng; gạt nút im lặng bên
hông sang đổ chuông mới nghe. Nguyên nhân: iOS xếp Web Audio của trang web vào phiên "ambient" — nút gạt im lặng tắt
nó, kể cả khi AudioContext đang chạy. Yêu cầu: kêu cả khi gạt im lặng, và soát lại toàn bộ đường âm thanh trên mobile.

- **D-421 — Phiên "playback" khi (và chỉ khi) người dùng muốn nghe** (`src/audio/playbackSession.ts`, AudioEngine
  `unlock({ playback: holder })` / `holdPlayback(holder)` / `releasePlayback(holder)`): trong cú chạm cần tiếng — Phát
  (cả Restart / đếm ngược bắt đầu trong cú bấm), "Tôi hiểu, bật" của nút loa, "Nghe giai điệu mẫu", chạm bàn nút khi
  bật tiếng phản hồi, và cú chạm "thử lại" của D-422 — màn chơi giữ phiên TRƯỚC `resume()`, đồng bộ trong gesture:
  Audio Session API có (`navigator.audioSession`, Safari 16.4+; feature-detect `type` là chuỗi) → `type = 'playback'`;
  không có API mà là máy Apple cảm ứng (iOS cũ) → một `<audio>` không chèn vào trang, `loop`, `muted = false`,
  `volume` ~0 (iOS bỏ qua), `playsinline`, `x-webkit-airplay="deny"`, nguồn = WAV PCM 8 bit im lặng 0,1 s dựng trong
  code (data: URI, cùng sample rate với AudioContext để iOS không đổi tần số phần cứng) → `play()` trong cùng cú chạm
  (phần tử media đưa phiên của cả trang sang "playback"); máy khác (Android, máy tính) → không làm gì. Gọi lại được:
  phần tử bị iOS dừng (sau cuộc gọi) thì phát lại ở cú chạm sau / khi context tự chạy lại. Trả phiên (`type = 'auto'`,
  dừng + bỏ nguồn + `load()`) khi tắt hết tiếng (giai điệu + click, và tiếng phản hồi nếu đang luyện tập —
  `soundWanted`), khi tắt luyện tập mà chỉ còn tiếng phản hồi, khi detach (rời màn chơi / đổi bài), AudioEngine
  `dispose()`. Đếm theo holder (Player chính + Cửa sổ nổi cùng engine singleton): holder cuối mới trả. **Âm thanh tắt
  (mặc định) không đụng tới gì**: không AudioContext, không đặt `type`, không `<audio>`, không listener — unit test +
  e2e `audio-mobile.spec.ts` A. Lý do trả phiên: "playback" không trộn — nhạc của app khác (Apple Music, Spotify) tạm
  dừng trong lúc giữ; README / REFERENCE nói rõ. Cài đặt → Âm thanh KHÔNG giữ phiên (D-423): không có chỗ trả ở đó.
  Các tiếng khác ngoài màn chơi (Nghe thử của Tạo bài từ file, màn Tự chơi để tạo bài) chưa giữ phiên — vẫn theo nút
  gạt (Còn mở). → Đã giữ: D-426.
- **D-422 — Mở khóa bền hơn trên mobile:** `UNLOCK_TIMEOUT_MS` 1000 → 3000 (iOS lần đầu có thể mất hơn 1 s; chỉ lần Play
  đầu chờ tới mức đó — đã thất bại thì hình chạy ngay như cũ, `audioFailed`). `unlock()` coi context chạy khi
  `statechange` → 'running' (không chỉ promise của `resume()`); mỗi lần gọi đều `resume()` và có lượt chờ đầy đủ riêng
  (bỏ promise dùng chung cũ: cú đầu có thể không được tính là gesture — vd. `pointerdown` của ngón tay ở bàn nút trên
  Safari / Chrome — nên cú thả tay sau đó phải được trọn 3 s, không bị cú đầu hết hạn kéo theo; context chạy thì mọi
  lượt cùng xong). 'interrupted' (iOS: cuộc gọi, Siri, app khác chiếm loa) = như 'suspended': về performance clock,
  hình chạy tiếp; chờ context tự chạy lại (gắn lại audio clock, không cần chạm) VÀ gắn listener `pointerup` /
  `touchend` / `click` / `keydown` (capture, passive) trên cửa sổ chủ → cú chạm / phím kế tiếp ở bất cứ đâu thử mở khóa
  lại (+ giữ phiên) trong chính cú đó; gỡ khi gắn được audio, tắt hết tiếng, detach. Listener gắn khi một lần mở khóa
  trong cú chạm còn đang chờ (để cú thả tay của chính lần chạm bàn nút đó thử lại ngay), sau khi thất bại và khi bị
  gián đoạn — không bao giờ lúc tải trang. Câu nhắc khi context vẫn không chạy sau khi mở khóa: MỘT lần mỗi lần tải trang
  (cờ cấp module — đổi bài không nhắc lại; `resetAudioHintForTests`); máy Apple cảm ứng (`isAppleMobile`) →
  `player.audioBlockedToastApple` (tăng âm lượng, tắt chế độ tập trung, gạt nút bên hông sang đổ chuông), máy khác →
  `player.audioBlockedToast`. Bị gián đoạn rồi tự / chạm là chạy lại thì không nhắc; tiếng phản hồi bị chặn chỉ gắn
  listener, không nhắc. → Sửa ở D-426: tiếng phản hồi bị chặn cũng nhắc (một lần); chữ không còn bảo bấm nút loa.
- **D-423 — Mở khóa ngay ở cú bấm bật tiếng (ghi đè phần "đứng yên thì không mở khóa" của D-404):**
  `PlayerEngine.setAudioEnabled(true)` (nút loa → "Tôi hiểu, bật") luôn `ensureAudio(true)` — lúc đứng yên cũng mở
  khóa + giữ phiên, nên lần Phát đầu chạy thẳng trên audio clock, không phải chờ; đang đếm ngược / chờ bấm vẫn như D-404.
  Cài đặt → Âm thanh: "Tôi hiểu, bật" (apply mặc định của `useMelodyToggle`), bật "Tiếng click", bật "Phát tiếng khi
  bấm phím / nốt" gọi `unlockAudioInGesture()` (`src/audio/gestureUnlock.ts` — chỉ `unlock()` AudioContext, không giữ
  phiên; module riêng để các test mock `../audio/engine` không phải khai thêm export). Về màn chơi → context đang chạy →
  gắn audio clock ngay; cú Phát giữ phiên. "Nghe giai điệu mẫu" (luyện tập) bật = cú bấm muốn nghe → `ensureAudio(true)`.
  Đánh đổi: Chromium mở thiết bị âm thanh đồng bộ trong constructor (0,5–1 s, xem `warm()`) — nay có thể rơi vào cú
  bấm "Tôi hiểu, bật" (một lần mỗi trang, hộp thoại đóng chậm một chút) thay vì lần Phát đầu; chấp nhận.
- **D-424 — Nút loa: tên cố định + `aria-pressed` (review A11Y-1, chọn cách 2 của D-420):** tên đọc `player.sound` =
  "Tiếng giai điệu" / "Melody sound" không đổi; `aria-pressed` = giai điệu đang bật; tooltip (`title`) = việc sẽ làm
  (`player.soundOn` "Bật tiếng giai điệu" / `player.soundOff` "Tắt tiếng"); `aria-describedby` câu trạng thái và
  `aria-haspopup` giữ nguyên. Test (TransportBar, PlayerView.sound, layout) + e2e (predeploy A, phase2c,
  audio-mobile B) theo tên mới; README / REFERENCE / checklist nói tooltip.
- **D-425 — Kiểm:** unit — `playbackSession.test.ts` (WAV im lặng, API giả, `<audio>` giả: thuộc tính, gọi lại, bị
  dừng → phát lại, bị từ chối → bỏ, Android / máy tính không làm gì), `engine.test.ts` (3 s, 1,5 s chậm vẫn được,
  statechange muộn, resume lại ở cú chạm sau + cú sau được trọn lượt chờ, 'interrupted', phiên trước `resume()`, holder,
  dispose), `usePlayerEngine.test.tsx` (mặc định không đụng gì; API trong cú Phát trước `resume()`; tắt / detach / hai
  engine; "Tôi hiểu, bật" lúc đứng yên; context chạy sẵn; `<audio>` iOS cũ; Android; mở khóa 1,5 s; 'interrupted' → cú
  chạm kế tiếp; tự chạy lại; câu nhắc một lần + bản iPhone / bản thường; listener gỡ đúng; tiếng phản hồi; chạm bàn nút
  bằng `pointerdown` → `pointerup` của chính cú đó mở khóa, không câu nhắc), `SettingsView` /
  `MelodyConfirm` (mở khóa trong cú bấm, Hủy không tạo gì, không giữ phiên). FakeAudioContext thêm `resumeDelayMs`;
  `src/audio/fakePlaybackEnv.ts` (navigator.audioSession giả, UA, `<audio>` giả). e2e `audio-mobile.spec.ts` (script
  đếm AudioContext / `createOscillator` / `<audio>.play()` + `navigator.audioSession` giả): A mặc định im lặng, B nút
  loa mở khóa ngay + phiên + trả, C UA iPhone không API → `<audio>` im lặng, D Android giả lập cảm ứng 844 × 390 — chạm
  Phát → context 'running', nốt lên lịch; luyện tập + tiếng khi bấm → chạm nút số lên lịch tiếng; không lỗi console.
  Android: âm lượng media quyết định Web Audio — không có chuyện nút gạt.
- **D-426 — Sửa sau kiểm tra (verifier):**
  - **Câu nhắc không bảo bấm nút loa.** Câu nhắc chỉ hiện khi tiếng ĐANG bật — lúc đó nút loa là **Tắt tiếng**: làm theo
    "bấm nút loa lần nữa" là tắt luôn tiếng (cú `pointerup` có thử mở lại, nhưng `click` ngay sau đó tắt giai điệu và
    trả phiên). Listener thử lại nghe cú bấm / chạm / phím ở bất cứ đâu, nên chữ mới: "Bấm hoặc chạm vào trang lần nữa
    để thử lại" / iPhone "Chạm vào màn hình lần nữa để thử lại. Nếu vẫn không nghe: …" (en tương ứng). REFERENCE nói
    rõ đừng bấm nút loa để thử lại.
  - **Tiếng phản hồi bị chặn cũng nhắc (một lần mỗi trang)** — REQUIRED 2 ("context vẫn không chạy sau khi mở khóa →
    nhắc một lần") áp cho mọi tiếng; trước chỉ gắn listener, người chỉ bật tiếng khi bấm lúc luyện tập không biết vì sao
    im. Chỉ nhắc khi lượt chờ kết thúc mà context vẫn không chạy: cú `pointerdown` bị treo rồi `pointerup` của chính cú
    chạm đó mở được thì lượt chờ đầu cũng xong `true` qua `statechange` → không nhắc nhầm. `showAudioHint()` dùng chung
    với `audioBlocked()`.
  - **WAV im lặng: số mẫu chẵn** (làm tròn lên) — khối RIFF cỡ lẻ (vd. 22,05 kHz × 0,1 s = 2205 byte) phải có byte
    đệm; tránh trường hợp bộ giải mã khó tính bỏ file. 44,1 / 48 kHz vốn đã chẵn.
  - **Nghe thử + Tự chơi để tạo bài giữ phiên "playback" (trước là "Còn mở")** — chủ dự án yêu cầu soát mọi đường âm
    thanh trên mobile. `TrackPreviewPlayer.play()` (Nghe thử ở Tạo bài từ file, gọi trong cú bấm) →
    `unlock({ playback: player })`; đổi sang bản khác lúc đang nghe giữ nguyên phiên (không lật 'auto' ↔ 'playback');
    trả khi dừng / hết bản / bị chặn / không có nốt / `engine.stopAll()` / unmount. RecordView (`#/record`): Thu khi bật
    tiếng click hoặc tiếng phản hồi, và bật tiếng phản hồi → `unlock({ playback: holder })`; trả khi dừng thu mà tiếng
    phản hồi tắt, hủy lúc chờ mở khóa, tắt tiếng phản hồi lúc không có click, rời màn. Âm thanh tắt (mặc định) vẫn không
    đụng gì. RecordPanel (Thu melody bằng MIDI) không đổi: Web MIDI không có trên iOS.
  - Kiểm thêm: unit (câu nhắc không có "nút loa", bấm chỗ trống thử lại mà tiếng vẫn bật, tiếng phản hồi bị chặn nhắc
    một lần không spam, WAV 22,05 kHz chẵn, RecordView + TrackPreviewPlayer giữ / trả phiên đúng lúc, `type` đặt trước
    `resume()`); e2e `audio-mobile.spec.ts` E (Tự chơi để tạo bài, UA iPhone + API giả: tải trang không đụng gì, bật /
    tắt tiếng phản hồi, rời màn → 'playback' / 'auto'); Edge headless trên bản build: quét mọi route (màn chơi, Thư viện, Cài đặt, AI, Hướng dẫn, Dev notes,
    Tự chơi, Tạo bài từ file, Editor, mini, overlay) với AudioContext / `createElement('audio')` / `new Audio()` /
    `<audio>.play()` / `navigator.audioSession` / listener thử lại được bọc — 0 lần khi tắt tiếng, kể cả Phát, Luyện
    tập, chạm bàn nút, mở rồi Hủy hộp thoại; mini + overlay im lặng cả khi Cài đặt bật hết tiếng; Android giả lập: chạm
    nút số ĐẦU TIÊN (chưa có user activation nào — CDP không `userGesture`) → context 'running'; ngắt context giữa bài
    (`suspend()`) → hình chạy tiếp, không nốt mới → bấm chỗ trống → chạy lại + nốt mới, vẫn một context.

### Còn mở sau âm thanh iPhone

- **Chưa thử trên iPhone thật** (môi trường phát triển không có): nút gạt im lặng với Audio Session API / phần tử im lặng, iOS có
  hiện "Đang phát" (trung tâm điều khiển / màn khóa) với phần tử im lặng ở iOS cũ không, sample rate khớp có tránh được
  tiếng rè / sai cao độ không, `pointerup` / `touchend` có được Safari tính là gesture cho `resume()` không, iOS có tự
  chạy lại context sau cuộc gọi không — checklist Phần 3 mục 6.
- ~~Nghe thử (Tạo bài từ file) và màn Tự chơi để tạo bài (click / tiếng khi bấm) chưa giữ phiên "playback" — trên iPhone
  vẫn theo nút gạt im lặng; chúng dùng `unlock()` với 3 s chờ mới.~~ Đã giữ: D-426.
- Khi giữ phiên, nhạc của app khác tạm dừng (iOS không trộn "playback") — cố ý, trả khi tắt tiếng / rời màn chơi.
- Edge headless không chặn AudioContext khi chưa có user activation (context tạo ra đã 'running'), nên e2e không tái
  hiện được đúng đường "bị chặn → cú chạm sau mở được" của Chrome / Safari thật — đường đó chỉ có unit test (fake).
- Chạm nút số ĐẦU TIÊN của trang (chưa có user activation) — Chrome ghi lỗi console "Blocked call to navigator.vibrate"
  (rung của bàn nút gọi ở `pointerdown`, trước khi có activation; có từ trước, không liên quan âm thanh) và lần chạm đó
  không rung.

## v1.0.1 — góp ý của chủ dự án trên bản live 1.0.0 (2026-10-17)

Chủ dự án test bản 1.0.0 trên https://df-harmonica-tiles.vercel.app và gửi 4 góp ý ("sửa luôn đi"): (1) nốt đầu chạm
vạch sáng đôi lúc vẫn khựng, và quãng nốt đầu rơi xuống quá dài — "cho nó bớt đi 35%"; (2) Cửa sổ nổi PC và overlay OBS
chưa tính viền trong của bảng phím game — hai ô ngoài cùng sát viền; (3) soát bảng nút mobile xem có cần chỉnh tương
tự; (4) Quốc ca bỏ phần 3 và phần 4. Ba builder (timing / khung PC / mobile + bài mẫu) + lead gộp.

### Khựng ở lần chạm đầu + đếm vào ngắn (mục 1)

- **D-427 — Đếm vào rút còn 65 % quãng nốt đầu** (`src/player/leadIn.ts`, thuần): `leadInBeats(tl, from, bar)` =
  max(0, 0,65 × bar − 0,35 × gap), gap = khoảng lặng từ điểm phát (chuẩn hóa như `Transport.play` — `playStartBeat`)
  tới nốt đầu có `startBeat ≥ from` (nốt đang kêu ở `from` bỏ qua; không còn nốt → gap 0), làm tròn 1e-6 beat. Quãng
  nốt đầu đi từ khung đứng yên (pre-roll) tới hit line = đúng 0,65 × (bar + gap): Quốc ca 6,75 → 4,3875 beat (đếm vào
  [−1,6375, 0)), bài vào ngay beat 0 → 0,65 ô nhịp (TAKEDISKRUSH 4 → 2,6). Khoảng lặng ≥ 0,65 / 0,35 ≈ 1,86 ô nhịp →
  không đếm vào (đoạn chạy từ `from`, không bao giờ bỏ phần nào của bài; quãng vẫn ngắn hơn trước). Dùng ở PlayerEngine
  (`preRoll` / `start` / `flushPendingPlay` — màn chơi, Cửa sổ nổi), OverlayEngine (`preRoll` / `startNow` — overlay
  tự chạy, trang mini), `guideVideoTiming.leadBeats` (video nổi, từ beat 0); overlay theo màn chơi chép dải đếm vào
  trong tin `state` nên tự khớp. Giữ nguyên: ô đứng yên lúc đếm ngược ở khung pre-roll (giờ thường đã thấy nốt đầu —
  Quốc ca 4,39 beat trong 6 beat lookahead), trượt mượt `PRE_ROLL_GLIDE_SEC` (khoảng trượt = đếm vào mới), không số khi
  ô đã chạy, không nhảy lùi.
- **D-428 — Click đếm vào theo nhịp tới nốt đầu, nhấn ở đầu ô nhịp** (`src/audio/scheduler.ts`): chỉ click "các beat
  còn lại" của đếm vào thì Quốc ca còn một tick lẻ rồi 2,75 beat im — mất cảm giác tempo. Quy tắc: click ở mọi beat
  nguyên từ đầu đếm vào tới nốt đầu từ cuối đếm vào trở đi (`leadInClickEnd`) — Quốc ca −1, 0 (nhấn), 1, 2 rồi nốt lấy
  đà ở 2,75; TAKEDISKRUSH −2, −1 rồi nốt ở 0; phát giữa ô nhịp [2, 6) ở 4/4: 2, 3, 4 (nhấn), 5. Nhấn chỉ ở đầu ô nhịp
  (b % beatsPerBar = 0) — bỏ nhấn "beat đếm đầu" vì đếm vào không còn bắt đầu ở vạch nhịp. AudioScheduler giữ count-in
  của đoạn phát (`leadIn`, lấy lúc epoch đổi) sau khi transport đã qua nó để click tiếp qua khoảng lặng đầu bài; vòng
  loop / đoạn mới không đếm vào thì bỏ. Nốt trong đếm vào vẫn im, metronome như cũ, tắt click thì không click. Không
  đếm vào (khoảng lặng dài) → không click dẫn vào. Bài 2/4 / 3/4 vào ngay đầu ô nhịp chỉ còn MỘT tick → sửa ở D-439
  (đếm vào luôn chứa ≥ 2 beat nguyên).
- **D-429 — Nguyên nhân khựng ở lần chạm đầu: GPU dùng lần đầu CSS của keycap sáng; làm nóng bằng phần tử THẬT** (thay
  bước 2 của D-380): không có lỗi logic ghim ô (beat lệch đường thẳng ≤ 3 ms ở mọi lượt, không lần nào đứng yên; lệnh
  vẽ canvas lúc chạm ~1 ms — `warmTileGlow` đã đủ). Trace CDP (Edge headless mới, CPU 4 ×, Quốc ca PC): lúc keycap đầu
  tiên sáng GPU raster ô DOM chứa keycap 34–49 ms + ANGLE biên dịch shader 28–44 ms, thêm vài lần 5–15 ms trong 150 ms
  hiệu ứng `gb-press`. Thủ phạm là cả `filter: drop-shadow` của cột phím, hiệu ứng `gb-press` (scale + nền +
  box-shadow) và clip-path của keycap — tắt riêng từng cái vẫn khựng, tắt cả thì hết; ô thăm dò 48 px chỉ mang filter
  của vòng 7 không làm nóng được đường raster này. Banner "ĐANG GIỮ …" đầu tiên (Quốc ca beat 7) khựng cùng kiểu (88 /
  71 ms). `warmDomEffects(host, setTimer, clearTimer)` (glowWarmup.ts, thay `warmKeycapGlow`): đặt một keycap sáng thật
  (`LIT_KEYCAP_CLASS` + `kbd.gb-cap` có chữ), một banner thật (`HOLD_BANNER_CLASS` + `.hold-banner-text`) và một nhãn
  modifier sáng thật (`LIT_MOD_CLASS` + `.gb-mod-name`) — opacity 0,01, `aria-hidden`, không `data-key` /
  `aria-current` / role, không bắt chuột, con trực tiếp của stage (ngoài `.game-bar` / `.mini-pad` / chỗ banner nên
  không lọt vào truy vấn của e2e), gỡ sau `DOM_WARMUP_MS` 700 ms hoặc lúc detach; phần tử không có CSS thật (jsdom) gỡ
  ngay. Gọi ở PlayerEngine.attach (màn chơi, Cửa sổ nổi) và nay cả OverlayEngine.attach (overlay, trang mini — overlay
  theo màn chơi cũng khựng 38–62 ms). Giữ `warmTileGlow`. Cửa sổ nổi ở bản build ban đầu KHÔNG được làm nóng (CSS chép
  sang chưa nạp lúc attach) — sửa ở D-440.
- **D-430 — Âm thanh: dựng sẵn bảng sóng khi tạo AudioContext** (`primeWaveTables`, engine.ts, cuối `ensureContext` —
  chỉ khi đã cần tiếng, quy tắc "tắt tiếng thì không đụng AudioContext" giữ nguyên): `new OscillatorNode(ctx, { type:
'sine' })`, như vậy với 'sawtooth', `new BiquadFilterNode(ctx, { type: 'lowpass' })`, không start / không nối, để GC
  dọn. Chromium dựng PeriodicWave + hệ số lọc LƯỜI lúc scheduler lên lịch nốt giai điệu đầu (~0,13–0,15 s trước khi nốt
  đầu chạm vạch): 4–8 ms mỗi loại ở CPU 4 ×, khung hở 26–51 ms. Constructor (không `createOscillator`) để unit test
  đếm `ctx.oscillators()` và probe `createOscillator` của e2e audio-mobile không đổi; thiếu constructor (jsdom, trình
  duyệt cũ) hoặc ném lỗi → bỏ qua.

### Khung bảng phím PC (mục 2)

- **D-431 — Số đo khung bảng phím PC; mép cửa sổ / overlay ở KHUNG NGOÀI, không ở viền trong** (ảnh chụp của chủ dự án
  1109 × 337, ≈ 2 × 1080p, bước cột s = 130 px; bảng số đầy đủ ở `docs/GAME-UI-REFERENCE.md` "Khung bảng phím PC"):
  tâm keycap 101,5 + 130·i (1080p 732,5 + 65·i), keycap 0,31 s, 7 vạch ngăn ở trung điểm, viền trong có hoa văn ở
  ±4,035 s từ tâm nhóm phím, khung ngoài (tấm nền bo góc) ±4,26 s; keycap ngoài cùng → viền trong 0,38 s. Lead giao
  "mép cửa sổ ở chỗ viền trong", nhưng viền trong chỉ cách mép 8 làn (±4 s) 0,035 s (≈ 2 px ở 1080p) — game có khoảng
  trống quanh phím vì keycap hẹp chứ không vì đệm; ô của app rộng ~0,85 s nên mép ở viền trong vẫn để ô cách mép ≈ 7
  px (vẫn sát). Chọn: cửa sổ nổi / khung overlay rộng bằng KHUNG NGOÀI (±4,26 s = 8,52 s, 1080p x 683,1 → 1236,9); mép 8
  làn (±4 s) rơi đúng chỗ viền trong. Ô ngoài cùng cách mép 0,337 s ≈ 21,9 px ở 1080p (trước 5 px), gần khoảng keycap
  → viền trong của game (0,38 s). Một hằng số: `GAME_FRAME_PAD` = 0,26 bước (`src/player/layout.ts`; 0,035 = viền
  trong) — layout, renderer, pipPrefs, overlayParams, test đều đọc nó.
- **D-432 — Renderer / overlay: `framePad`** (option layout + renderer, bước cột, chỉ `lanePadding: 'none'`, kẹp 0…1,
  là layout key): lane = (bề ngang trước gutter) / (8 + 2·pad), `Layout.frameInset` = đệm px, gutter + ribbon bắt đầu
  SAU đệm phải. Có đệm: chỉ vẽ 7 vạch GIỮA các cột (như game) + một vạch ở mép phải khung (ranh giới với dải giữ),
  không vạch ở mép ngoài làn 1 / 8; hit line vẫn phủ cả canvas (ngoặc ở mép trái khung và mép phải gutter), vạch nhịp /
  phách trong vùng làn, nhãn section nằm trong đệm trái. Bật cho Cửa sổ nổi PC (`PIP_RENDERER_OPTIONS`) và overlay
  `layout=game&fit=canvas` lane dọc (`overlayRendererOptions`); `canvasPlacement` dùng khung đo được: 1920 × 1080 → 610
  × 600 tại (683, 150) (8 làn x 700–1220), 2560 × 1440 → 813 × 800 tại (911, 200), 1280 × 720 → 406 × 400 tại (455,
  100), 3840 × 2160 → 1220 × 1200 tại (1366, 300). Bảng phím minh họa của "Xem trước" vẽ đúng khung đó (x 683,1, rộng
  553,8). Link cũ `fit=source` (streamer tự kéo source cho 8 làn trùng 8 phím) và cửa sổ Tauri (576 × 600 tại 700, 150)
  giữ 8 làn phủ kín — không xê dịch làn đang dùng. Kiểu Mobile (`'pad'`) bỏ qua `framePad`: overlay kiểu Mobile trên
  preset game rộng hơn (720p: 384 → 406 px) nên 8 cột Mobile rộng theo (48 → 50,75 px) — không có gì để thẳng hàng trên
  stream PC, vô hại.
- **D-433 — Cửa sổ nổi PC = khung bảng phím + dải giữ; cỡ đã nhớ của v1.0.0 bỏ qua một lần:** cỡ chuẩn rộng =
  round(553,8·k/dpr) (`PIP_FRAME_1080`) + round(56 · tileScale); mép trái cửa sổ = mép trái khung bảng phím, phần tới
  vạch gutter = đúng khung, dải giữ nằm ngoài khung bên phải như trước; quy tắc "mép trên chạm mép trên màn hình" (cao
  ngoài 750·k) không đổi. 768p 434 × 499, 900p 509 × 591, 1080p 610 × 716, 1200p 677 × 799, 1440p 813 × 966, 4K 1220 ×
  1466 (dpr 1, thanh tiêu đề 34); 5:4 1280 × 1024 xin 578 × 566 (trần 25 %, D-418); 3:2 1920 × 1280 @100 % vượt trần
  0,1 % → cùng đường D-418. "Căn chỉnh" và banner theo vùng làn qua `--lane-left` / `--lane-right` (17 / 73 px ở
  1080p). `rememberSize` ghi thêm `framePad`; `readRememberedSize` bỏ bản lưu thiếu / khác `framePad` (cùng bề ngang
  thì 8 làn nay hẹp hơn, lệch phím — tiền lệ D-409); đổi `GAME_FRAME_PAD` sau này cũng tự bỏ cỡ cũ. `pip.help` /
  `pip.resetSizeHint` (vi + en): đặt mép trái cửa sổ thẳng mép trái khung bảng phím; cỡ chuẩn = khung + dải giữ.

### Bảng nút mobile (mục 3)

- **D-434 — Trang mini "Khớp nút game": cửa sổ lý tưởng = 8 làn** (`FIT_WINDOW_STEPS` = 8, layout.ts): đo lại ảnh
  mobile (±2 px): hai vạch khung bảng nút chạy x 202,5 → 1166 = đúng mép ngoài nút 1 / 1̇ (đĩa Ø 86 = 0,69 bước) —
  bảng mobile KHÔNG có viền trong / đệm để chép. Cửa sổ bằng hàng nút (7,69 bước, chuẩn cũ) làm ô rộng đúng Ø nút chạm
  mép (khe 0–0,25 px; thu ô thì mất "ô = nút" mà vẫn chỉ còn ~3,5 px). Nay cửa sổ vừa = 8 bước: mép = mép ngoài lane 1
  / 1̇ (nửa bước ngoài tâm nút), ô ngoài cùng cách mép (1 − 0,69) / 2 ≈ 0,155 bước = nửa khe giữa hai ô, như bàn nút
  'pad'; phần rộng thêm chỉ che cảnh game phía trên bảng nút. `DEFAULT_LANE_FIT` suy từ `FIT_WINDOW_STEPS` (1/16 và
  15/16 — trước 4,43 % / 95,63 %); chỉ báo "Rộng" cần `FIT_WINDOW_STEPS × bước` ("Hẹp quá" dưới 7,85 bước, "Rộng hơn
  cần thiết" trên 8,6, "Lệch tâm" khi 8 làn ra ngoài mép quá 0,15 bước); bước gốc của "Vạch · Giãn" khi không đúng tỉ
  lệ thật = w / 8. Số căn chỉnh đã lưu giữ nguyên (chỉ máy đang dùng mặc định mới đổi). Ô, tâm làn, vòng chế độ, vòng
  đích (`GAME_MODE_COLUMNS`), quy tắc chiều cao không đổi. Chữ (vi, en) `mini.align.help` / `helpPc` /
  `mini.help.fitIntro`: "mỗi mép ra ngoài nút 1 / nút 1̇ chừng 1/4 nút" (0,155 / 0,69 ≈ 0,22 nút). 0,155 bước là lựa
  chọn (game không có số để đo), chưa thử trên cửa sổ nổi Android thật.
- **D-435 — Bàn nút Mobile + overlay kiểu Mobile: không đổi** — màn chơi kiểu Mobile, Cửa sổ nổi kiểu Mobile, trang mini
  "Thu nhỏ" (bố cục 'pad': 8 cột phủ khung, đĩa 0,68 cột, ô viên thuốc ~0,59 cột) và overlay kiểu Mobile (cùng 'pad',
  không viền) vốn để ô cách mép ~0,21–0,25 cột (844 × 390: ≈ 22 px), không chạm. Vị trí nút chế độ giữ:
  `PAD_MODE_COLUMNS` cho 'pad', `GAME_MODE_COLUMNS` (đo) cho vòng / vòng đích của 'fit'.

### Bài mẫu + gộp (mục 4)

- **D-436 — Quốc ca chỉ còn "Phần 1" + "Phần 2":** xóa từ "# Phần 3" tới hết; file kết thúc bằng đúng một LF sau
  `,*2 _*0.75` (chuột phải đã thả trước nốt cuối). 9 dòng, 73 nốt, 82,75 beat = 1:02 ở 80 BPM; nốt đầu vẫn ở beat
  2,75; `?line=3` / `?line=4` của e2e vẫn đúng (dòng 4 = đầu Phần 2). `seeds.parse.test.ts` ghim 2 đoạn (4 / 5 dòng),
  73 nốt, 82,75 beat, 1:02, một LF cuối, không Phần 3 / 4; ngưỡng `lineSpans` > 10 → ≥ 9. Không test / e2e / tài liệu
  nào ghim "2:02".
- **D-437 — Tên cài đặt "Đếm vào khi bấm Phát"** (lead): "Đếm vào 1 ô nhịp khi bấm Phát" / "Count in 1 bar when
  pressing Play" không còn đúng sau D-427 → `settings.countIn` = "Đếm vào khi bấm Phát" / "Count in when pressing
  Play"; `settings.countInHint` nói nốt đầu xuất phát cách vạch "khoảng 2/3 ô nhịp, bài có đoạn lặng trước nốt đầu thì
  cao hơn (Quốc ca: khoảng 1 ô nhịp)" + tick theo nhịp tới nốt đầu, ít nhất 2 tick (review: bản đầu ghi "khoảng 2/3 ô
  nhịp" cho mọi bài — Quốc ca thật ra 4,39 beat ≈ 1,1 ô nhịp; README sửa cùng);
  `settings.clickSoundHint` / `startDelayHint` (vi + en) bỏ "1 ô nhịp". Test theo tên mới: SettingsView.test,
  forced-colors.spec, round5.spec (hộp thoại OBS không có công tắc đó). Chú thích "1 ô nhịp" của đếm vào khi phát
  (settings.ts, overlayEngine, overlayParams, MiniView, videoPip, FloatingStage, e2e) sửa theo; "đếm vào 1 ô nhịp" của
  màn **Tự chơi để tạo bài** (đèn nhịp lúc thu) là chuyện khác — giữ.
- **D-438 — Gộp + kiểm (lead):** `npm run check` từng bước + `prettier --check .` xanh; e2e toàn bộ trên bản build mới
  (cổng 4174). round7.spec: hai test "đếm vào chỉ rơi xuống" (màn chơi, trang mini 360 × 360) với TAKEDISKRUSH ghi tới
  1,5 s sau hết đếm ngược — đếm vào mới chỉ 1,28 s nên nốt đầu chạm vạch trong cửa sổ, ô đang chạm không vẽ viền trong /
  highlight → bộ ghi thấy "một hình biến mất" (không phải nhảy). Cửa sổ kiểm nay dừng 150 ms trước lúc nốt đầu chạm
  (`leadWindowMs`; Quốc ca vẫn 1,5 s); test overlay "Xem trước" in dãy beat khi không thấy khung trung gian (fail một
  lần khi máy bận, chạy lại qua). e2e mới `e2e/v101.spec.ts`: Quốc ca chỉ 2 phần + 1:02; khung đứng yên + quãng rơi thật
  (= 0,65 × cũ ± 0,25 beat) ở màn chơi (keycap nốt đầu sáng), overlay theo màn chơi, overlay tự chạy, trang mini — cả
  hai bài; lần chạm đầu ở trang mới (PC tắt / bật tiếng, Mobile 844 × 390): khung hở < 100 ms, quãng rơi lệch đường
  thẳng ≤ 30 ms, `.glow-warmup` có rồi gỡ, không trong game bar; overlay `fit=canvas` 1920 × 1080 / 1280 × 720: ô cách
  mép khung ≥ 0,25 bước (đo được 21,9 / 14,3 px mỗi bên), tâm ô = tâm phím ±1,6 px; kiểu Mobile ô không chạm mép (màn
  chơi ≥ 8 px, overlay ≥ 5 px, trang mini đúng tỉ lệ thật 1001 × 183 ≥ 0,12 bước; đo 22,5 / 12,4 / 19,4 px) — các phép
  đo khe dùng một bài kiểm mép có nốt ở phím Z và `,` ngay từ đầu (hai bài mẫu không có ô ở làn ngoài cùng trong vài
  giây đầu; bản đầu của test vì thế đo nhầm làn 2). Harness đo thời gian chạy lại trên bản cuối, xen kẽ trước / sau (số
  ở CHANGELOG); ảnh kiểm tối + sáng: màn chơi PC / Mobile lúc đứng yên + lúc chạm đầu, Cửa sổ nổi 1080p và overlay 1920
  × 1080 trên ảnh bảng phím của chủ dự án, trang mini trên ảnh mobile.

### Sửa sau review (v1.0.1)

- **D-439 — Đếm vào luôn chứa ít nhất 2 beat nguyên trước nốt đầu** (`LEAD_IN_MIN_CLICKS` = 2, `leadInBeats`): với
  0,65 ô nhịp, bài 3/4 vào ngay beat 0 có đếm vào [−1,95, 0) → click DUY NHẤT ở −1 (0,95 beat sau khi ô chạy), 2/4
  [−1,3, 0) cũng một tick — đúng cái "tick lẻ mất cảm giác tempo" mà D-428 muốn tránh (review; hai bài mẫu 4/4 nên e2e
  không gặp). Chọn: nới đếm vào tới beat nguyên thứ hai tính lùi từ nốt đầu (`from − (ceil(nốt đầu) − 2)` + 0,001 beat
  `LEAD_IN_CLICK_MARGIN` để beat đó nằm hẳn trong đếm vào dù sai số float — transport bắt đầu ở `from − đếm vào`, cửa
  sổ đầu của scheduler bắt đầu đúng đó), trần = đếm vào cũ 1 ô nhịp. 3/4 → 2,001 beat (tick −2, −1; quãng 0,667 × cũ),
  2/4 → 2 beat (tick −2, −1; = 1 ô nhịp như trước — ngắn nhất có 2 tick), 1/4 / 3/8 giữ như trước (trần). Ô nhịp ≥ 4
  beat luôn ≥ 2 beat nguyên (khoảng ≥ 2,6 beat) → hai bài mẫu và mọi bài 4/4 không đổi. Áp cho HÌNH (khung đứng yên,
  quãng rơi) ở mọi bề mặt dù có tiếng hay không — không để công tắc tiếng click đổi chỗ ô đứng; bỏ phương án "≥ 2 beat
  đếm vào" (đổi cả Quốc ca, vốn đã có 4 tick nhờ khoảng lặng) và "chấp nhận một tick". Test: `leadIn.test.ts` quét nhịp
  1–12 × khoảng lặng × điểm phát qua `planEvents` thật: ≥ 2 tick đều 1 beat, tick cuối ngay trước nốt đầu, không dài hơn 1
  ô nhịp, ô nhịp ≥ 4 đúng 0,65 × cũ.
- **D-440 — Cửa sổ nổi: làm nóng DOM chờ CSS chép sang nạp xong** (`warmDomEffects`, glowWarmup.ts): review đo bản build
  (MutationObserver trên document PiP): `mountFloatingWindow` chép `<link rel=stylesheet>` (pipDocument.ts) rồi mount
  ngay → PlayerEngine.attach lúc ~32 ms, CSS về lúc ~70 ms → ba phần tử thăm dò đọc "không có CSS" và bị gỡ cùng mili-
  giây; cửa sổ nổi không được làm nóng gì (banner **ĐANG GIỮ …** đầu tiên vẫn khựng như D-429; bản dev không thấy vì Vite
  chèn `<style>` — chép đồng bộ). Sửa trong `warmDomEffects` (mọi bề mặt hưởng, không đổi luồng mount): không phần tử
  nào có CSS mà document còn `<link rel=stylesheet>` chưa `.sheet`, chưa báo load / error → nghe load / error của các link
  đó, mỗi lần báo thử đặt lại; đặt được thì thôi nghe; hết link để chờ mà vẫn không có CSS → thôi; trần
  `DOM_WARMUP_WAIT_MS` 2 s; detach → gỡ listener + timer. Link lỗi (`.sheet` vẫn null) tính là đã xong. Không chọn "chờ
  CSS rồi mới `root.render` cửa sổ nổi" (đổi thời điểm mount / đo thanh tiêu đề / test FloatingWindow; vài khung chưa
  có CSS của cửa sổ nổi vẫn còn như trước — chỉ thẩm mỹ). Test: glowWarmup.test (chờ load, nhiều link, link lỗi, link đã
  nạp, detach / quá hạn); e2e v101.spec "Cửa sổ nổi (bản build)" ghi `.glow-warmup` trong document PiP từ lúc
  `requestWindow` trả về: có, giữ ≥ 100 ms, gỡ sạch.
- **D-441 — Trang mini "Khớp nút game" không biết cỡ màn: nhắc một lần cho máy đã dùng ở bản 1.0.0**
  (`needsFitWindowNotice` / `dismissFitWindowNotice`, miniAlign.ts; `MiniFitNotice`, MiniCalibrate.tsx): D-434 đổi
  `DEFAULT_LANE_FIT` 0,0443 / 0,9563 → 1/16 / 15/16; v1.0.0 xóa khóa số căn chỉnh khi bằng mặc định nên máy dùng mặc định
  âm thầm sang mặc định mới — cửa sổ đặt theo hướng dẫn cũ (mép = mép ngoài nút 1 / 1̇) thì làn ngoài cùng lệch ~0,14
  bước vào trong, bước hẹp ~4 %, và kiểu này không có chỉ báo "Rộng" (cần `scale`). Chọn nhắc (không ghi lại số cũ — số
  cũ giữ đúng cái ô sát mép mà góp ý 3 muốn bỏ): máy có `dfht-mini-song` (bản 1.0.0 ghi mỗi lần mở trang mini; MiniView
  ghi SAU khi đọc), không có `dfht-mini-calibration`, chưa có dấu `dfht-mini-fit8` → chip nút **Bản mới: kéo rộng thêm ¼
  nút mỗi bên** (chữ ngắn "kéo rộng thêm ¼ nút" nằm trong tên đọc; tooltip giải thích) ở chỗ chỉ báo của hàng trên, chỉ
  khi bố cục "Khớp nút game" và không đúng tỉ lệ thật; chạm → hướng dẫn đặt cửa sổ (`MiniHelp section="fit"`) + ghi dấu;
  đổi số căn chỉnh cũng ghi dấu. Máy mới / có số riêng → ghi dấu ngay, không nhắc; storage bị chặn → không nhắc. Bố cục
  đã chọn (`dfht-mini-layout`) không tính là dấu bản cũ (e2e / người dùng chọn trước khi mở). Đúng tỉ lệ thật (Android)
  không đổi: chỉ báo "Rộng" đã nói cỡ, first / last không dùng. Test: miniAlign.test, MiniView.align.test (hiện / chạm /
  máy mới / số riêng / Thu nhỏ → Khớp nút game / chỉnh số / đúng tỉ lệ thật), mini.spec cửa sổ thật 546×90 … 640×80 vi +
  en: chip không ra ngoài / chồng / bị che, chạm → hướng dẫn, hết chip.
- **D-442 — Số đo khựng ở CHANGELOG + chốt chặn hồi quy:** review chạy lại harness trên cùng máy (trước = HEAD 8cf9a19,
  sau = cây làm việc, 3 lượt mỗi bên, trình duyệt mới mỗi lượt): CPU 4 × Quốc ca PC lần chơi đầu trước 27 / 35 / 37 ms, sau
  40 / 30 / 24 ms (hai lượt sau còn khung ~30 ms đúng lúc chạm); có tiếng trước 51 / 68 / 48, sau 38 / 49 / 21; CPU 1 ×
  trước 24 / 28 / 30, sau 17 / 17 / 17 (có tiếng như vậy; e2e gộp đo một lượt có tiếng 33 ms); 6 × lần đầu ≈ lần sau
  (34 / 32 ms) → phần còn lại là chi phí mỗi nốt (`gb-press`, "Còn mở"). Số 46 → 20 ms của đợt gộp đầu phóng đại →
  CHANGELOG nay dẫn CPU thường (24–30 → 17 ms, hết rớt khung; có tiếng 17–33) làm số chính, CPU 4 × ghi khoảng của cả
  hai đợt (trước 27–55, sau 19–40; có tiếng 29–68 → 19–50) + nói rõ còn khung ~30 ms ở 4 ×. Test lần chạm đầu của
  v101.spec (CPU 1 ×, < 100 ms) không phân biệt được bản trước / sau — chốt chặn thật là phần tử làm nóng có CSS: nay
  kiểm có lượt `.glow-warmup` GIỮ ≥ 100 ms (`expectWarmKept`) ở màn chơi (PC), Cửa sổ nổi, overlay tự chạy và trang mini
  (cả hai bài) — đã thử: tắt phần chờ CSS của D-440 thì test Cửa sổ nổi rớt (thêm / gỡ cùng mili-giây). Ngưỡng khung hở
  giữ 100 ms (máy dùng chung; số ở 1 × trước / sau đều < 50 ms nên siết cũng không phân biệt).

### Còn mở sau v1.0.1

- **Chưa thử trên game / OBS / điện thoại thật:** khung bảng phím đo từ một ảnh (≈ 2 × 1080p, ±0,015 bước); Edge
  headless giả viewport của Cửa sổ nổi (chỉ kiểm cỡ xin + bố cục trong trang); khe 0,155 bước của trang mini là lựa
  chọn.
- **Cửa sổ nổi (Document PiP) không đo được bằng harness** (không gắn vào canvas của cửa sổ PiP) — cùng mã
  PlayerEngine; phần tử làm nóng vào stage của cửa sổ nổi khi CSS chép qua pipDocument đã nạp (D-440, e2e kiểm có + giữ
  ≥ 100 ms), khung hình chưa đo. Vài khung đầu của cửa sổ nổi vẫn chưa có CSS (như trước).
- **CPU chậm 4 ×, trang mới:** lần chạm đầu đôi khi vẫn còn một khung ~30 ms (D-442); ở 6 × bằng lần chơi sau — chi phí
  mỗi nốt (mục `gb-press` dưới).
- **Kiểu Mobile: khung hở 50–86 ms ở CPU 4 ×** mỗi lần tới nhắc / đổi chế độ (Quốc ca beat 6–7: "SẮP CHẠM", ping,
  vòng, banner) — việc main thread mỗi lần nhắc, không phải chi phí lần đầu; đáng một vòng riêng (MobilePad /
  mobilePad.css).
- **Kiểu PC: hiệu ứng `gb-press`** (player.css) đổi nền + box-shadow → style + paint mỗi khung trong 150 ms mỗi nốt:
  khung 25–37 ms ở CPU 4–6 ×, ~6–9 ms ở 1 ×; chỉ dùng transform / opacity sẽ nhẹ hơn.
- Hold đầu (beat 7) còn 8–12 ms raster GPU sau làm nóng (không khung hở ≥ 45 ms ở các lượt có trace).
- Bài có khoảng lặng đầu ≥ ~1,86 ô nhịp: không đếm vào, không click dẫn vào (D-427, D-428). Bài 2/4 vào ngay đầu ô
  nhịp: quãng nốt đầu vẫn 1 ô nhịp như trước (D-439 — ngắn nhất có 2 tick).
- Nhắc "kéo rộng thêm ¼ nút" (D-441) nhận ra máy đã mở trang mini ở bản 1.0.0 chỉ qua `dfht-mini-song`: đã xóa dữ liệu
  trang (cỡ cửa sổ nổi do hệ điều hành nhớ, không mất theo) thì không nhắc.
- Trang mini "Thu nhỏ" kiểu PC và video nổi kiểu PC vẫn 8 làn phủ kín khung (không đặt lên bảng phím game — ngoài phạm
  vi góp ý).
- Số headless chỉ để tham khảo (3 agent chạy cùng máy, GPU / driver thật khác).

## Mở mã nguồn (2026-10-17)

Chủ dự án đưa mã nguồn lên GitHub công khai (https://github.com/nienlequang/df-harmonica-tiles, giấy phép MIT) bằng
một commit mới từ cây hiện tại (lịch sử riêng không đưa lên). App không đổi hành vi; bản web vẫn deploy từ máy (D-007).

- **D-443 — Fixture test tự soạn thay hai bài có bản quyền** (khép D-386): hai file của D-386 là bản ký âm hai bài hát
  có bản quyền nên không đưa vào kho công khai. Thay bằng hai bài tự soạn, phủ đúng những gì test cần:
  `src/test/fixtures/bai-thu-nhip-dieu.harm` ("Bài thử nhịp điệu", 76 BPM, La thứ không có Fa, 3 đoạn 4 / 4 / 8 dòng,
  128 beat, 118 nốt: độ dài 0,5 / 1 / 1,5 / 2 / 3 / 3,5, dấu nghỉ, cặp luyến X-C giữ chuột phải ngắn ở dòng 1 và 3
  của mỗi đoạn, điệp khúc giữ chuột phải suốt 8 dòng rồi thả trước dấu nghỉ cuối, nốt đầu N ở beat 0) và
  `src/test/fixtures/bai-thu-lap-doan.harm` ("Bài thử lặp đoạn và giữ chuột", có `@artist`, 160 BPM, mỗi nốt 1 beat như
  cảm âm chưa có nhịp; 8 đoạn — ĐOẠN 3 rỗng (chỉ có ghi chú), ĐOẠN 5 = `@repeat ĐOẠN 2` + `@repeat ĐIỆP KHÚC`, KẾT = 2
  dòng + 2 lần điệp khúc —, 63 dòng, 578 nốt: giữ trái qua nhiều dòng, một nốt giữ phải, luyến có tiền tố `Z-L:N` cuối
  dòng nối sang `[L] N [/L]` đầu dòng sau, luyến `N-B` trong giữ trái, 4 nốt Sib đứng lẻ bằng `[giữ scroll]` chỉ ở
  ĐOẠN 6, dòng dài cho donate; tên bài dài để kiểm cắt `@title` ở giới hạn 30). Số đoạn / dòng giữ như hai file cũ nên
  các chỉ số dòng của test Editor / editorText / tap timing không đổi; số nốt, beat của hold, cost optimizer, chữ kiểu
  Mobile, snapshot được tính lại và kiểm tay: bài 1 vẫn là phương án tối ưu của chính nó (cost 81, hạ một quãng 86,
  shift 5 = 89; nếu rest không phá run thì hạ quãng chỉ 75 — D-020 vẫn đúng), chỉ shift 0 và 5 không cần Nửa Cung; thêm một lần
  điệp khúc thì hạ quãng thắng (`ReoptimizeModal.test`). Nốt viết mới hoàn toàn, đã đối chiếu với hai file cũ: không
  có dãy nốt kèm độ dài nào dài quá 4 trùng nhau; dãy cao độ (bỏ quãng tám) trùng dài nhất 5 nốt, đều quanh cặp luyến
  X-C bắt buộc. Đổi kèm: lời / tên bài / tên tác giả / câu nốt của hai bài cũ còn rải trong test khác (camam,
  songSource, musicxml, MIDI pipeline, arrange, parser.spans, danh sách từ của roundtrip, e2e phase2c + round7 + mini)
  thành chữ trung tính; store.test / round7 kiểm một id seed lạ thay cho id cũ. Địa chỉ IP trong mạng nội bộ của máy
  test trong docs thay bằng `<địa chỉ IP máy tính>`.
- **D-444 — Giấy phép + link mã nguồn:** `LICENSE` (văn bản MIT chuẩn, "Copyright (c) 2026 nienlequang"); package.json
  thêm `repository`, giữ `"private": true` (không publish lên npm). `src/dev/sourceRepo.ts` (`SOURCE_REPO_URL`;
  `sourceRepo.test.ts` ghim trùng package.json + nội dung LICENSE) + `src/dev/SourceCodeLink.tsx` (tab mới,
  `rel="noopener"`, chữ ẩn "(mở tab mới)" như link ngoài của trang Hướng dẫn, title nói giấy phép): một dòng nhỏ dưới
  lời giới thiệu của trang Dev notes, và cùng dòng ngay sau "Dev notes" ở chân trang Hướng dẫn (prop `withSource`
  của `DevNotesLink`; chân trang Cài đặt giữ như cũ). Chuỗi `dev.source` / `dev.sourceTitle` (vi + en). README: mục người
  dùng "Mã nguồn & giấy phép" (một dòng, có trong mục lục) + phần người phát triển có cách chạy (`npm ci`,
  `npm run dev`, `npm run check`) và CI.
- **D-445 — GitHub Actions trên kho công khai:** `ci.yml` (push `main`, pull request, chạy tay) = job `check` trên
  ubuntu-latest, Node 24 (`.nvmrc`): `npm ci` → lint → typecheck → `format:check` → `npm test` → build; không cần
  secret. Job `e2e` chỉ khi chạy tay (`workflow_dispatch`, thử nghiệm): `npx playwright install --with-deps chromium` +
  `PW_CHANNEL=chromium` — nhiều spec đo điểm ảnh / cỡ cửa sổ / Document PiP và mới chạy trên Windows + Edge headless,
  chưa chạy thử trên Linux nên không chặn push. `tauri.yml` chỉ `workflow_dispatch` (đẩy tag `v*` không còn tự build
  Rust / tạo Release nháp); chạy tay không có tag nên `tagName` = `v__VERSION__` (version của package.json) thay
  `github.ref_name`. Lưu ý: `npm run release` tự `git push --follow-tags` khi repo có remote (D-007) — kho lịch sử riêng
  không được thêm remote của kho công khai.
- **D-446 — v1.0.2: bài mẫu thứ ba + tách giấy phép mã nguồn / bản quyền bài mẫu:** `seed-ji-mo-de-ren`
  (`src/library/seeds/ji-mo-de-ren.harm`, "寂寞的人伤心的歌 (Bài Ca Đau Khổ Của Kẻ Cô Đơn)", 龙梅子、杨海彪) đứng SAU hai bài
  mẫu cũ trong `SEED_SONGS`. Nguồn = cảm âm dạng prompt AI (số quãng: do1 = C4); chuyển bằng `convertPasted` của
  `src/editor/camamConvert.ts` (PC, baseOctave 4 — như ô dán AI): phương án dễ nhất = hạ 7 nửa cung (cost 92: 1 nốt Nửa
  Cung, 14 lượt giữ chuột, 26 nốt có modifier, không gập quãng), 504 nốt / 360 beat, cao độ + độ dài + luyến khớp nguồn
  từng nốt (đã kiểm bằng script tạm), tầm C4..F5. Sửa tay duy nhất: hai ghi chú `//` của nguồn mà converter gắn thành
  `//!` (cảnh báo Editor, ba câu đầu bài nối bằng " · ") được trả về `//` thường, mỗi câu một dòng, ba câu đầu đặt lại
  trước `# Dạo đầu` như nguồn — bài mẫu phải parse 0 diagnostics (`seeds.parse.test.ts`). Bản quyền: `LICENSE` giữ
  nguyên văn bản MIT (`sourceRepo.test.ts` ghim; GitHub nhận dạng giấy phép theo văn bản chuẩn) → file `NOTICE` riêng:
  MIT chỉ cho mã nguồn, bài mẫu là bản ký âm minh họa, bản quyền thuộc tác giả (Văn Cao — gia đình nhạc sĩ đã hiến tặng
  bản quyền cho Nhà nước; N2UtheHartlocker; 龙梅子、杨海彪), không cấp phép theo MIT; README (phần người dùng + dòng giấy
  phép cuối) và `docs/REFERENCE.md` (mục "Giấy phép và bản quyền bài mẫu") có dòng tương ứng. Trong app: chỉ BÀI MẪU
  (`entry.seed`, có `@artist`) có dòng `common.seedCredit` — thẻ Thư viện (`.library-card-credit`, 12 px mờ dưới tên tác
  giả) và header màn chơi (`.player-artist.player-credit`, 12 px: THAY dòng tác giả — vẫn có tên tác giả — chứ không thêm
  dòng; bản thử thêm dòng `flex-basis: 100%` làm khối tên bài đòi rộng hơn → ở 844×390 nút "◂ Thư viện" bị đẩy thành một
  hàng riêng, header cao thêm ~30 px); bản sao của bài mẫu là bài người dùng nên không có. `TakedownLine` (`src/dev/`, link
  `SOURCE_ISSUES_URL` = `${SOURCE_REPO_URL}/issues`, tab mới, `rel="noopener"`, chữ ẩn "(mở tab mới)") ở cuối trang
  Hướng dẫn (sau dòng "Dev notes · Mã nguồn") và dưới link "Mã nguồn (GitHub)" của trang Dev notes; chuỗi `dev.takedown` /
  `dev.takedownLink` (vi + en).

## Thanh bấm lặp (góp ý của chủ dự án, 2026-10-20)

- **D-447 — Đoạn bấm lặp một phím = một thanh dài có số lần bấm còn lại:** góp ý "bấm phím liên tục 1 phím hơn 3 lần,
  độ dài 0,5 đổ xuống" → một loại ô mới kiểu thanh dài ghi số lần cần bấm còn lại, bấm hết thì đổi sang ô thường.
  - **Luật (thuần, `src/core/repeatRuns.ts`):** đoạn = dãy LIÊN TIẾP lớn nhất trong `timeline.notes` gồm ≥
    `REPEAT_RUN_MIN` = 4 nốt, mỗi nốt `endBeat − startBeat` ≤ `REPEAT_NOTE_MAX_BEATS` = 0,5, cùng phím + quãng + Nửa
    Cung (→ cùng modifier, cùng chế độ Mobile), `slur === null`, khoảng nghỉ giữa hai nốt kề ≤ `REPEAT_GAP_MAX_BEATS` =
    0,25 (sai số `REPEAT_EPS` 1e-6 — chùm ba `*1/3` vẫn khớp). Nốt khác chen giữa, nốt dài hơn, nốt luyến, nghỉ dài hơn
    đều cắt đoạn; đoạn được phép vắt qua xuống dòng / sang đoạn bài (như hold run, D-021). `findRepeatRuns`,
    `repeatRunIndex` (nốt → đoạn), `repeatRemaining` / `pressesAhead` (số lần bấm còn lại, tìm nhị phân, không cấp phát).
  - **Số còn lại** = số nốt của đoạn có startBeat > playhead, sai số nghiêng về "chưa bấm": nốt ĐÚNG ở hit line vẫn tính
    (dừng ở đầu dòng hiện `×5` chứ không `×4`; chế độ **Chờ** của luyện tập giữ transport đúng ở đầu nốt đang chờ → nốt
    đó vẫn tính, không cần trường hợp riêng); ngay sau lần bấm đầu = n − 1; sau lần bấm cuối = 0 → ẩn số. Nốt thuộc ô
    nhịp đếm vào (không bấm) không tính; Loop không tính nốt từ loop end.
  - **Vẽ (renderer.ts, `collectBar` + `drawBarBody`, chỉ là cách vẽ):** mục `vis` riêng (visIdx = nốt đầu, `F_RUN` =
    nốt cuối) — MỘT thân từ đầu nốt đầu tới hết nốt cuối, độ dài như tile dài (`tileLength`, luật gap với nốt kế cùng
    lane, cắt tại loop end), cùng màu / viền / bo góc / viên thuốc ('pad') / `tileOpacity` / chi tiết HUD / mờ dần sau
    hit line / glow như tile thường. Trong lòng thanh (một `clip` cho mỗi thanh đang thấy): đoạn của từng nốt (đầu nốt →
    đầu nốt kế) — thân tô ở độ đục THẤP NHẤT trong các đoạn (đoạn đếm vào 0,22, luyện tập trúng 0,45 / trượt 0,4) rồi
    đoạn đậm hơn tô thêm cùng màu (alpha bù `(đích − nền) / (1 − nền)`; nền chroma: màu đặc đích) — để glow (shadow của
    thân) vẫn một hình; mỗi lần bấm sáng như một tile đơn đang chạm (góp ý 2026-10-20 "hiệu ứng sáng như phím bấm một
    lần, cho đủ số lần nhấn"): bao `env` = 1 ở đầu nốt đang ở hit line, giảm tuyến tính về 0 trong
    `REPEAT_PULSE_SPAN` 0,85 độ dài nốt (≥ `REPEAT_PULSE_MIN_BEATS` 0,12 beat), bật lại ở nốt kế — glow của thân
    `18·s·(0,2 + 0,8·env)`, đoạn của nốt đó phủ `ACTIVE_FILL` (độ đục × `0,35 + 0,65·env`) + trắng
    `REPEAT_PULSE_ALPHA` 0,5 × env, viền sáng dày `1 + 1,5·env` (nốt liền nhau không còn khe 2 px giữa các ô → nhịp sáng /
    tắt cho thấy từng lần bấm; giảm chuyển động: env = 1, sáng đều, không loé); loé + viền màu chấm điểm theo từng nốt; vạch mảnh (`REPEAT_TICK_*`, màu chữ của tile) ở đầu
    từng nốt bên trong. Viền ngoài: chờ bấm nhấp nháy / đang sáng / viền thường.
  - **Nhãn:** nhãn phím y như tile thường (bậc font, ↓ / ↑ / `#`, nhãn phụ, chấm giản phổ) + chữ `player.repeatCount`
    (`×{n}`, dấu nhân U+00D7, vi + en) — dọc: dòng dưới cùng của khối nhãn (sau nhãn phụ); ngang: cuối hàng nhãn. Khối
    nhãn bám mép gần của thanh như tile dài nhưng "sàn" là hit line (`min(tileLabelFloor, hitPos)` — dọc; ngang: ngay
    sau hit line) thay vì mép canvas: số đứng ngay chỗ người chơi nhìn, đuôi thanh tới thì đi theo đuôi. Sau review:
    - chỗ cho chữ khi còn lần bấm = phần CHƯA BẤM còn thấy (đuôi → sàn), không phải cả thanh: không đủ cho nhãn phím +
      số → bỏ nhãn phím trước (làn đã cho biết phím), chỉ số; còn lần bấm thì đáy dòng số không xuống quá hit line (nốt
      cuối ngắn hơn dòng số → thà vượt đuôi thanh vài px) — không bị hit line gạch, không bị mép canvas cắt ở 'fit';
    - nốt ô nhịp đếm vào ở đầu thanh (vẽ mờ `GHOST_ALPHA`) không mang chữ (chữ tối trên nền mờ): khối nhãn bám đầu nốt
      đầu tiên được đếm tới khi nốt đó chạm hit line;
    - ~~kiểu Mobile, sàn = ngay trên hàng vòng chế độ~~ — BỎ theo góp ý 2026-10-20 ("đi qua ô tròn chỉnh pitch / thăng
      thì giống bị chặn lại, không mượt"): khối chữ dừng trên hàng vòng rồi mới tụt theo đuôi trông như thanh bị kẹt.
      sàn giờ là `min(tileLabelFloor, hitPos)` chung cho mọi cột (bỏ `barLabelFloor`) — số trôi theo đầu thanh vào trong hàng
      vòng (vòng chỉ là viền mảnh không tô, chữ đè lên vẫn đọc được) rồi nằm sát hit line như cột không có vòng;
    - vạch đầu nốt đi qua hộp bao khối chữ (`F_LX0` … `F_LY1`, ghi ở `collectBar`) chỉ còn hai mẩu ngoài bề ngang chữ
      (cách 2 px, mẩu < `REPEAT_TICK_MIN` 3 px bỏ) — không gạch ngang chữ khi thanh trôi qua nhãn đứng yên;
    - ngang, thanh ngắn hơn ô tối thiểu (luật gap / loop cắt sát) còn lần bấm → chỉ số ở giữa thanh (trước: số bị bỏ,
      toạ độ NaN).

    Cỡ chữ số = `REPEAT_COUNT_RATIO` 0,72 × nhãn phím, dọc kẹp cho số rộng nhất lọt bề ngang tile — THEO LỚP số chữ số
    của đoạn (`countClass` 1…3; trước: theo "×max" của đoạn dài nhất bài → mọi thanh trên điện thoại chữ ~10 px chỉ vì
    một đoạn 12 nốt), cả thanh một cỡ (số chỉ giảm); ngang kẹp theo bề cao làn; sàn `REPEAT_COUNT_MIN_PX` 9. Chữ
    "×1…×max" + bề rộng theo lớp đo sẵn ở `prepare()` (đổi ngôn ngữ / layout mới đo lại) — hot loop không measureText,
    không cấp phát (không closure; hộp chữ dùng scratch `lbox`).

  - **Loop / đếm vào:** loop end cắt đoạn còn < 4 nốt → các nốt đó vẽ tile thường; vòng kế (đầu loop cắt giữa đoạn) dùng
    phần đoạn từ loop start nếu còn ≥ 4 nốt. Một phần thanh thuộc ô đếm vào → đoạn đó mờ, không sáng, không tính số; cả
    thanh thuộc đó → mờ cả thanh, không số. `maxLenBeats` tính cả thanh để cull nhị phân không bỏ sót thanh dài; luật
    "chuỗi quá sát chỉ nốt đầu có nhãn" coi nốt ngay sau một thanh là đầu chuỗi mới.
  - **Không đổi:** âm thanh, chấm điểm luyện tập, game bar / keycap, vòng `CHẠM`, banner giữ, ribbon vẫn theo từng nốt;
    mọi nơi dùng `TilesRenderer` (màn chơi, Cửa sổ nổi, overlay OBS, trang mini, video nổi) có thanh, cả hai hướng, mọi
    `lanePadding` + `framePad`. Bài mẫu có thanh: _TAKEDISKRUSH!_ (C × 5 ở beat 72 và 88), _Sao Mình Chưa Nắm Tay Nhau_
    (`,` × 4 ở beat 45,75 và 61,75); Quốc ca và bài thứ ba không có. Test cũ "nốt 0.25 beat lặp…" (renderer.test.ts)
    đổi 4 → 3 nốt mỗi phím để vẫn kiểm luật nhãn gọn của tile thường; test mới: `src/core/repeatRuns.test.ts`,
    `src/player/renderer.repeat.test.ts` (dòng `.harm` tự viết).

## Trang mini: bố cục "dưới nút" cho điện thoại Samsung (góp ý của chủ dự án, 2026-10-21)

- **D-448 — Bố cục "Khớp nút game · dưới nút" (bản nháp local, chưa thử trên máy thật):**
  - **Bối cảnh:** thử thật trên điện thoại Samsung — cửa sổ pop-up có chiều cao tối thiểu (~220 dp ≈ 55–60 % chiều cao
    màn ngang) nên không đặt gọn trong phần trên bảng nút được (mép dưới "Khớp nút game" phải ở ≤ `GAME_MODE_TOP_H`
    0,361 chiều cao màn — D-414), nhưng Samsung cho kéo pop-up xuống QUÁ mép dưới màn hình (phần dưới ra ngoài màn).
    → bố cục thứ ba: cửa sổ ngay DƯỚI hàng nút số, ô đi lên từ mép dưới màn hình tới vạch chạm ở mép trên cửa sổ; 8 làn
    thẳng 8 nút số như 'fit'; 4 vòng `CHẠM` giữ cột nút chế độ (lật, đáp ngay dưới vạch chạm — chủ dự án chấp nhận vòng
    nằm dưới hàng nút số dù nút chế độ thật ở trên). Khe giữa hàng nút số và vạch chạm (thanh của cửa sổ pop-up; vài máy
    thu gọn thanh) là bình thường.
  - **Id / lưu:** `MiniLayout` thêm `'below'` (thứ tự nút [Khớp nút | Dưới nút | Thu nhỏ]), cùng khóa `dfht-mini-layout`
    (bản cũ đọc `'below'` → không hợp lệ → mặc định, không lỗi); `isFitLayout` = 'game' | 'below'. Mặc định KHÔNG đổi,
    không đoán hãng (UA rút gọn của Chrome ghi model là "K") — người dùng điện thoại Samsung chọn "Dưới nút" một lần.
    Dùng chung `laneFit` + số căn chỉnh (`dfht-mini-calibration`) với "Khớp nút game"; số mới `edgeShift` (thiếu → 0).
  - **Renderer `flipY` (option, không phải khóa layout):** chỉ khi bố cục 'fit' dọc, cả khung vẽ bằng
    `setTransform(dpr, 0, 0, −dpr, 0, devH)` — layout.ts (hình học, cull, timing, fade, đếm vào, luyện tập, giữ, thanh
    D-447) không đổi, trên màn là ảnh gương của 'fit'. Chữ đứng thẳng: khối nhãn tile dời NGUYÊN KHỐI tới ảnh gương của
    hộp bao theo trục dọc gồm mọi phần (nhãn phím + chấm giản phổ, nhãn phụ, ↓ / ↑, `#` — không chỉ quanh `bottom − cc`:
    ở làn hẹp `#` / mũi tên nằm ngoài khối giữa, xoay quanh tâm khối thì chúng thò ra ngoài ô, qua vạch chạm) rồi vẽ bằng
    transform thẳng; thanh bấm lặp dời quanh đúng chiều cao chữ (chấm tính đúng phía), hộp chữ lưu ở toạ độ CHƯA lật để
    khe của vạch đầu nốt (vẽ dưới transform lật) trùng chữ đã dời — nhãn phím gần vạch chạm, `×n` dưới; chữ `CHẠM` vẽ
    thẳng ở y lật. Vạch / nhãn section tắt khi lật (trang mini vốn tắt). Giữ (mỹ thuật): dải sáng của tile nằm ở mép SAU
    (dưới); tile dài rời mép trên thì nhãn đi theo (chấm quãng trên ra trước), nhãn bám mép trên khi đang giữ vẫn trọn.
    Tắt `flipY` → luồng lệnh vẽ y hệt trước. Trang mini luôn gửi rõ `flipY` (`MINI_RENDERER_OPTIONS.flipY = false`,
    'below' → true) vì option renderer gộp vào option cũ. Bỏ: `flow: 'up'` thật trong layout (~16 chỗ renderer giả định
    "dọc = rơi xuống" — rủi ro hồi quy lớn); CSS `scaleY(−1)` (chữ / chấm giản phổ lộn ngược).
  - **Phần thấy:** trang không biết phần nào của cửa sổ còn trên màn (`window.screenY` không tin được trong cửa sổ nổi) →
    `belowVisibleOf(scale, chromeH, innerH, calib)` = (1 − `GAME_NOTE_BOTTOM_H`) × `refH` − `FLOAT_BAR_GUESS` −
    `chromeH` + `edgeShift`, kẹp [`BELOW_VISIBLE_MIN`, `innerH`] (`GAME_NOTE_BOTTOM_H` = 426,5 / 633 = đáy hàng nút số của ảnh game;
    `BELOW_VISIBLE_MIN` = 80 px = cỡ thấp nhất bảng lúc dừng / Căn chỉnh đã dựng + kiểm, D-401 — review: 60 px cắt mất
    hàng nút của bảng); màn 780 × 360 → 93 px, 915 × 412 → 110 px. Không biết cỡ màn (máy tính, màn không đọc được) →
    cả trang + `edgeShift`, nên tầm "Đáy · Dời" là −600…+400 px (cửa sổ pop-up để cao 250–400 px mà chỉ thấy ~90 px).
    Khi đang ở "dưới nút", MiniView kẹp thêm số đó vào tầm còn có tác dụng `belowEdgeRange(scale, chromeH, innerH)` (số
    lớn nhất còn cho `BELOW_VISIBLE_MIN` … số nhỏ nhất đã cho cả trang, tính cả làm tròn — mỗi bước đổi 1 px; số lưu
    ngoài tầm thì lần bấm đầu đưa về mép tầm rồi mới dời) (review: ngoài tầm đó con số vẫn chạy mà trang đứng yên — vd.
    780 × 360 đoán 93 px, cũ xuống tới −600 px phải bấm + ~587 lần mới thấy đổi); thanh trượt dùng cùng tầm.
    MiniView đặt `data-mini-layout="below"` + `--mini-visible-h` trên `:root` (`data-mini-short` khi ≤ 240 px), `.mini`
    cao đúng phần đó → canvas = phần thấy: ô hiện ra từ đáy phần thấy, phần đó chứa đúng Lookahead phách của màn chơi
    (không thêm ô Lookahead / độ dài làn ở trang mini — Lookahead chỉ ở thanh điều khiển Player). Phần cửa sổ dưới phần
    thấy: nền trang + một dòng `mini.below.rest` "kéo cửa sổ xuống…" (portal vào body) — tự ra ngoài màn khi đặt đúng.
    Dòng đó CHỈ lúc dừng (review: số đoán nhỏ quá — máy thu gọn thanh cửa sổ, thanh địa chỉ ở đáy — thì nó lộ một dải
    ở đáy màn suốt lúc chơi và bảo người chơi đã đặt đúng kéo tiếp xuống, lệch vạch chạm) và câu nhắc nói cả cách sửa
    trường hợp đó: "Cửa sổ đã đúng chỗ mà vẫn thấy dòng này: Căn chỉnh → 'Đáy · Dời' +".
  - **DOM:** vạch dẫn lật (`MiniAlignGuides flip`: mép sáng ở đỉnh, vòng ngay dưới, không nhãn số); bảng Căn chỉnh ngay
    dưới hàng vòng (`--mini-align-top`), kẹp cho trọn trong phần thấy (phần thấy thấp → được chồng lên hàng vòng);
    số "Đáy · Dời" (`EDGE_CONTROL`, cuối danh sách, px, focus 'edge' = vạch đứt `.mini-edge-mark` ở đáy phần thấy); lời
    nhắc riêng theo đúng tỉ lệ thật / Mobile / PC (`mini.align.helpBelow*`, 4 biến thể — review); chỉ báo chỉ có
    "Rộng" (`MiniFitStatus showHeight={false}`, tooltip `mini.fit.numbersWidth`); nhãn làn + banner PC ở đáy (phía ô
    đi vào); số đếm ngược theo `cqmin` của khung; hộp thoại (portal vào body) chỉ trong phần thấy, gọn như cửa sổ thấp
    khi ≤ 240 px (luật `@media (max-height: 240px)` của app.css xét cả cửa sổ — lặp lại dưới `:root[data-mini-short]`).
    Mọi luật theo CHIỀU CAO của mini.css thành `@container mini (…)` (`.mini { container: mini / size }`) để bảng lúc
    dừng / Căn chỉnh xếp theo phần thấy; 'game' / 'compact' như cũ vì `.mini` = cả cửa sổ — NHƯNG cần Chrome / WebView
    105+ / Samsung Internet 20+: trình duyệt cũ hơn mất cả 14 luật cửa sổ thấp ở MỌI bố cục (hồi quy chấp nhận cho bản
    nháp). Luật theo bề ngang giữ `@media`.
  - **Hướng dẫn theo loại máy (`MINI_HELP_DEVICES`, đầu hộp thoại ⓘ; mở từ Căn chỉnh thì ngay sau đoạn nút chọn — giữ
    D-416):** điện thoại Samsung → "dưới nút"; máy tính bảng Samsung / OPPO, đa số máy gập (vd.
    Galaxy Z Fold khi mở ra) → "Khớp nút game"; điện thoại Xiaomi / Redmi / POCO, OPPO, realme, OnePlus, vivo / iQOO,
    Honor, Huawei, nubia → vẫn mở bằng cửa sổ nổi của máy nhưng cảnh báo không kéo giãn được cho thẳng hàng nút số → "Thu nhỏ"
    đặt "ở giữa hoặc sát một bên màn hình" — đúng lời chủ dự án (review: bản trước tự hiểu "giữa" là giữa MÉP TRÊN, vì
    bảng nút kèn chiếm dải giữa màn — y ≈ 33–70 %, x ≈ 15–85 % ảnh game — nên cửa sổ ~300 × 300 ở giữa màn che nút kèn —
    chữ giờ theo đúng lời; chủ dự án muốn "giữa mép trên" thì đổi lại chữ). Lưu ý cũ theo hãng giữ nguyên (thêm một câu
    cuối mỗi hãng); mục kéo / đổi cỡ "Xiaomi / HyperOS" bỏ (trái lời khuyên mới — câu "Vạch · Giãn" chuyển sang "Điện
    thoại hãng khác"), thêm "Máy tính bảng / máy gập". "Cao quá" của "Khớp nút game" có tooltip nhắc Samsung dùng "dưới
    nút". `mini.helpIntro` / `mini.layout.compactHint` / launcher không còn "góc trên"; `mini.launcherIntro` tách câu ngắn
    (review: bỏ "—," lồng trong câu dài). Không nhắc riêng Galaxy Z Flip (máy gập — chủ dự án chỉ nói "đa số máy gập →
    Khớp nút game").
  - **Rủi ro / chưa kiểm:** chưa thử trên máy Samsung thật; thanh địa chỉ ở ĐỈNH cửa sổ pop-up ăn mất phần thấy (~56 px:
    màn 360 dp còn ~37 px → kẹp 80, ô vào từ dưới mép màn) — thanh ở ĐÁY thì `chromeH` làm số đoán nhỏ quá; thanh trên +
    dưới (> 25 % màn) → `chromeH` = 0; số đoán giả định mép trên cửa sổ ngay dưới hàng nút số + thanh ~24 px — mọi sai
    lệch chỉnh bằng "Đáy · Dời" (từ 2026-10-22: "Đáy ◂ ▸" ở hàng trên — sửa đổi cuối mục); phần thấy ~93 px rất chật (hàng vòng ~39 px + bảng Căn chỉnh một hàng ~37 px, hộp
    thoại cuộn); ba nút bố cục: cửa sổ hẹp hơn 560 px (mọi chiều cao) dùng chữ ngắn [Khớp nút | Dưới nút | Thu nhỏ]
    (review: chữ dài ≈ 356 px vi / ≈ 503 px en tràn mép ở 300 × 300 vi và 360 × 360 en — "Compact" ra hẳn ngoài màn;
    e2e `panel ▶ w×h` thêm 300 × 300 vi + en, 360 × 360 en, cả "game" và "compact" — chưa chạy), e2e "không chồng" ở
    cửa sổ 546–640 px có thể đỏ — chưa chạy; e2e không có spec cho
    'below'; video nổi từ trang mini vẫn là bố cục bàn nút.
  - **Sửa đổi 2026-10-22 — khoảng trống đáy ở hàng trên (góp ý của chủ dự án sau khi thử trên điện thoại Samsung thật:
    "app cần có khả năng tạo một khoảng trống dưới đáy để thứ hiển thị trên màn hình là toàn bộ nội dung app … nút chỉnh
    ở hàng trên trước khi vào bài, bấm trái phải thì khoảng trống tăng giảm"):** bỏ số "Đáy · Dời" khỏi Căn chỉnh
    (`EDGE_CONTROL`, focus 'edge', `alignControlsFor(…, below)`, tầm riêng của thanh trượt — xóa; Căn chỉnh của "dưới
    nút" có đúng các số của "Khớp nút game"). Thay bằng `MiniBelowGap` ở `.mini-top` của panel lúc dừng, ngay trước tên
    bài (sau ◂ về + huy hiệu — bên trái chỉ có thứ bề ngang cố định, nên bấm ◂ / ▸ liên tục làm phần thấy qua các
    ngưỡng cao 220 / 130 px — hàng trên đổi bề ngang, nút "Đổi sang Mobile" vào cùng hàng — thì nút KHÔNG xê dịch; review:
    để sau tên bài thì chạm kế tiếp rơi trúng "Đổi sang Mobile" / giữ bị ngắt vì nút chạy khỏi ngón tay): nhãn **Đáy** · ◂ (`mini.gap.less` "Giảm khoảng trống đáy") · số px · ▸ (`mini.gap.more` "Tăng khoảng trống
    đáy"), tooltip `mini.gap.hint`; chỉ khi 'below' + đang dừng (panel ẩn khi chạy / Căn chỉnh). **Một nguồn:**
    khoảng trống = `innerH` − phần thấy (`belowGapOf`), vẫn đổi qua `edgeShift` của số căn chỉnh (lưu như cũ): ▸ =
    `edgeShift` − `BELOW_GAP_STEP_PX` 8 px, ◂ = + 8 (`stepBelowGap`), kẹp vào `belowEdgeRange` (mỗi chạm trong tầm đều đổi
    trang; số lưu ngoài tầm tính như đã kẹp — lần bấm đầu đã đổi trang); số đoán vẫn là mặc định. Giữ để lặp dùng
    chung `useHoldRepeat` của Căn chỉnh (bước nhanh `BELOW_GAP_FAST_PX` 24 px; `onStep` trả `false` → thôi lặp). Hết tầm
    → nút đó `aria-disabled` (không `disabled`: nút đang giữ / đang focus không mất pointerup / focus), `canStepBelowGap`.
    Giá trị là `<output>` (TalkBack đọc số mới). Vạch đứt `.mini-edge-mark` giờ hiện suốt lúc dừng ở 'below' (cả Căn
    chỉnh), không còn kiểu "đang chỉnh". "Đặt lại mặc định" của Căn chỉnh GIỮ `edgeShift` (số đó không còn thuộc bảng
    này — đặt lại vạch không được làm trang đổi cao). Lời nhắc `mini.below.rest`, `mini.align.helpBelow*`,
    `mini.help.fit.controls`, `mini.help.device.samsungPhone` chỉ sang "Đáy ◂ ▸" ở hàng trên. Ở 'below', MỌI bề
    ngang: tên bài `flex-basis: 0` (co "…" trước, không đẩy nút xuống dòng), `.mini-top` được xuống dòng trong chính nó
    (hàng chật — kiểu PC ở cửa sổ thấp: nút "Đổi sang Mobile" cùng hàng; cửa sổ ≥ 560 px còn huy hiệu — thì chỉ báo / ⓘ
    xuống dòng, "Đáy ◂ ▸" vẫn ở dòng đầu), số px của chỉ báo (`.mini-fit-numbers`, ≥ 221 px cao) không hiện — có ở
    tooltip (review: số đó vào hàng đúng lúc bấm ◂ qua 221 px, đẩy ⓘ ra ngoài mép cửa sổ 600 px). Bản đầu chỉ cho xuống
    dòng < 560 px nên ở 560–~585 px kiểu PC, en (màn 915 × 412) tên bài còn 0 px và ⓘ nằm dưới "Đổi sang Mobile" — review
    bắt được. Cửa sổ < 560 px: bỏ thêm huy hiệu "Thử nghiệm" (~80–90 px; hộp thoại mở trang mini đã ghi "thử nghiệm").
    Kiểm bằng Edge headless 300 × 150 … 960 × 300, vi / en, Mobile / PC. Còn lại: phần thấy ~93 px mà cửa sổ < 420 px (chỉ
    báo "Rộng" xuống dòng — đã có trước) thì hàng ▶ / bố cục rơi xuống dưới phần thấy; MỚI: kiểu PC, phần thấy ~93 px, ở
    cửa sổ ~420–540 px và ~560–585 px — hàng trên xuống 2 dòng (cùng hàng với "Đổi sang Mobile") nên hàng ▶ bị cắt một
    phần (chấp nhận: không control nào đè nhau, ⓘ vẫn chạm được; cửa sổ đặt đúng trên điện thoại Samsung rộng ≥ ~570 px,
    và kiểu PC nên "Đổi sang Mobile").
