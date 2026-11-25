# Báo cáo thay đổi — Radar Daily Brief & ảnh bài viết

## 1. Tổng quan tính năng

> Phạm vi commit trên nhánh `feat/tai-radar-hotnews-rec`: daily brief, giao diện Radar và các phụ thuộc code/migration về image-rights đang có sẵn trong integration worktree. Các thay đổi trang chủ, Survey/Forensic E2E và cấu hình workspace không liên quan được giữ ngoài commit.

### Audit hiện trạng trước khi sửa

- `/radar` hiện tải tin, cảnh báo, danh sách ưu tiên, tín hiệu cá nhân hóa theo đồng ý và trạng thái nguồn qua các endpoint riêng.
- `RadarService.articleHighlights()` tính thứ tự ưu tiên từ độ mới, chủ đề, cảnh báo đã công bố và số nguồn; không có endpoint tổng hợp tin theo ngày hoặc cache daily brief.
- `recommendationSignals()` chỉ đọc `primaryGoal` và `sessionMode` khi body gửi consent tương ứng; không chọn dữ liệu số tiền/kết quả tính toán.
- `ThreatAlert` có `verificationStatus`, `publishedAt` và quan hệ bằng chứng `ThreatEvidence`; cảnh báo chưa xác minh được phân biệt với tin/bài cùng chủ đề.
- `MarketArticle` đã có metadata ảnh và lịch sử duyệt quyền; `articleDto()` chỉ trả ảnh khi trạng thái `PERMITTED` và đủ metadata quyền. FE đã có fallback khi URL ảnh lỗi; thiếu ảnh dùng `CategoryArtwork` tự tạo.
- AI Gateway hiện có schema cho phân tích tác động Radar nhưng chưa có tác vụ tóm tắt bản tin ngày.
- Prisma schema và các migration ảnh/duyệt quyền đang là thay đổi chưa commit của integration worktree; chúng là phụ thuộc trực tiếp của giao diện ảnh hiện tại và cần được review khi chốt phạm vi commit.
- Nhánh `feat/tai-radar-hotnews-rec` chưa tồn tại ở local hoặc remote tại thời điểm bắt đầu; nhánh được tạo từ integration HEAD `353d485` mà không thay đổi nội dung working tree.

## 2. Hành vi UI trước/sau

- **Trước:** Radar có tin nổi bật và thanh chứng minh nguồn; chưa có bản tin ngày tổng hợp. Ảnh được cấp quyền chỉ xuất hiện ở bài chính/chi tiết, hàng tin thứ cấp không có thumbnail.
- **Sau:** thêm “Tóm tắt nhanh trong ngày” ở cột ngữ cảnh desktop và trước bộ khám phá tin trên mobile (sau dải cảnh báo). Mặc định hiện tối đa 3 ý với “Xem đầy đủ”; mở rộng tối đa 10 ý trong luồng trang, có thể thu gọn.
- Mỗi ý phân biệt tóm lược AI/tiêu đề nguồn, góc nhìn AI, liên quan cá nhân (nếu có consent), lý do chọn, trạng thái xác minh và link nguồn cùng tiêu đề/thời gian.
- Mobile giữ nút mở/thu gọn, không dùng overlay/modal; điều hướng dưới vẫn nhìn thấy và thao tác được. Khi thiếu tin, hiện trạng thái rỗng; lỗi có nút thử lại; fallback được gắn nhãn “AI hiện chưa khả dụng”; dữ liệu cũ báo quá 24 giờ.
- Các hàng tin thứ cấp có thumbnail khi API trả ảnh đã duyệt; thiếu ảnh dùng hình minh họa chủ đề tự tạo và có nhãn, lỗi ảnh có fallback.

## 3. Thành phần mới

- `apps/web/src/components/radar/RadarDailyBrief.tsx` — trình bày trạng thái tải/lỗi/rỗng/fallback, 3 ý mặc định, tối đa 10 ý, provenance, AI interpretation, verification và relevance.
- `StoryThumbnail` trong `apps/web/src/app/radar/page.tsx` — hiển thị ảnh có credit hoặc `CategoryArtwork` cho hàng tin thứ cấp.
- CSS scoped Radar trong `apps/web/src/app/globals.css` — phân cấp biên tập, trạng thái, reduced motion, thumbnail, mobile 320/390px.

## 4. File thay đổi

- API/AI: `apps/api/src/modules/radar/radar.service.ts`, `radar.controller.ts`, `apps/api/src/modules/ai-gateway/ai-gateway.service.ts`, `ai-routing.ts`, `config/ai-routing.yaml`.
- Shared contract: `packages/shared-types/src/ai-gateway.contract.ts`, `packages/shared-types/src/dto/radar.dto.ts`.
- FE: `apps/web/src/app/radar/page.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/components/radar/RadarDailyBrief.tsx`.
- Tests: `apps/api/src/modules/radar/radar.service.spec.ts`, `tests/e2e/radar-daily-brief.spec.ts`.
- Báo cáo: `docs/changes/RADAR_DAILY_BRIEF_HOTNEWS_REC.md`.
- Phụ thuộc integration về ảnh: Prisma schema và hai migration image-rights hiện có; API quản trị/queue duyệt quyền; `CategoryArtwork`; màn chi tiết bài; shared shell; DB/admin tests, mock API và các tài liệu ERD/design được liệt kê trong commit.

## 5. Thay đổi API

- Thêm `POST /api/v1/radar/daily-brief` (qua controller `POST /radar/daily-brief`, session guest/user hiện có).
- Request strict: `personalizationEnabled`, `topics[]`, `includeProfileGoal`, `includeSurveyTopics`. Gửi profile/survey consent khi bật cá nhân hóa; khi disabled, backend từ chối cờ consent còn bật.
- Response có ngày Việt Nam, trạng thái `AI_SUMMARY | SOURCE_FALLBACK | EMPTY`, giờ cập nhật, stale flag, tín hiệu được dùng và tối đa 10 items. Mỗi item có ID, loại, summary, interpretation, category, publication time, verification, inclusion reason, relevance và citations.
- Citation URL/nhãn nguồn/thời gian được ghép từ database evidence sau khi lọc URL HTTPS; AI chỉ chọn `referenceId`, không trả URL tùy ý. Reference ID không tồn tại, trùng hoặc không có nguồn hợp lệ bị loại.
- Thêm task `RADAR_DAILY_BRIEF` với Structured Output trong AI Gateway và route/fallback model; không thêm streaming API.

## 6. Thay đổi database

- Daily brief không thêm bảng, cột hoặc migration. Bản tóm tắt lưu trong cache tiến trình, không persist.
- Để đáp ứng mục ảnh, commit chứa hai migration image metadata/image-rights vốn đã có trong working tree trước nhiệm vụ này. Chúng là phụ thuộc tích hợp của Radar V2; không phát sinh migration mới trong lượt này. Cần áp dụng migration đó trước khi chạy code ảnh trong môi trường mới.

## 7. Tóm tắt AI và grounding nguồn

- Candidate lấy từ MarketArticle ACTIVE đã xuất bản trong 14 ngày gần nhất và ThreatAlert đã công bố, kèm category, ngày, link nguồn, trạng thái/evidence; với bài tin chỉ truyền các fact từ phân tích GENERAL đã lưu (nếu có).
- AI chỉ nhận dữ liệu từ các candidate trên và chỉ trả ID nguồn, nội dung diễn đạt ngắn và góc nhìn chung. Server ghép citation từ evidence record; không nhận citation do model dựng.
- Mỗi cảnh báo giữ trạng thái xác minh riêng. Nguồn đáng tin không tự chuyển cảnh báo sang verified. Cảnh báo verified mới trong 48 giờ được chèn ở đầu nếu model bỏ sót và vẫn nằm trong giới hạn 10.
- AI tóm tắt tối đa 10 mục, khử trùng ID, không bù cho đủ 10. Nếu provider lỗi hoặc output không map được, trả tiêu đề nguồn có link dưới `SOURCE_FALLBACK`, không gắn nhãn AI.
- **Giới hạn grounding:** schema hiện không lưu toàn văn bài báo. Với bài chưa có phân tích GENERAL, AI chỉ có tiêu đề/metadata và source title để tóm lược; UI nói rõ AI không xác minh độc lập. Muốn tóm lược nội dung bài đầy đủ cần quyết định riêng về quyền lưu/đọc nội dung nguồn.

## 8. Cache ngày và quy tắc làm mới

- Backend tạo cache key `Asia/Ho_Chi_Minh date + SHA-256 fingerprint` của IDs, updatedAt, trạng thái xác minh, fact excerpts và URL nguồn hiện có.
- Cache in-process: 30 phút cho AI summary, 5 phút cho fallback; promise in-flight dùng chung để tránh gọi LLM trùng đồng thời. Candidate được truy vấn trước mỗi lần dùng cache để phát hiện dữ liệu mới/chỉnh sửa; warning mới, thay đổi trạng thái xác minh hoặc evidence mới làm đổi fingerprint.
- Client có query key ngày Việt Nam và đặt timer cho nửa đêm Việt Nam, ngoài việc refetch khi focus/thời gian cache stale.
- Tín hiệu cá nhân không thuộc cache bản tin: sau khi lấy base summary, backend đọc goal/sessionMode theo từng request và consent; relevance được dựng sau cache.
- Giới hạn: cache bộ nhớ chỉ chia sẻ trong một API process; khi scale nhiều instance hoặc cần sống qua restart nên chuyển cache sang Redis có version key tương đương.

## 9. Ưu tiên cảnh báo lừa đảo

- Candidate cảnh báo phải đã công bố và có ít nhất một URL evidence HTTPS.
- Cảnh báo verified mới trong 48 giờ được ưu tiên cao nhất và cưỡng chế có mặt trong 10 ý đầu nếu còn chỗ; cảnh báo khác và tin fraud vẫn giữ trạng thái riêng.
- API không tự xác minh; trạng thái `UNVERIFIED`/khác `VERIFIED` hiển thị chữ rõ ràng.

## 10. Consent cá nhân hóa và quyền riêng tư

- `topics` từ giao diện được chọn; `primaryGoal` chỉ đọc với `includeProfileGoal=true`; `sessionMode` chỉ đọc với `includeSurveyTopics=true`.
- Không đọc/đưa vào prompt AI số tiền, thu nhập, khoản vay, kết quả calculator, giấy tờ forensic, tài khoản ngân hàng hoặc PII. Signals chỉ dùng sau AI để gắn câu relevance khái quát.
- Khi personalization tắt, client gửi topic rỗng, consent false; backend không gọi truy vấn hồ sơ/Khảo sát.

## 11. Quyền ảnh bài viết

- Dùng article-image metadata và review history hiện có. API `articleDto()` chỉ phát ảnh trạng thái `PERMITTED`, HTTPS, cùng host với nguồn và đủ credit/source/rights evidence; FE không tự suy quyền. `UNKNOWN` vẫn không được hiển thị.
- Ảnh bài nổi bật giữ credit/source; tin thứ cấp có thumbnail nhỏ với credit. URL ảnh hỏng có fallback; bài không ảnh có graphic nội bộ ghi “Minh họa chủ đề”, không dùng ảnh stock gán cho sự kiện.
- Lưu ý: CSS hiện dùng `<img>` để hỗ trợ URL nguồn ngoài; Next build còn ba cảnh báo `<img>` ở Radar detail/admin queue. Chưa đổi sang `next/image` vì cần loader/host policy cho nguồn ngoài.

## 12. Screenshot desktop/mobile

- Desktop 1440×900, collapsed: `docs/design/screenshots/radar-daily-brief-collapsed-desktop.png`
- Desktop 1440×900, expanded: `docs/design/screenshots/radar-daily-brief-expanded-desktop.png`
- Mobile 390×844, collapsed: `docs/design/screenshots/radar-daily-brief-collapsed-mobile.png`
- Mobile 390×844, expanded: `docs/design/screenshots/radar-daily-brief-expanded-mobile.png`
- Mobile 320px: `docs/design/screenshots/radar-daily-brief-mobile-320.png`
- Ảnh dùng fixture kiểm thử minh họa (`example.test`), không phải tin thật. Expanded desktop/mobile tiếp tục theo luồng trang; nội dung nằm dưới màn hình đầu có thể xem bằng cuộn.

## 13. Kiểm tra đã chạy

- Shared-types build bằng TypeScript trực tiếp: pass.
- TypeScript `--noEmit` cho API và Web: pass.
- API production TypeScript compile: pass.
- API Vitest toàn bộ `apps/api/src`: **314/314 pass**.
- Playwright Radar V2 + daily brief (bỏ test “ma trận ảnh” ghi đè screenshot lịch sử): **16/16 pass**. Bao gồm 0/1/3/5/10/12 items, nguồn/citation, reduced motion, rollover nửa đêm Việt Nam, điều hướng mobile, ảnh thumbnail/fallback và các luồng Radar V2.
- ESLint cho API/shared types/Radar/admin image components/E2E daily brief: pass.
- Next production build: pass. Còn 3 warning hiện hữu về `<img>` tại Radar, Radar detail và Admin image review queue.
- Prisma Client generate: pass.
- `pnpm --filter ...` không dùng được trong môi trường hiện tại do pnpm từ chối build scripts bị ignore (`ERR_PNPM_IGNORED_BUILDS`) và báo thiếu executable links. Các kiểm tra tương đương được chạy trực tiếp qua package binaries đã cài; không thay đổi cấu hình dependency.

## 14. Vấn đề và giới hạn

- AI chỉ tóm tắt metadata/analysis facts có sẵn, không đọc toàn văn bài chưa lưu; kết quả không phải xác minh độc lập.
- Cache in-memory phù hợp cho một process/MVP, không chia sẻ nhiều instance.
- Crawl freshness còn phụ thuộc trạng thái nguồn ingestion hiện tại; UI có stale flag nhưng chưa có endpoint SLA riêng.
- Ảnh chỉ có thể hiện khi reviewer đã nhập đủ quyền; ảnh `UNKNOWN`/thiếu evidence dùng minh họa theo chủ đề.

## 15. Git

- Nhánh: `feat/tai-radar-hotnews-rec`
- Integration base: `353d485` (`origin/dev` tại lúc tạo nhánh).
- Commit triển khai: `4b58766` — `feat(radar): add grounded daily brief and article imagery`.
