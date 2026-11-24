# FINCOPILOT Radar — Review độ trung thực thị giác, lượt 2

**Phạm vi:** Chỉ trang `/radar` và phần hiển thị điều hướng được bật riêng cho đúng route này. Không thay Backend, schema, route khác hay dữ liệu nghiệp vụ.

## Bằng chứng đã xem trước khi sửa

- Ảnh Bace News Dashboard được mở trực tiếp từ `Momo/docs/design/references/Y3-wzBYn2B1xWLDUWqK6b-Dhza28Immmmj-CkINWIxF7-E6i7S7KwiOmKa67NTsn47WOxIRD-Gisfijns9MBKpR-TIFQg80I3MKNZ28kWA9mZ1CxdozvtB_krcZUfmiEoD4Oz9-QHffdlO9ShbMNUOQv8Bd0UchcvZxq1jkXK-Bqggbb_0dSbZ9H3pBZSMSi.jpg`.
- Radar hiện tại được mở tại 1440×900 và 390×844; ảnh trước lưu tại `screenshots/radar-second-pass-before-desktop.png` và `screenshots/radar-second-pass-before-mobile.png`.
- Hợp đồng dữ liệu được kiểm tra trong `apps/api/src/modules/radar/radar.service.ts`, `apps/api/prisma/schema.prisma`, DTO dùng chung và type ở `apps/web/src/app/radar/page.tsx`.

Ảnh trước là render thật của frontend hiện tại qua mock API E2E: một bài NHNN mẫu, không có danh sách trạng thái nguồn. Đây không phải tin production.

## Năm khác biệt lớn nhất giữa Bace và Radar trước lượt này

| # | Ảnh Bace quan sát trực tiếp | Radar trước lượt này | Hệ quả thiết kế |
|---|---|---|---|
| 1. Canvas và tỷ lệ | Một vùng workspace trắng liền mạch chiếm khoảng 90% khung ảnh; thanh điều hướng khoảng 17%, vùng bài chính khoảng 56%, cột bên khoảng 25%. | Thanh điều hướng app cũng chiếm gần 18%, nhưng trang nội dung là một canvas riêng, giới hạn bề rộng, chỉ có feed và rail trạng thái 268 px. | Chỉ có các tỷ lệ tương tự không tạo cùng bố cục. Radar cần một vùng nội dung chính và ngữ cảnh bên phải được nhóm thành một workspace; nav desktop cần co lại riêng cho Radar. |
| 2. Vùng bài dẫn đầu | Hai story có ảnh đặt cạnh nhau chiếm phần lớn cột trung tâm. Mỗi story có nhãn, headline và lớp metadata đặt trên ảnh. | Một headline chữ trên nền chung; không có bề mặt feature hoặc story thứ hai. | Tăng nhẹ cỡ headline đầu tiên không thay được trọng lượng thị giác của hai feature. |
| 3. Nhịp và mật độ | Sau cặp feature là các hàng nhỏ hơn, mỗi hàng có thumbnail và metadata; kích thước giữa các nhóm nội dung thay đổi rõ. | Các tin dùng gần như cùng một kiểu chữ và quy tắc hàng. Khi chỉ có một tin, phần lớn viewport trống. | Cần nhịp: một hoặc hai feature, tiếp theo là hàng gọn, và trạng thái rỗng có bố cục riêng. |
| 4. Cột ngữ cảnh | Cột bên có các picks, chủ đề và theo dõi — một số hành động đọc rõ ràng. | Rail chỉ có trạng thái crawl. Ảnh trước không có dữ liệu trạng thái nguồn nên gần như rỗng. | Chuyển ngữ cảnh bên phải sang thông tin hữu ích thật: cảnh báo đã công bố và tình trạng thu thập; nếu thiếu, ghi rõ. |
| 5. Bộ lọc, chữ và nhóm bề mặt | Search, topic chips và feed tabs nằm sát vùng story; bề mặt ảnh làm điểm nhấn, hàng tin gọn hơn. | Search, select và tabs còn rời nhau; separator và tiêu đề là gần như toàn bộ nhóm thị giác. | Tích hợp bộ lọc; dùng bề mặt có chủ đích cho tối đa hai feature; hàng thứ cấp phẳng và có vạch phân cách. |

## Ảnh bài viết: khả năng thực tế

`MarketArticle`, API `articleDto`/list response, DTO dùng chung và type frontend không có URL ảnh, asset media, quyền sử dụng, caption hay alt text. Vì vậy chưa có cơ sở để hiển thị ảnh bài viết thật trong production. Không dùng ảnh lifestyle/stock hoặc ảnh tạo ngẫu nhiên như thể chúng mô tả sự kiện tài chính.

Để thử bố cục gần Bace, đã tạo **prototype thiết kế riêng** trong `docs/design/prototypes/`: hai SVG hình học trừu tượng và một HTML dùng dữ liệu mẫu. Banner và nhãn trên từng hình ghi rõ đây là mô phỏng/không phải ảnh sự kiện. Đây không phải nội dung hoặc tính năng của app production.

Production dùng bố cục chữ, màu theo chủ đề, dấu chủ đề dạng chữ viết tắt có nội dung nhãn đầy đủ và bề mặt feature. Không dùng ảnh giả. Nếu sau này cần ảnh thật, phải chốt nguồn, quyền sử dụng, lưu trữ, alt text và hợp đồng API trước.

## Kết quả lượt thiết kế mới

- Desktop `/radar` chuyển nav toàn cục thành rail icon gọn chỉ tại route landing; tên route vẫn giữ trong cây accessibility và tooltip. Mobile giữ bottom navigation hiện hành.
- Main trở thành vùng biên tập chính; cột bên hiển thị cảnh báo gần đây cùng trạng thái xác nhận độc lập, sau đó là trạng thái crawl nguồn.
- Một tin có một feature rộng; từ hai tin trở lên có hai feature khác nhau, các tin sau thành hàng gọn. Thứ tự dùng `publishedAt` API đang sắp giảm dần, không tự tạo điểm “nổi bật”.
- Search, lọc chủ đề, tab cảnh báo và trạng thái loading/error/empty còn hoạt động. Tích hợp “Tải thêm” theo cursor `hasMore/nextCursor` hiện có, không đổi API/backend.
- Nguồn và mốc công bố/ghi nhận vẫn tách biệt. Tình trạng nguồn không được diễn giải thành nội dung đã xác minh.
- Sau lần xem screenshot, watermark ban đầu đè gần headline đã được đưa sang vùng riêng trên desktop và ẩn ở mobile; màu cảnh báo được gỡ khỏi feature bài thường.

## Ảnh đã render

Ảnh app sau ở 1440×900 và 390×844 dùng mock API E2E có một bài mẫu. Ảnh `radar-two-feature-*` dùng fixture Playwright cô lập có năm bài, năm nguồn và một nguồn lỗi để xem hai feature cùng hàng thứ cấp. Tiêu đề, URL `example.test`, nguồn và thời gian trong fixture không phải dữ liệu production.

Prototype có ảnh minh họa riêng, được chụp ở cùng hai kích thước. Hai SVG là hình học trừu tượng do dự án tạo; không phải ảnh chụp hoặc biểu diễn tin thật.

## Khác biệt còn lại so với Bace

1. Bace có ảnh biên tập thật chiếm diện tích lớn; app production FINCOPILOT chưa thể làm vậy nếu chưa có media hợp lệ. Bản production chủ động dùng bố cục chữ.
2. Prototype ảnh chỉ chứng minh tỷ lệ và trọng lượng ảnh trong một bài thử, không biến thành thiết kế production.
3. Bace có hành động theo dõi/lưu bài và nội dung Picks. FINCOPILOT không có các hành động đó trong API/phạm vi hiện tại nên không sao chép.
4. Cột nguồn trên mobile nằm sau feed; người dùng cuộn xuống mới xem trạng thái crawl. Đây là lựa chọn để giữ story làm nội dung đầu tiên.

## Kiểm tra đã chạy

- Playwright render ảnh desktop/mobile cho production và prototype; xác nhận 2 SVG prototype tải được.
- Layout không tràn ngang tại 320, 390, 768, 1024 và 1440 px; kiểm tra dữ liệu một/trên một story, hai feature và hàng thứ cấp.
- Kiểm tra empty/loading/error, thử lại, đổi chủ đề, tìm kiếm, chuyển từ cột ngữ cảnh sang tab cảnh báo và tải tiếp theo cursor. Fixture hai trang cho thấy 100 bài hiển thị, không tràn ngang.
- Hình học desktop: headline của hai feature không giao với vùng dấu chủ đề sau chỉnh sửa.
- SVG trong prototype: cả hai asset tải thành công trong Chromium.
- E2E hiện có: 4/4 pass sau khi bỏ liên kết trùng giữa preview cảnh báo và danh sách cảnh báo.
- ESLint pass; `tsc --noEmit` pass; Next.js production build pass; `git diff --check` không có lỗi whitespace (chỉ có cảnh báo CRLF trên một số file vốn đã sửa trước đó).

## File liên quan

- Prototype thiết kế: `prototypes/radar-image-study.html`, `prototypes/radar-artwork-liquidity.svg`, `prototypes/radar-artwork-policy.svg`.
- Screenshot app: `screenshots/radar-second-pass-before-*`, `screenshots/radar-second-pass-after-*`, `screenshots/radar-two-feature-*`.
- Screenshot prototype: `screenshots/radar-image-study-*`.
