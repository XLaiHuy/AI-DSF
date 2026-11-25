# FINCOPILOT — Design Direction

## Định vị trải nghiệm

**Editorial Financial Intelligence × Trust-first Workspace** — một nơi đọc tin tài chính có nguồn gốc rõ ràng, và một workspace có cấu trúc cho các tác vụ vận hành. Tĩnh, chính xác, tối ưu tiếng Việt; dữ liệu và hành động quan trọng hơn hiệu ứng.

## Hai hướng thị giác đã cân nhắc

### A. Bản tin tài chính biên tập

- **Khái niệm:** Radar vận hành như trang đọc tin; tiêu đề và nguồn là trọng tâm, nội dung theo cột đọc, trạng thái có nghĩa dùng màu tiết chế.
- **Typography:** Be Vietnam Pro tạo nhịp bằng cỡ/độ đậm; JetBrains Mono chỉ dùng cho lãi suất, tiền, mã và timestamp cần so sánh.
- **Màu:** nền trung tính ấm, chữ mực xanh đen, xanh rừng làm điểm nhấn; amber/đỏ chỉ cho trạng thái rủi ro.
- **Bố cục:** feed dọc, khoảng trắng có chủ đích, divider thay cho card lặp; provenance ngay cạnh thời gian công bố.
- **Điều hướng:** Radar là lối đọc chính; liên kết chi tiết rõ, không trùng CTA.
- **Thành phần:** hàng tin, nguồn gốc, trạng thái xác minh, vùng fact/assessment.
- **Lợi ích:** phù hợp đọc/lọc/đối chiếu nhiều nguồn; giúp fact và AI không nhập làm một.
- **Đánh đổi:** chiều dài trang tăng; cần xử lý trạng thái dữ liệu ít/không có mà không lấp bằng nội dung giả.

### B. Bàn làm việc điều phối tin cậy

- **Khái niệm:** giao diện như công cụ làm việc cho quản trị nguồn và dữ liệu, nhấn vào trạng thái, bảng và thao tác.
- **Typography:** sans nhất quán; mono cho mã nguồn, lượt quét, số liệu.
- **Màu:** nền trung tính, semantic status rõ và có nhãn chữ.
- **Bố cục:** mật độ cao, nhóm thao tác theo nguồn/catalog, bảng có phân cấp cột.
- **Điều hướng:** tách khu vực vận hành khỏi luồng người đọc; route nội bộ nằm trong nhóm phụ.
- **Thành phần:** bảng, trạng thái crawl, thao tác thử lại, form catalog.
- **Lợi ích:** hiệu quả với SCR-09 và kiểm tra dữ liệu nhiều dòng.
- **Đánh đổi:** nếu áp toàn hệ thống sẽ làm Radar giống dashboard giám sát, giảm trải nghiệm đọc và bối cảnh bài viết.

## Hướng được chọn

Chọn **A làm ngôn ngữ mặc định của Radar**, kết hợp **B có chọn lọc cho Admin**. Home là điểm điều hướng gọn, không phải dashboard thống kê. `/survey` giữ trạng thái tiếp nhận handoff cho tới khi phần tính toán được nhóm triển khai. `/forensic` và `/profile` vẫn là scaffold ngoài phạm vi redesign này.

Tham khảo cách [Mercury trình bày insight gắn với dữ liệu](https://mercury.com/blog/march-2026-product-updates), [Stripe tổ chức báo cáo theo câu hỏi và phạm vi dữ liệu](https://support.stripe.com/questions/stripe-reports), và [Ramp so sánh ngân sách dự kiến với thực tế](https://support.ramp.com/budgets-overview-and-setup/). FINCOPILOT mượn nguyên tắc về hierarchy, scope dữ liệu và hành động; không mượn nhận diện, bố cục hay bảng màu.

## Nguyên tắc thiết kế

1. Hiển thị nguồn, thời gian và nhãn dữ kiện sát nội dung mà chúng hỗ trợ.
2. Nêu rõ “AI” khi đó là diễn giải; giữ trạng thái “chưa xác minh” có chữ và không suy diễn.
3. Chỉ dùng biểu đồ hoặc số lớn khi giúp so sánh/ra quyết định thật; không tạo KPI trang trí.
4. Dùng divider, kiểu chữ, spacing và nhóm nội dung trước khi thêm card.
5. Mọi điều khiển có tên gọi dễ hiểu, vùng bấm đủ lớn và focus nhìn thấy.
6. Nội dung và hành động phải phản ánh trạng thái triển khai thực tế; không hứa chức năng scaffold.
7. Mobile là một bố cục riêng: bốn điểm điều hướng chính và menu phụ cho các route còn lại.

## Phạm vi thực hiện

- Redesign / chuẩn hóa: `/`, `/radar`, `/radar/[id]`, `/survey` (handoff hiện có), `/admin`.
- Chỉ ảnh hưởng gián tiếp qua AppShell; không mở rộng nghiệp vụ `/forensic` và `/profile`.
- Giữ API, schema, business logic và dữ liệu hiện hữu; không thêm tính năng, nội dung demo hay endpoint.

## Tài liệu liên quan

- [Audit giao diện](UI_AUDIT.md)
- [Design System](DESIGN_SYSTEM.md)
- Screenshot kiểm tra: [`radar-desktop.png`](screenshots/radar-desktop.png), [`radar-mobile.png`](screenshots/radar-mobile.png)

## Kết quả áp dụng và critique

- Home dùng hai mục điều hướng dạng hàng biên tập; bỏ số tiền/kỳ hạn demo.
- Feed Radar giữ bố cục một cột và loại CTA lặp; detail dùng tiêu đề tiếng Việt, nguồn gốc theo thời gian, trạng thái AI độc lập và evidence tách nhóm.
- Admin vẫn dùng bề mặt cho hai tác vụ lớn (nguồn và catalog), vì bảng cần được nhóm theo công việc; không chuyển mỗi dòng thành card.
- Survey chỉ thiết kế lại trạng thái handoff có thật. Không giả lập calculator.
- Mobile dùng ba mục chính và nút “Thêm” để vào các route còn lại; đo không tràn ngang ở 360/390/768/1440 px.
- Xem [UI Audit — phần Thực hiện và vòng critique](UI_AUDIT.md#thực-hiện-và-vòng-critique) và screenshot desktop/mobile của từng màn ở bảng trong audit.
