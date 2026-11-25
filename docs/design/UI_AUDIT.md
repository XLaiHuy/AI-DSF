# FINCOPILOT — UI Audit

**Ngày kiểm tra:** 23/11/2026
**Phạm vi:** giao diện đang có tại `/`, `/radar`, `/radar/[id]`, `/survey`, `/admin`; code của `/forensic` và `/profile`; AppShell dùng chung.
**Trạng thái:** audit trước khi mở rộng ngôn ngữ thiết kế; không phải xác nhận phạm vi nghiệp vụ.

## Nguồn và giới hạn

- Đã kiểm tra source frontend trong `apps/web/src`, các mô tả nghiệp vụ/wireframe có trong `docs/specs/00_CHEATSHEET_CHOT.md` và `docs/specs/02_Flowchart_Wireframe.md`, cùng tài liệu thiết kế trước đó trong `docs/UI_AUDIT.md` và `docs/DESIGN_DIRECTION.md`.
- Đã mở và quan sát trực tiếp các màn `/`, `/radar`, `/radar/[id]`, `/survey?mode=loan&amount=50000000&term=24` và `/admin` trên trình duyệt ở desktop 1440×1000 và mobile (ảnh màn hình Admin 360 px). `/radar` trước đó đã có screenshot 390×844 trong `docs/design/screenshots/`.
- Chi tiết Radar có thể tải được dữ liệu fixture; trang Admin có 5 nguồn, 1 nguồn lỗi, catalog rỗng. Đây là nội dung môi trường dev, không đại diện cho mật độ dữ liệu production.
- `docs/input/hihi.docx` không có trong checkout hiện tại. Bản brief UI/UX được cung cấp ngoài repo. Vì vậy các kết luận phạm vi nghiệp vụ chỉ dựa trên tài liệu `docs/specs/` và trạng thái code; cần đối chiếu lại với tài liệu gốc trước khi chốt các nội dung xung đột.
- Đã tham khảo nguyên tắc hiển thị insight và dữ liệu của [Mercury Insights](https://mercury.com/blog/march-2026-product-updates), bộ lọc/báo cáo của [Stripe Reports](https://support.stripe.com/questions/stripe-reports), và cách Ramp thể hiện ngân sách so với thực tế trong [Ramp Budgets](https://support.ramp.com/budgets-overview-and-setup/). Đây là tham khảo nguyên tắc, không sao chép nhận diện.

## 10 vấn đề quan trọng nhất

| # | Nhóm | Mức | Quan sát | Tác động | Hướng xử lý |
|---|---|---|---|---|---|
| 1 | Thông tin / độ tin cậy | P1 | Trang chủ nêu chung cả ba phân hệ, gồm nội dung Forensic ngoài phạm vi MVP hiện tại; thông điệp không giúp người dùng bắt đầu hai tác vụ đang có. | Người dùng không biết Radar và Survey đang ở mức hoàn thiện nào; kỳ vọng vượt quá trải nghiệm thật. | Chuyển Home thành điểm vào ngắn gọn cho Radar và phần Khảo sát đang nhận bàn giao; thể hiện đúng trạng thái triển khai. |
| 2 | Nội dung giả lập | P1 | Home tạo lời mời “khảo sát mẫu” với số tiền/kỳ hạn cố định (50 triệu/24 tháng) và gọi là ước tính dù chưa có công cụ tính trên `/survey`. | Dữ liệu minh họa có thể bị hiểu thành đề xuất/tính toán thật. | Loại bỏ con số và CTA tính mẫu; không trình bày con số tài chính không được tạo từ logic xác định. |
| 3 | Kiến trúc thông tin | P1 | AppShell đưa Tổng quan, Radar, Khảo sát, Giám định, Hồ sơ và Quản trị thành 6 điểm đến ngang hàng. Mobile bottom nav ép cả 6 mục trong chiều ngang nhỏ. | Mục trọng tâm bị cạnh tranh, nhãn khó đọc/chạm; route vận hành nội bộ lẫn với điều hướng người dùng. | Giữ mọi route truy cập được nhưng thu điều hướng chính xuống 4 mục: Tổng quan, Radar, Khảo sát, Thêm; đưa Giám định/Hồ sơ/Quản trị vào menu phụ. |
| 4 | Tính nhất quán / responsive | P1 | `/admin` tự khai báo `<main>` bên trong `<main>` của AppShell; bảng đặt `min-width` lớn, nên trên mobile chỉ xem một phần cột trong vùng cuộn ngang không có hướng dẫn. | Cấu trúc landmark bị lặp; thông tin nguồn/trạng thái/thao tác khó ghép khi xem hẹp. | Dùng section landmark; giữ bảng dữ liệu đầy đủ nhưng bổ sung nhãn vùng cuộn và ưu tiên trường trên màn nhỏ; ưu tiên cải tiến đọc được trước khi tái cấu trúc sang card. |
| 5 | Tính toàn vẹn thời gian | P1 | `/radar/[id]` dùng `toLocaleString` mặc định theo máy, khác với trang danh sách vốn chỉ rõ múi giờ Việt Nam. | Cùng một tin có thể hiển thị giờ khác nhau trên máy người dùng. | Dùng formatter chung với múi giờ `Asia/Ho_Chi_Minh`, tên trường rõ và giữ riêng thời gian công bố/thu thập. |
| 6 | Phân cấp thông tin | P1 | Chi tiết tin đặt provenance và phân tích AI trong hai card đồng dạng; phần analysis trước khi người dùng bấm nút chỉ có mô tả và CTA, vùng nguồn sự kiện không có nhịp đọc rõ. | Fact, provenance và diễn giải AI chưa được phân tách thị giác đủ mạnh. | Dùng cột đọc biên tập và khối phân tích có nhãn; provenance trình bày dạng danh sách nguồn gắn mốc thời gian; không thêm kết luận AI hoặc trích dẫn giả. |
| 7 | Trạng thái và độ chắc chắn | P1 | Trang cảnh báo (trong code chi tiết) có trạng thái xác minh, dấu hiệu và evidence, nhưng các phần đều là card và danh sách chưa chỉ rõ evidence là nguồn dẫn chứng hay indicator được trích xuất. | Khó phân biệt nguồn gốc của kết luận với chỉ dấu cần đối chiếu. | Phân cấp tiêu đề/nhãn cho `verificationStatus`, “Dấu hiệu cần đối chiếu” và “Nguồn dẫn chứng”; không coi nguồn đáng tin là tự động xác minh. |
| 8 | Tác vụ chưa triển khai | P1 | `/survey` chỉ hiển thị URL handoff và ghi rõ 3 tab/bảng/biểu đồ/lịch trả nợ chưa được lắp; mô tả đầu trang lại hứa toàn bộ khả năng vay/đầu tư/DTI. | Màn hình hứa chức năng chưa có, không giúp người dùng biết giá trị các tham số đang được chuyển. | Thiết kế lại thành trạng thái bàn giao dữ liệu tối giản, nêu rõ đây chưa phải công cụ tính; không tự thêm form, công thức hay kết quả. |
| 9 | Mật độ và affordance | P2 | Radar danh sách dùng CTA “Mở phân tích” bên cạnh tiêu đề vốn đã là link tới cùng trang; chi tiết hiển thị mã chủ đề dạng `INTEREST_RATE`. Trạng thái nguồn ở sidebar có thể thưa khi API không trả nguồn. | Tăng điều khiển lặp và đưa enum nội bộ ra UI; vùng trống có thể trông như dashboard rỗng. | Chỉ giữ một hành động chính; đổi mã chủ đề thành nhãn tiếng Việt; khi trạng thái API vắng, nói rõ chưa được cung cấp. |
| 10 | Tương phản vai trò | P2 | `/forensic` và `/profile` là placeholder nhưng nav/topbar hiển thị chúng như điểm đến đã dùng được; sidebar còn thông điệp hồ sơ ẩn danh/bảo mật dù chưa có thao tác hồ sơ hoàn chỉnh. | Người dùng tưởng có xử lý tài liệu, đăng nhập hoặc lưu profile thật. | Gắn nhãn trạng thái đang triển khai trong các placeholder hiện có và tránh mô tả dữ liệu/khả năng như đã hoạt động; không mở rộng các module đó trong lượt này. |

## Kiểm tra theo màn

- **`/radar`:** feed biên tập dọc, lọc và metadata nguồn/thời gian đã đúng hướng. Cần bỏ hành động trùng, làm rõ trạng thái nguồn thiếu dữ liệu; giữ xử lý loading/error/empty và không phát minh nội dung.
- **`/radar/[id]`:** có nguồn, mốc công bố/thu thập, hành động phân tích, nhãn facts/assessment, delta và luồng cảnh báo/evidence. Cần thống nhất múi giờ, làm rõ ranh giới fact/AI/evidence và trình bày đẹp hơn trên mobile.
- **`/admin`:** bảng và hành động quét/thử lại/catalog đã kết nối API. Cần cấu trúc nội dung theo tác vụ, trạng thái lỗi rõ, cải thiện đọc bảng ở viewport hẹp.
- **`/survey`:** chỉ có trạng thái URL handoff, chưa có chức năng tính toán/so sánh. Thiết kế chỉ cải thiện khả năng hiểu dữ liệu nhận được, không giả lập tính năng.
- **`/`:** đang trộn thông điệp tổng quan, quảng bá ba phân hệ và khoản vay demo cố định. Sẽ thay bằng lối vào cho hai tác vụ trong phạm vi, không đặt KPI.
- **`/forensic`, `/profile`:** đọc code cho thấy scaffold/placeholder; không redesign nghiệp vụ hay thêm module. Chỉ đảm bảo điều hướng phụ vẫn truy cập được và giao diện placeholder dùng chung nhất quán.

## Thứ tự xử lý

1. P1 — Điều hướng responsive và nhóm mục phụ.
2. P1 — Gỡ con số/CTA vay mẫu trên Home, sửa nội dung theo trạng thái thật của MVP.
3. P1 — Detail Radar: mốc giờ nhất quán, provenance, fact/assessment/evidence rõ.
4. P1 — Survey handoff: thông tin đang được chuyển và giới hạn hiện tại rõ.
5. P1 — Admin: landmark hợp lệ, đọc dữ liệu/bảng trên mobile.
6. P2 — Loại bỏ liên kết trùng trong feed và rà các placeholder ngoài phạm vi.

**Kết luận:** Radar đã có nền trình bày phù hợp; phần còn lại cần hệ thống hóa điều hướng và đồng bộ các màn đang thực sự tồn tại. Thiết kế không được tạo cảm giác Loan Advisor, Forensic, hồ sơ, dữ liệu hoặc kết quả AI đã triển khai khi code hiện chỉ có placeholder.

## Thực hiện và vòng critique

- Home bỏ khoản vay demo 50 triệu/24 tháng và CTA ước tính; còn hai lối vào tương ứng Radar và handoff Khảo sát, với mức độ triển khai được nêu rõ.
- AppShell chuyển thành 3 tuyến chính cộng menu “Thêm” trên mobile; trên desktop chia “Không gian làm việc” và “Công cụ khác”. Escape đóng menu; mọi route vẫn truy cập được.
- Detail Radar dùng timezone `Asia/Ho_Chi_Minh`, hiển thị nhãn chủ đề tiếng Việt, nhóm provenance/evidence/indicator riêng và nêu rõ khối AI là diễn giải, không xác minh.
- Survey chỉ trình bày tham số đã nhận, định dạng số dễ đọc và nêu giới hạn hiện tại; không thêm phép tính hay lưu trữ.
- Admin bỏ landmark `<main>` lồng nhau, thêm nhãn cuộn ngang có thể focus, `scope="col"`, thông báo tải riêng và định dạng thời gian ổn định.
- Vòng review screenshot xác nhận hierarchy rõ ở Home/Radar/detail, bảng Admin có hướng dẫn cho màn nhỏ. Không có dữ liệu thật ngoài fixture hiện tại; ảnh được capture từ API mock/dev.
- Đã đo `documentElement.scrollWidth` tại 360, 390, 768 và 1440 px cho Home, Radar, detail, Survey và Admin: 20/20 viewport không tràn ngang. Menu mobile mở được và Escape đóng được.

Screenshot cuối (viewport, API mock):

| Màn | Desktop 1440×1000 | Mobile 390×844 |
|---|---|---|
| Tổng quan | [`overview-desktop.png`](screenshots/overview-desktop.png) | [`overview-mobile.png`](screenshots/overview-mobile.png) |
| Radar | [`radar-desktop.png`](screenshots/radar-desktop.png) | [`radar-mobile.png`](screenshots/radar-mobile.png) |
| Chi tiết tin | [`article-detail-desktop.png`](screenshots/article-detail-desktop.png) | [`article-detail-mobile.png`](screenshots/article-detail-mobile.png) |
| Khảo sát handoff | [`survey-handoff-desktop.png`](screenshots/survey-handoff-desktop.png) | [`survey-handoff-mobile.png`](screenshots/survey-handoff-mobile.png) |
| Quản trị Radar | [`admin-desktop.png`](screenshots/admin-desktop.png) | [`admin-mobile.png`](screenshots/admin-mobile.png) |

Lưu ý: ảnh là ảnh viewport, vì vậy nội dung phía dưới màn hình cần cuộn để xem; thanh điều hướng cố định là thành phần của giao diện mobile.
