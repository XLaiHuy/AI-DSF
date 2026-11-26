# Deep Bug, Bottleneck & Weakness Audit

Nhánh `dev`, commit `4c30459` ngày 26/11/2026, gồm PR #7 và #8. Đợt rà soát ngày 26/11/2026 dùng mã nguồn, các test có sẵn, phép thử gọi service với dữ liệu giả lập và Chromium trên bản build Web cục bộ. Các số đo ghi rõ nguồn và phạm vi bên dưới.

## 1. Tóm tắt điều hành

| P0 · Critical | P1 · High | P2 · Medium | P3 · Low | Tổng |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 6 | 15 | 2 | **23** |

Ưu tiên sửa kết luận `HIGH_RISK` khi Forensic ghép hai câu lành tính không liên quan, validation Admin làm hỏng cả lượt Khảo sát, biên lãi suất bị tính sai trên Bảng tin, lỗi mất nội dung Radar khi storage hết dung lượng, và bản ghi guest có thể bị bỏ lại nếu ghi sau lúc đăng nhập. Ảnh gửi tới nhà cung cấp AI hiện giữ nguyên dữ liệu nhìn thấy trên ảnh sau khi thu nhỏ và mã hóa lại.

| Kiểm tra | Kết quả trên `4c30459` |
| --- | --- |
| `pnpm --filter @fincopilot/financial-math test --no-cache --pool=threads` | **13/13** đạt, 1 file. Pool fork mặc định gặp `spawn EPERM` trên Windows sandbox. |
| `pnpm --filter api test --no-cache --maxWorkers=4` | **487/488** đạt, 24/25 file đạt trong 91 giây. Test Radar ở `radar.service.spec.ts:207` là test duy nhất thất bại. |
| Lint theo lệnh ESLint gốc của từng package | **4/4** đạt. Gọi ESLint trực tiếp với cùng các đích của package sau khi pnpm recursive gặp `spawn EPERM`. |
| Typecheck `tsc --noEmit --incremental false` | **4/4** đạt trên Prisma Client đã có. Gọi trực tiếp để tránh sinh file và tránh bước nạp môi trường của Turbo/Prisma. |
| `pnpm test:e2e` | **Chưa chạy suite đầy đủ.** Docker engine 29.7.2 phản hồi, `docker ps` rỗng và cổng PostgreSQL 5432 không có listener. Lệnh Playwright tương đương với `--list` nhận diện **40 test / 4 file**. Config suite khởi động Nest thật và build Web. `tests/e2e/playwright.config.ts:9-28`. |
| Chromium 390×844, Web build cục bộ và API fixture | `/`, `/radar`, hai chế độ `feed`, chi tiết bài, `/forensic`, `/survey`, `/profile` và `/admin` ở trạng thái khách đều có `scrollWidth = 390` trong lượt tải bình thường. Kiểm tra riêng lỗi quota, focus hộp thoại và các request của tab đã lưu. Các màn hình có kết quả thật và Admin đã xác thực cần E2E với DB. |

Turbo dùng `.env` như đầu vào toàn cục, Prisma và Next config có bước nạp file môi trường. Audit chạy các lệnh thành phần và phục vụ bản build có sẵn với fixture. Auto-review chặn một lượt lặp khởi tạo Next vì chức năng nạp môi trường của lớp server. Phép đo focus sau đó hoàn tất bằng cách chỉ phục vụ HTML/JS đã build. `turbo.json:3-9`, `apps/api/prisma.config.ts:3-7`, `apps/api/src/app.module.ts:25-28`, `apps/web/next.config.ts:3-7`.

## 2. Phần A — Bugs ảnh hưởng chức năng

### BUG-01 · P1 · Forensic ghép hai câu độc lập thành cảnh báo nghiêm trọng

Engine tìm dấu hiệu OTP và hành động cài đặt bằng hai lần `findQuote` độc lập. Khi cả hai tồn tại, rule tăng thẳng lên `CRITICAL` ngay cả khi hai câu mô tả hai việc khác nhau. Nhánh `remoteRequest` bên dưới có kiểm tra ngữ cảnh theo câu, song nhánh tổng quát đã có thể khóa verdict trước đó. `apps/api/src/modules/forensic/hard-rules.engine.ts:254-258`, `apps/api/src/modules/forensic/hard-rules.engine.ts:424-453`, `apps/api/src/modules/forensic/data/trusted-institutions.ts:187-189`.

Gọi engine với chứng cứ giả lập “Mã OTP dùng để đăng nhập. Cài đặt ứng dụng lịch từ App Store.” và danh sách QR/chỉ dấu rỗng. Kết quả đo được là `HIGH_RISK` do `RULE_09_BIOMETRIC_OTP_PHISHING`. Người dùng nhận kết luận rủi ro cao và AI không thể hạ kết luận đã khóa. Yêu cầu hai dấu hiệu cùng mô tả một yêu cầu hoặc có liên kết ngữ nghĩa rõ ràng trước khi đặt `CRITICAL`. Thêm ca câu kể lại, lời khuyên phủ định và hai câu độc lập.

### BUG-02 · P1 · Admin lưu được gói làm cả lượt Khảo sát trả 400

Admin chỉ so min với max và kiểm tra dạng số của phí. Giá trị phí trả trước 100% phù hợp schema Admin và kiểu `Decimal(7,4)`. Survey duyệt toàn bộ catalog trong một `flatMap`, sau đó `disbursement` ném lỗi cho một gói, chặn cả kết quả. Tương tự, cú sốc âm hợp lệ ở cấp request có thể khiến một gói rơi dưới 0% và làm mất cả gói vẫn tính được. `apps/api/src/modules/admin/admin.service.ts:11-42`, `apps/api/src/modules/admin/admin.service.ts:71-86`, `apps/api/prisma/schema.prisma:234-239`, `apps/api/src/modules/survey-calc/survey-calc.service.ts:36-49`, `apps/api/src/modules/survey-calc/survey-calc.service.ts:171-208`.

Mock ghi catalog cho Admin, lưu gói có phí 100% rồi khảo sát cùng một gói lành mạnh, thu được 400. Với hai gói có đáy 5% và 7%, cú sốc −6 điểm phần trăm cũng trả 400 dù gói thứ hai vẫn còn lãi 1%. Chặn dữ liệu cấu hình sai khi tạo/cập nhật, báo rõ gói không còn phù hợp với cú sốc và trả các gói còn hợp lệ.

### BUG-03 · P1 · Bảng tin hiển thị sai biên trên lãi suất

`/home/market` đọc `nominalRateMin` và `nominalRateMax`, nhưng tập dùng để tính biên độ chỉ nhận `nominalRateMin`. Tooltip và tóm tắt biểu đồ hiển thị kết quả như biên độ niêm yết. Truy vấn cũng lấy mọi gói đang active, kể cả gói có ngày hiệu lực trong tương lai. `apps/api/src/modules/home/home.controller.ts:82-85`, `apps/api/src/modules/home/home.controller.ts:179-192`, `apps/web/src/components/charts/MarketRateBenchmarkChart.tsx:45-57`, `apps/web/src/components/charts/MarketRateBenchmarkChart.tsx:78-85`.

Gọi controller với hai gói cùng nhóm có khoảng 5–9% và 7–10%. Service trả `min=5, median=6, max=7`, trong khi biên trên niêm yết của hai gói là 10%. Tính biên trên từ `nominalRateMax`, áp dụng mốc hiệu lực và ghi rõ ý nghĩa thống kê của trung vị. Giữ Decimal khi tổng hợp lãi suất rồi chuyển sang kiểu biểu đồ ở biên DTO.

### BUG-04 · P1 · Trang chi tiết Radar mất nội dung khi storage từ chối ghi

`read` bắt lỗi storage, còn `write` gọi `setItem` trực tiếp. Trang chi tiết ghi lịch sử từ một effect và nút lưu/bỏ lưu dùng cùng hàm ghi. `apps/web/src/components/radar/ReadingStore.ts:7-30`, `apps/web/src/app/radar/[id]/page.tsx:39-42`, `apps/web/src/app/radar/page.tsx:173-175`.

Ở Chromium, cho `Storage.prototype.setItem` ném `QuotaExceededError` rồi mở bài fixture. HTTP vẫn trả 200 nhưng heading biến mất và có `pageerror`. Lượt đối chứng render đúng tên bài. Bắt lỗi tại hàm ghi, duy trì khả năng đọc bài và trả trạng thái lưu thất bại để thao tác lưu có phản hồi. Giữ event cùng tab và event `storage` liên tab khi ghi thành công. [WHATWG Web Storage](https://html.spec.whatwg.org/dev/webstorage.html)

### BUG-05 · P1 · Ghi muộn từ phiên khách không được chuyển vào tài khoản

Guard gắn owner guest từ đầu request. Transaction đăng nhập chuyển những hàng đã hiện diện, sau đó response xóa cookie guest. Survey và Forensic lưu ở cuối pipeline bằng owner đã chụp từ đầu, nên một ghi muộn sau commit vẫn thuộc guest cũ. Lịch sử của tài khoản lọc theo user. Đây là thứ tự có thể kiểm tra bằng barrier giữa hai lượt gọi service. `apps/api/src/common/guest-session.guard.ts:68-76`, `apps/api/src/modules/profile-auth/profile-auth.service.ts:129-159`, `apps/api/src/modules/profile-auth/profile-auth.controller.ts:152-155`, `apps/api/src/modules/survey-calc/survey-calc.service.ts:151-162`, `apps/api/src/modules/survey-calc/survey-calc.service.ts:350-364`, `apps/api/src/modules/forensic/forensic.service.ts:338-345`.

Dùng hai tab chung cookie guest. Giữ một lượt Survey hoặc Giám định ở bước AI trước `create`, đăng nhập ở tab còn lại, rồi cho lượt đang chờ lưu tiếp. Phép thử service dùng barrier và Prisma mock tái hiện được với Survey. Response có `savedToHistory=true`, vẫn có **1** hàng guest và lịch sử user có **0** hàng. Duy trì ánh xạ guest đã chuyển trong DB và đồng bộ thao tác xác định owner lúc commit ghi. Thêm test song song có barrier trên PostgreSQL.

### BUG-06 · P2 · Fixture Radar hết hạn sau 48 giờ

Fixture mặc định là `2026-11-24T08:00:00Z`, còn nhánh ưu tiên chạy với `Date.now()` thật. Sau 15:00 giờ Việt Nam ngày 26/11/2026, test vẫn đòi cảnh báo fixture đứng trước tin thường dù cửa sổ 48 giờ đã qua. `apps/api/src/modules/radar/radar.service.spec.ts:44-60`, `apps/api/src/modules/radar/radar.service.spec.ts:200-207`, `apps/api/src/modules/radar/radar.service.ts:448-458`.

Suite thật lúc 17:06 ngày 26/11 tái hiện đúng failure. Đóng băng đồng hồ cho ca này hoặc tính ngày fixture tương đối, đồng thời thử hai phía của mốc 48 giờ. Các ca kiểm tra ngày lịch cố định hoặc midnight đã tự đặt giờ vẫn có thể dùng ngày tuyệt đối.

### BUG-07 · P2 · Đăng nhập qua Hồ sơ làm mất trạng thái handoff

DeskNavigation và AppShell xây `returnTo` từ `usePathname()`. Điều hướng email và OAuth dùng đích đó để quay lại, trong khi Survey đọc `sessionId`, `mode` và tham số mô phỏng từ query. `apps/web/src/components/radar/DeskNavigation.tsx:21-30`, `apps/web/src/components/layout/AppShell.tsx:33-39`, `apps/web/src/components/profile/AccountPanel.tsx:62-65`, `apps/api/src/modules/profile-auth/profile-auth.controller.ts:116-121`, `apps/web/src/app/survey/page.tsx:4-6`, `packages/shared-types/src/routes.ts:81-98`.

Tại `/radar?feed=saved`, Chromium thấy link Hồ sơ chỉ mang `returnTo=/radar`. Tương tự, vào Survey từ một cú sốc Radar hoặc từ một phiên đã lưu rồi đăng nhập qua Hồ sơ sẽ quay về `/survey` với form mặc định. Giữ danh sách tham số được phép cho từng route và tiếp tục xác thực đích nội bộ. Dùng cơ chế riêng cho dữ liệu nhận dạng đề cập ở SEC/WEAK-03.

### BUG-08 · P2 · Classifier bỏ qua transcript của hồ sơ chỉ có ảnh

Intent text được tạo trước khi vision trả transcript. Lần phân loại lại transcript khi intent text rỗng chỉ chạy nếu có callback `observe`, thường dùng bởi benchmark. `apps/api/src/modules/forensic/forensic-extraction.ts:95-116`, `apps/api/src/modules/forensic/forensic.service.ts:147-150`, `apps/api/src/modules/ai-gateway/ai-gateway.service.ts:188-195`.

Gọi extraction với ảnh PNG giả lập 160×160, không kèm văn bản, cùng stub vision trả một transcript. Đường ứng dụng có **0** payload phân loại không rỗng, đường có observer có **1**. Dấu hiệu rủi ro chỉ có trên ảnh vì vậy mất một lớp đối chiếu intent. Dùng transcript đã che PII cho cả hai đường khi thiếu dữ liệu phân loại ban đầu.

### BUG-09 · P2 · Hồ sơ bỏ qua số tiền tiếng Việt có nhiều đơn vị

Parser tách mỗi thành phần thành một giá trị và bỏ đoạn nếu có hơn một giá trị. AI chỉ được điền một số trùng chính xác với tập các giá trị rời, nên kết quả đúng cũng bị loại. `apps/api/src/modules/profile-auth/profile-natural.ts:25-37`, `apps/api/src/modules/profile-auth/profile-natural.ts:41-54`, `apps/api/src/modules/profile-auth/profile-copilot.controller.ts:23-41`, `apps/web/src/components/profile/FinancialProfileForm.tsx:105-119`.

Nhập “Lương 2 triệu 500 nghìn.”. Handler trả thu nhập `null` ngay cả khi stub AI trả đúng `2500000`. Ghép các đơn vị giảm dần trong cùng cụm số bằng Decimal, sau đó kiểm tra giá trị đã ghép khi đối chiếu góp ý AI.

### BUG-10 · P2 · Phiên đã lưu hiện trong lịch sử nhưng có thể không mở được

History trả thông tin tóm tắt theo owner. Detail giải mã JSONB compact bằng schema strict và coi lỗi shape hoặc lệch số recipe là 404. Fixture có phiên thuộc đúng owner và kết quả gốc còn đủ, nhưng thiếu recipe, sẽ bị báo là phiên không tồn tại. `apps/api/src/modules/survey-calc/survey-calc.service.ts:21-25`, `apps/api/src/modules/survey-calc/survey-calc.service.ts:350-380`.

Trong mock Prisma, phiên 360 tháng compact phát lại lịch stress giống từng dòng. Đổi riêng `stressRecipes` thành mảng rỗng, GET detail qua service trả 404. Đây là ca tương thích, chưa xác minh có hàng lỗi như vậy trong DB thật. Thêm phiên bản cho cấu trúc lưu, vẫn mở kết quả gốc khi thiếu dữ kiện stress và hiển thị trạng thái riêng cho biểu đồ thiếu dữ liệu.

### BUG-11 · P2 · Bản tin đúng ba mục làm mất mục thứ ba trên mobile

Component render tối đa ba mục khi thu gọn và chỉ hiện nút mở rộng khi API trả hơn ba mục. CSS ở viewport tối đa 40rem lại ẩn từ mục thứ ba. Test Playwright hiện có đếm node trong DOM, nên có thể đạt dù node thứ ba không hiển thị. `apps/web/src/components/radar/RadarDailyBrief.tsx:29-38`, `apps/web/src/app/globals.css:96-105`, `tests/e2e/radar-daily-brief.spec.ts:40-56`.

Mock bản tin có đúng ba mục, mở `/radar` và đếm dòng hiển thị. Chromium ở **390 px** thấy **2/3** dòng và **0** nút mở rộng, còn ở **1280 px** thấy **3/3** dòng. Dùng cùng giới hạn thu gọn cho component và CSS, rồi assert trực tiếp mục thứ ba hiển thị hoặc có điều khiển để mở.

## 3. Phần B — Bottlenecks hiệu năng và tài nguyên

### PERF-01 · P2 · Hai lịch chi tiết làm kết quả Survey lớn

Mỗi gói tính và trả cả lịch gốc lẫn lịch stress, tức `2 × kỳ hạn × số gói` dòng. DB compact nhưng detail dựng lại lịch đầy đủ. Mock service kỳ hạn 600 tháng, ba gói, trả **3.600 dòng / 431.915 byte JSON** trước nén. Phần JSON compact tương ứng là **217.330 byte**, chưa tính lưu trữ JSONB. Báo cáo QA cũ ghi nhận **263.773 byte HTTP** cho 360 tháng và ba gói. Chart chỉ dùng tối đa 50 bucket ở kỳ hạn 600 tháng. Trả tóm tắt cho các gói và tải lịch chi tiết theo lựa chọn. `apps/api/src/modules/survey-calc/survey-calc.service.ts:87-94`, `apps/api/src/modules/survey-calc/survey-calc.service.ts:206-233`, `apps/api/src/modules/survey-calc/survey-calc.service.ts:262-266`, `apps/api/src/modules/survey-calc/survey-calc.service.ts:373-381`, `apps/web/src/components/charts/chart-math.ts:25-37`, `docs/FULL_SYSTEM_QA_AND_OPTIMIZATION_REPORT.md:55`.

### PERF-02 · P2 · JS khởi đầu vượt 420 kB ở bốn route

Cộng các file JS duy nhất từ layout và route trong `apps/web/.next/app-build-manifest.json`, gzip từng file, được **429.347 B** ở `/`, **429.348 B** ở `/radar`, **439.473 B** ở `/forensic` và **427.262 B** ở `/survey`. Trước nén khoảng 1,59–1,62 MB mỗi route. Đây là số đo artifact của bản build cục bộ hiện có, chưa tính prefetch, CSS, HTTP overhead hoặc thời gian tải mạng. Biểu đồ được import tĩnh kể cả khi người dùng chưa mở kết quả. Tách biểu đồ theo màn hình/nhánh kết quả và đo lại JS cùng thời gian tương tác. `apps/web/src/app/page.tsx:1`, `apps/web/src/app/radar/page.tsx:10`, `apps/web/src/components/charts/MarketRateBenchmarkChart.tsx:1-8`, `apps/web/src/components/forensic/LoanCost.tsx:1-5`, `apps/web/src/components/survey/SurveyWorkspace.tsx:12-14`.

### PERF-03 · P2 · Giám định giữ nhiều buffer và tiếp tục pipeline khi client đóng

Giới hạn mặc định là **6 tệp × 20 MiB**. Parser gom cả tệp trước khi xử lý, và lúc `Buffer.concat` tạm thời có cả chunks lẫn buffer kết quả. Sau đó QR và chuẩn bị ảnh chạy song song trong từng audit. Giới hạn ảnh 25 triệu pixel, tối đa 8 ảnh vision và mặc định PDF 5 trang giảm tải từng phần, còn ngân sách đồng thời giữa các audit chưa hiện diện tại các entry point. Trong stream audit, handler khi đóng chỉ xóa buffer nguồn và ngừng ghi event, service vẫn chạy với các dữ kiện đã trích nếu đã qua bước trích xuất. `apps/api/src/main.ts:17-21`, `apps/api/src/modules/forensic/forensic.controller.ts:25-57`, `apps/api/src/modules/forensic/forensic.controller.ts:83-120`, `apps/api/src/modules/forensic/forensic-extraction.ts:23-35`, `apps/api/src/modules/forensic/forensic-extraction.ts:54-75`, `apps/api/src/modules/forensic/pdf-extractor.ts:15-27`.

Để kiểm tra theo tải hợp lệ, đo RSS khi nhận các audit nhiều tệp cùng lúc và theo dõi một audit bị đóng sau bước trích xuất bằng gateway stub. Mỗi request có thể giữ tới **120 MiB chỉ tính byte tệp đầu vào**, chưa tính các bản sao hay raster. Đây là mức suy ra từ giới hạn cấu hình, chưa đo RSS. Đặt ngân sách byte tổng, giới hạn số pipeline CPU nặng và truyền tín hiệu hủy tới các stage có thể dừng.

### PERF-04 · P2 · Cache Daily Brief vẫn truy vấn trước hit và giữ key hết hạn trong ngày

Mỗi request đọc ứng viên và tính hash trước khi tra cache. Key chứa ngày cùng hash của ứng viên, gồm `updatedAt`. Key của cùng ngày vẫn nằm trong `Map` sau TTL 5 hoặc 30 phút. Mỗi lượt tra còn duyệt key để dọn ngày cũ. `dailyBriefInFlight` gộp lượt trùng key và dọn ở `finally`. `apps/api/src/modules/radar/radar.service.ts:327-333`, `apps/api/src/modules/radar/radar.service.ts:373-387`, `apps/api/src/modules/radar/radar.service.ts:417-429`.

Giữ ngày Việt Nam cố định và thay đổi `updatedAt` của một ứng viên giữa hai lượt gọi. Hai phiên bản có hai key. Với N phiên bản trong ngày, có thể giữ N key cho tới lần truy cập ngày sau, ngay cả khi TTL đã hết. Đặt trần và xóa theo TTL, đồng thời dùng phiên bản nguồn để giảm truy vấn lặp khi hit. Kiểm tra mốc 48 giờ đi qua giữa hai lượt có cùng fingerprint khi định nghĩa TTL.

### PERF-05 · P2 · Tab đã lưu/lịch sử vẫn tải toàn bộ nguồn Radar

Các query danh sách bài, Home market, cảnh báo, tin lừa đảo, highlights và bản tin ngày chạy không phụ thuộc tab. Query danh sách đưa bộ lọc vào key nhưng không nhận `signal` để hủy fetch cũ. Chromium vào trực tiếp `/radar?feed=saved` với context mới ghi được **7 request API**, gồm session và sáu tài nguyên Radar/Home trước khi mở hộp thoại. Bật query theo phần thực sự hiển thị và nối tín hiệu hủy của React Query khi thay đổi bộ lọc. `apps/web/src/app/radar/page.tsx:160-171`, `apps/web/src/app/radar/page.tsx:212-241`, `apps/web/src/app/radar/page.tsx:360-366`.

### PERF-06 · P3 · Giới hạn lịch sử thiếu index phù hợp với owner và thứ tự

Survey lấy 20 dòng, Forensic lấy 50 dòng mới nhất với `WHERE owner ORDER BY createdAt DESC`. Schema và migration hiện không có index ghép `(user_id, created_at)` hoặc `(guest_session_id, created_at)` trên hai bảng. `take` giới hạn kích thước kết quả nhưng không tạo đường truy cập theo owner và thứ tự. Khi bảng tích lũy nhiều chủ thể, xác minh trên dữ liệu đại diện bằng `EXPLAIN (ANALYZE, BUFFERS)` rồi bổ sung index phù hợp. Chưa đo query plan trên DB của audit. `apps/api/src/modules/survey-calc/survey-calc.service.ts:350-356`, `apps/api/src/modules/forensic/forensic.service.ts:411-418`, `apps/api/prisma/schema.prisma:261-319`.

## 4. Phần C — Weaknesses bảo mật, độ ổn định và UX/A11y

### SEC/WEAK-01 · P1 · Ảnh vision giữ PII nhìn thấy trước khi gửi ra nhà cung cấp

`maskForensicText` xử lý văn bản. Với ảnh upload hoặc PDF raster, pipeline chỉ xoay/thu nhỏ/đổi sang JPEG rồi đưa vào phần ảnh của yêu cầu provider. Việc xóa buffer trong `finally` có tác dụng tại tiến trình local. `apps/api/src/modules/forensic/forensic-extraction.ts:25-35`, `apps/api/src/modules/forensic/forensic-extraction.ts:86-105`, `apps/api/src/modules/forensic/forensic-extraction.ts:179-183`, `apps/api/src/modules/ai-gateway/ai-provider.ts:53-77`.

Kiểm tra bằng ảnh giả có trường định danh và gateway stub trong RAM. Audit đã xác nhận nhánh provider nhận ảnh tổng hợp và pipeline không có bước che pixel trước trường `images`. Khi dùng ảnh chứng từ thật, tên, số điện thoại hoặc số tài khoản in trên ảnh có thể nằm trong dữ liệu gửi đi. Ưu tiên OCR/che vùng nhạy cảm cục bộ hoặc cho người dùng chủ động xác nhận gửi nguyên ảnh với mục đích rõ ràng.

### SEC/WEAK-02 · P2 · Image proxy thiếu ngân sách đồng thời và cho hạ cấp HTTP

Route công khai gọi nguồn với timeout mặc định **6 giây**, tối đa bốn vòng kiểm tra và giới hạn **5 MiB mỗi response**. Mỗi ảnh thành công giữ chunks rồi ghép buffer trả về. Ở cấp ứng dụng chưa thấy giới hạn tổng tác vụ đang chờ hoặc số request trên route. Entry point yêu cầu HTTPS nhưng scheme của hop tiếp theo cũng cho HTTP. `apps/api/src/modules/radar/radar.controller.ts:6-31`, `apps/api/src/modules/radar/radar.service.ts:675-677`, `apps/api/src/modules/admin/threat-safety.ts:145-198`.

Kiểm tra phòng thủ bằng transport stub với nhiều phản hồi ảnh hợp lệ và theo dõi số request đang chờ, hoặc kiểm tra policy scheme cho một nguồn ảnh công khai mô phỏng. Tải tài nguyên tăng theo số request đồng thời. Hop HTTP có thể làm mất bảo vệ tính toàn vẹn trên đường tới nguồn ảnh. Bổ sung giới hạn đồng thời, quota, và yêu cầu HTTPS ở mọi hop. Đợt audit không đo tải thông qua nguồn mạng bên ngoài.

### SEC/WEAK-03 · P2 · Trust Filter đưa nguyên nhãn người dùng nhập vào URL

Tên tổ chức là chuỗi tự do. Khi bị chặn, API đưa nguyên chuỗi vào `details` và frontend đưa giá trị đó vào `claimedEntity` trong URL của Forensic. Đây có thể là tên cá nhân hoặc chuỗi có số định danh khi người dùng dán nhầm thông tin người nhận. `packages/shared-types/src/dto/survey.dto.ts:11-14`, `apps/api/src/modules/survey-calc/survey-calc.service.ts:104-112`, `apps/web/src/components/survey/SurveyWorkspace.tsx:206-210`, `packages/shared-types/src/routes.ts:74-87`.

Dùng một tên người nhận giả không có trong danh mục. Handoff giữ nguyên tên trong URL và lịch sử trình duyệt. Việc URL đi vào log còn tùy cấu hình vận hành. Chuyển dữ liệu định danh qua tham chiếu ngắn hạn theo phiên hoặc trạng thái điều hướng cục bộ, chỉ giữ cờ nguồn luồng trong URL.

### SEC/WEAK-04 · P2 · AI Gateway cộng dồn timeout và không áp breaker cho intent

Mỗi fallback có timeout riêng 12 giây cho các tác vụ ngoài Profile. Route vision có primary và bốn fallback, nên ngân sách chờ riêng của vision có thể tới **60 giây** nếu đủ route được bật và từng route tiêu hết timeout. Circuit breaker theo process/model bắt đầu chặn sau lỗi đã quan sát, vì vậy các yêu cầu đồng thời có thể cùng khởi chạy trước lỗi đầu tiên hoặc sau khi timeout breaker hết. Intent dùng khóa cấu hình trực tiếp và không qua `routeKey` hay `recordFailure`. SDK đã đặt `maxRetries: 0`. `config/ai-routing.yaml:23-35`, `apps/api/src/modules/ai-gateway/ai-gateway.service.ts:135-150`, `apps/api/src/modules/ai-gateway/ai-gateway.service.ts:188-229`, `apps/api/src/modules/ai-gateway/ai-provider.ts:69-77`.

Kiểm tra bằng stub provider timeout/429 và ghi thời điểm các call cùng model. Khi provider sự cố, lượt audit có thể chờ qua nhiều lần thử và intent vẫn gọi lại ở request tiếp theo. Đặt deadline chung theo pipeline, cho intent tham gia breaker và giới hạn số probe khi model vừa hết cooldown.

### SEC/WEAK-05 · P2 · Đóng hộp thoại Radar mobile làm mất focus bàn phím

Click trong menu đóng danh sách ngay cả khi nút con vừa mở modal. CSS ẩn nút đã kích hoạt trên mobile và dialog không chỉ định đích focus thay thế khi đóng. `apps/web/src/components/radar/DeskNavigation.tsx:26-39`, `apps/web/src/components/radar/DeskDialog.tsx:6-15`, `apps/web/src/app/radar/desk.css:167-173`, `apps/web/src/app/radar/desk.css:187-189`.

Chromium 390×844, mở menu rồi focus nút “Chủ đề & thời gian” và nhấn Enter. Dialog rộng **366 px**, focus vào trong đúng, Escape đóng được. Sau đó focus rơi về `BODY` vì menu đã thu. Khôi phục focus về nút Menu khi trigger bị ẩn, hoặc giữ menu mở trong lúc modal tồn tại. [W3C APG Modal Dialog Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)

### SEC/WEAK-06 · P3 · Finding AI có thể mất vì lỗi chép dấu câu

Hàm grounding chuẩn hóa NFC, chữ hoa/thường và khoảng trắng rồi tìm chuỗi con. Phép thử lành tính dùng nguồn “Khoản trả mỗi tháng”, quote có ba khoảng trắng giữ **1** finding, quote thêm một dấu phẩy giữ **0**. Đây là giới hạn của ràng buộc trích dẫn, có thể làm mất finding hữu ích nếu mô hình chép dấu câu. Yêu cầu trích lại từ một đoạn đã đánh số hoặc định vị và thay bằng lát cắt nguyên văn rồi kiểm tra lần nữa. Giữ nguyên yêu cầu dẫn chứng và khóa quyết định deterministic. `apps/api/src/modules/forensic/deep-reasoning.ts:6-18`, `apps/api/src/modules/forensic/forensic.service.ts:262-278`.

### Đối chiếu đủ bảy trục

| Trục | Phần đã đối chiếu và giới hạn |
| --- | --- |
| 1. Tích hợp và giao diện | Lần theo Radar → Survey, Radar → Forensic, Forensic → Survey và Profile → replay. Kiểm tra `feed`, `returnTo`, `sessionId`, `claimedEntity`, `from`, đồng bộ Radar hai loại event, fallback ảnh và CSS/layout. `EditorialImage` loại nguồn đã lỗi và dùng ảnh minh họa khi hết nguồn. Các nút menu/đóng dialog ở ngoài form tương ứng. Tương phản tính từ CSS của chữ điều hướng, mục ưu tiên và tab lần lượt là 8,30:1, 6,44:1 và 5,61:1 trên nền tương ứng. Chưa bao phủ toàn bộ trạng thái động hay báo cáo có dữ liệu thật. `packages/shared-types/src/routes.ts:81-117`, `apps/web/src/components/profile/SurveyHistory.tsx:17-22`, `apps/web/src/app/radar/page.tsx:166-171`, `apps/web/src/components/radar/EditorialImage.tsx:20-35`, `apps/web/src/app/radar/desk.css:22-24`, `apps/web/src/app/radar/desk.css:42-43`, `apps/web/src/app/radar/desk.css:113`. |
| 2. Thời gian, trạng thái và DTO | Rà cửa sổ 48 giờ, bài ứng viên 14 ngày, midnight Việt Nam, cache, validate dữ liệu từ API và hủy request khi chuyển tab/unmount. Survey remount theo handoff, khóa tab khi restore, và bảo vệ kết quả tính bị hủy. Forensic hủy request frontend khi unmount, có khác biệt phía server trong PERF-03. Market và replay dùng schema lúc đọc. Một số query Radar dùng type generic ở client, nên typecheck chỉ kiểm tra hợp đồng tĩnh ở các điểm đó. `apps/api/src/modules/radar/radar.service.ts:329-333`, `apps/api/src/modules/radar/radar.service.ts:373-387`, `apps/web/src/components/survey/SurveyWorkspace.tsx:89-131`, `apps/web/src/components/survey/SurveyWorkspace.tsx:145-157`, `apps/web/src/components/forensic/ForensicWorkbench.tsx:176-189`, `apps/web/src/lib/api-client.ts:41-59`. |
| 3. Forensic, Prompt Guard và AI | Đối chiếu việc sàng lọc text, trường tên, QR và multipart. Controller giới hạn trường và tệp, pipeline cô lập chỉ dẫn, che văn bản và xóa buffer trong cả nhánh lỗi. Ca câu độc lập lộ BUG-01. Follow-up có phân luồng thuần, che dữ liệu văn bản và kiểm tra câu trước khi nhả stream. Suite hiện có chạy các ca refusal và degraded fallback, không dùng nhà cung cấp thật trong đợt audit. `apps/api/src/modules/forensic/forensic.service.ts:96-102`, `apps/api/src/modules/forensic/forensic.controller.ts:25-78`, `apps/api/src/modules/forensic/forensic-extraction.ts:78-112`, `apps/api/src/modules/forensic/forensic-follow-up.ts:75-103`, `apps/api/src/modules/forensic/forensic-chat-stream.ts:91-141`. |
| 4. Toán, Survey và biểu đồ | Thử 0%, 1/36/37/600 tháng, cùng ba cách trả nợ, tiền gốc 10.000.000.001 đồng, thực nhận 1 đồng, tất toán đúng tháng ưu đãi và kỳ cuối. Kỳ cuối có dư nợ và phí tất toán bằng 0. Hàng compact 360 tháng phát lại giống từng dòng, và test legacy hiện có qua. Rà mã của năm biểu đồ với ca rỗng, một điểm, APR `null`, số lớn và kích thước container SSR. Kiểm thử runtime biểu đồ giới hạn ở Market fixture, chưa render mọi kết quả Survey/Forensic với DB thật. `packages/financial-math/src/index.ts:18-120`, `apps/api/src/modules/survey-calc/survey-calc.spec.ts:52-77`, `apps/web/src/components/charts/FinancialChartFrame.tsx:13-22`, `apps/web/src/components/charts/ForensicCostTrapChart.tsx:48-65`. |
| 5. Hiệu năng và tài nguyên | Kiểm tra giới hạn truy vấn, index, phân trang, cache và xử lý ảnh/PDF. Radar dùng quan hệ Prisma theo lô khi đọc feed, còn ingest thực hiện nhiều thao tác theo từng mục. Home giới hạn bài và cảnh báo, aggregate vẫn đọc toàn bộ gói active. Admin liệt kê toàn bộ sản phẩm, sync snapshot hiện có 21 sản phẩm và làm theo từng sản phẩm trong transaction có timeout 15 giây. Không kết luận p95/CPU PostgreSQL từ đọc nguồn. Cache ví có trần 512. `apps/api/src/modules/radar/radar.service.ts:274-285`, `apps/api/src/modules/radar/radar.service.ts:583-634`, `apps/api/src/modules/home/home.controller.ts:61-85`, `apps/api/src/modules/admin/admin.service.ts:53-68`, `apps/api/src/modules/survey-calc/product-catalog.ts:65-109`, `apps/api/src/modules/forensic/channel-intelligence.service.ts:117-132`. |
| 6. Bảo mật và quyền riêng tư | Resolver kiểm tra mọi IP DNS trả về, từ chối các dải loopback/private/link-local đã nêu, giới hạn IPv6 global và ghim IP vào socket. Mỗi redirect được kiểm lại. Allowlist raster, `nosniff` và giới hạn byte streaming hiện diện. Không xác nhận SSRF qua các dải đã hỏi, DNS rebinding hoặc XSS SVG/HTML trong luồng đã đọc. Các handler replay/read/export dùng owner, cookie có `httpOnly`, `sameSite=lax`, chữ ký và `secure` ở production. Admin kiểm tra role từ DB. Rà tĩnh luồng log, prompt và URL cho kết quả SEC/WEAK-01/03. `apps/api/src/modules/admin/threat-safety.ts:59-85`, `apps/api/src/modules/admin/threat-safety.ts:145-198`, `apps/api/src/modules/admin/admin-threat-ops.spec.ts:23-45`, `apps/api/src/modules/radar/radar.controller.ts:23-28`, `apps/api/src/common/guest-session.guard.ts:15-29`, `apps/api/src/common/admin.guard.ts:19-31`, `apps/api/src/modules/forensic/forensic.service.ts:423-429`. |
| 7. Vận hành và độ tin cậy | Kiểm tra parse Profile, email unique, retry conflict và guest transfer. Test sync snapshot offline xác nhận `sourcesReachable=0`, sync vẫn dùng snapshot và giữ override Admin. Các ca publish/revoke và chặn chỉ dấu whitelist đạt. AI fallback/rate limit được rà theo route và theo process, chưa chạy provider mạng thật. `apps/api/prisma/schema.prisma:155-160`, `apps/api/src/modules/profile-auth/profile-auth.service.ts:81-103`, `apps/api/src/modules/profile-auth/profile-auth.service.ts:129-159`, `apps/api/src/modules/survey-calc/survey-calc.spec.ts:214-237`, `apps/api/src/modules/admin/admin-threat-ops.spec.ts:140-166`, `apps/api/src/modules/ai-gateway/ai-gateway.service.ts:135-228`. |

## 5. Phần D — Lộ trình ưu tiên xử lý

| Nhóm | Hạng mục | Điều kiện xác nhận |
| --- | --- | --- |
| **1 · Bắt buộc trước demo hoặc merge `main`** | BUG-01–06, SEC/WEAK-01 | Ca câu lành tính giữ verdict phù hợp, kết quả khảo sát vẫn có gói hợp lệ, tooltip khớp biên catalog, Radar vẫn đọc được khi quota lỗi, ghi guest song song xuất hiện trong lịch sử user, suite API xanh qua mốc 48 giờ, có lựa chọn rõ ràng cho ảnh chứa PII. |
| **2 · Sprint kế tiếp** | BUG-07–11, PERF-01–05, SEC/WEAK-02–05 | Giữ handoff, mở lại phiên với dữ liệu khả dụng, đồng nhất classifier ảnh, giữ đủ mục bản tin trên mobile, kiểm tra tải/timeout theo ngân sách, khôi phục focus khi đóng hộp thoại, tránh mang định danh qua URL. |
| **3 · Theo dõi ở quy mô hiện tại** | PERF-06, SEC/WEAK-06 | Thu query plan theo tập lịch sử đại diện và tỷ lệ finding bị rớt vì trích dẫn trước khi chọn tối ưu. |

**Tính toàn vẹn worktree.** Snapshot `apps/api/src/modules/forensic/eval/__snapshots__/benchmark-deterministic.spec.ts.snap` đã có trạng thái `M` trước audit. Hash Git `0b5082359cb4d91534bd4e280e0defd852cbe630` được giữ nguyên. Báo cáo này là thay đổi duy nhất do audit tạo, nên `git status --short` hiển thị cả snapshot có sẵn lẫn báo cáo. Cổng 3000 và 4000 không có tiến trình lắng nghe khi kết thúc kiểm tra.
