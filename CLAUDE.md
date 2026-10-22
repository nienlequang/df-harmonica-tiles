# CLAUDE.md — Delta Force Harmonica Tiles

Web app tĩnh (không backend) hiển thị guide thổi harmonica trong game Delta Force kiểu Piano Tiles.
Spec gốc: `docs/SPEC.md` (đọc mục "Thay đổi so với spec gốc" ở đầu file trước — ghi đè phần dưới).
Quyết định thiết kế: `docs/DECISIONS.md` (đọc trước khi đổi hành vi core).

Docs khác: `README.md` (hướng dẫn tiếng Việt cho streamer — cập nhật khi đổi UI / format / overlay; mọi tên nút
nhắc tới phải có trong `src/i18n/strings.ts`; link web là **https://df-harmonica-tiles.vercel.app** — token cũ
`VERCEL_URL_TODO` đã thay hết, `withAppUrl` của src/guide vẫn đổi token đó thành gốc app nếu còn sót; phần trước mục
"Cho người phát triển" không link file trong repo trừ `docs/AI-PROMPT-CAM-AM.md` và `docs/images/` — người dùng chỉ
có link web, D-257; phần đó + `docs/AI-PROMPT-CAM-AM.md` hiện nguyên văn ở trang Hướng dẫn `#/guide` — D-260, slug tiêu
đề mà app link tới được `src/guide/guideContent.test.ts` giữ; phần người dùng giữ NGẮN — bắt đầu nhanh → "Những chỗ
hay nhầm" → mục ngắn, D-363), `docs/REFERENCE.md` (tài liệu tham khảo tách khỏi trang Hướng dẫn: `.harm` đầy đủ +
bảng lỗi, phím tắt, tham số URL của overlay, chi tiết từng tính năng, giới hạn đã biết — app hiện nguyên văn file này
cùng `CHANGELOG.md` ở trang **Dev notes** `#/dev`, D-387: link tương đối tính từ `docs/`, `#mục` phải trỏ tới tiêu đề
có thật — `src/dev/devContent.test.ts` / `DevNotesView.test.tsx` ghim vài tiêu đề và đúng một link tên "README"),
`docs/DESIGN.md` (brief giao diện "Tactical HUD" — token màu, font, quy tắc accent; đọc trước khi sửa CSS / màu
canvas), `docs/GAME-UI-REFERENCE.md` (số đo bảng phím của game PC + bảng nút mobile, preset overlay), `docs/AI-PROMPT-CAM-AM.md`
(prompt AI cho cảm âm, nguồn của `src/editor/aiPrompt.ts`), `docs/TAURI.md` (overlay desktop tùy chọn), ảnh README
ở `docs/images/` (home, player-pc, player-mobile, library, ai, editor, obs-link, settings — chụp 1600×900, theme tối,
từ dev server bằng một Edge headless, mỗi ảnh < 300 KB; `home.png` được `src/guide/guideContent.test.ts` ghim),
`docs/LOCAL-TEST-CHECKLIST.md` (checklist SAU DEPLOY trên https://df-harmonica-tiles.vercel.app — tên file giữ từ
thời test local).

## Commands

```bash
npm run dev           # Vite dev server
npm run build         # build vào dist/ (base từ env VITE_BASE, mặc định /; Vercel dùng mặc định)
npm run build:single  # 1 file HTML (dist-single/index.html), mở được từ file://
npm run preview       # xem bản build
npm run test          # vitest run (jsdom)
npm run test:e2e      # Playwright smoke (e2e/), không nằm trong check
npm run lint          # eslint, zero warning
npm run typecheck     # tsc --noEmit
npm run format        # prettier --write   (format:check = prettier --check)
npm run check         # lint + typecheck + test + build — phải xanh trước khi commit phase
npm run icons         # sinh lại icon PWA PNG trong public/icons/ từ hình vẽ trong scripts/gen-icons.mjs (pngjs)
npm run release -- patch|minor|major   # tăng version + CHANGELOG + tag local
npm run deploy        # check rồi deploy PREVIEW lên Vercel (Vercel CLI, lần đầu cần đăng nhập)
npm run deploy:prod   # check rồi deploy PRODUCTION lên Vercel
```

Chạy một file test: `npx vitest run src/core/parser.test.ts`. Vitest 5 cache module trên đĩa
(`node_modules/.vitest-cache`): thêm / đổi file mà `import.meta.glob` đọc (vd. ảnh trong `docs/images`) thì chạy
`npx vitest --clearCache` trước, không thì `guideContent.test` báo "thiếu ảnh" (D-334). Overlay desktop (Tauri, cần
Rust — chưa build thử lần nào): `npx --yes @tauri-apps/cli@2 dev|build`, xem `docs/TAURI.md`.

Mã nguồn công khai: **https://github.com/nienlequang/df-harmonica-tiles** (giấy phép MIT — `LICENSE`; `repository` của
package.json = `SOURCE_REPO_URL` của `src/dev/sourceRepo.ts`, D-444). Kho công khai là một commit mới từ cây làm việc,
không có lịch sử riêng: đừng thêm remote của nó vào kho có lịch sử (`npm run release` tự push khi có remote). Không đưa
vào repo bản ký âm bài hát có bản quyền (kể cả làm fixture test), địa chỉ IP / đường dẫn máy / thông tin cá nhân — ghi
chú riêng của máy để ở `CLAUDE.local.md` (gitignore).

## Deploy

Vercel, deploy từ máy local (không dùng GitHub) — `vercel.json`, `.vercelignore`, `scripts/deploy.mjs` (DECISIONS D-007).
Người dùng cuối chỉ mở link (kể cả OBS), không tải gì; không phát hành zip / HTML 1 file.

- **Project:** Vercel `df-harmonica-tiles` → production **https://df-harmonica-tiles.vercel.app** (tài khoản Vercel của
  chủ dự án; liên kết lưu ở `.vercel/`, đã gitignore).
- **Máy / bản clone chưa liên kết (một lần):** `npx vercel@64.0.2 login` (mở trình duyệt) rồi
  `npx vercel@64.0.2 link --project df-harmonica-tiles` ở thư mục gốc repo.
- **Lần deploy production ĐẦU (bắt buộc theo thứ tự):** `git add -A && git commit` (vòng 7 có nhiều file MỚI —
  `commit -am` bỏ sót chúng: bản deploy vẫn chạy vì Vercel CLI tải cả cây làm việc, nhưng commit ghi trên Dev notes
  không build lại được) → `git status` phải trống → `npm run release -- major` (1.0.0 cho lần ra mắt; đổi
  `## [Unreleased]` của CHANGELOG thành `## [1.0.0] - <ngày>`, commit + tag local; cây phải sạch) →
  `npm run deploy:prod`. Trang Dev notes `#/dev` khi đó ghi **Phiên bản 1.0.0**, commit = commit release, không
  `-dirty` — còn `0.0.0` / `-dirty` nghĩa là bỏ sót bước.
- **Deploy lại:** `git add -A && git commit` (Dev notes ghi commit; còn thay đổi chưa commit — kể cả file mới chưa
  add — thì `<sha>-dirty`, `git status --porcelain` ở deploy.mjs / vite.config.ts), `npm run release -- patch|minor`
  khi là bản phát hành mới, rồi `npm run deploy:prod` (= `npm run check` →
  `npx vercel@64.0.2 deploy --prod --build-env DFHT_COMMIT=<sha>`; Vercel `npm ci` + `npm run build` lại từ source).
  `npm run deploy` = bản preview (link riêng, không đụng production); `-- --skip-check` bỏ check (không khuyến khích).
- **Sau deploy:** đi qua `docs/LOCAL-TEST-CHECKLIST.md` (checklist sau deploy: PC Chrome, iPhone Safari, OBS, PWA +
  offline, nhắc bản mới, các mục vòng 7).
- **Quy tắc:** chỉ deploy production khi người dùng đồng ý (luồng đã thống nhất: test → sửa theo phản hồi → người dùng
  OK → Claude chạy `npm run deploy:prod`). Không tự deploy trước bước duyệt của người dùng.

## Cấu trúc

```
src/
  core/      model + logic thuần (không React/DOM): types, keys (+ `GAME_SCROLL_DIR` = +1: Nửa Cung luôn thăng),
             parser (+ span nguồn; tiền tố lời cũ `lời: ` được nhận rồi bỏ — `LEGACY_LYRIC_SPLIT_RE`), serializer
             (không bao giờ ghi lời), timeline, stats, sourceEdit (sửa văn bản theo span), optimizer + melodyBuild
             (Melody ↔ Song; cost model PC hoặc Mobile), mobile (kế hoạch chạm chế độ, số giản phổ), mobileText
             (donate kiểu mobile), camam (cảm âm), tapTiming, donate (chia tin k/n), share (lz-string),
             repeatRuns (đoạn bấm lặp ≥ 4 nốt ≤ 0,5 beat cùng một lần bấm + số lần bấm còn lại — D-447).
             Test kỹ nhất ở đây.
  audio/     Web Audio: engine (AudioContext lazy; `unlock({ playback })` / `holdPlayback` / `releasePlayback` —
             phiên "playback" đếm theo holder; `UNLOCK_TIMEOUT_MS` 3 s, 'interrupted' = như suspended), playbackSession
             (iPhone kêu cả khi gạt nút im lặng: `navigator.audioSession.type = 'playback'`, iOS cũ = `<audio>` im lặng
             lặp data: WAV; máy khác không làm gì — D-421), gestureUnlock (`unlockAudioInGesture` cho Cài đặt — chỉ
             mở khóa, không giữ phiên, D-423), synth harmonica/sine (harmonica = mẫu thu thật `harmonicaSamples.ts` —
             FluidR3_GM CC BY 3.0, `samples/harmonica/<midi>.mp3` C3–D6, tải khi AudioEngine tạo context, chưa có thì
             synth; `SAMPLE_PEAK` 8 vì mẫu rất nhỏ), metronome, scheduler (click đếm vào ở mọi beat nguyên
             từ đầu đếm vào tới nốt đầu, nhấn ở đầu ô nhịp — `leadInClickEnd`, D-428); engine dựng sẵn bảng sóng khi tạo
             AudioContext (`primeWaveTables` — constructor, không `createOscillator`, D-430); fakeAudioContext /
             fakePlaybackEnv chỉ cho test.
  home/      HomeView = route `#/` = `<PlayerView songId={DEMO_SONG_ID} home />` (màn chơi đầy đủ với bài mẫu —
             không còn màn demo / ☰ Menu); demoSong.ts (`DEMO_SONG_ID` = `seed-quoc-ca-viet-nam`, tách riêng để
             lastPlayed không import Player); newSong (template bài trống của link "hoặc tự gõ từ đầu" ở `#/ai`,
             luôn `@scroll +1`).
  ai/        "Tạo bài với AI" (route `#/ai`, góp ý 2026-10-16, D-358): AiCreateView (4 bước: Sao chép prompt → mở AI
             chat → ô "Dán kết quả của AI vào đây" → Tên bài + Lưu = `addSong` thẳng / Mở trong Editor = bản nháp;
             link "hoặc tự gõ từ đầu" = bản nháp trống), PasteSummary (dòng kết quả, chỗ không đọc được, select
             "Tông"; dùng chung với ô dán của Editor), ai.css.
  player/    transport + clock, canvas renderer (thanh bấm lặp — D-447: đoạn của core/repeatRuns vẽ thành MỘT tile dài
             `collectBar` / `drawBarBody`, vạch ở đầu từng nốt, nhãn phím + `player.repeatCount` "×n" đứng ngay trên hit
             line, đếm lùi, hết thì ẩn; sáng / luyện tập theo đoạn của từng nốt; mọi bố cục / hướng / overlay / trang
             mini / video — tiếng, game bar, vòng "CHẠM" vẫn theo từng nốt), PlayerView (route `#/` và
             `#/play/:id`: header "◂ Thư viện" + tên
             + chip + TransientNotice (bản nháp / bài tạm: chip + nút giữ bài lại, D-335) + PrefButtons;
             TransportBar; thân 3 cột = ShortcutsHelp (trái, ≥ 1200 px; hẹp hơn = nút "?") · khu tiles ·
             PlayerSideBar (thanh dọc phải: Kiểu điều khiển PC | Mobile, Cửa sổ nổi — Mobile hoặc điện thoại không
             có Document PiP thì mở MiniLauncher, OBS, Chia sẻ, Cài đặt); PlayerSeekBar ở đáy;
             `#/play/draft-…` đã Lưu → chuyển sang bài đã lưu, D-336), game bar / banner PC + Mobile (mobilePlan.ts); practice mode
             (practice.ts chấm điểm thuần, practiceInput.ts phím nốt + nút chuột — không có phím thay chuột,
             PracticePanel.tsx HUD + kết quả; kiểu Mobile chỉ nhận bàn nút trên màn hình). Kiểu Mobile = bố cục
             giống màn chơi kèn (Phase 4m): MobilePad.tsx (8 nút số + 4 nút chế độ ở đáy khu tiles, thay game bar)
             + mobilePad.css; layout.ts `padGeometry` / `lanePadding: 'pad'` (renderer và bàn nút dùng chung một
             hình học); mobilePadInput.ts (luyện bằng chạm: chốt chế độ, đa chạm → PracticeInputEvent
             'tap-down'); padPrefs.ts (rung, gợi ý xoay ngang). Nhắc chạm chế độ = **vòng "CHẠM" trong suốt** (vòng
             7, D-373): viền màu chế độ, Ø ngoài = Ø nút chế độ, chữ `player.mobile.tapBar` ở tâm (mờ dần khi vòng
             tới gần nút, không có lúc đồng tâm / đứng trên nút — `CUE_TEXT_FADE_FAR` / `_NEAR`, D-390), tâm đi
             `CUE_RING_SPEED` = 1,75 × tốc độ tile và đồng tâm nút đúng beat cue (`cueTargets(L)` / `cueRingAxis` trong
             layout.ts), giữ trên nút rồi mờ trong `CUE_RING_HOLD_BEATS` (renderer.ts); token `cueRing` / `cueHalo` /
             `cueText` ở canvasTheme.ts (D-376). Vòng vẽ lên lớp canvas trong suốt `canvas[data-cue-layer]`
             (`CUE_LAYER_ATTR` ở layout.ts; MobilePad render là con cuối, renderer tìm trong cha của canvas tiles —
             không có thì vẽ lên canvas tiles) để nằm TRÊN nút DOM (D-374). Kiểu Mobile KHÔNG có gutter ribbon / chữ
             "CHẠM: <tên chế độ>" ở bố cục nào (`layoutOptionsOf` trong renderer.ts, D-366): màn chơi, trang mini "Thu
             nhỏ", Cửa sổ nổi dùng `lanePadding: 'pad'` + MobilePad đầy đủ; trang mini "Khớp nút game" dùng
             `lanePadding: 'fit'` + `laneFit` (layout.ts `fitGeometry` — lane theo tâm 8 nút số thật của game, hit line
             = mép dưới, vòng đáp sát mép dưới ở cột nút chế độ thật + 4 vòng đích mờ; số đo `GAME_MODE_COLUMNS` /
             `DEFAULT_LANE_FIT`, D-396, D-397; `laneFit.stepPx` / `shiftPx` = đúng tỉ lệ thật: bước cột px CSS, hàng
             nút căn giữa khung + dời, bỏ qua first / last — renderer tính lại theo cỡ canvas, D-405); trang mini
             "Khớp nút game · dưới nút" = 'fit' + renderer `flipY` (lật dọc cả khung bằng `setTransform(dpr, 0, 0,
             −dpr, 0, devH)` — ô đi lên, hit line + vòng ở mép trên; chỉ khi `L.fit`; khối nhãn tile / thanh dời nguyên
             khối tới ảnh gương trong collectTiles / collectBar rồi vẽ đứng thẳng, chữ CHẠM ở y lật, vạch / nhãn
             section tắt; layout.ts không đổi; option không phải khóa layout — người gọi gửi rõ `flipY: false` khi rời
             bố cục đó vì option được gộp — D-448); overlay OBS
             truyền `modeTargets: 'outline'` (mặc
             định 'pad') → không bàn nút, renderer tự vẽ 4 vòng đích mờ ở hàng nút chế độ (lane dọc) hoặc sau hit line
             (dải ngang) — D-375. Canvas KHÔNG vẽ số đếm vào (D-354; số to chỉ có ở đếm ngược, phần DOM). Đếm ngược
             = khung pre-roll (getter `preRoll` của engine: vẽ beat `from − countIn`, transport vẫn dừng ở `from`;
             hết đếm ngược `start()` trước rồi mới xóa số — D-377); bước khung đứng yên ↔ pre-roll / đếm vào (bấm
             Phát, hủy đếm ngược, đếm ngược Tắt mà đếm vào bật) trượt mượt `PRE_ROLL_GLIDE_SEC` qua preRollGlide.ts
             (`beatFor` mỗi khung ở PlayerEngine + OverlayEngine — D-389); glowWarmup.ts làm nóng `shadowBlur` của tile
             (D-380 — hằng số theo `drawTileBodies`) và hiệu ứng DOM của lần chạm đầu bằng phần tử THẬT (`warmDomEffects`:
             keycap sáng + banner giữ + nhãn modifier, opacity 0,01, con trực tiếp của stage ngoài `.game-bar` / `.mpad` /
             chỗ banner, gỡ sau `DOM_WARMUP_MS` 700 ms — PlayerEngine + OverlayEngine, D-429; chưa phần tử nào có CSS
             mà document còn `<link rel=stylesheet>` đang tải — Cửa sổ nổi bản build — thì chờ load / error của chúng, tối
             đa `DOM_WARMUP_WAIT_MS` 2 s, D-440). leadIn.ts (thuần): độ dài
             đếm vào `leadInBeats` = max(0, 0,65 × ô nhịp − 0,35 × khoảng lặng tới nốt đầu) → nốt đầu đi 0,65 × quãng cũ
             (D-427; PlayerEngine, OverlayEngine, video PiP; overlay theo Player chép dải đếm vào trong tin `state`), nới
             cho đủ `LEAD_IN_MIN_CLICKS` = 2 beat nguyên trước nốt đầu (+ `LEAD_IN_CLICK_MARGIN` 0,001; trần 1 ô nhịp —
             bài 2/4 / 3/4 vào ngay đầu ô nhịp, D-439).
             layout.ts `framePad` (bước cột, chỉ `lanePadding: 'none'`) / `Layout.frameInset` / `GAME_FRAME_PAD` 0,26 =
             khung bảng phím PC của game: 8 làn ở giữa, gutter sau đệm phải, renderer bỏ vạch mép ngoài 8 làn + vẽ vạch mép
             phải khung (D-431, D-432); `FIT_WINDOW_STEPS` = 8 = cửa sổ lý tưởng của 'fit' (D-434). TransportBar không
             có Đếm vào / Đếm ngược (chỉ ở Cài đặt) nhưng có Lookahead và nút loa của giai điệu mẫu cạnh Tempo (prop
             `onSound`, chỉ prop — PlayerView giữ hộp cảnh báo; TransportBar.css: đỏ khi bật — D-392, D-394). `usePlayerEngine` `mobilePad`: Mobile →
             'pad' thắng `lanePadding` cố định, PC → lanePadding cố định (Cửa sổ nổi 'none') hoặc 'normal'.
  editor/    EditorView (.harm textarea + preview, lịch sử Công cụ, hashGuard chặn rời trang; bản nháp
             `draft-…`: chưa sửa thì rời đi không lưu / không hỏi), AiPasteBox (ô "Dán kết quả của AI vào đây" ngay
             trên ô soạn: dán = chuyển + thay bài, một bước Hoàn tác; gõ / kéo thả = xem trước + "Áp dụng" — D-360;
             "dán" = `inputType === 'insertFromPaste'` của chính lần nhập, không cờ onPaste; prop `source` → "Đã đưa …"
             chỉ khi ô soạn còn đúng kết quả; giữ @title/@artist/@bpm/@time của bài khi văn bản dán thiếu — D-369;
             mọi khối code được ghép — D-368),
             camamConvert.ts (thuần: câu trả lời AI / cảm âm / .harm → .harm tông dễ nhất, dùng chung `#/ai` — D-359),
             aiPrompt.ts (prompt VI / EN, `AI_CHATS`, `AI_GUIDE_SECTION`), DonateModal, ShareView, OptimizerPanel
             (dùng chung với MIDI; gập quãng luôn bật); tools/ = modal Công cụ (TapTiming, Reoptimize — không còn
             Nhập cảm âm) theo contract tools/types.ts.
  library/   seeds (.harm ?raw; `SEED_SONGS` theo thứ tự hiển thị: `seed-quoc-ca-viet-nam`, `seed-takediskrush` —
             bài người dùng tự tạo, chép nguyên byte; hai bài cũ đã bỏ trước deploy, file `.harm` chỉ còn là fixture
             test ở `src/test/fixtures/` — D-364, D-386), store (zustand persist, version +
             migrate; bài tạm `shared-…` và bản nháp `draft-…` — openDraftSong / isDraftSong / saveDraftSong /
             draftSavedAs — chỉ nằm trong bộ nhớ, không persist, không vào danh sách; saveSharedSong / sharedSavedId
             = lưu bài từ link một lần, dùng chung ShareView và màn chơi), import/export, LibraryView (route
             `#/library`: mục "Thêm bài" 4 cách theo thứ tự Tạo bài với AI → từ file MIDI / MusicXML → nhập file ký
             tự → tự chơi, D-357; dòng fan-made ở chân).
  midi/      MidiImportView "Tạo bài từ file" (FileWizard MIDI + MusicXML, Thu melody), midiFile (@tonejs/midi,
             tải động; không đọc lời), musicxml + zip (.mxl, DecompressionStream), fileLoad, extract,
             melodySuggest (gợi ý track / bè / giọng theo mật độ nốt mỗi phách ≈ 1, đơn âm, không bè trầm, tên),
             autoArrange (tự chia dòng + section, marker khi hợp lý — wizard + Thu melody), arrange (bản cũ
             `arrangeMelody`, recorder còn dùng), mapping, webmidi (Web MIDI), recorder, PianoRoll; finishSteps mở
             kết quả thành bản nháp; testing/ (smf, musicxml, zipBuild) sinh fixture cho test / e2e (app không
             import).
  overlay/   route overlay OBS (Phase 3, góp ý 2026-10-15 "OBS chỉ lo hiển thị"): OverlayView (chỉ ô rơi, nền trong
             suốt, LUÔN im lặng, không ghi Cài đặt; kiểu Mobile: không bàn nút / game bar, chỉ 4 vòng đích mờ —
             `modeTargets: 'outline'`, D-375; theo Player chính, không nghe thấy Player ~2 s thì tự chạy;
             "Đang chờ màn chơi…" ở mọi cửa sổ trình duyệt thường, không bao giờ trong OBS; `preview=1` = cửa sổ
             "Xem trước" — `html.overlay-preview` nền tối, khung 16:9, bảng phím game minh họa, nhãn "Xem trước ·
             không dùng để quay", D-349; không còn nút "⛶ Toàn màn hình"; `bg=chroma` chỉ còn cho link cũ;
             `.overlay[data-beat]` cho e2e), overlayEngine (+ applyFollow; `preRoll` + `prepare('play'|'restart'|null)`
             cho đếm ngược của chính nó / trang mini — D-377, D-379),
             overlayParams (đọc tham số URL + dựng link + preset + bố cục cả canvas `fit=canvas` /
             `canvasPlacement`; `gameKeyboardBox` cho bảng phím minh họa của Xem trước), follow.ts (contract tin
             song / state / hello / bye, đồng hồ chung `Date.now()`; `countIn` trong tin `state` có `playing = false`
             = đếm vào đang chờ → overlay vẽ khung pre-roll; `sentAt` ở tương lai → overlay chờ, tối đa 1 s, qua
             `PlayOptions.startDelaySec` của Transport — D-378),
             followBroadcast.ts (Player + Cửa sổ nổi phát: BroadcastChannel `dfht-follow` + relayToObs; mỗi tab
             một bộ "nói" theo `priority` — cửa sổ nổi thắng, D-338; mount / bài đổi = cause `announce`, không giành
             overlay — D-337; `bye` lúc pagehide rồi im), followReceiver.ts (overlay nhận: waiting → follow /
             standalone / lost; nhớ bài của vài người gửi), obsWebsocket.ts (client obs-websocket v5 tự viết),
             obsBridge.ts (kết nối dùng chung của tab: tự nối lại, relay `CallVendorRequest` obs-browser
             `emit_event`, "Thêm overlay vào OBS" = Browser Source "DF Harmonica Tiles" cỡ canvas tại 0,0),
             ObsConnectPanel (+ obsConnect.css) mục "Gửi thẳng vào OBS", ObsLinkModal "Tạo link OBS" (01 Kiểu
             overlay, 02 Hiển thị — độ đậm / cỡ UI game, nhớ ở localStorage `dfht-obs-display` qua obsLinkPrefs.ts —
             rồi 2 cách: 03 Gửi thẳng vào OBS (khuyên dùng), 04 Browser Source thủ công; hàng cuối không đánh số
             "Xem trước" = popup 960×540 link Browser Source + `preview=1`; KHÔNG còn Window Capture / "Mở thử" /
             nền chroma — D-348; mở từ nút OBS của Player), commands.ts (contract
             lệnh ngoài `dfht:command`: toggle / restart / nextLine / prevLine = Space / R / → / ←); testing/fakeObs.ts
             (OBS giả cho test).
  record/    "Tự chơi để tạo bài" (route `#/record`, Phase 3b): recorder.ts (thuần: gom phím / chuột / nút mobile
             thành nốt, quantize, .harm), RecordView (thiết lập, đếm vào bằng đèn nhịp, khung thu, bàn nút Mobile,
             Thu lại / Hoàn tác, Mở trong Editor = bản nháp, chặn rời trang), RecordRoll (canvas cuộn nốt 8 làn),
             record.css.
  pip/       "Cửa sổ nổi" (Document Picture-in-Picture, Phase 3b): FloatingWindow (mở / đóng / nhớ kích thước, một
             cửa sổ duy nhất, React root riêng), pipDocument (chép + đồng bộ style / theme / ngôn ngữ sang cửa sổ
             nổi), FloatingStage (8 làn kiểu khớp bảng phím game, thanh nhỏ, Căn chỉnh; đếm ngược / đếm vào theo
             Cài đặt — không ô riêng, D-367, đếm ngược tối thiểu 3 s `floatingCountdownSec`, D-381; kiểu Mobile =
             `mobilePad` + MobilePad chỉ hiển thị, D-366),
             FloatingWindowButton (thanh dọc Player, kiểu PC: một nút bật / tắt `aria-pressed`), pipPrefs (cỡ chuẩn
             theo màn hình — `k / dpr = screen.height / 1080`, rộng `round(553,8·k/dpr)` (`PIP_FRAME_1080` = khung bảng
             phím PC, renderer `framePad: GAME_FRAME_PAD` — D-433) + gutter của `presetTileScale`,
             cao NGOÀI `750·k/dpr` (mép trên màn → mép trên bảng phím) trừ thanh tiêu đề đo được `dfht-pip-chrome`
             (chưa có thì đoán 34) — `fitOuterHeight` chỉnh ngay khi còn user activation; cỡ tự kéo `dfht-pip-size`
             kèm màn hình, chỉ dùng lại trên đúng màn đó; `resetToStandardSize` cho nút "Đặt lại cỡ chuẩn" của
             FloatingStage — D-407 – D-410; `WindowPlan` = `kind` + `target` (cỡ muốn có) + `size` (cỡ xin —
             `capRequestSize`: vượt trần 25 % diện tích màn của Chrome thì giữ bề ngang, hạ chiều cao, `fitOuterHeight`
             kéo lên cả bề ngang — D-418); `requestInitialPlacementOnce` / `takeInitialPlacement` = lần `requestWindow`
             sau "Đặt lại cỡ chuẩn" bị từ chối xin `preferInitialWindowPlacement` — D-419; `floatingCountdownSec` =
             clamp(Cài đặt, 3, 10) dùng chung FloatingStage + MiniView),
             phonePref.ts (module nhẹ: "Apple / Android" nhớ ở localStorage `dfht-phone-kind`, `usePhoneKind`,
             `guessPhoneKind`, `useIsApplePhone`, `isAppleMobile` — D-383); FloatingStage phát follow cho overlay OBS
             (`FLOAT_FOLLOW_PRIORITY`);
             testing/fakePipWindow.ts cho test. Engine chạy bằng cửa sổ nổi qua option `hostWindow` của
             usePlayerEngine; renderer lấy DPR / ResizeObserver từ document chứa canvas. Phase 4m: videoPip.ts
             ("Cửa sổ video nổi" = PiP của `<video>`: Trực tiếp = canvas stream, Dựng sẵn = WebCodecs) + webm.ts
             (muxer WebM tự viết). Mở PiP theo kiểu chuẩn bị trước — chạm sau (D-361): `prepareLiveVideoPip` /
             `prepareVideoBlobPip` dựng `<video>` muted / playsinline TRƯỚC lần chạm, `enter()` gọi
             `requestPictureInPicture()` (hoặc iOS `webkitSetPresentationMode`) ĐỒNG BỘ, không await gì trước — đừng
             thêm `await` trước lệnh đó (Safari mất user activation); lỗi → câu thân thiện (`videoPipErrorKind`);
             video chuẩn bị lỗi / quá `PREPARE_STALL_MS` hoặc iPhone "chưa sẵn sàng" lần 2 → câu "không hỗ trợ" (D-370).
             Video theo Cài đặt → Đếm vào (`GuideVideoOptions.countIn`); bộ vẽ video có lớp vòng CHẠM riêng dán lên bàn
             nút nó tự vẽ (D-374). Máy Apple: không có "Trực tiếp" (Safari không mở PiP của luồng canvas), chỉ dựng
             sẵn — chạy cả qua `http://` trên iPhone (D-385).
  mini/      trang mini cho cửa sổ nổi Android (route `#/mini/:id`, Phase 4m, thử nghiệm): MiniView (ba bố cục nhớ
             theo máy; chưa chọn → theo kiểu điều khiển: Mobile = "Khớp nút game" (lane 'fit' ngay trên bảng nút
             thật, không bàn nút / banner chế độ riêng — D-403, Căn chỉnh lúc dừng), PC = "Thu nhỏ" (làn + bàn nút /
             game bar thu nhỏ) — D-395, D-402; "Khớp nút game · dưới nút" (`'below'`, D-448 — điện thoại Samsung: cửa
             sổ pop-up đặt DƯỚI hàng nút số, phần dưới ra ngoài màn; `isFitLayout` = game | below, chung `laneFit` +
             số căn chỉnh, renderer `flipY`; trang thu về phần THẤY `belowVisibleOf` → `:root[data-mini-layout]` +
             `--mini-visible-h` (`data-mini-short` ≤ 240 px — hộp thoại portal cũng trong phần đó; mini.css lặp luật
             hộp thoại thấp của app.css), `--mini-align-top` = bảng Căn chỉnh ngay dưới hàng vòng, kẹp trong phần
             thấy, `.mini-edge-mark` vạch đứt ở đáy (lúc dừng, cả Căn chỉnh), `.mini-below-rest` dòng nhắc dưới phần thấy
             (portal, chỉ lúc dừng); khoảng trống đáy = "Đáy ◂ ▸" (`MiniBelowGap`) ở `.mini-top` của panel lúc dừng, TRƯỚC
             tên bài (sau ◂ + huy hiệu: không xê dịch khi bấm qua ngưỡng cao) — KHÔNG ở Căn chỉnh (góp ý 2026-10-22);
             'below' mọi bề ngang: `.mini-top` xuống dòng, tên `flex-basis: 0` co "…", ẩn `.mini-fit-numbers`; < 560 px
             bỏ thêm huy hiệu; mini.css:
             mọi luật theo CHIỀU CAO là `@container mini (…)` — `.mini { container: mini / size }`, Chrome 105+);
             kiểu PC: panel lúc dừng có "Đổi sang Mobile"; panel lúc dừng gói
             2 hàng ở cửa sổ ≤ 130 px cao, không control nào chồng nhau — D-401; OverlayEngine → luôn im lặng; nút "◂" — aria "Về màn chơi" — về `#/play/<id>`, CHỈ hiện khi
             đang dừng theo `isMiniStopped()`, D-362; đếm ngược / đếm vào theo Cài đặt → Phát bài, đếm ngược tối
             thiểu 3 s, `?delay=` đè — D-367, D-381), miniControl (đếm ngược / tạm dừng; `parseMiniDelay` 0..10,
             không nhớ riêng; gọi `target.prepare?(action)` khi đếm ngược bắt đầu / `prepare(null)` khi hủy — D-379),
             miniAlign.ts (thuần: bố cục `dfht-mini-layout` + `defaultMiniLayout(scheme)`, số căn chỉnh
             `dfht-mini-calibration` — tâm nút 1 / 1̇, dời / giãn hàng chế độ, `laneFitOf`, nút − / + theo px của khung
             `nudgeCalibration(c, field, dir, widthPx, px)` — D-400, try/catch; đúng tỉ lệ thật — `readScreenInfo`,
             `isAndroidTouch()` (D-412: chỉ máy Android cảm ứng), `trueScaleOf(screen, viewW, androidTouch)` (màn ngang,
             bề ngang trang ≤ 0,95 cạnh dài) → `refH = min(H, W / GAME_REF_ASPECT)`, bước = `GAME_NOTE_STEP_H` × refH ×
             `stepScale` (UI game phóng theo chiều cao — D-413), `panelTop` / `modeTop` (bảng nút bám đáy màn), dời
             `shift` px; chỉ báo `fitStatusOf` Rộng (`FIT_WINDOW_STEPS` = 8 làn — D-434, không cộng `shift`; 8 làn ra ngoài mép →
             `moveLeft` / `moveRight` — D-415) / Cao (mép dưới từ `panelTop` tới `modeTop`, thanh cửa sổ nổi
             `FLOAT_BAR_GUESS` 24 / `FLOAT_BAR_MAX` 36, `browserChromeHeight` — D-414) — D-405, D-406; MiniView đặt
             `data-scale="true"`; `needsFitWindowNotice` / `dismissFitWindowNotice` = nhắc một lần "kéo rộng thêm ¼ nút"
             cho máy đã mở trang mini ở bản 1.0.0 (`dfht-mini-song` có, không `dfht-mini-calibration`, chưa dấu
             `dfht-mini-fit8`; chỉ hiện ở "Khớp nút game" không đúng tỉ lệ thật — `MiniFitNotice` của MiniCalibrate.tsx ở
             chỗ chỉ báo; chạm = hướng dẫn `fit` + ghi dấu — D-441); "dưới nút" (D-448): `GAME_NOTE_BOTTOM_H` (đáy hàng
             nút số 426,5 / 633), `belowVisibleOf(scale, chromeH, innerH, calib)` = (1 − GAME_NOTE_BOTTOM_H) × refH −
             FLOAT_BAR_GUESS − chromeH + `edgeShift` (px, −600…+400), kẹp [`BELOW_VISIBLE_MIN` 80, trang];
             không biết cỡ màn → cả trang; `belowEdgeRange` = tầm `edgeShift` còn đổi phần thấy;
             khoảng trống đáy `belowGapOf(innerH, visibleH)` = trang − phần thấy, nút "Đáy ◂ ▸" = `stepBelowGap(c, dir,
             range, px)` (▸ +1 = khoảng trống lớn hơn = `edgeShift` − `BELOW_GAP_STEP_PX` 8, giữ `BELOW_GAP_FAST_PX` 24,
             kẹp `belowEdgeRange`) + `canStepBelowGap` (hết tầm → nút `aria-disabled`); một nguồn = `edgeShift`, "Đặt lại
             mặc định" của Căn chỉnh giữ nó),
             MiniCalibrate.tsx (`MiniFitStatus` = chip "Rộng" / "Cao", `SCALE_ALIGN_CONTROLS` [Vạch · Dời | Vạch · Giãn
             | Vòng · Dời | Vòng · Giãn] khi đúng tỉ lệ thật — nút chọn hai dòng `group` + `short`, `alignFocusOf` →
             `MiniAlignGuides focus` tô sáng 8 vạch / 4 vòng đang chỉnh, tên vòng tới Ø `GUIDE_NAME_MIN_D` — D-416; nhãn
             làn, vạch + vòng căn chỉnh — nhãn số chỉ hiện khi còn chỗ dưới bảng, `guideKeyTop`; bảng "Căn chỉnh" chỉnh
             MỘT số mỗi lúc: nút chọn [Vạch · Nút 1 | Vạch · Nút 1̇ | Vòng · Dời | Vòng · Giãn] + − / + giữ để lặp
             (`useHoldRepeat`) + thanh trượt khi đủ rộng,
             cửa sổ ≤ 220 px cao một hàng ~36 px — D-398, D-399; `ShortLong` = chữ dài / ngắn của nút, chữ ngắn nằm
             trong `aria-label`; không đặt tên MiniAlign.tsx: trùng miniAlign.ts trên Windows; "dưới nút" — D-448:
             `MiniAlignGuides flip` (lật: mép sáng ở đỉnh, vòng ngay dưới, không nhãn số), `alignControlsFor(scheme,
             scaled)` như "Khớp nút game" (không có số đáy), lời nhắc `mini.align.helpBelow*`, `MiniFitStatus
             showHeight={false}` = chỉ chip "Rộng"; "Cao quá" có tooltip nhắc Samsung dùng "dưới nút"; `MiniBelowGap`
             = "Đáy ◂ px ▸" của panel lúc dừng — `useHoldRepeat` dùng chung, `onStep` trả `false` thì thôi lặp),
             wakeLock, MiniHelp (hướng dẫn theo hãng; `MINI_HELP_DEVICES` "Bố cục nên dùng theo máy" — điện thoại
             Samsung → dưới nút, máy tính bảng Samsung / OPPO + đa số máy gập → Khớp nút game, điện thoại hãng Trung Quốc
             → Thu nhỏ, đứng đầu hộp thoại / ngay sau đoạn nút chọn ở `section="fit"`, class `mini-help-device*` riêng —
             D-448; `section="fit"` = kéo / đổi cỡ cửa sổ khớp nút game), MiniLauncher + MiniLauncher.css (nút Cửa sổ nổi của Player trên
             điện thoại, prop `songId` = bài đang mở: hỏi "Apple / Android" trước — PhoneChooser, chân hộp thoại
             PhoneKindLine "Đổi loại điện thoại" —, Android → hộp thoại "Cửa sổ mini / video nổi (thử nghiệm)" + "Mở
             trang mini", Apple → MiniLauncherVideo; không `songId` = ô chọn bài, không hỏi — D-383),
             MiniLauncherVideo.tsx (TẢI LƯỜI: `SongVideoPip` / `AppleVideoBody` — dựng sẵn ngay khi mở, nút "Mở video
             nổi" gọi `openBuilt` đồng bộ trong cú chạm, sống cùng màn chơi sau lần mở đầu để giữ phiên PiP;
             `songVideoCountdown` tối thiểu 3 s — D-384), VideoPipDialog (`pip.arm()` khi mở hộp thoại để chuẩn bị
             video; nút mở có `data-ready`; `apple` / `liveOffered` — máy Apple ẩn "Trực tiếp" và tự dựng sẵn, D-385),
             mini.css.
  guide/     trang "Hướng dẫn" (route `#/guide`, `#/guide/cam-am`, D-260): markdown.ts (bộ đọc markdown tối giản,
             thuần; bộ đếm slug dùng chung được), guideContent (README / prompt AI cảm âm nạp `?raw`, cắt phần người
             phát triển, map link / ảnh — `docs/REFERENCE.md` → `#/dev`; `repoPath`, `withAppUrl`), MarkdownView
             (khối → React, không HTML thô; prop `resolve: LinkResolver`), GuideView (chân trang = DevNotesLink),
             guide.css.
  dev/       trang "Dev notes" (route `#/dev?s=<id tiêu đề>`, tải lười, vòng 7 — D-387): DevNotesView (h1 "Dev notes",
             link "Mã nguồn (GitHub)" — SourceCodeLink + sourceRepo.ts, D-444 —, vùng "Bản đang chạy" = phiên bản /
             commit / ngày build, mục lục, REFERENCE + CHANGELOG), devContent.ts
             (nạp `?raw` hai tài liệu, tiêu đề hạ một bậc, slug không trùng, `resolveDevLink`), buildInfo.ts
             (`__BUILD_COMMIT__` / `__BUILD_DATE__` của vite.config.ts — '' dưới Vitest), DevNotesLink.tsx +
             devNotesLink.css (link nhỏ eager ở chân Hướng dẫn và Cài đặt; Hướng dẫn có thêm "Mã nguồn (GitHub)" —
             `withSource`), dev.css.
  desktop/   tauriBridge.ts: có `window.__TAURI__` thì nghe sự kiện Tauri "dfht-command" → phát `dfht:command`;
             trình duyệt thường không làm gì (import một lần trong main.tsx).
  ui/        router (hash, interceptor chặn điều hướng), settings store (v5: âm thanh mặc định tắt,
             controlScheme, labelOverrides, startDelaySec 3, subLabel 'none', lookahead 6 — v4 → v5 đổi 8 → 6,
             D-353; bỏ showLyrics / scrollDir / practiceKeys), MelodyConfirm.tsx (`MelodyConfirmDialog` = hộp cảnh
             báo bản quyền + `useMelodyToggle` — dùng chung Cài đặt → Âm thanh và nút loa của thanh điều khiển, D-393),
             SettingsView (7 thẻ đánh số trong 2 cột cố định:
             01 Kiểu điều khiển · 02 Giao diện · 03 Phát bài · 04 Harmonica | 05 Âm thanh · 06 Luyện tập · 07 MIDI
             cuối; không có thẻ Phím tắt, không có ô Lookahead; Âm thanh là thẻ thường — D-355, D-356), modLabels
             (tên gọi nút), lastPlayed.ts (đích nút "◂ Về màn chơi", sessionStorage;
             bản nháp đã Lưu → bài đã lưu qua `resolvePlayedId`), useHotkeys (Space trên control được Tab tới = bấm
             control, D-345),
             PrefButtons (ngôn ngữ + theme, dùng chung nav và header Player), ShortcutsHelp (danh sách phím tắt
             đầy đủ: cột trái Player, hộp thoại "?"), components dùng chung, features (cờ phase),
             palette, app.css, toast; pwa.ts + UpdatePrompt (service worker, "Có bản mới"; `watchForUpdates` gọi
             `registration.update()` khi tab hiện lại — cách nhau ≥ 5 phút — và mỗi 45 phút khi tab hiện, bỏ lượt khi
             offline, lỗi mạng im lặng — D-382; overlay / trang mini không đăng ký SW).
  test/      fixtures/ — `.harm` chỉ cho test, hai bài tự soạn (app không import — D-443):
             `bai-thu-nhip-dieu.harm` (nhịp đủ loại, luyến giữ phải ngắn, điệp khúc giữ phải 8 dòng; optimizer §9) và
             `bai-thu-lap-doan.harm` (@artist, @repeat, đoạn rỗng, giữ trái nhiều dòng, `Z-L:N`, Nửa Cung, dòng dài).
  i18n/      strings.ts (MỌI chuỗi UI, vi + en), useT.
public/icons/  icon PWA: icon.svg (viết tay) + PNG 192 / 512 / maskable / apple-touch do `npm run icons` sinh.
e2e/         Playwright: smoke.spec.ts (Phase 1; mọi bài mẫu), library-a11y.spec.ts ("Thêm bài" đúng thứ tự — AI
             đầu, link Sửa, Player không có nút Sửa, dòng fan-made), phase2.spec.ts (Editor, Donate, share, MIDI →
             bản nháp, practice, Cài đặt 2 cột — Âm thanh hiện sẵn, MIDI cuối, không Phím tắt / Lookahead),
             first-run.spec.ts (`#/` = màn chơi đầy đủ với bài mẫu: thanh dọc đúng thứ tự, cột phím tắt, tiến độ ở
             đáy, đếm ngược 3 s mặc định, thanh điều khiển không có Đếm vào / Đếm ngược, "◂ Thư viện" ↔ "◂ Về màn
             chơi", 375 px), phase2c.spec.ts (âm thanh, Mobile, nút PC | Mobile ở thanh dọc, chia sẻ ở Thư viện,
             MusicXML có mật độ "≈ N nốt/phút"), overlay.spec.ts (overlay OBS — nền trong suốt kể cả trước khi JS
             chạy, không có nút nào, layout game, link cũ tự chạy khi không thấy Player, cửa sổ "Xem trước"
             `preview=1` theo Player + nền tối / nhãn / 8 phím minh họa thẳng làn, khung 610 × 600 tại (683, 150) —
             bảng phím minh họa x 683 rộng 554, `--lane-left` 17px / `--lane-right` 73px, link data= từ nút OBS),
             pwa.spec.ts (Phase 3: SW + offline, bản 1 file mở từ file://),
             record.spec.ts (Phase 3b: thu bằng phím + chuột → Editor bản nháp), pip.spec.ts (Phase 3b: cửa sổ nổi
             từ thanh dọc Player — Edge headless có Document PiP, cửa sổ là page mới; đếm ngược tối thiểu 3 s;
             "Chuyển sang bài này"; đổi sang Mobile khi đang mở → bàn nút, vòng "CHẠM" Ø = nút đáp đúng nút chế độ,
             không "CHẠM: …"),
             forced-colors.spec.ts (tương phản cao Windows: switch, nút aria-pressed, chấm quãng game bar, rãnh
             thanh trượt, tên nút chế độ đang chọn của bàn nút Mobile — kiểm bằng pixel), guide.spec.ts (trang
             Hướng dẫn: link "Xem hướng dẫn" ở cột phím tắt → mục lục → prompt AI, 360 px), mini.spec.ts (Phase
             4m: trang mini 360×360 cảm ứng (bố cục "Thu nhỏ" đặt sẵn; cuối file: "Khớp nút game" 960×300 / 720×240 —
             vạch / vòng đúng số đo ảnh game, vòng đích trên canvas, Căn chỉnh chọn số + − / + / giữ để lặp / bàn
             phím, tải lại vẫn giữ, Đặt lại mặc định, Thu nhỏ nhớ theo máy; cửa sổ THẬT 546×90 / 546×119 / 624×100 /
             640×80 vi + en — panel lúc dừng / tạm dừng / Căn chỉnh từng số: không control nào ra ngoài / chồng / bị
             che, bảng không che vòng / mép dưới, hộp ⓘ đọc được; cùng các cỡ đó, máy đã mở trang mini ở bản 1.0.0
             (`dfht-mini-song` đặt sẵn): chip nhắc "kéo rộng" không ra ngoài / chồng, chạm → hướng dẫn, hết chip — D-441;
             300×150 / 300×200 / 360×200 / 480×100 + 300×300 vi / en + 360×360 en (ba nút bố cục chữ ngắn ở cửa sổ
             < 560 px — D-448) cả hai bố cục; kiểu PC → "Thu nhỏ" + "Đổi sang Mobile" → khớp nút game; đúng tỉ lệ thật — option `screen` của
             Playwright = màn điện thoại ngang + UA Android (`ANDROID_UA`), viewport = cửa sổ nổi: bước cột theo chiều
             cao màn, vạch / vòng / canvas trùng nút của ảnh game, chỉ báo Rộng / Cao, kéo giãn bằng CDP
             `Emulation.setDeviceMetricsOverride` giữ cỡ màn (`setViewportSize` đặt màn = viewport), Vạch · Dời / Giãn
             lưu + Đặt lại; không có `screen` hoặc máy tính (1280 × 720 trên màn 1920 × 1080) = kiểu "cửa sổ = hàng
             nút"), màn chơi kiểu Mobile → Cửa sổ nổi → hỏi Apple / Android → Android →
             trang mini, → Apple → dựng sẵn ngay, "Mở video nổi" xin PiP trong cú chạm, đóng hộp thoại không đóng PiP,
             "Đổi loại điện thoại" hỏi lại (vòng 7), 300×300 kiểu PC keycap thẳng làn, nút "◂" chỉ khi đang dừng,
             video PiP trực tiếp mở / đóng — chờ `data-ready` trước khi chạm, không có PiP, dựng sẵn WebM → mở →
             rời trang thu hồi blob URL), round5.spec.ts (góp ý
             2026-10-15: bản nháp "hoặc tự gõ từ đầu" / "Tạo bài từ file" chỉ vào Thư viện khi sửa + Lưu, gợi ý
             track theo mật độ, không ô gộp nốt / chia dòng, Cài đặt mặc định đếm ngược 3 s + nhãn phụ ẩn +
             lookahead 6, thanh điều khiển không có Đếm vào / Đếm ngược và không có số khi đếm vào, hộp thoại OBS
             chỉ hiển thị, không còn giao diện lời; vòng R5: bản nháp → Phát → chip + "Mở trình soạn để lưu" → Lưu →
             "◂ Về màn chơi" mở bài đã lưu, bài tạm từ link → "Lưu vào thư viện", Tab tới "Mobile" + Space đổi kiểu
             không đếm ngược, tab app mới không giành overlay, hộp thoại OBS nhớ tùy chọn), round6.spec.ts (góp ý
             2026-10-16: bài mẫu mới đứng đầu + màn đầu = Quốc ca Việt Nam, Tạo bài với AI dán cảm âm → Lưu → phát
             được, ô dán AI của Editor — dán = lần nhập `insertFromPaste` (`pasteInto`), Hoàn tác tắt "Đã đưa …",
             gõ tay chỉ xem trước —, vòng 7: vòng "CHẠM" trong suốt Ø = nút chế độ đáp đúng tâm nút ở màn chơi
             844×390 (trên lớp của bàn nút), overlay kiểu Mobile (Xem trước khớp game + cả cột) không bàn nút — chỉ 4
             vòng mờ, vòng đáp vào đó; không "CHẠM: …"; đếm ngược 3-2-1 lúc ô đứng yên, đếm vào không vẽ số),
             round7.spec.ts (góp ý vòng 7 + trước deploy: Thư viện đúng 4 bài mẫu; 844×390 kiểu Mobile — vòng
             "CHẠM" vào lại đầu "Phần 2" đồng tâm đúng Ø nút, vòng đang rơi thẳng cột nút, nhanh ~1,75 × ô, tới tâm
             nút đúng beat rồi mờ; đếm ngược → đếm vào không nhảy lùi / không mất ô ở màn chơi + trang mini; trang
             mini Đếm ngược = Tắt vẫn đếm 3 s; dòng nhắc ở Cài đặt → Phát bài; link "Dev notes" ở chân Hướng dẫn /
             Cài đặt → `#/dev` có phiên bản, REFERENCE, CHANGELOG);
             audio-mobile.spec.ts (âm thanh mobile, D-421 – D-425 — script đếm AudioContext / `createOscillator` /
             `<audio>.play()` + `navigator.audioSession` giả: mặc định im lặng không đụng gì; "Tôi hiểu, bật" mở khóa
             ngay + phiên "playback", tắt / rời màn chơi trả; UA iPhone không API → `<audio>` im lặng; Android giả lập
             844×390 cảm ứng: chạm Phát → 'running' + nốt, luyện tập + tiếng khi bấm → tiếng phản hồi; Tự chơi để tạo
             bài: bật / tắt tiếng phản hồi, rời màn → giữ / trả phiên — D-426);
             predeploy.spec.ts (bổ sung trước deploy: A. nút loa — mặc định tắt, đúng hộp cảnh báo, Hủy / bật → huy
             hiệu, tắt ngay, khớp Cài đặt, bàn phím, 844×390 / 390×844 không chồng; B. trang mini "Khớp nút game"
             960×300 — Căn chỉnh → tải lại → canvas: ô thẳng vạch, vòng đích + vòng "CHẠM" đúng cột chế độ, đáp sát mép
             dưới đúng beat, PC (mặc định "Thu nhỏ" → chọn "Khớp nút game"), "Thu nhỏ" vẫn chạy; đúng tỉ lệ thật ở màn
             1371 × 633 = ảnh game (UA Android): vạch / vòng trùng tâm nút ±1,5 px, vòng đáp đúng cột, chỉ báo Cao quá →
             vừa; nút loa kiểu Mobile 844 × 390 / 390 × 844: huy hiệu gọn "[🔊]", bật / tắt không làm trang nhảy — D-417),
             pip-size.spec.ts (Cửa sổ nổi PC cỡ chuẩn: cỡ `requestWindow` xin — 1600 × 900 headless, màn giả lập 900p,
             2160p @150 % / @100 %, 768p / 1080p / 1440p, 5:4 1280 × 1024 (trần 25 % — xin 578 × 566) qua `screen` +
             `deviceScaleFactor` —, làn 1 bắt đầu sau đệm khung 0,26 bước, gutter sau đệm phải, 8
             cột Căn chỉnh = `65·k/dpr`, bản lưu cũ bỏ qua,
             "Đặt lại cỡ chuẩn", cỡ đã kéo theo màn; Edge headless giả viewport trang PiP → chỉ kiểm cỡ xin, không cỡ
             thật); v101.spec.ts (góp ý trên bản live 1.0.0: Quốc ca chỉ "Phần 1" + "Phần 2" 1:02; đếm vào 0,65 quãng cũ —
             khung đứng yên + thời gian rơi thật ở màn chơi / overlay theo màn chơi / overlay tự chạy / trang mini, cả hai
             bài mẫu; lần chạm đầu ở trang mới (PC tắt / bật tiếng, Mobile): khung hở < 100 ms, quãng rơi lệch đường thẳng
             ≤ 30 ms, `.glow-warmup` có rồi gỡ, không nằm trong game bar; `.glow-warmup` có CSS thật = giữ ≥ 100 ms
             (`expectWarmKept`) ở màn chơi PC, Cửa sổ nổi (ghi trong document PiP từ lúc `requestWindow` trả — D-440),
             overlay tự chạy, trang mini; bài kiểm mép (nốt Z / `,` từ đầu — `data=` /
             Thư viện): overlay `fit=canvas` 1920 × 1080 / 1280 × 720 ô
             cách mép khung ≥ 0,25 bước + tâm ô = tâm phím; kiểu Mobile ô không chạm mép — màn chơi, overlay, trang mini
             "Khớp nút game" đúng tỉ lệ thật cửa sổ 8 làn 1001 × 183);
             helpers.ts (clipboard giả, chữ ký canvas). Mỗi spec dùng clipboard giả; mọi spec trừ pwa.spec.ts
             chặn service worker (playwright.config.ts).
scripts/     release.mjs (version + tag), deploy.mjs (Vercel CLI), gen-icons.mjs (icon PWA, pngjs).
src-tauri/   overlay desktop Tauri v2 (Phase 4, tùy chọn, CHƯA build thử — không có Rust): tauri.conf.json (cửa
             sổ trong suốt / không viền / luôn trên cùng, `withGlobalTauri`), Cargo.toml, build.rs, src/main.rs
             (phím tắt toàn cục Ctrl+Alt+P/R/→/←, Ctrl+Alt+T click xuyên qua, Ctrl+Alt+D khung cửa sổ),
             capabilities/default.json. `target/`, `gen/` gitignore.
.github/workflows/  ci.yml (push main / PR: lint, typecheck, format:check, test, build trên Ubuntu + Node 24; job e2e
             chỉ khi chạy tay), tauri.yml (chỉ chạy tay) — D-445.
```

Contract dùng chung: `src/core/types.ts` (Song/Section/Line/Unit, Diagnostic, Timeline, ParseResult spans),
`src/core/keys.ts` (phím, midi, tầm C3..C6), `src/core/melody.ts`, `src/ui/settings.ts`, `src/ui/router.ts`,
`src/ui/palette.ts`, `src/player/practice.types.ts`, `src/midi/types.ts`, `src/editor/tools/types.ts`,
`src/overlay/commands.ts` (`dfht:command`, dùng chung với `src/desktop/tauriBridge.ts` và Tauri `main.rs`),
`src/overlay/follow.ts` (tin Player → overlay, dùng chung followBroadcast / followReceiver / obsBridge).
Route Editor / Share / MIDI / overlay / record / ai / guide / mini / dev tải lười trong `App.tsx` (D-140, D-234, D-260,
D-296, D-358, D-387); cờ phase ở
`src/ui/features.ts` (D-060, D-139). Script inline trong `index.html` đặt `html.overlay-mode` + class nền overlay (và
`html.overlay-preview` khi `preview=1`) trước khi JS chạy — đổi cách nhận route overlay (router.ts), `bg` hay `preview`
thì sửa cả script đó (test: `src/overlay/earlyOverlayClass.test.ts`).

Route (hash):

- `#/` = màn chơi đầy đủ (PlayerView, y như `#/play/:id`) với bài mẫu `DEMO_SONG_ID` (D-306; không còn màn demo
  hay ☰ Menu);
- `#/library` thư viện; `#/play/:id`; `#/edit/:id` (cả bản nháp `draft-…`); `#/s/<lz>` (link chia sẻ, bài nằm
  trong link);
  `#/midi` (Tạo bài từ file); `#/record` (Tự chơi để tạo bài); `#/ai` (Tạo bài với AI — trang con của Thư viện,
  link Thư viện của thanh điều hướng sáng khi ở đây); `#/settings`; `#/guide` / `#/guide/cam-am` (Hướng dẫn,
  `?s=<slug tiêu đề>` cuộn tới mục); `#/dev` (Dev notes: REFERENCE + phiên bản / commit / ngày build + CHANGELOG,
  `?s=<id tiêu đề>`; chỉ có link nhỏ ở chân trang Hướng dẫn và Cài đặt, không có trong nav — D-387);
  `#/mini/:id?delay=0|3|5|10` (trang mini cho cửa sổ nổi Android, thử nghiệm — không nav app, luôn im lặng, D-296;
  đếm ngược = Cài đặt, tối thiểu 3 s, `delay` đè — D-381; lối ra duy nhất = nút "◂" về `#/play/:id` lúc đang dừng,
  D-362);
- overlay: `#/overlay/:id?…`, `#/overlay?…&data=<lz>` (bài nhúng trong link — OBS có bộ nhớ riêng) hoặc
  `?overlay=1&song=<id>&…` trên location.search (Tauri dùng dạng này). Tham số: song, data, bpm, countin,
  delay, lookahead (mặc định 6), scale, tilescale, sublabel, lang, theme, lanes, bg (`chroma` chỉ còn cho link cũ),
  layout, fit (`canvas` = phủ cả canvas OBS, tự khớp bảng phím game), opacity, scheme, gamebar, banner, semitone,
  nl / nr / nn / ns (tên gọi nút), preview (`1` = cửa sổ "Xem trước", nền tối, không dùng để quay);
  `autoplay`, `loop`, `lyrics` của link cũ bị bỏ qua. Overlay theo Player chính (follow.ts) — tham số hiển thị /
  timing trong link chỉ là ảnh chụp Cài đặt dùng khi overlay tự chạy một mình; overlay không đọc / ghi Cài đặt
  của trình duyệt mở nó. Đọc ở `src/overlay/overlayParams.ts`; bảng cho người dùng ở `docs/REFERENCE.md` "Tham số
  URL của overlay" — đổi một bên thì sửa bên kia.

Dùng `href(paths.…)`, không hard-code `'#/'` (D-185).
Màn chơi (góp ý 2026-10-15, D-308 / D-309): thanh dọc phải đúng thứ tự **Kiểu điều khiển PC | Mobile · Cửa sổ nổi · OBS ·
Chia sẻ · Cài đặt** (PlayerSideBar); cột trái = danh sách phím tắt đầy đủ (ShortcutsHelp); thanh tiến độ ở đáy;
ngôn ngữ + theme ở góc trên phải (PrefButtons); KHÔNG có nút "Sửa" (chip lỗi / chip `@scroll −1` link tới Editor;
bài chưa lưu — bản nháp / bài tạm từ link — có chip + nút giữ bài lại, D-335). Mọi trang có thanh điều hướng: chỗ tên
app = nút "◂ Về màn chơi" (`src/ui/lastPlayed.ts`); Player: "◂ Thư viện". Chuỗi tiếng Việt gọi màn này là "màn
chơi" (không viết "Player" trong UI vi).
Âm thanh mặc định tắt: mọi đường bật "Phát giai điệu mẫu" phải qua `MelodyConfirmDialog` (src/ui/MelodyConfirm.tsx) —
chỉ có hai chỗ: Cài đặt → thẻ "Âm thanh" (thẻ thường, không còn "Nâng cao") và nút loa trên thanh điều khiển màn chơi
(tên đọc cố định "Tiếng giai điệu" + `aria-pressed`, tooltip = việc sẽ làm — D-424); không thêm đường bật nào khác, tắt
thì không hỏi (D-183, D-184, D-356, D-392). Cú bấm bật tiếng mở khóa AudioContext ngay (D-423); màn chơi giữ phiên
"playback" của iPhone chỉ trong cú chạm cần tiếng và trả khi tắt hết tiếng / detach (Nghe thử của Tạo bài từ file và
màn Tự chơi để tạo bài cũng vậy — D-426) — âm thanh tắt thì không được đụng tới AudioContext, `navigator.audioSession`
hay `<audio>` nào (D-421, D-422). Câu nhắc "chưa bật được âm thanh" không bảo bấm nút loa (đang bật thì đó là Tắt
tiếng — D-426).
Tên modifier hiển thị luôn lấy từ `src/ui/modLabels.ts` (D-181).
Không có lời / karaoke (D-311): không thêm lại lời vào model, UI, import hay link; parser chỉ nhận rồi bỏ tiền tố lời
cũ. Nửa Cung cố định thăng: dùng `GAME_SCROLL_DIR` (`src/core/keys.ts`), không có setting chiều (D-314).
Hộp thoại OBS chỉ chứa tùy chọn hiển thị riêng của overlay; mọi chỉnh transport / hiển thị khác nằm ở Player (D-323).
OBS chỉ có 2 cách (Gửi thẳng vào OBS, Browser Source thủ công) + cửa sổ "Xem trước" chỉ để xem — không thêm lại
Window Capture / nền chroma / nút toàn màn hình (D-348).
Bài tạo mới (Tạo bài từ file, Tự chơi, "hoặc tự gõ từ đầu", Mở trong Editor của `#/ai`) mở bằng `openDraftSong` —
không `addSong` thẳng (D-318). Ngoại lệ duy nhất: nút "Lưu" của trang `#/ai` (người dùng bấm Lưu rõ ràng, D-358).
Đếm vào / đếm ngược chỉ chỉnh ở Cài đặt → Phát bài (đếm vào ngắn: nốt đầu đi 0,65 × (1 ô nhịp + khoảng lặng) —
`src/player/leadIn.ts`, D-427, luôn ≥ 2 beat nguyên trước nốt đầu — D-439; nhãn "Đếm vào khi bấm Phát") — cả Cửa sổ
nổi, trang mini, video PiP theo đó, không thêm ô
riêng (D-354, D-367); Cửa sổ nổi / trang mini / video nổi đếm ngược tối thiểu 3 s (D-381); số to chỉ hiện lúc đếm
ngược (ô đứng yên ở khung bắt đầu của đếm vào — không nhảy lùi khi chạy, D-377; bấm Phát / hủy thì trượt mượt tới /
khỏi khung đó, không nhảy — D-389), đếm vào không có số ở bất cứ đâu.
Lookahead chỉ ở thanh điều khiển của Player. Kiểu Mobile: không thêm lại gutter / nhãn "CHẠM: <tên chế độ>" — vòng
"CHẠM" phải đáp vào một nút chế độ thật (bàn nút) hoặc vòng đích mờ của overlay / trang mini "Khớp nút game" (cả "dưới
nút" — lật, đáp ở mép trên; D-366, D-373, D-375, D-396, D-448); overlay OBS
không vẽ lại bàn nút đầy đủ. Nút "Cửa sổ nổi" trên điện thoại luôn hỏi Apple / Android trước (lựa chọn đã lưu thắng,
UA chỉ chọn sẵn — D-383); máy Apple không có "Trực tiếp" (D-385).

## Conventions

- TypeScript strict, không `any` (dùng `unknown` + thu hẹp). `import type` cho type (lint bắt).
- `src/core/**` thuần TS: không import React, DOM, zustand. Mọi thứ khác import core, không ngược lại.
- Chuỗi UI chỉ ở `src/i18n/strings.ts` (block theo module, thêm key ở cả `vi` và `en`). Không hard-code
  text tiếng Việt trong component. Canvas lấy chuỗi qua `tNow()`.
- Test đặt cạnh source: `foo.ts` → `foo.test.ts`. Core phải có test cho mọi nhánh lỗi.
- Phím tắt app KHÔNG dùng Z X C V B N M , (dành cho practice mode). Dùng Space, R, ←/→, L, [ ]. Phím tắt
  toàn cục của Tauri cũng vậy (Ctrl+Alt+P / R / T / D / ← / →).
- App không bao giờ gửi phím / chuột vào game (SPEC: đã hủy tính năng tự chơi). Overlay luôn im lặng.
- Mọi listener / rAF / interval / audio node phải được dọn trong cleanup (không leak khi play/pause/seek).
- Không network: không CDN, font ngoài, analytics. Asset nằm trong bundle.
- A11y: control có label/aria-label, focus ring (`:focus-visible` đã có trong app.css), contrast AA.
- Giao diện theo `docs/DESIGN.md`: màu chỉ dùng token của `src/ui/app.css`; accent xanh neon chỉ cho khung UI, KHÔNG
  BAO GIỜ tô tile / keycap / nốt (gần màu Nửa Cung); hổ phách `--warn` chỉ cho cảnh báo; viền control dùng
  `--control-border`; không animation lặp ngoài canvas. app.css nạp trước CSS của view (D-237) — view ghi đè ở cùng
  độ ưu tiên.
- Lint/typecheck zero warning. Prettier: single quote, width 100.
- Commit: conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`), một commit mỗi phase.

## Định dạng `.harm` tóm tắt

`@title/@artist/@bpm/@time/@scroll/@repeat`, `# Section`, `// comment` (`//! cảnh báo` hiện warning),
dòng nốt `tokens` (tiền tố `lời: ` của file cũ được nhận và bỏ qua). Token: `Z X C V B N M ,` (+ `*dur`), `_` nghỉ,
`X-C` luyến, hold
`[giữ chuột trái]…[thả chuột trái]` / `[L] [/L] [R] [/R] [S] [/S]`, prefix `L:N R:N S:N LS:N RS:N`.
Chi tiết đầy đủ: `docs/SPEC.md` mục 3 và `docs/REFERENCE.md` ("Định dạng .harm đầy đủ", gồm bảng thông báo lỗi). Trang
Hướng dẫn trong app chỉ có bảng tóm tắt "Cú pháp .harm" (README).

## Thêm bài seed

1. Tạo `src/library/seeds/<slug>.harm` (UTF-8, LF). Bài người dùng gửi từ app: chép nguyên byte, không định dạng lại
   (`*.harm` nằm trong `.prettierignore`).
2. Đăng ký trong `src/library/seeds.ts` (import `./seeds/<slug>.harm?raw`, id `seed-<slug>`, thêm vào `SeedId`);
   thứ tự trong `SEED_SONGS` = thứ tự hiển thị đầu Thư viện.
3. Test đọc danh sách từ `SEED_SONGS` / `SEED_TITLES` / `SEED_COUNT` nên thường chỉ cần cập nhật các hằng đó
   (`src/library/*.test.*`, `e2e/smoke.spec.ts`, `e2e/round5.spec.ts`); hàng `song` của "Tham số URL của overlay" ở
   `docs/REFERENCE.md`. Tìm chỗ khác: `grep -rn "seed-quoc-ca-viet-nam" src e2e README.md docs`.
4. `npx vitest run src/library` — `library.integration.test.ts` bảo đảm mọi seed parse không lỗi.

Bài mẫu hiện có (D-364, D-386): `seed-quoc-ca-viet-nam` ("Quốc ca Việt Nam", Văn Cao — cũng là `DEMO_SONG_ID`; từ
v1.0.1 chỉ "Phần 1" + "Phần 2", 73 nốt, 1:02 — D-436, `seeds.parse.test.ts` ghim) và
`seed-takediskrush` ("TAKEDISKRUSH!", N2UtheHartlocker), `seed-ji-mo-de-ren` ("寂寞的人伤心的歌", 龙梅子、杨海彪 — v1.0.2) và
`seed-sao-minh-chua-nam-tay-nhau` ("Sao Mình Chưa Nắm Tay Nhau", Yan Nguyễn — v1.0.3). Test cần nội dung dài / nhiều đoạn dùng hai bài tự soạn ở
`src/test/fixtures/` (import `../test/fixtures/<slug>.harm?raw` từ test — D-443), test chỉ cần "một bài mẫu" dùng hai bài
thật.

Bài người dùng: Thư viện (`#/library`, nút "◂ Thư viện" của màn chơi) → "Tạo bài với AI" (Lưu = vào Thư viện ngay),
"Nhập file ký tự" (.harm/.txt/.json, lưu thẳng) hoặc tạo bài khác (bản nháp trong Editor, chỉ lưu khi bấm Lưu); lưu
localStorage. Bài mở sẵn ở màn đầu: `DEMO_SONG_ID` trong `src/home/demoSong.ts`.
