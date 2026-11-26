# Báo cáo QA và tối ưu FinCopilot

Ngày kiểm thử 26/11/2026, giờ Việt Nam. Nhánh `feat/huy-loan-security-charts`, mốc đầu `11771ec`, bản vá `f9d950b`. Môi trường gồm Windows, Node.js 24.18.0, PostgreSQL 16.16, Redis và Chromium. QA dùng cơ sở dữ liệu riêng, 9 migration và dữ liệu mẫu. Các lệnh build và chạy ứng dụng dùng biến môi trường thử nghiệm và bỏ qua nạp `.env`.

## 1. Ma trận kết quả kiểm thử theo phân hệ

| Phân hệ | Unit / integration | HTTP cục bộ với PostgreSQL thật và chuỗi AI rỗng | Định tuyến AI mặc định | Playwright |
| --- | ---: | --- | --- | --- |
| Forensic, upload và đánh giá khoản vay | 365/365, gồm benchmark 101/101 | 32/32. Có B1/B2, mẫu phủ định, lỗi 102, off-topic không tăng lịch sử, JSON/SSE, export của chủ phiên và giới hạn tải tệp | 8/8 kịch bản khớp kết quả dự phòng. Provider thực chưa xác minh | Phase Two trên desktop và mobile, cùng luồng bàn giao sang Survey |
| Survey, Calculator và chart math | 37/37 API, 13/13 financial-math | 26/26 Survey và 9/9 Manual Compare. Đã thử 5 mục đích vay, 15 tổ hợp số tiền/kỳ hạn, replay, 3 loại đầu tư và nhóm đầu vào từ chối | Phần HTTP chạy với AI tắt. Kiểm thử API có mô phỏng sinh giải thích và lỗi provider | 16 bài trong `flows.spec.ts`, cùng 2 luồng Phase Two dùng chung |
| Profile và Auth | 28/28 | 5/5, gồm phiên khách, đăng ký, đăng nhập, chuyển giao hồ sơ và lịch sử, phân tích tiếng Việt và coach dự phòng | 1/1 cho tạo phiên khách | Phase Two kiểm tra hồ sơ khách, tác động cá nhân và luồng bàn giao |
| AI Gateway | 12/12 | Xác minh dự phòng qua Forensic, Survey và Profile. Đợt HTTP không phát sinh 500 | Cấu hình mặc định hoạt động ở chế độ dự phòng. Kiểm thử mô phỏng đã đi qua fallback, circuit breaker, rào dữ liệu và lỗi provider | Đi qua luồng dự phòng của API trong Phase Two |
| Admin và AdminGuard | 26/26 | 3/3. Quyền quản trị, sync lặp lại, và vòng đời cảnh báo công khai 404 → 200 → 404 | Hai lần sync với cấu hình mặc định đã kiểm tra riêng | Vòng đời công khai có kiểm tra UI ở suite Radar |
| Radar và Home, phạm vi chỉ đọc | 20/20 | 3/4. `/home/market`, `/radar/articles` và `/radar/alerts` trả 200. `/radar/feed` trả 404 | Chưa đo với provider thực | 19 bài trong các spec Radar, có media, lỗi nguồn và lọc bản nháp |

Toàn suite đạt **488/488** bài API trong 25 file, **13/13** financial-math và **37/37** Playwright. Các luồng chính chạy ở **1280×800** và **390×844**, qua các assertion về lỗi console và tràn ngang. HTTP trực tiếp đạt **78/79** nhóm kiểm tra, tính các lần xác minh lại ở suite bổ sung. Kiểm tra ngưỡng DTI chạy thêm trực tiếp trên financial-math.

- **Forensic.** B1, B2 và các biến thể chính quyền, tập tin APK, sếp và kế toán được kiểm tra qua HTTP. Lỗi 102 giữ `HIGH_RISK 90/100`. Benchmark hồi quy bao phủ QR, crypto, phí thu hồi, lãi phẳng/lãi bậc thang/hồi tố, bảo hiểm, cô lập chỉ dẫn và xóa buffer. Phần tải tệp qua HTTP xác nhận sai magic, PDF hỏng, PDF sáu trang, kích thước vượt 20 MiB và số tệp vượt giới hạn. Bộ kiểm thử sẵn có bao phủ giới hạn tám ảnh đầu vào Vision và kiểm tra nội dung/PII trong SSE.
- **Survey và Calculator.** Đã thử các kỳ hạn 1, 36, 37, 360, 420 và 600 tháng. Danh mục đã qua `AVAILABLE` và `NO_MATCH` trên HTTP, `EMPTY_CATALOG` trước lần sync đầu, và `CATALOG_UNAVAILABLE` bằng lỗi DB mô phỏng. Hai tên bị Trust Filter trả 422 cùng đường dẫn chuyển sang `/forensic`. Ba nhóm đầu tư đều có kết quả và replay đúng danh mục. `OPEN_FUND` trả đủ ba kịch bản. Manual Compare chạy với 2–4 gói, đủ ba phương thức, lãi 0%, chuyển lãi sau ưu đãi, hai loại phí và tất toán đầu/giữa/cuối kỳ. Sáu nhóm đầu vào sai đều trả 400. DTI 0 thu nhập trả `UNAVAILABLE`. Kiểm tra riêng đã xác nhận các ngưỡng 35%, 45%, 50% và dòng tiền âm. Chart math có kiểm thử số nguyên lớn, làm tròn và gộp lịch dài. Playwright kiểm tra thông báo khi APR thiếu.
- **AI Gateway.** Mô phỏng bổ sung đặt tín hiệu timeout cho provider đầu tiên. Gateway chuyển sang provider dự phòng, bỏ qua provider đầu tại 59.999 ms và thử lại thành công tại 60.000 ms.
- **Profile, Admin và Radar.** Các giá trị tự nhiên triệu/tỷ/k và trường mơ hồ được xác nhận qua HTTP. Coach dự phòng trả điểm 88/100 và ba hành động với dữ liệu QA. Sync danh mục lần đầu thêm và kích hoạt 21 sản phẩm. Lần hai ghi 0 và kích hoạt 0, với 7/10 nguồn trả kết quả. Bản nháp của Admin chỉ xuất hiện công khai sau khi xác minh và biến mất khi thu hồi.
- **Phạm vi xác minh phòng vệ.** Kiểm tra sở hữu qua bộ unit và rà soát luồng dùng chung của đọc/export/chat, kết hợp HTTP cho chủ phiên. Cô lập prompt tampering, PII, và quy tắc đích công khai của proxy dựa trên bộ kiểm thử phòng vệ sẵn có và rà soát mã. Không có phép đo live cho kịch bản truy cập chéo chủ phiên hoặc gửi URL đích nội bộ qua proxy.
- **Benchmark.** 101 bài gồm 100 hồ sơ đều qua `screenAudit()` và một bài kiểm tra cấu trúc bộ dữ liệu. Snapshot bằng bản ở `11771ec`. Con số 101/101 đo hồi quy theo snapshot đã khóa. Bộ benchmark có lưu các điểm chưa khớp với nhãn vàng từ trước.

## 2. Lỗi, điểm yếu và nút thắt

| Mức | Phát hiện và cách tái hiện | Vị trí |
| --- | --- | --- |
| P0 | B2. Văn bản mô tả công an gọi yêu cầu cài VNeID trước đây có thể trả `SAFE 0/100` dù đã vào `MEDIUM`. Luật cũ chưa kết hợp yêu cầu cài đặt/xác minh với định danh và chủ thể tự xưng. | [trusted-institutions.ts:199](../apps/api/src/modules/forensic/data/trusted-institutions.ts#L199), [hard-rules.engine.ts:436](../apps/api/src/modules/forensic/hard-rules.engine.ts#L436) |
| P0 | B1. Văn bản mô tả Shipper gọi bảo bấm link nhận đơn trả `SAFE 0/100` khi không có nhà cung cấp AI. Tầng luật cứng thiếu dấu hiệu kết hợp bên liên hệ với yêu cầu mở liên kết. | [hard-rules.engine.ts:448](../apps/api/src/modules/forensic/hard-rules.engine.ts#L448) |
| P1 | Guard off-topic từng cho qua yêu cầu viết HTML khi điền tên định chế. Giữ bản vá đang có tại đầu lượt và xác minh HTTP 5 yêu cầu ngoài phạm vi trả `FORENSIC_OFF_TOPIC` với lịch sử giữ nguyên. | [forensic.service.ts:96](../apps/api/src/modules/forensic/forensic.service.ts#L96), [forensic-prompt-guard.spec.ts:123](../apps/api/src/modules/forensic/forensic-prompt-guard.spec.ts#L123) |
| P2 | Multipart với hơn sáu tệp trả `400 ERR_VALIDATION_FAILED`. Tái hiện trên hai route với Fastify và bằng tải nhiều tệp qua HTTP. | [forensic.controller.ts:56](../apps/api/src/modules/forensic/forensic.controller.ts#L56), [forensic-audit-stream.spec.ts:150](../apps/api/src/modules/forensic/forensic-audit-stream.spec.ts#L150) |
| P2 | Hợp đồng kiểm thử yêu cầu `GET /radar/feed` nhưng máy chủ trả `404 ERR_NOT_FOUND`. Controller đăng ký `/radar/articles` và `/radar/alerts`, cả hai trả 200. | [radar.controller.ts:40](../apps/api/src/modules/radar/radar.controller.ts#L40) |

Phân tích B2 xác nhận `MEDIUM` thực hiện lượt Deep Reasoning. Mảng phát hiện có thể rỗng khi model trả `findings: []` hoặc khi trích dẫn không xuất hiện nguyên văn trong bằng chứng đã che. `degradedMode=false` vẫn tương thích với cả hai trường hợp. Mô phỏng đã kiểm tra kết quả rỗng, trích dẫn không khớp và provider lỗi. Chưa có payload phản hồi của lần online ban đầu để xác định nhánh cụ thể. [forensic.service.ts:264](../apps/api/src/modules/forensic/forensic.service.ts#L264), [deep-reasoning.ts:10](../apps/api/src/modules/forensic/deep-reasoning.ts#L10)

## 3. Giải pháp đã áp dụng và phần tồn đọng

- **Commit `f9d950b`.** Bổ sung luật theo yêu cầu trong từng đoạn bằng chứng. Liên hệ yêu cầu định danh và cài ứng dụng/mở link kích hoạt `RULE_09` với 55 điểm. Yêu cầu xác minh hoặc thanh toán từ người tự xưng là cơ quan kích hoạt `RULE_11` với 45 điểm. Yêu cầu mở link/cài app từ bên giao hàng kích hoạt `RULE_15` với 40 điểm. Mỗi kết quả kèm việc xác minh qua kênh chính thức. Mạo danh sếp/kế toán kèm chuyển gấp cho `HIGH_RISK 85/100`. Câu phủ định, cảnh báo cộng đồng và hướng dẫn tải VNeID từ kho chính thức thuộc bộ hồi quy `SAFE 0/100`.
- Prompt Deep Reasoning bổ sung dấu hiệu về bối cảnh người liên hệ và cách phân biệt lời cảnh báo với yêu cầu thực tế. Điều kiện trích dẫn nguyên văn và ngưỡng cảnh báo của luật cứng tiếp tục áp dụng. Guard nhận ra câu khuyên “Không bấm link lạ” là nội dung hợp lệ để giám định.
- Hai endpoint tải tệp cùng trả `413 ERR_FILE_TOO_LARGE` khi multipart quá sáu tệp. Bài kiểm thử xác nhận từ chối trước khi tạo lịch sử hoặc chạy giám định. Bài kiểm thử Survey bổ sung replay định dạng cũ chứa cả `stressSchedule`.
- **Bàn giao Radar/Home.** Đối chiếu tài liệu tích hợp dùng `/radar/feed` với route đã đăng ký để thống nhất hợp đồng. Quy trình QA quan sát ba endpoint đọc hiện hành và bộ kiểm thử Radar. Git diff từ `3ecabda` giữ nguyên các đường dẫn thuộc phạm vi Tài được liệt kê trong yêu cầu.
- **AI online.** Môi trường QA thiếu thông tin xác thực được cấp qua biến môi trường. Định tuyến mặc định trở về `degradedMode=true`, `llmProvider=null`. Cần một lượt chạy QA với thông tin xác thực được cấp riêng để xác minh verdict, trích dẫn và độ trễ của provider thật, gồm các ca phủ định và các luồng tải ảnh/streaming.

## 4. Hiệu năng và đề xuất tối ưu

Số đo HTTP từ vòng thử tuần tự trên cùng máy Windows tới API cục bộ, tính từ gửi yêu cầu tới đọc xong JSON. Kết quả phụ thuộc tải máy và số gói phù hợp. Không tính các lỗi đầu vào, đăng nhập hoặc lần đồng bộ danh mục vào bảng thời gian.

| Luồng ngoại tuyến | Số lần | Trung bình | Chậm nhất |
| --- | ---: | ---: | ---: |
| Forensic văn bản | 13 | 49,4 ms | 144,5 ms |
| Survey Loan | 17 | 122,7 ms | 783,4 ms |
| Manual Compare | 3 | 35,1 ms | 42,6 ms |

Phiên vay mua nhà 1 tỷ đồng, 360 tháng, ba gói. `pg_column_size(math_results_json)` là **32.675 byte** cho định dạng compact và **61.702 byte** khi ghi lại cùng phiên theo định dạng cũ có đầy đủ lịch stress, giảm **47,0%**. Kích thước biểu diễn văn bản JSONB lần lượt là 144.476 và 285.547 byte. Body HTTP khi tạo phiên là 263.773 byte. Replay khớp cả 360 kỳ của cả ba gói, gồm số tiền kỳ 1 và kỳ 360.

B1/B2 có điểm dự phòng ổn định ngay cả khi kết quả Deep Reasoning rỗng. Với hồ sơ ảnh hoặc OCR, chất lượng nhận dạng còn phụ thuộc vào dữ kiện trích từ ảnh. Đợt này chưa đo được độ trễ provider thật.

Đo riêng pipeline Sharp với tám ảnh thử nghiệm 2.200×1.700, đầu ra JPEG tối đa 1.400 pixel mỗi chiều. Trung vị ba lượt là **1.217 ms** khi xử lý song song và **3.644 ms** khi xử lý tuần tự. Phép đo này chỉ tính bước nén ảnh, không tính đọc PDF, giải mã QR hay gọi Vision.

- **Ngắn hạn.** Tách phép đo thời gian chờ DB, tính lịch, giải nén replay và tuần tự hóa JSON trước khi tối ưu luồng Survey dài. Theo dõi p50/p95 theo số gói và số kỳ. Theo dõi số phát hiện model trả về và số trích dẫn bị loại dưới dạng số đếm, tránh lưu văn bản bằng chứng.
- **Dài hạn.** Đo thời gian từng provider và tỷ lệ dự phòng với tập QA riêng. Xem xét phân trang lịch chi tiết hoặc chỉ tải lịch sau khi người dùng mở biểu đồ nếu dung lượng HTTP trở thành nút thắt. Đo độ trễ và bộ nhớ của nén/raster dưới nhiều lượt upload đồng thời trước khi đổi số tác vụ song song.

Xác minh cuối đã chạy `pnpm --filter @fincopilot/financial-math test`, `pnpm --filter api test`, `pnpm lint --force`, typecheck API/web, build shared-types/API/web và `pnpm test:e2e`. Snapshot có 0 dòng diff với `11771ec`. Nhánh giữ commit cục bộ.
