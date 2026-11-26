# Cảnh báo lừa đảo — Editorial Security News V2

> Concept A đã được hoàn thiện thêm ở [Fraud Alert Visual Refinement](FINCOPILOT_FRAUD_ALERT_VISUAL_REFINEMENT.md). Tài liệu này ghi lại bước chọn concept.

Ngày review: 26/11/2026. Phạm vi: giao diện danh sách Cảnh báo trong Home/Radar. Không thay đổi API, quy tắc xác minh, dịch vụ, Prisma hoặc dữ liệu.

## 1. Ảnh tham chiếu đã kiểm tra

- **Gridstudio Cybersecurity Editorial Cards** (ảnh người dùng cung cấp): nhịp khối ảnh lớn xen bài nhỏ, tiêu đề ngắn, metadata khiêm tốn. Lấy nhịp biên tập và vai trò ảnh, không sao chép lưới thẻ trắng.
- **Bace News Dashboard** (ảnh người dùng cung cấp trước đó): giữ khung đọc ba cột, banner tối, tìm kiếm, chủ đề và tab; tin chính dẫn mắt trước các bài ngắn.
- **Monzo Scam Prevention** (ảnh người dùng cung cấp trước đó): cảnh báo dùng câu trực tiếp và hướng dẫn rõ. Màn Radar chỉ là bước đọc tin nên lối sang Giám định vẫn là liên kết, không biến thành nút chặn thanh toán.

## 2. Hai bản mẫu độc lập

Cả hai dùng HTML/fixture cô lập tại `artifacts/fraud-alert/editorial-v2/prototypes.html`. Chúng không gọi API và ghi rõ nội dung minh họa. Các SVG là tranh vẽ gốc trong repository, không phải ảnh sự việc hoặc bằng chứng.

| Phương án | Desktop | Mobile | Nhận xét |
| --- | --- | --- | --- |
| A — trang nhất | [Ảnh](../../artifacts/fraud-alert/editorial-v2/prototype-a-desktop.png) | [Ảnh](../../artifacts/fraud-alert/editorial-v2/prototype-a-mobile.png) | Ảnh và tít chính cân bằng; bài phụ ở hàng ngắn; dẫn chứng gần câu cảnh báo. Mobile còn đủ chỗ cho hai bài phụ. |
| B — tạp chí | [Ảnh](../../artifacts/fraud-alert/editorial-v2/prototype-b-desktop.png) | [Ảnh](../../artifacts/fraud-alert/editorial-v2/prototype-b-mobile.png) | Ảnh ngang nổi bật nhưng chiếm nhiều chiều cao; các cảnh báo phụ và dẫn chứng xuống sâu. |

**Chọn A.** Phương án này gần nhịp tin lớn/tin nhỏ của Gridstudio và phù hợp khung đọc Bace hơn. So với Monzo, hướng dẫn phòng tránh vẫn trực tiếp nhưng không giả định người đọc đang ở một giao dịch thanh toán.

## 3. Áp dụng vào tab Cảnh báo

- Một bài chính có ảnh minh họa gốc phù hợp nhóm thủ đoạn đã biết; bài phụ là các mục đọc ngắn, không lặp cùng mô típ thẻ.
- Trạng thái “Đã xác minh” chỉ lấy từ `verificationStatus === 'VERIFIED'`, và cảnh báo phải có `publishedAt` mới xuất hiện. Nhãn này không phải điểm rủi ro cá nhân.
- Giữ nguyên URL dẫn chứng từ `evidence`. Nếu thiếu URL, hiển thị tên nguồn cùng “Chưa có liên kết”; không tạo liên kết giả.
- Thời điểm công bố nằm cạnh nhóm thủ đoạn. Dẫn chứng và liên kết xem chi tiết nằm ngay trong bài, không tách thành khối CTA lớn.
- Ảnh SVG được ghi “Minh họa gốc · không phải ảnh sự việc”. API cảnh báo hiện không có ảnh bài viết; không dùng ảnh của bài khác để gán cho cảnh báo.
- Trên mobile, thứ tự đọc của bài chính là metadata và tiêu đề → ảnh → hướng dẫn và nguồn. Sidebar của shell vẫn ở sau nội dung.

Ảnh giao diện thật sau khi tích hợp: [desktop](../../artifacts/fraud-alert/editorial-v2/final/feed-desktop.png), [390px](../../artifacts/fraud-alert/editorial-v2/final/feed-mobile.png), [320px](../../artifacts/fraud-alert/editorial-v2/final/feed-narrow.png). Ảnh chi tiết: [desktop](../../artifacts/fraud-alert/editorial-v2/final/detail-desktop.png), [mobile](../../artifacts/fraud-alert/editorial-v2/final/detail-mobile.png).

## 4. Review ảnh chụp và chỉnh sửa

Lần dựng đầu trên ứng dụng thật còn đường viền dọc từ CSS cũ và đặt tiêu đề dưới ảnh trên điện thoại, khiến tít chính nằm dưới vùng nhìn đầu tiên. Đã bỏ đường viền, tách phần đầu bài khỏi phần bằng chứng và đổi thứ tự đọc ở màn nhỏ. Ảnh trước sửa lưu tại `artifacts/fraud-alert/editorial-v2/inspection/`.

Ở 1440px, nhịp chính/phụ rõ nhưng phần tin thứ hai bắt đầu gần mép dưới khung đọc do chiều cao shell hiện hữu. Người đọc cuộn vùng tin để xem tiếp. Ở 390px và 320px không có tràn ngang; ảnh và tít không che điều khiển điều hướng.

## 5. Kiểm tra đã chạy

- TypeScript: `node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json` — đạt.
- ESLint: `node node_modules/eslint/bin/eslint.js apps/web/src/app/radar/page.tsx` — đạt.
- Next production build với Node 24 và font cache cục bộ — đạt. Next thông báo cấu hình ESLint chưa nhận plugin Next; không phải lỗi build.
- Playwright trên bản build cục bộ và API fixture: `fraud-alert-ui.spec.ts` **9/9**, `radar-v2.spec.ts` + `ui-completion.spec.ts` **30/30**.
- Chụp prototype A/B desktop và mobile; chụp ứng dụng thật 1440×900, 390×844 và 320×844. Cả ba kích thước ứng dụng thật có `scrollWidth - innerWidth = 0`.

## 6. Giới hạn

- Ảnh là minh họa gốc theo nhóm thủ đoạn, không phải ảnh nguồn. Nếu câu cảnh báo không khớp hình chuyển phí hoặc mạo danh, dùng hình trung tính về kiểm tra nguồn; không suy đoán cảnh sự việc.
- Fixture thử nghiệm dùng nguồn `example.test`; không chứng minh tính đúng đắn của cảnh báo hoặc nguồn thực tế.
- Bố cục shell, sidebar, trạng thái xác minh, bằng chứng và trang chi tiết vẫn theo hiện trạng. Không thử nguồn tin thật hoặc dữ liệu production trong đợt UI này.
