# FINCOPILOT — Design System

Phiên bản 1.0 · Ngôn ngữ giao diện cho Radar và các màn hiện hữu liên quan. Dựa trên Be Vietnam Pro, JetBrains Mono, Tailwind CSS v4 và các component hiện có.

## Nguyên tắc

- **Đọc trước trang trí:** hierarchy được tạo từ kiểu chữ, căn chỉnh và khoảng cách.
- **Nguồn gốc trước kết luận:** source, published time, collected time và trạng thái xác minh được ghi tên tường minh.
- **Dữ liệu thiếu được nói là thiếu:** không thay bằng zero, trạng thái khỏe, giá trị lãi suất hay câu trả lời AI giả.
- **Mỗi trang có mật độ đúng tác vụ:** feed biên tập; admin bảng điều phối; handoff gọn; Home là điểm vào.

## Tokens

### Typography

| Token | Giá trị | Quy tắc |
|---|---|---|
| `font-ui` | Be Vietnam Pro | Nội dung tiếng Việt, label, nút, điều hướng |
| `font-data` | JetBrains Mono | Chỉ tiền, tỷ lệ, delta, ID và mốc kỹ thuật |
| `type-display` | 32–36 px desktop; 28–32 px mobile | H1, weight 650–700, line-height 1.15–1.25 |
| `type-section` | 18–22 px | H2/H3, weight 600–650 |
| `type-body` | 14–16 px | Nội dung chính, line-height 1.55–1.7 |
| `type-meta` | 12–13 px | Nguồn/thời gian, tương phản đọc được |

Không dùng serif hệ thống cho headline vì glyph/dấu tiếng Việt không đồng bộ. Số có `font-variant-numeric: tabular-nums`.

### Màu

| Token | Giá trị | Ý nghĩa |
|---|---|---|
| `canvas` | `#F6F7F4` | Nền app trung tính hơi ấm |
| `surface` | `#FFFFFF` | Bề mặt cần phân biệt, dùng tiết chế |
| `ink` | `#13221C` | Nội dung chính |
| `muted-ink` | `#4F635A` | Nội dung phụ nhưng vẫn dễ đọc |
| `rule` | `#DCE4DE` | Ranh giới bảng/nhóm |
| `brand` | `#145C46` | Điều hướng/hành động chính |
| `caution` | `#8A5A08` | Chưa xác minh/cần chú ý, luôn có nhãn chữ |
| `danger` | `#A62D25` | Rủi ro/nguy cơ, luôn có nhãn chữ |
| `verified` | `#176B49` | Trạng thái xác minh được xác nhận |

Không lấy màu của nguồn đáng tin làm trạng thái đã xác minh. Không dùng đỏ/xanh làm tín hiệu duy nhất.

### Layout và spacing

- Bậc spacing: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 px.
- Shell desktop: topbar cố định theo luồng, sidebar 15–16 rem, nội dung co giãn; vùng đọc tối đa khoảng 1120 px.
- Cột bài viết: 640–760 px để giữ độ dài dòng phù hợp; metadata đứng sát title.
- Mobile: một cột, padding 16–20 px, bottom bar 4 mục và safe-area inset; menu “Thêm” không che nội dung.
- Bảng: row cao tối thiểu 44 px; cột số căn phải, chữ căn trái; nếu cần cuộn ngang thì phải có nhãn chỉ dẫn vùng cuộn.

### Radius và elevation

- Input/control: radius 6 px; menu/panel: 8 px; card chứa form tối đa 10 px.
- Feed và danh sách evidence dùng nền phẳng + đường kẻ, không bọc từng dòng thành card.
- Elevation chỉ dành cho menu/overlay; tránh shadow trang trí trên bề mặt tĩnh.

## Component rules

| Thành phần | Quy tắc |
|---|---|
| Navigation | 4 điểm đến chính; mục phụ trong menu; `aria-current`; nhãn dễ đọc và focus rõ. |
| Button | Một primary action mỗi vùng; secondary nhẹ; min-height 40–44 px; loading không đổi ngữ nghĩa. |
| Input/filter | Label truy cập được, placeholder không thay label, focus ring rõ, lọc hiển thị trạng thái chọn. |
| Article row | Category nhỏ, headline chính, published time và nguồn, action một lần; không nhồi chip. |
| Provenance | Link nguồn, thời gian công bố và lần thu thập là các trường riêng. |
| AI assessment | Heading nêu “Nhận định AI”; tách fact/assumption/citation; không tạo dẫn chứng. |
| Alert | Hiển thị verification status, dấu hiệu và evidence thành nhóm khác nhau; trạng thái có text. |
| Admin table | Header rõ, trạng thái lỗi/chưa chạy/phát sinh tác vụ bằng chữ; action nằm cùng hàng nguồn. |
| Empty/error/loading | Nói rõ dữ liệu đang tải, chưa có, lỗi, hoặc API chưa cung cấp; retry khi có hành động hỗ trợ. |

## Responsive và accessibility

- Breakpoints kiểm tra: 390 px (mobile), 768 px (tablet), 1440 px (desktop).
- Không tràn ngang ngoài vùng bảng có kiểm soát; không để fixed nav che nội dung/focus.
- Landmark HTML không lồng sai; heading phân cấp tuần tự; link có mục đích rõ.
- Tương tác bằng bàn phím, focus-visible, skip link, trạng thái không chỉ dựa màu.
- Tôn trọng `prefers-reduced-motion`; animation trang trí không cần thiết thì không dùng.
- Kiểm tra tương phản chữ thường mục tiêu tối thiểu WCAG AA khi có thể đo bằng tooling.

## Token áp dụng trong code

Các token nền tảng hiện ở `apps/web/src/app/globals.css`. Bản redesign có thể thêm semantic tokens hoặc class component-local, nhưng không nhân đôi biến màu nếu token hiện tại đã đúng. Các giá trị ở bảng trên là chuẩn ngôn ngữ thiết kế; thay đổi token toàn cục cần rà soát tất cả route vì các component UI còn được dùng ở trang scaffold ngoài phạm vi.
