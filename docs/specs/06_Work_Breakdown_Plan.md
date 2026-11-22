# FinCopilot AI — Kế hoạch Chia Việc & Dựng Khung Monorepo (06)

> **Vai trò tài liệu:** Quy định ranh giới phân công **3 thành viên (Bạn/Lead — Tân — Tài)** theo chiều dọc (**Vertical Slice**) nhằm tránh tuyệt đối merge conflict khi làm việc với AI Coding Agent, đồng thời chốt **4 Ổ cắm Liên kết** và **Checklist Dựng Khung Codebase** trước khi push lên Git (`main`). Toàn bộ thiết kế tuân thủ chặt chẽ bộ đặc tả trong `docs/specs/` ([00_CHEATSHEET_CHOT.md](file:///D:/Documents/OU-TongHop-Project/MoMo/docs/specs/00_CHEATSHEET_CHOT.md), [01_DeBai_YeuCau_NghiepVu.pdf](file:///D:/Documents/OU-TongHop-Project/MoMo/docs/specs/01_DeBai_YeuCau_NghiepVu.pdf), [03_TechStack_KienTruc_ERD.md](file:///D:/Documents/OU-TongHop-Project/MoMo/docs/specs/03_TechStack_KienTruc_ERD.md), [05_Agent_Coding_Spec.md](file:///D:/Documents/OU-TongHop-Project/MoMo/docs/specs/05_Agent_Coding_Spec.md)).

---

## Phần 1. Phân công Vertical Slice & Ranh giới Thư mục (Zero-Conflict Ownership)

| Thành viên | Phạm vi Nghiệp vụ & Kỹ thuật | Tỷ trọng | Nhánh Git | Thư mục / File Được phép Sửa (Độc lập) |
| :--- | :--- | :---: | :--- | :--- |
| **Bạn (Lead)** | **1. Khung Codebase & Infra:** Monorepo (`pnpm` + `Turborepo`), `docker-compose.yml` (PG16 + Redis7), `.env.example`, `README.md`, `prisma/schema.prisma` (17 bảng), `packages/shared-types`<br>**2. Module dùng chung & P0:** `AiGatewayModule` (OpenAI Primary + Fallback), `ProfileAuthModule` (Guest/Auth + `R07`), App Shell + `SCR-01` + `SCR-08`<br>**3. Phân hệ 3 (Mũi nhọn MVP):** `ForensicModule` (`sharp/zxing-wasm`, `unpdf/canvas`, 7 Luật Cứng, PII Purge) + `SCR-06`, `SCR-07` | ~36% | `main` (khung)<br>`feat/p3-forensic` | • Root configs (`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `docker-compose.yml`, `.env.example`, `README.md`)<br>• `packages/shared-types/**`<br>• `apps/api/prisma/schema.prisma`<br>• `apps/api/src/common/**`<br>• `apps/api/src/modules/ai-gateway/**`<br>• `apps/api/src/modules/profile-auth/**`<br>• `apps/api/src/modules/forensic/**`<br>• `apps/web/src/app/(main)/page.tsx`, `profile/**`, `forensic/**`, `src/components/layout/**`, `src/lib/api-client.ts` |
| **Tân** | **Trọn bộ Phân hệ 2 (Survey & Calculator):**<br>• `packages/financial-math` (`decimal.js`: EMI, Gốc đều, Lãi phẳng ➔ APR/EAR, DTI, Lãi kép + Quỹ mở) + Vitest pass **Golden Vectors `V1..V4`**<br>• `SurveyCalcModule` (Trust Filter, Hybrid Catalog + Web fallback, Rate Shock)<br>• Giao diện `SCR-04` (3 tabs) & `SCR-05` (Bảng đối chiếu, Biểu đồ, Lịch nợ, DTI Gauge, Sốc lãi) | ~32% | `feat/p2-survey-calc` | • `packages/financial-math/**`<br>• `apps/api/src/modules/survey-calc/**`<br>• `apps/web/src/app/(main)/survey/**`<br>• `apps/web/src/components/survey/**` |
| **Tài** | **Trọn bộ Phân hệ 1 + Admin + Seed & E2E:**<br>• `RadarModule` (Cron RSS/Web 5 nguồn, Dedup 2 tầng, Freshness Lock, R07 Impact, sinh `threat_indicator`)<br>• Giao diện `SCR-02`, `SCR-03`<br>• `AdminModule` + `SCR-09` (`/admin`)<br>• `apps/api/prisma/seed.ts` (5 nguồn + 18 tổ chức/sản phẩm + mẫu NCSC) & Bộ test E2E 4 luồng | ~32% | `feat/p1-radar-admin` | • `apps/api/src/modules/radar/**`<br>• `apps/api/src/modules/admin/**`<br>• `apps/api/prisma/seed.ts`<br>• `apps/web/src/app/(main)/radar/**`, `admin/**`<br>• `apps/web/src/components/radar/**`, `admin/**`<br>• `tests/e2e/**` |

> **Quy tắc chống Conflict tuyệt đối:**
> 1. Sau khi Lead dựng khung và push `main`, Tân và Tài chỉ code trong thư mục thuộc quyền sở hữu của mình.
> 2. Không ai tự ý sửa `apps/api/prisma/schema.prisma`, `packages/shared-types`, `docker-compose.yml` hay `apps/web/src/components/layout/` khi chưa báo Lead cập nhật lên `main`.

---

## Phần 2. Bốn "Ổ cắm" Liên kết Bắt buộc khi Dựng Khung (Integration Contracts)

Khi Lead tạo khung empty modules để push lên Git, 4 ổ cắm sau được dựng hoàn chỉnh từ đầu để khi từng người code xong phần mình thì toàn hệ thống tự khớp nối:

1. **Ổ cắm 1 — `packages/shared-types` (Khóa Contract & Zod Schemas):**
   - Xuất sẵn các schema & type chuẩn từ `05_Agent_Coding_Spec.md`: `FinancialProfileDto`, `SurveyLoanRequest/Response`, `SurveyInvestRequest/Response`, `ForensicAuditResponse`, `RadarArticleDetailResponse`, `ApiErrorCode` (`ERR_INVALID_FILE_MAGIC`, `ERR_TRUST_FILTER_BLOCKED`...), `RouteHandoffParams`.
   - Khai báo Interface `IAiGatewayService` (`generateStructured(taskType, zodSchema, payload)`) để Tài và Tân dùng ngay qua DI hoặc mock khi chưa có OpenAI Key.

2. **Ổ cắm 2 — NestJS Cross-Module Boundaries (Không phụ thuộc vòng):**
   - `AiGatewayModule` đánh dấu `@Global()`: Export `AiGatewayService` cho cả `RadarModule` (Tài), `SurveyCalcModule` (Tân), và `ForensicModule` (Lead).
   - `ProfileAuthModule` đánh dấu `@Global()` (hoặc import sạch): Export `ProfileAuthService.getActiveProfile(sessionCtx)` để `RadarModule` kiểm tra nhánh `R07` và `SurveyCalcModule` tự lấy thông số tính `DTI`.
   - **Cầu nối Luồng 2 (P1 ➔ P3):** `RadarModule` ghi các chỉ dấu đã xác minh vào bảng PostgreSQL `threat_indicator`; `ForensicModule` truy vấn trực tiếp bảng `threat_indicator` và `financial_institutions` thông qua `PrismaService` (`@Global()`) ➔ **zero circular dependency giữa 2 module**.

3. **Ổ cắm 3 — Frontend URL Query Handoff (4 Cầu nối khép kín):**
   Định nghĩa hằng số route & parser trong `packages/shared-types/src/routes.ts`:
   - **Luồng 1 (`SCR-03` của Tài ➔ `SCR-05` của Tân):** `/survey?mode=loan&shockDelta=-1.0&from=radar&articleId=...`
   - **Luồng 3 (`SCR-07` của Lead ➔ `SCR-05` của Tân):** `/survey?mode=loan&amount=50000000&term=24&from=forensic&auditId=...`
   - **Luồng 4 (`SCR-04` của Tân ➔ `SCR-06` của Lead):** `/forensic?claimedEntity=...&from=trust-filter`
   - **Quick Survey (`SCR-01` của Lead ➔ `SCR-05` của Tân):** `/survey?mode=loan&amount=...&term=...`

4. **Ổ cắm 4 — Shared API Client & Guest Session Cookie (`apps/web/src/lib/api-client.ts`):**
   - Middleware ở Backend tự cấp/đọc `guest_session_id` cookie hoặc Bearer JWT.
   - `apiClient` ở Frontend cấu hình sẵn `credentials: 'include'` và chuẩn parse lỗi `ApiError`. Tân và Tài chỉ gọi `apiClient.get(...)` / `apiClient.post(...)` là tự động ăn phiên Guest/User.

---

## Phần 3. Lộ trình Thực thi 3 Phase

| Phase | Bạn (Lead) | Tân (Phân hệ 2) | Tài (Phân hệ 1 + Admin + Seed) |
| :--- | :--- | :--- | :--- |
| **Phase 1: Dựng khung & Push `main`** | • Dựng Monorepo, `docker-compose.yml`, `.env.example`, `README.md`<br>• Viết `schema.prisma` 17 bảng & chạy migrate<br>• Dựng 5 empty NestJS modules (`+ AdminModule`), Next.js App Shell, `shared-types` & 4 ổ cắm | • Pull `main`, đọc kỹ `05_Agent_Coding_Spec.md` Phần 3, 4, 5 (`V1..V4`) | • Pull `main`, chuẩn bị link RSS/Web 5 nguồn & danh sách 18 tổ chức Seed |
| **Phase 2: Code Độc lập (Song song 100%)** | • Code `AiGatewayModule` (OpenAI + Fallback)<br>• Code `ProfileAuthModule` + `SCR-01`, `SCR-08`<br>• Code `ForensicModule` (`sharp/zxing-wasm`, `unpdf/canvas`, 7 Luật Cứng, PII Purge) + `SCR-06`, `SCR-07` | • Code `packages/financial-math` (`decimal.js`) + pass 100% Vitest `V1..V4`<br>• Code `SurveyCalcModule` (Trust Filter, Hybrid Catalog + Web, DTI, Shock)<br>• Code UI `SCR-04`, `SCR-05` | • Viết `prisma/seed.ts` (5 nguồn + 18 tổ chức/sản phẩm + mẫu NCSC)<br>• Code `RadarModule` (Cron BullMQ, Dedup, Freshness Lock, R07, `threat_indicator`)<br>• Code UI `SCR-02`, `SCR-03`, `SCR-09` (`/admin`) |
| **Phase 3: Merge & Test E2E 5 Phút** | • Review & Merge 3 nhánh vào `main`<br>• Verify **Luồng 3** (`SCR-07` ➔ `SCR-05`) & **V5 VietQR**<br>• Deploy Staging (Vercel + Railway/Neon) | • Verify **Luồng 1** (nhận `shockDelta` từ Radar) & **Luồng 4** (Trust Filter đẩy sang `SCR-06`)<br>• Chốt responsive bảng & biểu đồ `SCR-05` | • Chạy bộ E2E **Kịch bản Demo 5 phút** (`SCR-01 ➔ 02/03 ➔ 06/07 ➔ 05`)<br>• Verify Seed & Retry nguồn lỗi tại `SCR-09` |

---

## Phần 4. Checklist Nghiệm thu Khung Bàn giao (Definition of Ready)

Trước khi thông báo cho Tân và Tài pull nhánh `main` về code, bộ khung của Lead phải chạy thông suốt **4 điều kiện** sau trên local:
1. `docker compose up -d` ➔ Container `postgres:16-alpine` & `redis:7-alpine` chạy healthy.
2. `pnpm prisma migrate dev` ➔ Tạo thành công toàn bộ **17 bảng** trong PostgreSQL (khớp 100% `docs/specs/sources/erd.dbml`).
3. `pnpm dev` ➔ `apps/api` (`http://localhost:4000/api/v1/health`) trả `200 OK` cùng danh sách 6 module đã nạp; `apps/web` (`http://localhost:3000`) mở lên đầy đủ App Shell (Desktop Sidebar + Mobile Bottom Bar) với các route placeholder `/`, `/radar`, `/survey`, `/forensic`, `/profile`, `/admin`.
4. `git status` sạch sẽ; có đủ `.env.example`, `.gitignore`, `README.md` hướng dẫn chạy 1 lệnh cho Tân và Tài.
