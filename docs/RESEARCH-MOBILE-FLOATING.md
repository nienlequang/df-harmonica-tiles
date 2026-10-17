# Nghiên cứu: cửa sổ nổi / overlay trên game mobile (2026-10-15)

> Workflow nghiên cứu 5 nhánh (Trung, Anh, Hàn, Việt, riêng Delta Force) + tổng hợp có kiểm chứng lại nguồn. Bằng chứng cộng đồng là tham khảo; phải thử trên máy thật trước khi làm tính năng.

## Kết luận ngắn

Tôi đã tự mở lại khoảng 25 nguồn quan trọng nhất từ 5 lượt tìm kiếm (Trung, Anh, Hàn, Việt và riêng về Delta Force).

1. **Có người làm, nhưng không theo kiểu ta hình dung.** Người chơi game mobile mở cửa sổ nổi/pop-up đè lên game đang chạy là chuyện rất phổ biến, nhưng chủ yếu để xem bản đồ, video hoặc chat. Với nhạc cụ trong game, cách phổ biến nhất là **app Android cài riêng, vẽ đè lên game** (dùng quyền "hiển thị trên ứng dụng khác" và Accessibility), và phần lớn các app này **tự bấm thay người chơi**. Ở cả 4 ngôn ngữ, tôi không tìm thấy bằng chứng nào về việc người chơi DF mở **trang web** trong cửa sổ nổi để đọc nốt kèn.
2. **Về kỹ thuật thì làm được, nhưng mỗi hãng có cái bẫy riêng.** Các bẫy đã kiểm chứng: Samsung có lỗi mất focus làm đứng game; realme tự giấu cửa sổ khi chạm ra ngoài trong lúc chơi game; vivo không cho phóng to cửa sổ nhỏ và có thể treo game; OnePlus bị văng game.
3. **Rủi ro bị khoá tài khoản:** quy định chính thức của Tencent và Garena **không nhắc tới** cửa sổ nổi hay chia đôi màn hình. Tuy vậy, cộng đồng Trung Quốc có lời đồn (chưa kiểm chứng) rằng mở 分屏/小窗 (chia màn hình / cửa sổ nhỏ) thì bị khoá.
4. **Đề xuất thứ tự làm:** C → A → B → D (bản rẻ, kèm thử nghiệm cửa sổ nổi kiểu Picture-in-Picture) → E.

## a) Người chơi mobile có đặt cửa sổ đè lên game để đọc bản nhạc không?

**Cửa sổ nổi đè lên game là thói quen phổ biến, và hãng điện thoại tự quảng cáo tính năng này:**

- Samsung Game Booster có bảng pop-up, mở tối đa 4 app trong lúc chơi; app nào không hỗ trợ đa cửa sổ thì không thêm được.
- Huawei viết: "Open a floating window while gaming… without missing a second of the action".
- Xiaomi Việt Nam có hẳn một FAQ giải thích vì sao máy giật khi mở cửa sổ nhỏ trong lúc chơi game.
- Bản đồ Genshin dạng cửa sổ nổi của 光环助手 (một app hỗ trợ chơi game) có 1,1 triệu lượt xem.
- Nhóm Genshin Impact Việt Nam (06/2026, 102 lượt thích) hướng dẫn mở bản đồ HoYoLAB thành cửa sổ nổi. Bình luận nói dùng đa cửa sổ của Android với **Chrome mở web bản đồ thì mượt hơn**, và "iphone làm quái gì có cửa sổ nổi". Đây là trường hợp **gần nhất với sản phẩm của ta**: trang web trong cửa sổ nổi của hệ điều hành, nằm đè lên game.

**Riêng với nhạc cụ trong game, xếp theo mức phổ biến:**

1. **App cài riêng vẽ đè lên game:** đây là cách phổ biến nhất (Sky, Genshin, Identity V, Eggy Party, nay có cả DF). Đa số là app tự bấm thay người chơi. App chỉ để đọc bản nhạc thì hiếm. Ví dụ đáng chú ý: SkyScores (光遇乐谱) trên iOS dùng **Picture-in-Picture** (cửa sổ video nổi) để hiện bản nhạc ngay trong game (bản 1.8.9).
2. **Trình duyệt trong cửa sổ nổi:** đã được chứng minh dùng cho bản đồ và hướng dẫn, chưa thấy ai dùng để đọc bản nhạc.
3. **Chia đôi màn hình:** có dùng, chủ yếu để chạy hai tài khoản cùng lúc hoặc chat. Chính DF chạy được ở chế độ chia màn hình và cửa sổ nhỏ.
4. **Thiết bị thứ hai:** không tìm thấy bài nào nhắc tới. Không thấy bằng chứng không có nghĩa là không ai làm.

## b) Riêng kèn harmonica trong Delta Force bản mobile

**Nhu cầu rất lớn:**

- Video TikTok Việt Nam hướng dẫn thổi Quốc ca (26/9): 23,9k lượt thích, 3.392 lượt lưu, bản nốt ghim trong bình luận.
- Công cụ hiển thị nốt rơi luôn nằm trên cùng cho PC (Bilibili): 195k lượt xem, 9,8k lượt yêu thích. Đây chính là ý tưởng cửa sổ nhỏ cho PC của mình.
- Người chơi mobile hiện chép nốt dạng số từ bình luận hoặc ảnh chụp màn hình.

**Công cụ cho mobile hiện có, tất cả đều là file APK Android, không có cái nào là web:**

- **时屿洲音** (GitHub Suyi-yi/zhouyin): giống ý tưởng của ta nhất. Có chế độ luyện với nốt rơi, và "Delta mode" hiện gợi ý trong suốt nổi trên game. Công cụ này chỉ hiển thị: "不注入任何输入、不读取游戏画面、不调用无障碍" (không bấm thay, không đọc màn hình game, không dùng Accessibility). README dặn nếu game hiện cảnh báo bảo mật thì tắt ngay. Repo chưa có sao nào.
- **App tự bấm:**
  - "手游三角洲口琴自动演奏" (Bilibili, 9/2026): 125k lượt xem.
  - NoctReed (GitHub): dùng `AccessibilityService.dispatchGesture`.
  - A光遇音乐盒: app trả phí, đã thêm hỗ trợ kèn 8 phím của DF.
  - RatBook: có bản beta Android vẽ đè lên game; chế độ dạy (Teaching Mode) chỉ có trên Windows.
- **Video nhỏ** "三角洲口琴助手 悬浮显示口琴琴谱" (trợ lý kèn DF, hiện bản nhạc nổi): 483 lượt xem, xin công cụ qua tin nhắn riêng.

**Bố cục nút trên mobile đã được xác nhận:** 8 nút nốt cộng 4 nút chế độ (半音 nửa cung / 升调 lên quãng / 自然音 tự nhiên / 降调 xuống quãng). Cách chơi là chạm nút chế độ trước rồi mới chạm nốt; NoctReed chờ khoảng 120 ms giữa hai lần chạm. → Trang hướng dẫn của ta nên báo nút chế độ trước nốt.

**Lưu ý thực tế (trang trợ giúp DF của A光遇音乐盒):**

- Phải tắt con quay hồi chuyển, nếu không thì khi kéo cửa sổ nổi, góc nhìn trong game bị xoay theo.
- Lỗi "触摸被系统拦截" (thao tác chạm bị hệ thống chặn) thì gỡ DF khỏi 游戏空间 / 游戏魔盒 / 游戏加速 (các tiện ích chơi game của hãng).

**Tencent đang gây áp lực lên các công cụ tự bấm:** repo ChickenD233 phải "因被腾讯投诉，已暂停维护" (dừng phát triển vì bị Tencent khiếu nại), và ghi rõ: "在线对局使用自动输入违反游戏协议，有封号风险" (tự động bấm trong trận online là vi phạm thoả thuận người dùng, có nguy cơ bị khoá).

## c) Cửa sổ nổi có để game toàn màn hình tiếp tục chạy và nhận thao tác chạm không?

**Nhìn chung là có:**

- Từ Android 10, mọi cửa sổ đang hiển thị đều được giữ ở trạng thái chạy (multi-resume).
- DF chạy được trong cửa sổ nhỏ và khi chia màn hình. Có một lỗi giao diện sau khi thoát ra rồi vào lại chế độ chia màn hình; khởi động lại game là hết.

**Các vấn đề đã kiểm chứng:**

- **Samsung, mất focus:**
  - 12/2025: sau khi cập nhật One UI, chạm vào cửa sổ pop-up Chrome thì game phía sau đứng hình. Cập nhật Good Lock (module đa cửa sổ) thì hết.
  - 01/2026 (DC Inside): app ở chế độ chia màn hình hoặc pop-up bị dừng khi người dùng làm việc khác. Cách sửa: Good Lock → MultiStar → bật **Multi Focus**.
  - Với ta là chiều ngược lại: khi người chơi chạm vào DF, trang web mất focus và **nốt rơi có thể bị dừng**. Cần thử trên máy thật.
- **Samsung, độ trong suốt:** thanh trượt độ trong suốt của pop-up có đến One UI 6, **đã bị bỏ ở One UI 7** (theo người dùng và moderator chương trình beta, 2025). Chưa thấy bằng chứng One UI 8 đưa lại. Trang web không tự làm trong suốt cửa sổ của hệ điều hành được, nên giao diện phải gọn và đặc.
- **realme (dựa trên ColorOS):** tài liệu chính thức có mục "Quick-hide window in game": chạm ra ngoài cửa sổ nổi trong lúc chơi thì cửa sổ bị giấu vào mép màn hình. Rất bất lợi cho ta, vì người chơi phải chạm nút kèn bên ngoài cửa sổ. OPPO/OnePlus có lẽ cũng vậy nhưng chưa kiểm chứng.
- **vivo/iQOO:**
  - Cửa sổ nhỏ không phóng to được ("字我看都看不见", chữ nhỏ tới mức không đọc nổi).
  - Sau bản cập nhật, game toàn màn hình bị treo ngầm rồi mất kết nối.
  - Xiaomi thì thu cửa sổ nhỏ vào mép màn hình không làm dừng game (theo 1 bình luận).
- **OnePlus Ace 5 Pro / OnePlus 12 (2026):** văng game hoặc đứng khoảng 10 giây khi mở cửa sổ nhỏ hay chia màn hình. Một bình luận bị văng lúc đang "跑刀" (từ lóng của DF) và xem video cùng lúc.
- **Xiaomi (FAQ chính thức):** giật vì app chưa tối ưu cho cửa sổ nhỏ, nhiều app chạy nền, hoặc RAM thấp.
- **iPhone:** không có cửa sổ nổi cho app tuỳ ý.

## d) Rủi ro bị khoá tài khoản

**Quy định chính thức không cấm cửa sổ nổi:**

- Trang bảo mật của Tencent (df.qq.com) cấm: 外挂 (hack), 修改器 (công cụ sửa game), 模拟器脚本 (script giả lập), 非法插件 (plugin trái phép), và phần mềm ảnh hưởng cân bằng game.
- Danh sách của Garena VN (12/03/2025), trên mobile:
  - **Cấm:** chuột/bàn phím ngoài, phần cứng macro, adb/ida/ce, GG/IGG, Xposed/LSPosed, VMOS/app nhân bản, root/jailbreak.
  - **Khuyến cáo không dùng:** key macro, auto-click, AI aimbot, VPN, bộ lọc hình ảnh.
- **Không văn bản nào nhắc** cửa sổ nổi, chia đôi màn hình, trình duyệt hay lớp phủ.

**Lời đồn trong cộng đồng (chỉ là chuyện kể, chưa kiểm chứng):**

- Bình luận ghim (chỉ 8 lượt thích) dưới video "三角洲手游误封分析讲解" (phân tích các vụ khoá nhầm DF mobile, 601 bình luận) liệt kê các nguyên nhân bị khoá nhầm: "分屏小窗.游戏空间 游戏助手 … 非官方APP加载后台留存" (chia màn hình/cửa sổ nhỏ, không gian game, trợ lý game, app không chính thức chạy nền).
- "你手机开小窗就容易被封号" (mở cửa sổ nhỏ trên điện thoại là dễ bị khoá; 10 lượt thích), có người trả lời "这是真的，刚被封" (thật đấy, vừa bị khoá).
- Video về iQOO (1,25 triệu lượt xem): bình luận top (1.021 lượt thích) khuyên đừng bật tính năng hỗ trợ trong DF. Một trả lời (302 lượt thích) nói bị khoá 1 ngày vì bật hiển thị FPS, nhưng trả lời khác (114 lượt thích) nói dùng ROG 9 Pro bật đủ thứ nửa năm không sao.
- Hàn Quốc: một người bị khoá 7 ngày vì "sửa mã/dữ liệu game" sau khi cài từ Galaxy Store và chỉnh FPS trong Gaming Hub. Hỗ trợ của DF dặn tránh "포트 최적화, 권한 상승 플러그인, 키 매크로, 커스텀 롬" (tối ưu cổng, plugin leo thang quyền, macro phím, ROM tuỳ biến). Người chơi Hàn khuyên tắt Gaming Hub và các app tăng tốc.

**Đánh giá:** một trang web chỉ hiển thị thuộc nhóm rủi ro thấp nhất: không bấm thay, không đọc game, không cài app. Nhưng phải nói thật với người dùng là có lời đồn. Khuyên mở cửa sổ từ Đa nhiệm hoặc thanh bên, **không mở qua Game Booster/Gaming Hub/游戏空间**, và **không bao giờ thêm chức năng tự bấm**.

## e) Ý nghĩa cho web app của ta

**D có đáng làm không?** Chỉ nên làm **bản rẻ có nhãn "Thử nghiệm – Android"**, gần như chỉ là một chế độ giao diện:

- Chạy không cần chạm sau khi bắt đầu: đếm ngược 3-2-1 rồi tự chạy.
- 8 làn nốt to, chữ tương phản cao, báo nút chế độ trước nốt.
- Vẫn đọc được ở khoảng 300×300 dp, cả dọc lẫn ngang.
- Giữ màn hình sáng; có nút chỉnh lệch nhịp trước khi bắt đầu.

Trước khi quảng bá, phải thử với DF trên Samsung (One UI 7/8), Xiaomi HyperOS, OPPO/realme, vivo. Cần kiểm tra:

1. Game vẫn nhận thao tác chạm.
2. Nốt vẫn rơi khi focus nằm ở game.
3. Cửa sổ không bị tự giấu.
4. Âm thanh vẫn phát.
5. FPS và độ nóng máy sau một bài khoảng 3 phút.

**Nên thử song song: "D bằng Picture-in-Picture".**

- Chrome Android có `requestPictureInPicture` từ bản 105 (theo dữ liệu tương thích của MDN). Document PiP (cửa sổ nổi chứa HTML) thì không có trên Android.
- Ý tưởng: dựng sẵn hoạt cảnh nốt rơi của bài thành video, rồi phát trong PiP. Nếu dùng luồng canvas trực tiếp thì khi Chrome xuống nền, việc vẽ dừng và hình sẽ đứng.
- Cửa sổ PiP luôn nằm trên cùng, chạm ra ngoài thì thao tác đi vào game. Có thể chạy cả trên máy không có cửa sổ nổi, có thể cả iPhone. SkyScores đã làm cách này trên iOS.
- Cần thử trên máy thật.

**Thứ tự ưu tiên đề xuất:**

1. **C – Luyện chạm:** bố cục 8+4 giống hệt game, chạm chế độ rồi mới chạm nốt. Không rủi ro, chạy trên mọi máy kể cả iPhone. Người chơi mobile than nút khó bấm, và 时屿洲音 cũng có chế độ luyện này.
2. **A – Chế độ màn hình thứ hai:** điện thoại cũ, máy tính bảng hoặc PC đặt cạnh; làn nốt to, giữ màn hình sáng (Wake Lock), đếm ngược để bắt nhịp. Không rủi ro, rẻ.
3. **B – Nhắc nốt bằng giọng:** nên dựng sẵn thành một file âm thanh. Hẹn giờ trong tab chạy nền bị làm chậm, còn file âm thanh thì nhiều khả năng vẫn phát khi trình duyệt chạy nền (cần thử), nên không cần màn hình. Cần thử thêm việc trộn tiếng với âm thanh game.
4. **D – Trang gọn cho cửa sổ nổi Android, kèm thử PiP:** thử nghiệm.
5. **E – Rung:** `navigator.vibrate` chỉ chạy khi trang đang hiển thị trên Chrome Android, không chạy trên iOS, nên vô dụng khi game đang ở phía trước.

**Hướng dẫn cho người dùng (nếu ra mắt D):**

- Tắt con quay hồi chuyển trong DF. Không chạm vào cửa sổ hướng dẫn khi đang thổi. Game hiện cảnh báo bảo mật thì tắt cửa sổ ngay.
- **Samsung:** Đa nhiệm → chạm biểu tượng trình duyệt → "Mở ở dạng xem pop-up". Kéo cửa sổ lên góc trên, không che 12 nút. Nếu game đứng hoặc nốt ngừng rơi: Good Lock → MultiStar → bật Multi Focus. Không mở qua Gaming Hub.
- **Xiaomi/HyperOS:** Đa nhiệm, nhấn giữ thẻ trình duyệt → Cửa sổ nhỏ, hoặc mở từ thanh bên. Các máy Redmi giá rẻ có thể không có tính năng này.
- **Huawei/Honor:** vuốt từ mép màn hình và giữ → thanh đa cửa sổ → trình duyệt.
- **OPPO/realme/OnePlus:** Thanh bên thông minh → trình duyệt. Báo trước là chạm ra ngoài cửa sổ có thể làm nó bị giấu vào mép; OnePlus có báo văng game.
- **vivo/iQOO, iPhone, máy không có cửa sổ nổi:** dùng A (màn hình thứ hai) hoặc B (nhắc bằng giọng).

## Mâu thuẫn và các điểm đã hạ mức tin cậy

- SkyScores: App Store Mỹ ghi PiP có từ bản **1.8.9 (13/7)**, không phải 1.8.10.
- Tài liệu realme: WebFetch trả về trang trống, nội dung xác nhận qua chỉ mục tìm kiếm. Chỉ chắc chắn cho realme UI 3.0–6.0.
- Video "千万不要用三角洲分屏" (đừng chia màn hình khi chơi DF; 643 lượt xem): người đăng chia màn hình vì nửa dưới màn hình bị hỏng. Không thấy câu "ngày nào cũng chơi".
- Tin đồn bị khoá vì cửa sổ nhỏ: bình luận ghim chỉ 8 lượt thích; video BV13Fa667ExH chỉ 171 lượt xem, 0 bình luận. Mức tin cậy: yếu.
- Thông tin Samsung pop-up có chỉnh độ trong suốt (bài mẹo năm 2020) đã lỗi thời.

## Nguồn (đã tự kiểm lại)

**Tiếng Trung**

- https://www.bilibili.com/video/BV15NbN6jEey/
- https://www.bilibili.com/video/BV1Uq3MzJEVH/
- https://www.bilibili.com/video/BV1FhzqBNE5A/
- https://www.bilibili.com/video/BV1JPNMznETs/
- https://www.bilibili.com/video/BV1V1gHztEm2/
- https://www.bilibili.com/video/BV1eET1zpEFD/
- https://www.bilibili.com/video/BV1Gp316LESk/
- https://www.bilibili.com/video/BV1Lv41147Cw/
- https://www.bilibili.com/video/BV1sxYr6GEAT/
- https://www.bilibili.com/video/BV1uBYh6WEvn/
- https://www.bilibili.com/video/BV1xrhD6KExX/
- https://github.com/Suyi-yi/zhouyin
- https://github.com/JeanWenzelCN/Delta-Force-NoctReed
- https://github.com/ChickenD233/harmonica-auto-player
- https://www.autotouch.cn/help/delta-force/
- https://df.qq.com/cp/a20240531anticheat/

**Tiếng Anh**

- https://consumer.huawei.com/ph/support/content/en-us15834637
- https://www.realme.com/in/support/kw/doc/2071405
- https://apps.apple.com/us/app/-/id1483899033
- https://us.community.samsung.com/t5/Questions/Pop-up-View-Transparency-missing/m-p/3219998
- https://ratbook.xyz
- https://groups.google.com/a/chromium.org/g/blink-dev/c/JTPl7fM64Lc
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestPictureInPicture

**Tiếng Hàn**

- https://www.samsungsvc.co.kr/solution/1017693
- https://r1.community.samsung.com/t5/%EA%B0%A4%EB%9F%AD%EC%8B%9C-s/%EA%B2%8C%EC%9E%84%EC%8B%9C-%ED%8C%9D%EC%97%85%EC%B0%BD-%EC%8B%A4%ED%96%89%ED%95%98%EB%A9%B4-%EB%92%A4%EC%97%90-%EA%B2%8C%EC%9E%84-%EB%A9%88%EC%B6%A4-%ED%98%84%EC%83%81/td-p/36088795
- https://gall.dcinside.com/mgallery/board/view/?id=nnsnb&no=24974
- https://gall.dcinside.com/mgallery/board/view/?id=deltaforce&no=93928
- https://gall.dcinside.com/mgallery/board/view/?id=deltaforce&no=94680

**Tiếng Việt**

- https://deltaforce.garena.vn/news/huong-dan-chung/danh-sach-phan-mem-phan-cung-bi-cam
- https://www.facebook.com/groups/648618483681727/posts/1368893094987592/
- https://www.tiktok.com/@sundaesarmie/video/7689790725508091142
- https://www.mi.com/vn/support/faq/details/KA-539974/
