# Kiểm tra độ tin cậy của FinCopilot

Phạm vi gồm hợp đồng dữ liệu dùng chung, thư viện tài chính, API và các thành phần Khảo sát, Giám định, biểu đồ của Huy. Mức ưu tiên phản ánh tác động lên kết luận rủi ro, khả năng khôi phục kết quả và chi phí vận hành.

## Phát hiện và bản sửa

| Mức | Hiện tượng và nguyên nhân | Bản sửa và bằng chứng |
|---|---|---|
| Cao | Yêu cầu tạo trò chơi có thể tạo hồ sơ SAFE vì bộ lọc chỉ nhận biết một số chủ đề và lượt đầu thiếu điều kiện xác nhận phạm vi. Chat tiếp nối cũng dùng hồ sơ cũ làm ngữ cảnh. | Kiểm tra bằng chứng hoặc tín hiệu tài chính/lừa đảo trước AI và ghi DB. Lọc chủ đề ở lượt tiếp nối, giới hạn phạm vi trong gateway và chặn mã trong stream. Benchmark nay đi qua bước sàng lọc trước khi tính điểm. [Guard](../apps/api/src/modules/forensic/forensic-prompt-guard.ts), [controller](../apps/api/src/modules/forensic/forensic.controller.ts), [stream](../apps/api/src/modules/forensic/forensic-chat-stream.ts), [benchmark](../apps/api/src/modules/forensic/eval/benchmark-deterministic.spec.ts) |
| Trung bình | Bộ phân loại ý định nhận văn bản còn thẻ biên do người dùng cung cấp. Ảnh được nén tuần tự khiến nhiều ảnh phải chờ nhau. | Làm sạch thẻ trước adapter. Nén song song tối đa tám ảnh, bỏ ảnh lỗi theo từng phần tử và xóa buffer nguồn, ảnh raster và JPEG trong finally. [Gateway](../apps/api/src/modules/ai-gateway/ai-gateway.service.ts), [trích xuất](../apps/api/src/modules/forensic/forensic-extraction.ts) |
| Trung bình | Lịch stress lặp lại hàng trăm dòng trong JSONB của mỗi gói. | Lưu lãi suất stress và mốc đổi lãi cạnh kết quả gốc. Khôi phục đúng lịch từ tham số lịch sử, kể cả khi danh mục thay đổi. Kiểm thử hai gói 360 tháng so sánh toàn bộ phản hồi và yêu cầu JSON tuần tự hóa dưới 60% kích thước cũ. [Dịch vụ và định dạng lưu](../apps/api/src/modules/survey-calc/survey-calc.service.ts), [kiểm thử](../apps/api/src/modules/survey-calc/survey-calc.spec.ts) |
| Trung bình | Ép APR trống thành Number tạo cột 0%. Chuỗi tiền bất thường có thể gây lỗi khi chuyển sang BigInt. UI còn nhập thư viện qua đường dẫn nguồn ngoài workspace. | Kiểm tra chuỗi thập phân trước khi tính, hiển thị giải thích khi thiếu APR, cộng chính xác bằng BigInt cho biểu đồ và đối chiếu kết quả với decimal.js. Giới hạn đầu vào số 64 ký tự và lịch vay 600 kỳ tại DTO. [Biểu đồ chi phí](../apps/web/src/components/charts/ForensicCostTrapChart.tsx), [phép tính](../apps/web/src/components/charts/chart-math.ts), [kiểm thử](../apps/api/src/modules/survey-calc/chart-math.spec.ts) |
| Thấp | Bộ lọc quỹ chỉ tác động danh sách đang hiển thị. Người dùng khó biết vì sao kỳ hạn không có gói phù hợp. | Ghi nhóm đã chọn vào yêu cầu và khôi phục khi mở lại. Kết quả truy vấn toàn bộ vẫn lọc tức thì. Bổ sung khoảng kỳ hạn danh mục tham chiếu và cách điều chỉnh khi NO_MATCH. [Khảo sát](../apps/web/src/components/survey/SurveyWorkspace.tsx), [kiểm thử trình duyệt](../tests/e2e/flows.spec.ts) |

### Đối chiếu trên PostgreSQL

Trong phiên kiểm tra ngày 26/11/2026, khoản vay 1 tỷ đồng trong 360 tháng trả về ba gói mua nhà. Bản ghi có ba bộ tham số stress, không có mảng stressSchedule và chiếm 32.884 byte theo pg_column_size. GET chi tiết trả đúng toàn bộ kết quả POST, bao gồm 360 kỳ stress của từng gói. Trong cùng phiên khách, yêu cầu “viết html rắn săn mồi” trả FORENSIC_OFF_TOPIC và danh sách giám định trước, sau yêu cầu trùng nhau.

## Ranh giới giữa quy tắc cố định và dữ liệu động

| Thành phần | Cơ chế | Lý do |
|---|---|---|
| Công thức Decimal.js/BigInt, làm tròn, RULE_01–RULE_17 và khóa CRITICAL ≥ 75 | Cố định, kiểm thử hồi quy | Cùng dòng tiền và bằng chứng phải tái tạo được cùng kết quả. AI chỉ có thể nâng mức rủi ro. |
| Chặn địa chỉ IPv4/IPv6 riêng, bộ safeCases, vn-legal-registry.ts, BIN và domain ngân hàng được cấp phép trong trusted-institutions.ts | Cố định, thay đổi qua rà soát mã | Giữ ranh giới truy cập mạng, căn cứ pháp lý và danh tính tin cậy độc lập với nội dung thu thập. |
| Che PII, ba lớp sàng lọc đầu vào/phạm vi và bộ lọc đầu ra | Cố định | Bảo vệ quyền riêng tư và tính toàn vẹn của kết luận cả lúc mô hình suy giảm. |
| financial_products | Động qua config/loan-rate-snapshot.json, Admin sync/CRUD | Nguồn, kỳ hạn, phí và lãi có thể thay đổi theo sản phẩm. |
| threat_alert, threat_indicator, threat_feedback_examples, TEENCODE_ALIAS đã duyệt | Động qua nghiệp vụ quản trị | Bổ sung thủ đoạn, chỉ báo, phản hồi và tiếng lóng theo bằng chứng. Giữ nguyên văn bản nguồn khi kiểm chứng trích dẫn. |
| config/ai-routing.yaml, trạng thái circuit breaker, market_source | Động | Định tuyến và nguồn tin thay đổi theo tính khả dụng, điều kiện vận hành và phê duyệt. |

## Giới hạn vận hành

- Trạng thái giới hạn tần suất và circuit breaker trong RAM thuộc từng tiến trình. Khi triển khai nhiều replica, tổng hạn mức và thời gian ngắt có thể khác giữa các instance. [AI gateway](../apps/api/src/modules/ai-gateway/ai-gateway.service.ts)
- PDF raster và nén ảnh song song dùng chung ngân sách RAM của tiến trình. Giới hạn số trang, số ảnh và số pixel bảo vệ từng yêu cầu. Mức tải đồng thời cần được đo trên cấu hình triển khai. [PDF](../apps/api/src/modules/forensic/pdf-extractor.ts), [ảnh](../apps/api/src/modules/forensic/forensic-extraction.ts)
- Bộ lọc ngôn ngữ có thể yêu cầu thêm ngữ cảnh với một thủ đoạn mới. Dùng bộ hồ sơ có nhãn để kiểm tra từ chối nhầm khi bổ sung từ khóa. Kết quả benchmark chỉ áp dụng cho bộ hồ sơ đã kiểm thử.
- Truy vấn danh mục đọc mọi gói thỏa điều kiện để xếp hạng đúng trên toàn tập. Khi danh mục tăng lớn, cần theo dõi số gói nhân với số kỳ và thời gian dựng cả hai lịch. Các gợi ý kỳ hạn trên form dùng bản danh mục tham chiếu, còn máy chủ xét danh mục đang hoạt động.
- Các phiên cũ giữ nguyên định dạng. Chỉ số kích thước kiểm thử đo JSON trước nén. Dung lượng vật lý của PostgreSQL còn phụ thuộc TOAST và dữ liệu thực.
