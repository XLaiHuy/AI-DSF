# FINCOPILOT — UI Audit (Radar SCR-02)

**Phạm vi audit:** màn Radar hiện có tại `/radar`, ở trạng thái chạy trên desktop và mobile; các yêu cầu SCR-02/SCR-03, user stories P1, app shell, component tokens và prototype/ERD/architecture assets hiện có. Đây là audit trước khi redesign, không phải phê duyệt nghiệp vụ.

## Tài liệu và giới hạn

- Đã đối chiếu `docs/specs/02_Flowchart_Wireframe.md` (luồng P1 và wireframe SCR-02/03), `docs/specs/00_CHEATSHEET_CHOT.md`, `docs/specs/sources/user-story.html`, `docs/specs/03_TechStack_KienTruc_ERD.md` và `docs/specs/04_UI_Prototype.html`.
- `docs/input/hihi.docx` không tồn tại trong checkout được mở (`Test-Path` trả về False). Vì vậy không thể xác nhận đây là bản yêu cầu mới nhất hoặc rà nội dung trong file đó.
- Đã kiểm tra trực quan màn `/radar` thực tế tại viewport mobile và desktop. Dữ liệu API khi audit có một bài viết demo và không có danh sách trạng thái nguồn; kết luận về mật độ nội dung thật cần được xem lại với dữ liệu gần sản xuất.
- Các hình minh họa trong `docs/specs/` là sơ đồ kiến trúc/ERD và prototype giao diện; không thấy bộ ảnh thương hiệu hoặc UI kit có sẵn cho Radar.

## Những điểm đang làm tốt

- Tiêu đề và mục đích Radar được nhận ra ngay; có chuyển giữa tin thị trường và cảnh báo, tìm kiếm và lọc chủ đề.
- Bài viết hiển thị tên nguồn và mốc công bố; có liên kết tới bài phân tích và bài gốc.
- Lỗi tải tin có hành động thử lại; empty state và loading state đã có.
- Palette xanh lá/trung tính và focus ring hiện tại phù hợp định vị tài chính điềm tĩnh; không có gradient hay hiệu ứng glow.
- Các user story yêu cầu tách dữ kiện gốc khỏi nhận định AI, giữ nguyên thời điểm tin khi feed lỗi, gắn trạng thái xác minh cảnh báo, và cho biết trạng thái nguồn. Đây là nền tảng đúng cho hướng thiết kế ưu tiên xuất xứ dữ liệu.

## Vấn đề về hierarchy và trình bày

| Ưu tiên | Quan sát trên giao diện/code | Tác động tới tác vụ | Hướng xử lý cho màn mẫu |
|---|---|---|---|
| P1 | Bài viết được đặt trong lưới card hai cột đồng cấp. Với dữ liệu demo hiện tại chỉ có một bài, khối tin nhỏ ở góc trái và phần lớn màn hình desktop bỏ trống. | Khó nhận biết bài nào quan trọng; feed thiếu nhịp đọc kiểu biên tập. | Chuyển sang danh sách biên tập một cột có phân cấp tiêu đề, dòng nguồn/thời gian và đường phân cách; tránh thêm KPI hoặc biểu đồ không có use case. |
| P1 | Nguồn chỉ được gộp thành chuỗi cạnh thời gian; liên kết bài gốc nằm ở cuối card. `publishedAt` hiển thị bằng `toLocaleString`, gồm cả giây trong dữ liệu demo. | Người đọc khó quét nhanh ngày giờ và khó phân biệt thông tin được xuất bản với provenance của nguồn. | Tách metadata thành các trường dễ quét; định dạng ngày/giờ gọn, có ngữ cảnh; nguồn/link gốc nhìn thấy rõ. Không suy diễn thời gian thu thập nếu API không trả trường đó. |
| P1 | Header có khoảng trống cho trạng thái từng nguồn, nhưng khi API trả mảng `sources` rỗng thì không có tín hiệu cập nhật/độ tươi nào. | Người đọc không biết feed đang cập nhật bình thường hay một nguồn bị gián đoạn. | Hiển thị trạng thái tổng hợp/nguồn chỉ khi API cung cấp trạng thái; nếu thiếu thì ghi trạng thái chưa có dữ liệu, không biến trạng thái trống thành “tốt”. |
| P1 | Thiết kế feed chưa cho thấy tách bạch “dữ kiện nguồn” và “nhận định AI”; phần này nằm sau CTA chi tiết. | Với chủ đề tài chính, nguồn dẫn và nội dung diễn giải cần phân biệt rõ, tránh người đọc hiểu nhận định là факт. | Giữ list ở mức tiêu đề/provenance; trong chi tiết (ngoài phạm vi màn mẫu hiện tại) cần vùng nội dung riêng có nhãn rõ theo yêu cầu SCR-03. |
| P2 | Tabs là button trong `role="tablist"`, nhưng không khai báo `role="tab"`, `aria-selected` hoặc quan hệ panel. | Hành vi bàn phím/đọc màn hình không khớp ngữ nghĩa tabs. | Dùng tabs có semantics đầy đủ hoặc chuyển thành các nút lọc có tên gọi/ARIA phù hợp; giữ bàn phím hoạt động rõ ràng. |
| P2 | Trên ảnh mobile 360 px, thanh điều hướng sáu mục rất chật và xuất hiện thanh cuộn ngang trang. | Có nguy cơ mất nội dung ngang và chạm nhầm, nhất là với nhãn dài. | Màn Radar mẫu phải không tràn ngang; kiểm tra giới hạn app shell riêng trước khi dùng lại trên mọi route. |
| P2 | Chủ đề, loại nội dung, trạng thái xác minh và tên nguồn đều dùng badge/pill ngắn. | Khi mọi metadata có cùng trọng lượng, ý nghĩa và thứ tự đọc mờ đi. | Dùng văn bản thường, divider và màu semantic tiết kiệm; dành badge cho trạng thái có ý nghĩa như “Chưa xác minh”. |
| P2 | Mô tả mở đầu rộng và chung (“Tổng hợp các nguồn...”), không hướng dẫn lựa chọn/tác vụ kế tiếp. | Chiếm chiều dọc nhưng không giúp quyết định đọc tin hay xem cảnh báo. | Rút gọn nội dung hướng hành động, dành diện tích cho provenance và feed. |

## Đánh giá theo tác vụ P1

- **Đọc feed / lọc chủ đề (US-r01, SCR-02):** một phần đã có; có tìm kiếm/lọc nhưng thiếu hierarchy biên tập, trạng thái nguồn không bảo đảm có dữ liệu, chưa thấy pagination control trên UI.
- **Đọc tin, nguồn và phân tích tác động (US-ro02, SCR-03):** danh sách có đường dẫn tới màn chi tiết; chưa đánh giá đầy đủ màn chi tiết trong đợt redesign đơn màn. Wireframe yêu cầu ngày công bố/link gốc và phân vùng dữ kiện với nhận định AI; đây là tiêu chí bắt buộc trước khi mở rộng redesign.
- **Cảnh báo và độ xác minh (US-ro3):** có tab cảnh báo và badge trạng thái trong code; màn danh sách hiện tại chưa thể hiện dấu hiệu/bằng chứng theo wireframe. Phải giữ rõ “chưa xác minh” và không đồng nhất độ tin cậy của nguồn với xác minh nội dung.
- **Chuyển cú sốc lãi suất / chỉ dấu lừa đảo sang phân hệ khác:** có trong tài liệu flow, nhưng không phải điều khiển trên màn danh sách hiện tại; không thêm CTA giả nếu chưa có API/luồng hỗ trợ.

## Kết luận audit

Giao diện hiện tại dùng được để chứng minh các thao tác cơ bản, nhưng chưa tạo được trải nghiệm Radar có độ tin cậy và tính biên tập cần cho nội dung tài chính. Màn tham chiếu nên giữ một feed có thứ tự đọc rõ, provenance dễ quét, chỉ trình bày trạng thái do dữ liệu thật cung cấp, và không tạo cảm giác phân tích AI đã xác minh. Sửa giao diện sẽ giới hạn ở `/radar`; các màn chi tiết, Admin, Loan Advisor và app shell chưa được mở rộng trước khi người dùng duyệt màn mẫu.

## Thay đổi sau audit và critique

- Đã thay lưới card bằng feed dọc phân cấp, đặt thời gian công bố và thời điểm thu thập cạnh nguồn, giữ link gốc và phân biệt trạng thái cảnh báo.
- Khi API demo trả `sources: []`, giao diện hiện `—` và báo trạng thái chưa được API cung cấp; không kết luận là có 0 nguồn.
- Đã chuyển 2 tab thành nhóm nút lọc có `aria-pressed`, giữ tìm kiếm/lọc, loading/error/empty và hành động thử lại.
- Ảnh vòng critique cho thấy serif hệ thống làm dấu tiếng Việt trông rời; đã bỏ serif, dùng Be Vietnam Pro sẵn có.
- Đã ẩn nút Hồ sơ trên topbar dưới 640 px vì mục này đã có trong bottom nav; đo lại document width tại 360 px và 390 px, không còn overflow ngang.
- Lần render cuối trên viewport 1440×1000 và 390×844 đã được lưu ở `docs/design/screenshots/radar-desktop.png` và `docs/design/screenshots/radar-mobile.png`.

## Tham khảo ngôn ngữ sản phẩm

Đây là tham khảo nguyên tắc phân cấp thông tin, không sao chép nhận diện/định dạng của sản phẩm khác:

- Mercury: biến dữ liệu dòng tiền thành insight dùng được; bài giới thiệu Mercury Insights nhấn vào bảng/biểu đồ cập nhật theo kỳ và khả năng truy nguyên con số. [Mercury Insights](https://mercury.com/blog/march-2026-product-updates)
- Stripe: hệ thống báo cáo cho phép lọc và thêm cột phù hợp câu hỏi, đồng thời phân biệt góc nhìn hoạt động với báo cáo tài chính có tính đối soát. [Stripe Reports](https://support.stripe.com/questions/stripe-reports)
- Ramp: budget view làm rõ plan so với actual, ngân sách đã cam kết và nguy cơ vượt hạn mức thay vì đưa chart trang trí. [Ramp Budgets](https://support.ramp.com/budgets-overview-and-setup/)

**Áp dụng cho FINCOPILOT:** ưu tiên nguồn gốc và thời gian như dữ liệu có thể đối chiếu; dùng biểu đồ chỉ khi trả lời câu hỏi tài chính cụ thể; giúp người dùng nhận ra đâu là dữ kiện, đâu là nhận định và đâu là trạng thái chưa chắc chắn.
