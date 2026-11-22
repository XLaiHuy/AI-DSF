# FinCopilot AI — Cheatsheet Chốt & Bản đồ Kim Chỉ Nam (Điểm Đọc Đầu Tiên)

> **Hướng dẫn dùng cho Người & AI Coding Agent:** Đọc file này đầu tiên để nắm toàn bộ phạm vi, kiến trúc, bản đồ sơ đồ và **6 quy tắc bất di bất dịch** trước khi mở bất kỳ file thiết kế hay viết dòng code nào.

---

## 1. Định vị & Tech Stack (Tóm tắt 2 dòng)
- **Định vị (Chủ đề 1 + Chủ đề 3 MoMo Tech Contest):** Trợ lý tài chính cá nhân toàn diện dùng hàng ngày, lấy **Phân hệ 3 (Forensic Auditor: Chat/PDF/VietQR + quy đổi APR thực + 7 Luật Cứng VN)** liên thông **Khảo sát & Tính toán xác định nhiều bên + DTI (Phân hệ 2)** làm mũi nhọn *White Space*.
- **Tech Stack:** **Next.js 15 (React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Recharts)** + **Node.js 22 (NestJS 11 + Fastify, TypeScript)** + **PostgreSQL 16 (Prisma ORM — 17 bảng)** + **Redis 7 / BullMQ** + **Multi-LLM Gateway** (Vercel AI SDK: **OpenAI primary**, fallback Gemini/Claude) + `decimal.js` + `sharp/zxing-wasm` + `unpdf/@napi-rs/canvas`.

---

## 2. Bảng Chức năng Cốt lõi (4 Phân hệ • 14 User Stories • 9 Màn hình)

| Phân hệ | Mã US | Chức năng cốt lõi trong MVP | Màn hình |
| :--- | :--- | :--- | :--- |
| **P0. Hồ sơ & Auth** | `US-pf01..02` | Dùng ngay dạng **Guest-first** (`guest_session_id`), thiết lập Hồ sơ tài chính (Thu nhập, Chi phí, Nợ, Tiền nhàn rỗi, Khẩu vị rủi ro), đăng nhập tùy chọn (Email/Google) gộp lịch sử vào PostgreSQL. | `SCR-01`, `SCR-08` |
| **P1. Market & Threat Radar** | `US-r01`, `US-ro02`, `US-ro3` | Cron cào RSS/Web (CafeF, VnEconomy, Vietstock, NHNN, NCSC) + Dedup 2 tầng; khóa độ tươi khi nguồn lỗi; AI tách bạch **Dữ kiện gốc vs Nhận định AI** (nhánh `R07` cá nhân hóa); trích xuất `threat_indicator` nạp sang P3. | `SCR-02`, `SCR-03`, `SCR-09` |
| **P2. Survey & Calculator** | `US-lo01..04`, `US-inv01..02` | **3 chế độ:** (1) Khảo sát & Tính Vay nhiều bên, (2) Khảo sát & Tính Tích lũy/Đầu tư an toàn (Tiết kiệm, Ví tích lũy, Quỹ mở UBCKNN — 3 kịch bản), (3) Nhập tay & So sánh. Dùng **Hybrid Catalog (~18 tổ chức chuẩn hóa) + Web fallback có nhãn** + **Trust Filter** + Tính `decimal.js` (EMI, Gốc đều, Lãi phẳng ➔ APR thực, DTI 4 ngưỡng, Sốc lãi thả nổi). | `SCR-04`, `SCR-05`, `SCR-09` |
| **P3. Forensic Auditor** *(Mũi nhọn MVP)* | `US-fa01..03` | Upload đa phương thức (**Ảnh Chat + PDF digital/scan + Ảnh VietQR + Text**) ➔ Giải mã **VietQR EMVCo/NAPAS 247** (`BIN`, `STK`, `QRIBFTTA`, tiền, nội dung, CRC-16) + **AI Vision** đọc tên chủ TK & điều khoản + **7 Luật Cứng VN** + Quy đổi APR thực + Xuất Bằng chứng + Tự hủy file gốc & che PII + **1-click sang P2**. | `SCR-06`, `SCR-07` |

---

## 3. Bốn Luồng Khép kín, 7 Luật Cứng & 4 Ngưỡng DTI

- **4 Cầu nối liên thông:**
  1. `P1 Lãi suất` ➔ `P2 Mô phỏng cú sốc lãi suất (Δr)`
  2. `P1 Cảnh báo NCSC` ➔ `P3 Nạp threat_indicator cho RULE_05`
  3. `P3 Phán quyết bẫy vay` ➔ `P2 1-Click tìm nguồn vay hợp pháp & DTI`
  4. `P2 Trust Filter chặn app/sàn lạ` ➔ `P3 Giám định hợp đồng/QR`
- **7 Luật Cứng (`RULE_01..07`):** `01` Phí giải ngân trước qua QR (`CRIT`) | `02` Kịch bản lỗi 102 / đóng băng vốn (`CRIT`) | `03` Lệch pháp nhân công ty vs TK cá nhân `QRIBFTTA` (`CRIT`) | `04` Không phép NHNN/UBCKNN hoặc mạo danh (`HIGH/CRIT`) | `05` Trùng `threat_indicator` NCSC (`CRIT`) | `06` Bẫy lãi phẳng / APR vượt trần Điều 468 BLDS 20% hay mặt bằng CTTC (`HIGH`) | `07` Cam kết lãi Ponzi phi lý (`CRIT`).
- **Phán quyết 3 mức:** `0–29 AN TOÀN` | `30–69 CẦN THẬN TRỌNG` | `70–100 NGUY HIỂM CAO` *(có bất kỳ luật `CRITICAL` nào ➔ khóa cứng điểm `>= 75`, cấm AI hạ mức)*.
- **4 Ngưỡng DTI:** `<35% SAFE` | `35–45% MODERATE` | `45–50% HIGH_PRESSURE` | `>50% CRITICAL_OVERLOAD`.

---

## 4. Bản đồ Toàn bộ Tài liệu & Sơ đồ Đồng bộ (`docs/specs/` — `10 File + 5 File Nguồn`)

| File trong `docs/specs/` | Nội dung & Sơ đồ bên trong | Giao cho ai / Đọc khi nào |
| :--- | :--- | :--- |
| [00_CHEATSHEET_CHOT.md](file:///D:/Documents/OU-TongHop-Project/MoMo/docs/specs/00_CHEATSHEET_CHOT.md) | Tóm tắt 1 trang toàn bộ chức năng, sơ đồ & quy tắc chốt | **Đọc đầu tiên** (cả người & Agent) |
| [01_DeBai_YeuCau_NghiepVu.pdf](file:///D:/Documents/OU-TongHop-Project/MoMo/docs/specs/01_DeBai_YeuCau_NghiepVu.pdf) | Đề bài, White Space, 8 chương nghiệp vụ, Công thức toán, 14 US, Demo 5 phút | PM / BA / Thuyết trình / Kiểm chứng nghiệp vụ |
| [02_Flowchart_Wireframe.md](file:///D:/Documents/OU-TongHop-Project/MoMo/docs/specs/02_Flowchart_Wireframe.md) | 5 System Flowcharts (Mermaid) + Sitemap + Wireframe 9 màn hình `SCR-01..09` | Frontend & Backend nắm luồng điều hướng |
| [03_TechStack_KienTruc_ERD.md](file:///D:/Documents/OU-TongHop-Project/MoMo/docs/specs/03_TechStack_KienTruc_ERD.md) | Tech Stack Node.js + Multi-LLM, Kiến trúc 4 Tầng, ERD 17 bảng (Mermaid + DBML), REST API, Monorepo | Tech Lead / Backend / Database / DevOps |
| [04_UI_Prototype.html](file:///D:/Documents/OU-TongHop-Project/MoMo/docs/specs/04_UI_Prototype.html) | **Interactive Prototype** mở trình duyệt chạy thử đủ 9 màn hình + 3 Theme + Toán JS thật | Designer / Frontend / Demo sớm với BGK |
| [05_Agent_Coding_Spec.md](file:///D:/Documents/OU-TongHop-Project/MoMo/docs/specs/05_Agent_Coding_Spec.md) | **3 Sequence Diagrams + 3 State Machines + JSON Contracts + Prompt Guardrails + Golden Test Vectors (TDD) + Seed ~18 Tổ chức VN** | **Bắt buộc đọc trước khi code Backend, AI Gateway & Unit Tests** |
| [06_Work_Breakdown_Plan.md](file:///D:/Documents/OU-TongHop-Project/MoMo/docs/specs/06_Work_Breakdown_Plan.md) | Phân công Vertical Slice (Lead / Tân / Tài), 4 Ổ cắm Liên kết, Checklist Dựng khung Repo | Toàn team (trước khi chia nhánh & dựng code) |
| [ERD.png](file:///D:/Documents/OU-TongHop-Project/MoMo/docs/specs/ERD.png) | Ảnh sơ đồ ERD mới 17 bảng chia 4 cụm màu (`sources/erd.dbml`, `sources/erd.svg`) | Tham chiếu nhanh DB & chèn Slide |
| [System-architect.png](file:///D:/Documents/OU-TongHop-Project/MoMo/docs/specs/System-architect.png) | Ảnh sơ đồ Kiến trúc 4 Tầng / 5 Modules (`sources/system-architect.mmd`, `.svg`) | Tham chiếu nhanh Kiến trúc & chèn Slide |
| [UserStory.pdf](file:///D:/Documents/OU-TongHop-Project/MoMo/docs/specs/UserStory.pdf) | 14 User Stories (Epic 0–3) + 4 User Flow thẻ màu trực quan (`sources/user-story.html`) | Kiểm thử Acceptance Criteria & chèn báo cáo |

---

## 5. Sáu Quy tắc Bất di Bất dịch khi Giao AI Coding Agent

1. **Cấm tính tiền bằng JS `Number` hoặc giao phép tính cho LLM** — 100% phép tính tài chính đi qua `packages/financial-math` (`decimal.js`).
2. **Cấm AI hạ mức cảnh báo (`Deterministic Override`)** — chỉ cần >= 1 luật `CRITICAL` kích hoạt, điểm rủi ro tối thiểu `75` và phán quyết cứng là `HIGH_RISK`.
3. **Bắt buộc `finally {}` xóa tệp ảnh/PDF gốc** ngay sau bước trích xuất và che CCCD/SĐT trước khi ghi vào PostgreSQL hoặc log.
4. **Cấm gọi thẳng SDK OpenAI rải rác trong module nghiệp vụ** — mọi lời gọi LLM phải qua `AiGatewayModule` (Vercel AI SDK + Zod + Circuit Breaker hỗ trợ fallback Gemini/Claude).
5. **Tuân thủ tuyệt đối Guardrails hiển thị** — không đẩy tin cũ làm mới khi RSS lỗi; luôn tách *Dữ kiện gốc* vs *Nhận định AI*; luôn gắn nhãn *Đã chuẩn hóa* vs *Tham khảo web*.
6. **Phải Pass 100% Golden Test Vectors (`V1..V5`)** trong `05_Agent_Coding_Spec.md` trước khi đánh dấu hoàn thành module.
