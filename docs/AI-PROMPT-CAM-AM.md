# Prompt cho AI: biến sheet nhạc / trang cảm âm thành cảm âm chuẩn để dán vào app

Dùng được với ChatGPT, Claude, Gemini, Copilot… (bản có đọc ảnh nếu bạn gửi ảnh chụp).
Có 2 bản: **Tiếng Việt** (ngay dưới) và **[English](#english-version)** (cuối file) — cùng một cú pháp đầu ra.

**Cách dùng**

1. Trong app: **Thư viện → Tạo bài với AI** → bấm **Sao chép prompt** (hoặc copy nguyên khối **PROMPT** bên dưới).
2. Mở AI, dán prompt rồi gửi kèm **một** trong các thứ sau:
   - ảnh chụp sheet nhạc (khuông nhạc 5 dòng kẻ) — chụp thẳng, rõ, đủ cả bài;
   - ảnh hoặc chữ giản phổ (số 1–7 có chấm);
   - nội dung trang cảm âm (copy nguyên chữ dán vào; nhiều AI không tự mở được link).
3. AI trả về một khối code. Bấm nút copy của khối đó.
4. Quay lại trang **Tạo bài với AI**, dán vào ô **Dán kết quả của AI vào đây** — app tự đổi sang phím Z X C… và chọn
   tông dễ chơi nhất (muốn thì đổi ở ô **Tông**) → bấm **Lưu**. Bài đang mở trong Editor: dán vào ô **Dán kết quả của AI
   vào đây** ngay trên ô soạn rồi bấm **Lưu**.
5. Nếu nguồn không có nhịp (đa số trang cảm âm), mọi nốt dài 1 beat: mở bài trong Editor, dùng **Công cụ → Tap
   timing** để gõ lại nhịp.

> Lưu ý: AI có thể đọc sai nốt, nhất là ảnh mờ hoặc bài dài. Luôn nghe/thử lại trong app và sửa những chỗ AI ghi
> `// không chắc`. **Đừng nhờ AI tự "nhớ" giai điệu một bài hát** — AI rất hay bịa; luôn đưa cho nó nguồn thật
> (ảnh hoặc chữ).

### Tìm nguồn ở đâu

**Mẹo chung:** ưu tiên bản cho **nhạc cụ chơi một giai điệu** (sáo, harmonica, ocarina, violin, kalimba…) hoặc bản ghi
"melody / lead sheet" — chỉ có đúng giai điệu nên AI chuyển chính xác nhất. Bản piano đầy đủ (2 tay, nhiều hợp âm)
khó hơn. Bản nhạc trên mạng thường thuộc bản quyền của người soạn: dùng để tự chơi, không đăng lại.

| Bài         | Từ khóa tìm (thay `<tên bài>`)                                                                                                                                                          | Trang hay dùng                                                                                                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Việt Nam    | `cảm âm <tên bài>` · `cảm âm sáo <tên bài>` · `tab harmonica <tên bài>` · `sheet <tên bài>` · `sheet piano <tên bài>` · `<tên bài> musescore`                                           | **MuseScore** (musescore.com — tìm tên bài, có nhiều bản soạn nhạc Việt; tải file cần tài khoản/Pro), **Cảm Âm Việt** (camamviet.com — thư viện cảm âm sáo), các blog / nhóm Facebook "tab harmonica", "cảm âm sáo trúc" |
| Tiếng Anh   | `<song> melody sheet music` · `<song> lead sheet` · `<song> easy piano melody` · `<song> flute / recorder / violin sheet music` · `<song> musescore`                                    | **MuseScore**, **Hooktheory TheoryTab** (giai điệu + hợp âm nhạc pop), **8notes**, **Free-scores**, **IMSLP** (chỉ nhạc cổ điển / hết bản quyền)                                                                         |
| Tiếng Trung | `<歌名> 简谱` (giản phổ) · `<歌名> 主旋律 简谱` (giai điệu chính) · `<歌名> 口琴谱` (kèn harmonica) · `<歌名> 笛子谱` (sáo) · `<歌名> 陶笛谱` (ocarina) · `<歌名> 五线谱` (khuông nhạc) | **MuseScore**, **虫虫钢琴** (Chongchong Piano — có nhiều 简谱), **环球钢琴网**, **中国乐谱网**, **曲谱之家**, **谱多多**                                                                                                 |

Tìm thấy rồi thì chụp màn hình (hoặc copy chữ) gửi cho AI cùng PROMPT bên dưới. Nếu là file MusicXML/MIDI tải từ
MuseScore thì không cần AI: dùng thẳng **Thư viện → Tạo bài từ file** trong app.

---

## PROMPT (copy từ dòng dưới đến hết khối)

````text
Bạn là chuyên gia ký âm. Hãy chuyển GIAI ĐIỆU CHÍNH (bè hát / bè melody) của bản nhạc tôi gửi kèm thành "cảm âm" theo ĐÚNG cú pháp dưới đây. Tôi sẽ dán kết quả vào một app đọc máy, nên cú pháp phải chính xác tuyệt đối.

ĐẦU RA: CHỈ MỘT khối code (```text ... ```), không viết thêm lời giải thích nào bên ngoài khối code.

CÚ PHÁP
1. Dòng đầu (header), mỗi thứ một dòng:
   @title <tên bài>
   @artist <ca sĩ / tác giả>      (bỏ dòng này nếu không biết)
   @bpm <số nhịp mỗi phút>        (lấy từ dấu tempo, vd ♩=76; không có thì ước lượng; không đoán được thì 90)
   @time <nhịp>                   (vd 4/4, 3/4, 6/8; không rõ thì 4/4)
2. Tên đoạn trên dòng riêng: # Đoạn 1, # Điệp khúc, # Kết ...
3. Mỗi dòng nốt là một câu nhạc (khoảng 1–2 ô nhịp), CHỈ gồm các nốt cách nhau bằng một dấu cách (không ghi lời):
   <nốt> <nốt> <nốt> ...
4. Ghi chú / chỗ không chắc: dòng bắt đầu bằng // (vd: // không chắc ô nhịp 12).

NỐT
5. Tên nốt viết thường, không dấu: do re mi fa sol la si.
6. Thăng/giáng viết ngay sau tên nốt: # = thăng, b = giáng. Vd: fa#  sib  do#  mib.
7. LUÔN ghi số quãng ngay sau (sau cả dấu thăng/giáng): 1, 2 hoặc 3.
   do1 = C4 (Đô giữa), re1 = D4, ..., si1 = B4; do2 = C5, ..., si2 = B5; do3 = C6.
   Vd: la1, do2, fa#1, sib1, mi2.
   Nếu giai điệu có nốt thấp hơn do1 hoặc cao hơn do3: dịch CẢ BÀI lên/xuống nguyên quãng tám cho vừa,
   giữ nguyên quan hệ giữa các nốt.
8. Cách đọc nguồn:
   - Khuông nhạc 5 dòng: đọc cao độ thật theo khóa và hóa biểu (áp dụng dấu thăng/giáng của hóa biểu và
     dấu hóa bất thường trong ô nhịp), Do = C.
   - Giản phổ (số): 1=do 2=re 3=mi 4=fa 5=sol 6=la 7=si (bỏ qua "1=D", "1=F"... không cần quy đổi giọng).
     Số không chấm = quãng 1; chấm trên = lên 1 quãng; chấm dưới = xuống 1 quãng (rồi áp dụng quy tắc 7).
   - Trang cảm âm chữ: giữ đúng tên nốt; chữ thường = quãng 1, chữ viết hoa (Do, Re...) hoặc có dấu ' = quãng 2,
     trừ khi trang ghi quy ước khác; rồi ghi lại theo quy tắc 7.
   - Tab harmonica 10 lỗ (diatonic, tông C; số dương / "+" = thổi, số âm / "-" = hút):
     thổi 1=C4 2=E4 3=G4 4=C5 5=E5 6=G5 7=C6 8=E6 9=G6 10=C7;
     hút 1=D4 2=G4 3=B4 4=D5 5=F5 6=A5 7=B5 8=D6 9=F6 10=A6;
     nốt bẻ (bend, ký hiệu ' hoặc b) = thấp hơn 1 bán cung mỗi dấu. Đổi ra tên nốt rồi áp dụng quy tắc 7.
     Nếu tab ghi tông khác C: vẫn đọc như tông C (app tự chọn tông dễ chơi sau).
9. Chỉ lấy giai điệu: bỏ hợp âm (Am, C, G7...), bè đệm, bass, ngón bấm, tab, nốt hoa mỹ (grace note).
   Nếu một chỗ có nhiều nốt cùng lúc trên bè melody, lấy nốt cao nhất.

ĐỘ DÀI (đơn vị = phách, nốt đen = 1)
10. Viết *<độ dài> ngay sau nốt khi độ dài KHÁC 1; độ dài 1 thì không ghi gì.
    Nốt tròn *4, nốt trắng *2, trắng chấm *3, đen chấm *1.5, móc đơn *0.5, móc đơn chấm *0.75, móc kép *0.25.
    Chùm ba móc đơn: mỗi nốt *1/3. Chùm ba nốt đen: mỗi nốt *2/3.
    Hai nốt nối bằng dấu nối (tie): gộp thành MỘT nốt, cộng độ dài.
    Giản phổ: gạch dưới 1 lần = *0.5, 2 lần = *0.25; mỗi dấu "-" sau số = cộng thêm 1 phách; dấu chấm sau số = ×1.5.
11. Nếu nguồn KHÔNG có thông tin nhịp (chỉ có tên nốt): KHÔNG tự bịa nhịp, để mọi nốt dài 1 (không ghi *).
12. Dấu lặng (nghỉ): _ = nghỉ 1 phách; _*2, _*0.5 ... Nhiều dấu lặng liền nhau thì gộp thành một.

LUYẾN
13. Các nốt nối bằng dấu luyến (slur) CÓ ĐỘ DÀI BẰNG NHAU: viết dính liền thành một cụm, độ dài TỔNG ghi sau cụm.
    Vd: re2mi2 = 2 nốt mỗi nốt 0.5 (tổng 1); re2mi2*2 = mỗi nốt 1; do2re2mi2 = 3 nốt mỗi nốt 1/3.
    Nếu các nốt luyến dài khác nhau: viết thành các nốt rời.

LẶP LẠI
14. Dấu lặp, khung 1/2 (volta), D.C., D.S., "x2"...: viết ra đầy đủ theo đúng thứ tự khi hát, không dùng ký hiệu lặp.

TỰ KIỂM TRA TRƯỚC KHI TRẢ LỜI
15. Tổng độ dài mỗi ô nhịp khớp số chỉ nhịp (trừ ô nhịp lấy đà ở đầu bài).
16. Mọi nốt đều có dạng tên + (#|b)? + số quãng + (*độ dài)? ; không có hợp âm, không có chữ thừa.
17. Chỗ nào không chắc thì vẫn ghi phương án hợp lý nhất và thêm một dòng // ghi rõ chỗ đó.

VÍ DỤ ĐẦU RA (chỉ minh họa cú pháp)
```text
@title Bài mẫu
@artist Tác giả
@bpm 76
@time 4/4

# Đoạn 1
la1*0.5 mi1*0.5 la1*0.5 si1*0.5 do2 re2mi2 si1*2 _*0.5
fa#1 sib1 do2*1/3 re2*1/3 mi2*1/3 sol1*1.5 la1*0.5 la1*2

# Điệp khúc
// không chắc nốt thứ 3 của dòng dưới
mi2 re2 do2 la1*2 _
```
````

---

## English version

Works with ChatGPT, Claude, Gemini, Copilot… (use a model that can read images if you send a photo).

**How to use**

1. In the app: **Library → Create with AI** → press **Copy the prompt** (or copy the whole **PROMPT** block below).
2. Open your AI chat, paste the prompt and attach **one** of:
   - a photo/screenshot of the sheet music (staff notation) — straight, sharp, the whole song;
   - numbered notation (jianpu, digits 1–7 with dots), as an image or text;
   - the text of a solfège ("cảm âm") web page — copy-paste the text (many AIs cannot open links).
3. The AI replies with a single code block. Press the block's copy button.
4. Back on **Create with AI**, paste it into **Paste the AI's answer here** — the app converts it to Z X C… keys and
   picks the easiest key (change it in **Key** if you like) → press **Save**. For a song open in the Editor: paste into
   the **Paste the AI's answer here** box right above the text and press **Save**.
5. If the source has no rhythm (most solfège pages), every note is 1 beat: open the song in the Editor and use
   **Tools → Tap timing** to tap the rhythm.

> Note: AI can misread notes, especially from blurry images or long songs. Always play it back in the app and fix
> the places the AI marked `// unsure`. **Never ask the AI to "remember" a song's melody** — it will often make it
> up; always give it a real source (image or text).

### Where to find a source

**General tip:** prefer versions for **single-melody instruments** (flute, recorder, harmonica, ocarina, violin,
kalimba…) or "melody / lead sheet" versions — they contain only the tune, so the AI converts them most accurately.
Full two-hand piano arrangements are harder. Sheet music online is usually copyrighted by its arranger: use it to
play for yourself, do not re-post it.

| Songs      | Search keywords (replace `<song>`)                                                                                                                                                                 | Popular sites                                                                                                                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vietnamese | `cảm âm <tên bài>` · `cảm âm sáo <tên bài>` · `tab harmonica <tên bài>` · `sheet <tên bài>` · `sheet piano <tên bài>` · `<tên bài> musescore`                                                      | **MuseScore** (musescore.com — many Vietnamese arrangements; downloading needs an account/Pro), **Cảm Âm Việt** (camamviet.com — solfège library for bamboo flute), "tab harmonica" / "cảm âm sáo trúc" blogs and Facebook groups |
| English    | `<song> melody sheet music` · `<song> lead sheet` · `<song> easy piano melody` · `<song> flute / recorder / violin sheet music` · `<song> musescore`                                               | **MuseScore**, **Hooktheory TheoryTab** (pop melodies + chords), **8notes**, **Free-scores**, **IMSLP** (classical / public domain only)                                                                                          |
| Chinese    | `<歌名> 简谱` (numbered notation) · `<歌名> 主旋律 简谱` (main melody) · `<歌名> 口琴谱` (harmonica) · `<歌名> 笛子谱` (dizi flute) · `<歌名> 陶笛谱` (ocarina) · `<歌名> 五线谱` (staff notation) | **MuseScore**, **虫虫钢琴** (Chongchong Piano — lots of jianpu), **环球钢琴网**, **中国乐谱网**, **曲谱之家**, **谱多多**                                                                                                         |

Once found, take a screenshot (or copy the text) and send it to the AI together with the PROMPT below. If you
downloaded a MusicXML/MIDI file from MuseScore you don't need an AI: use **Library → Create from file** in the app.

### PROMPT (copy from the line below to the end of the block)

````text
You are an expert music transcriber. Convert the MAIN MELODY (the vocal line / lead melody) of the music I attach into "solfège text" using EXACTLY the syntax below. I will paste your result into an app that parses it automatically, so the syntax must be exact.

OUTPUT: ONLY ONE code block (```text ... ```). Do not write any explanation outside the code block.

SYNTAX
1. Header lines first, one per line:
   @title <song title>
   @artist <singer / composer>      (omit this line if unknown)
   @bpm <beats per minute>          (from the tempo mark, e.g. ♩=76; if none, estimate; if you cannot, use 90)
   @time <time signature>           (e.g. 4/4, 3/4, 6/8; if unclear, 4/4)
2. Section names on their own line: # Verse 1, # Chorus, # Outro ...
3. Each note line is one musical phrase (about 1–2 bars) containing ONLY notes separated by single spaces (no lyrics):
   <note> <note> <note> ...
4. Comments / uncertain parts: a line starting with // (e.g. // unsure about bar 12).

NOTES
5. Note names in lowercase, no accents: do re mi fa sol la si.
6. Sharp/flat right after the name: # = sharp, b = flat. E.g. fa#  sib  do#  mib.
7. ALWAYS write the octave number right after (after the sharp/flat too): 1, 2 or 3.
   do1 = C4 (middle C), re1 = D4, ..., si1 = B4; do2 = C5, ..., si2 = B5; do3 = C6.
   E.g. la1, do2, fa#1, sib1, mi2.
   If the melody goes below do1 or above do3: shift the WHOLE melody up/down by whole octaves so it fits,
   keeping all intervals.
8. How to read the source:
   - Staff notation: read the real pitches using the clef and key signature (apply key-signature sharps/flats and
     accidentals within the bar), fixed do (do = C).
   - Numbered notation (jianpu): 1=do 2=re 3=mi 4=fa 5=sol 6=la 7=si (ignore "1=D", "1=F"...; no key conversion).
     Plain digit = octave 1; dot above = one octave up; dot below = one octave down (then apply rule 7).
   - Solfège text pages: keep the note names; lowercase = octave 1, capitalised (Do, Re...) or marked with ' =
     octave 2, unless the page states another convention; then rewrite them following rule 7.
   - 10-hole (diatonic) harmonica tabs in C (positive number / "+" = blow, negative / "-" = draw):
     blow 1=C4 2=E4 3=G4 4=C5 5=E5 6=G5 7=C6 8=E6 9=G6 10=C7;
     draw 1=D4 2=G4 3=B4 4=D5 5=F5 6=A5 7=B5 8=D6 9=F6 10=A6;
     a bend (marked ' or b) = one semitone lower per mark. Convert to note names, then apply rule 7.
     If the tab is for another key, still read it as a C harmonica (the app picks an easy key afterwards).
9. Melody only: drop chord symbols (Am, C, G7...), accompaniment, bass, fingerings, tabs, grace notes.
   If the melody line has several simultaneous notes, keep the highest one.

DURATIONS (unit = beat, quarter note = 1)
10. Write *<length> right after a note when its length is NOT 1; length 1 gets nothing.
    Whole *4, half *2, dotted half *3, dotted quarter *1.5, eighth *0.5, dotted eighth *0.75, sixteenth *0.25.
    Eighth-note triplet: *1/3 each. Quarter-note triplet: *2/3 each.
    Two notes joined by a tie: merge into ONE note and add the lengths.
    Jianpu: one underline = *0.5, two underlines = *0.25; each "-" after a digit = +1 beat; a dot after a digit = ×1.5.
11. If the source has NO rhythm information (note names only): do NOT invent a rhythm; give every note length 1
    (no *).
12. Rests: _ = 1-beat rest; _*2, _*0.5 ... Merge consecutive rests into one.

SLURS
13. Notes joined by a slur, of EQUAL length: write them glued together as one group, with the TOTAL length after
    the group. E.g. re2mi2 = 2 notes of 0.5 each (total 1); re2mi2*2 = 1 each;
    do2re2mi2 = 3 notes of 1/3 each. If the slurred notes have different lengths, write them as separate notes.

REPEATS
14. Repeat signs, 1st/2nd endings (volta), D.C., D.S., "x2"...: write everything out in full, in the order it is
    performed; do not use repeat symbols.

SELF-CHECK BEFORE ANSWERING
15. The total length of each bar matches the time signature (except a pickup bar at the start).
16. Every note has the form name + (#|b)? + octave digit + (*length)? ; no chord symbols, no extra words.
17. Where you are unsure, still write the most plausible version and add a // line saying exactly where.

EXAMPLE OUTPUT (syntax illustration only)
```text
@title Sample song
@artist Composer
@bpm 76
@time 4/4

# Verse 1
la1*0.5 mi1*0.5 la1*0.5 si1*0.5 do2 re2mi2 si1*2 _*0.5
fa#1 sib1 do2*1/3 re2*1/3 mi2*1/3 sol1*1.5 la1*0.5 la1*2

# Chorus
// unsure about the 3rd note of the line below
mi2 re2 do2 la1*2 _
```
````

---

## Ghi chú cho người phát triển

- Cú pháp trên là tập con của convention `digits` trong `src/core/camam.ts` (mọi nốt đều có hậu tố số, nên hoa/thường
  không gây nhầm quãng). Đã kiểm tra parser đọc đúng ví dụ: 0 diagnostic.
- Quy ước quãng: do1 = midi 60 (C4), do2 = 72, do3 = 84 — khớp `CAMAM_BASE_MIDI`.
- Trang **Tạo bài với AI** (`#/ai`, góp ý 2026-10-16) có nút **"Sao chép prompt"**, copy bản tiếng Việt hoặc tiếng
  Anh theo ngôn ngữ đang chọn (`src/editor/aiPrompt.ts`); nội dung lấy từ file này — sửa ở đây thì cập nhật luôn chuỗi
  trong app (cả 2 bản). Kết quả AI dán vào trang đó hoặc ô dán phía trên ô soạn của Editor được
  `src/editor/camamConvert.ts` đổi sang `.harm` (tông dễ nhất; ghi chú `//` của AI thành `//!` ngay trên dòng kế tiếp).
- Hai bản phải giữ **cùng cú pháp đầu ra** (tên nốt do…si + số quãng, `*dur`, `_`, cụm luyến; dòng chỉ có nốt,
  không có lời — app đã bỏ tính năng lời); chỉ khác ngôn ngữ hướng dẫn và tên section ví dụ.
