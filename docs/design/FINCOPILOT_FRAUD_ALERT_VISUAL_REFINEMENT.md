# Cảnh báo lừa đảo — hoàn thiện hình ảnh và thứ bậc thông tin

Ngày review: 26/11/2026. Nền tảng là Editorial Security News V2, Concept A. Chỉ thay đổi tab Cảnh báo của Home/Radar và các tranh SVG gốc; không thay API, logic xác minh, backend hay các route khác.

## Audit từ ảnh trước sửa

| Kích thước | Vấn đề nhìn thấy |
| --- | --- |
| 1440×900 | Tin chính có nhịp biên tập tốt, nhưng ngày công bố và dẫn chứng còn nhỏ; minh họa chuyển phí thiếu phân biệt với các thủ đoạn khác. |
| 390×844 | Banner, ô tìm kiếm và chip chủ đề chiếm nhiều chiều cao; tiêu đề tin chính bắt đầu quanh nửa dưới màn hình, hướng dẫn nằm sau ảnh. |
| 320×844 | Chip chủ đề xuống hai hàng dù không lọc cảnh báo; tiêu đề và hướng dẫn càng xuống sâu. |

Ảnh trước sửa: [desktop](../../artifacts/fraud-alert/editorial-v3/before/feed-desktop.png) · [390px](../../artifacts/fraud-alert/editorial-v3/before/feed-mobile.png) · [320px](../../artifacts/fraud-alert/editorial-v3/before/feed-narrow.png).

## Thay đổi

1. **Màn đầu mobile.** Chỉ khi tab Cảnh báo mở, banner vẫn có ô nhập và nút Giám định nhưng gọn thành hai hàng; tìm kiếm thấp hơn, chip chủ đề ẩn vì chúng dẫn sang tab tin tức chứ không lọc danh sách cảnh báo. Các chip vẫn hoạt động ở tab khác. Tít và hướng dẫn phòng tránh đứng trước ảnh. Shell, tab và menu mobile giữ nguyên.
2. **Minh họa.** Dùng tranh SVG nguyên bản với cùng giấy ngà, xanh rừng và đất nung: tin nhắn chứa đường dẫn; hai hồ sơ danh tính; tin nhắn đòi phí tài khoản; hồ sơ vay kèm phiếu phí trước giải ngân. Quy tắc chọn ảnh dựa trên nhóm thủ đoạn và từ khóa thực sự trong tóm tắt; trường hợp không khớp dùng tranh kiểm tra nguồn trung tính. Mọi ảnh trong bài có chú thích “Minh họa gốc · không phải ảnh sự việc”. [Xem bộ tranh](../../artifacts/fraud-alert/editorial-v3/illustrations.png).
3. **Dẫn chứng và xác minh.** “Đã xác minh cảnh báo” đặt cạnh chủ đề, tách khỏi ngày công bố và tiêu đề. Câu mở đầu giải thích đây là trạng thái cảnh báo, không đánh giá trường hợp cá nhân. Ngày dùng thứ tự `dd/mm/yyyy · hh:mm` theo giờ Việt Nam. Tên nguồn là liên kết gạch chân rõ hơn; URL vẫn lấy nguyên từ `evidence`. Bài cùng chủ đề chưa có trạng thái xác minh vẫn nằm ở mục riêng, không được gắn nhãn đã xác minh hoặc mức độ rủi ro.

## Review ảnh sau sửa

Ảnh cuối: [desktop](../../artifacts/fraud-alert/editorial-v3/after/feed-desktop.png) · [390px](../../artifacts/fraud-alert/editorial-v3/after/feed-mobile.png) · [320px](../../artifacts/fraud-alert/editorial-v3/after/feed-narrow.png).

Ở desktop, ảnh chính mô tả đúng yêu cầu chuyển phí tài khoản thay vì nhầm sang hồ sơ vay. Cảnh báo chính vẫn đứng cạnh ảnh, bài phụ giữ nhịp ngắn. Ở 390px, tiêu đề, ngày, hướng dẫn và liên kết dẫn chứng đều nằm trong màn đầu. Ở 320px, tiêu đề và hướng dẫn nằm trong màn đầu; một phần dẫn chứng cần cuộn thêm. Cả ba kích thước không tràn ngang. Bản chụp trung gian `artifacts/fraud-alert/editorial-v3/after-first/` ghi lại lỗi ghép hình đã được sửa trong pass cuối.

## Kiểm tra thực tế

- `node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json` — đạt.
- `node node_modules/eslint/bin/eslint.js apps/web/src/app/radar/page.tsx` — đạt.
- Next production build sạch bằng Node 24, dùng font cache cục bộ — đạt. Có cảnh báo cấu hình ESLint chưa nhận Next plugin; build vẫn thành công.
- Playwright với API fixture trên bản build cục bộ: `fraud-alert-ui.spec.ts` **11/11**; `radar-v2.spec.ts` và `ui-completion.spec.ts` **30/30**. Test kiểm tra 320/390px có tít và hướng dẫn trong màn đầu, nút Giám định hiện, ảnh đúng thủ đoạn, nguồn thiếu URL không thành link và cảnh báo chưa xác minh không xuất hiện như cảnh báo công bố.
- Playwright đã chụp 1440×900, 390×844, 320×844; `scrollWidth - innerWidth = 0` ở cả ba.

## Giới hạn

Minh họa gốc không phải ảnh từ nguồn dẫn chứng. Fixture `example.test` không chứng minh tính đúng của nguồn thực; đợt này không kiểm tra RSS hoặc dữ liệu production. Các thư mục `.next-*` dự phòng từ quá trình build vẫn nằm trong worktree, chưa xóa để bảo vệ trạng thái chưa commit.
