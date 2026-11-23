# FINCOPILOT — Hướng thiết kế Radar

## Mục tiêu

Thiết kế giao diện Radar như một công cụ đọc thông tin tài chính có xuất xứ rõ ràng: người đọc lướt tiêu đề, nhận biết thời điểm và nguồn, rồi quyết định mở bài phân tích hoặc nguồn gốc. Không trình bày AI như nhân vật chính, không khiến suy luận AI bị hiểu thành sự kiện đã được xác minh.

## Hai hướng thị giác

### A. Bản tin tài chính biên tập — đề xuất

- Bố cục feed dọc, phân cấp một câu chuyện chính và các tin kế tiếp bằng cỡ chữ, khoảng cách và đường kẻ mảnh.
- Typography UI hiện có, tạo nhịp biên tập bằng kích cỡ/độ đậm/đường kẻ; số liệu/thời gian dùng chữ số tabular.
- Nền giấy sáng hơi ấm, chữ mực đậm, xanh lá trầm làm màu thương hiệu; màu rủi ro chỉ dùng cho trạng thái có nghĩa.
- Provenance (nguồn, ngày công bố, link gốc) đặt sát tiêu đề; phân vùng riêng cho dữ kiện và diễn giải khi vào chi tiết.
- Ưu điểm: hợp với nhiệm vụ đọc, so sánh nguồn, phân biệt fact/assessment; nội dung có khoảng thở mà vẫn tiết kiệm không gian.
- Đánh đổi: cần kiểm soát độ dài tiêu đề và metadata để danh sách không kéo dài; serif cần fallback có đủ glyph tiếng Việt.

### B. Bàn điều phối nguồn tin

- Bố cục dày hơn, tập trung vào trạng thái nguồn, bộ lọc và bảng sự kiện; dùng sans/mono xuyên suốt.
- Các trạng thái crawl và cảnh báo ở thanh bên; mỗi hàng ưu tiên thời điểm cập nhật và loại tin.
- Ưu điểm: thuận cho người vận hành theo dõi nhiều nguồn lỗi và xử lý tác vụ quản trị.
- Đánh đổi: dễ biến Radar cho người đọc thành màn hình vận hành; bảng dày làm giảm khả năng đọc tiêu đề và ngữ cảnh. Phù hợp hơn với `/admin` nếu team xác nhận nhu cầu vận hành.

## Hướng được chọn cho màn tham chiếu

Chọn **A — Bản tin tài chính biên tập** cho `/radar`. Đây là điểm vào đọc của SCR-02; nhiệm vụ đầu tiên là hiểu tin và provenance, còn vận hành crawl thuộc trang quản trị. Học từ Mercury về việc trình bày insight gắn với dữ liệu; từ Stripe về lọc/báo cáo theo câu hỏi và độ chính xác; từ Ramp về việc chỉ trực quan hóa thứ hỗ trợ hành động. Không sao chép màu, hình khối, biểu tượng hay cấu trúc của các sản phẩm này.

Prototype giới hạn trong màn `/radar`. Không sửa `/radar/[id]`, `/admin`, Loan Advisor hoặc nghiệp vụ API trước khi người dùng duyệt màn tham chiếu.

## Design tokens V0

Các giá trị dưới đây định hướng màn Radar; dùng biến hiện tại khi tương đương, thêm token riêng cho page nếu cần. Không đổi theme toàn ứng dụng ở lượt này.

### Typography

| Token | Giá trị/ý định |
|---|---|
| UI | `Be Vietnam Pro`, đã có trong ứng dụng; 14–16 px, line-height 1.45–1.6 |
| Tiêu đề feed | Be Vietnam Pro hiện có; 21–25 px, weight 600, line-height khoảng 1.35; nhấn bằng phân cấp và khoảng trắng, không dựa vào serif |
| Page heading | Sans hiện có, 30–34 px desktop, 27–30 px mobile; 600–700 |
| Metadata | Sans 12–13 px, tương phản đủ; thời gian dùng `font-variant-numeric: tabular-nums` |
| Tài chính | `JetBrains Mono` chỉ cho con số/lãi suất cần so sánh; không dùng mono như trang trí |

### Màu

| Token | Giá trị | Dùng cho |
|---|---|---|
| `radar-paper` | `#F7F7F2` | Nền vùng nội dung |
| `radar-surface` | `#FFFFFF` | Bề mặt đọc/điều khiển cần tách lớp |
| `radar-ink` | `#17231D` | Nội dung chính |
| `radar-muted` | `#52635A` | Metadata và hướng dẫn phụ |
| `radar-rule` | `#D9E1DA` | Đường chia mảnh |
| `radar-brand` | `#145C46` | Hành động chính/điều hướng đang chọn |
| `radar-verified` | `#176B49` | Chỉ trạng thái đã xác minh |
| `radar-uncertain` | `#8A5A08` | Chưa xác minh/cần thận trọng; luôn kèm nhãn chữ |
| `radar-danger` | `#A62D25` | Nguy cơ đã được phân loại; không hàm ý xác minh |

Không dùng màu riêng để ngụ ý mức tin cậy AI. Màu semantic luôn đi cùng nhãn; màu nguồn đáng tin không tự suy ra trạng thái xác minh.

### Layout, density và components

- Lưới 12 cột desktop, vùng nội dung tối đa khoảng 1120 px; feed chính khoảng 700–760 px và cột trạng thái nguồn chỉ xuất hiện khi có dữ liệu nguồn.
- Mobile một cột, padding ngang 20–24 px; không có cuộn ngang. Giữ tương tác lọc và chuyển tab dễ chạm (mục tiêu cao tối thiểu 44 px).
- Spacing theo bội 4 px: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64.
- Feed dùng đường phân cách và bề mặt phẳng; không lặp card bo tròn cho mỗi bài. Radius: 4 px cho input, 6 px cho menu; tối đa 10 px cho bề mặt có chứa form. Không elevation cho bài viết.
- Button: hành động chính xanh đặc, phụ dạng text/outline nhẹ; trạng thái focus nhìn rõ; liên kết bài gốc có icon nhỏ và nhãn.
- Input/select: viền trung tính, nhãn truy cập được, focus ring hiện tại; không chỉ dựa vào placeholder.
- Tables/charts chưa cần trong feed. Chỉ thêm biểu đồ ở Loan Advisor khi so sánh chi phí/kịch bản thực sự dễ hiểu hơn bằng đồ thị.
- Loading: skeleton/nhãn tải ở vùng feed; empty: chỉ rõ không có kết quả và thao tác lọc liên quan; error/partial: giữ nội dung đã tải, chỉ nguồn lỗi mới gắn cảnh báo cùng mốc lần thành công gần nhất nếu API có trường đó.

### Responsive và accessibility

- Giữ thứ tự DOM theo thứ tự đọc: tiêu đề → tabs/lọc → trạng thái nguồn → feed.
- Tabs hoặc dùng semantic ARIA đầy đủ (tab, tablist, tabpanel, phím mũi tên) hoặc thể hiện là bộ lọc bằng button/aria-pressed.
- Liên kết ngoài mô tả rõ là nguồn gốc; mở tab mới cần báo phù hợp cho công nghệ hỗ trợ.
- Màu chữ/viền phải đủ tương phản; trạng thái xác minh luôn có text, không mã hóa bằng màu/icon đơn lẻ.
- Kiểm tra viewport 390 px và 1440 px; tôn trọng focus-visible, skip link, reduced motion và zoom trình duyệt.

## Phạm vi thử nghiệm và tiêu chí duyệt

Màn mẫu: `/radar` với danh sách tin và bộ lọc đã có; không thêm tính năng mới. Trước khi mở rộng, cần người dùng duyệt screenshot desktop/mobile sau ít nhất một vòng critique. Tiêu chí: nguồn/thời gian dễ quét; feed đọc như một danh sách có biên tập; mọi trạng thái bất định được nói rõ; không còn tràn ngang ở mobile; không dùng dữ liệu hoặc phân tích giả để lấp khoảng trống.

### Screenshot vòng duyệt

- Desktop 1440×1000: [`radar-desktop.png`](design/screenshots/radar-desktop.png)
- Mobile 390×844: [`radar-mobile.png`](design/screenshots/radar-mobile.png)

Trong shell dùng chung, nút Hồ sơ trên topbar được ẩn dưới 640 px vì cùng chức năng đã có ở bottom navigation; thay đổi này sửa tràn ngang tại 360 px. Các route khác chưa được redesign.

## Ghi nhận sau critique screenshot vòng 1

Thử serif hệ thống trên tiêu đề tiếng Việt làm dấu phụ trông rời khỏi chữ ở ảnh desktop và mobile. Đã bỏ serif để dùng Be Vietnam Pro (font đã tải trong app) và giữ cảm giác biên tập bằng tiêu đề lớn hơn, cột hẹp, metadata sát nội dung và divider. API demo hiện trả danh sách trạng thái nguồn rỗng; giao diện vì thế hiển thị “—” và thông báo trạng thái chưa được cung cấp, không coi `0` là số nguồn đang chạy.
