# AI-DSF — FinCopilot AI

**FinCopilot AI** is a personal wealth, credit comparison, and anti-scam forensic copilot built as a `pnpm` + Turborepo monorepo. It connects market/threat intelligence, deterministic `decimal.js` loan/investment/refinance mathematics, and multi-modal VietQR & loan contract forensics inside a unified editorial workspace.

---

## What FinCopilot AI Does

1. **Unified Editorial Workspace & Performance Shell**
   - Uses a persistent `AppShell` and sidebar (`DeskNavigation`) across `/`, `/radar`, `/forensic`, `/survey`, `/profile`, and `/admin` for instant navigation without layout jumps or redundant API focus refetches.
   - Public read endpoints use bounded Redis + HTTP cache headers (`Cache-Control: public, ...`), while private session/audit/profile routes remain strictly `no-store`.
   - Heavy Recharts visualizations on `/survey` are lazy-loaded via `next/dynamic` only when simulation results are rendered.

2. **Profile & Financial Health Copilot (`/profile`)**
   - Supports Email/Password auth, Google & GitHub OAuth, signed `HttpOnly` guest sessions with automatic merge on login, and WebP portrait avatars processed & cropped safely via `sharp`.
   - Evaluates emergency fund runway, DTI headroom, and personalized next-step suggestions backed by grounded `Decimal` numbers and strict anti-identifier-leak guards.

3. **Market & Threat Radar (`/`, `/radar`, `/radar/[id]`)**
   - Ingests market news and official scam advisories from **8 configured sources** in `config/sources.yaml` (CafeF, VnEconomy, Vietstock, NHNN, Tín nhiệm mạng / NCSC, Tin giả VN / A05, VnExpress Pháp luật, Dân Trí Pháp luật).
   - Displays **Tóm tắt nhanh trong ngày**, an independent dual-axis **Mặt bằng lãi suất & lợi suất** benchmark chart (`LOAN` vs `INVESTMENT` with package counts and medians), **Cảnh báo & Tài chính** rail, and **`ThreatTrendBoard`** (7 / 30 / 90-day verified trend board tagged with `VN-AIS-01..24`, `GASA`, and target-audience filters, enforcing `minSample >= 3` and `>= 50%` growth guards with zero fabricated stats).

4. **Financial Survey, Precision Calculator & Refinance X-Ray (`/survey`)**
   - Powered by pure `Decimal` math (`packages/financial-math`): EMI, declining principal, flat-rate to APR/EAR IRR conversion, DTI risk bands, DCA open-end fund scenarios, and **Contract Refinance Break-Even (`simulateRefinanceBreakEven`)**.
   - Includes **4 modes**: `Khảo sát vay`, `Đầu tư / tích lũy`, `Tự nhập so sánh`, and **`Đổi khoản vay / Đảo nợ`** (with 1-click ownership-checked handoff from any audited loan contract in `/forensic` to compare against top NHNN-licensed banks).
   - Enforces a Trust Filter that redirects suspicious or unlisted entities straight to `/forensic`.

5. **Contract & VietQR Forensics — FERS v1 (`/forensic`, `/forensic/[id]`)**
   - **3-layer conversational router** (`forensic-conversation` + Redis 2h TTL session store + fail-closed entity-preserving token compressor + OpenRouter JEV / Fast-LLM / deterministic offline fallback) with emergency scam-recovery checklists.
   - Processes images, VietQR/EMVCo/crypto QR codes (`sharp` + `zxing-wasm`), and PDFs (`unpdf`), then purges uploaded buffers immediately.
   - Produces **`FERS-v1`** assessments combining:
     - **4-tier action scale (`T0–T3`) × NATO Admiralty evidence confidence (`A1–D4`)** with strict **Epistemic Abstention** (never labels insufficient `D4` input as `T0` safe).
     - **3 groups / 24 VN-AIS scam categories** (`VN-AIS-01..24` from Cục ATTT) & **GASA** taxonomy.
     - Plain Vietnamese UI with a concise `?` methodology explainer, expandable/printable **"Sổ bằng chứng & Chuẩn đối chiếu"**, and PII-redacted **OASIS STIX 2.1 JSON** export (`/api/v1/forensic/audits/:id/export?format=stix`).
   - Collects user accuracy feedback into a human-reviewed Continual Learning queue.

6. **Admin Operations Console (`/admin`)**
   - Role-guarded (`ADMIN`) dashboard to trigger **`Hot Crawl All`**, manage 4 BullMQ schedulers (Radar 15m, Threat intake 24h, Product catalog sync 24h, DB maintenance 24h), review/approve scam alerts & user feedback, and monitor **Rolling Drift**.

7. **Security Hardening**
   - Cross-origin mutating-request guard (`403`), Content-Security-Policy & security headers in Next.js + Fastify, Redis sliding-window `RateLimitGuard` on auth/forensic/avatar endpoints, `private` + `CORP: same-site` avatar delivery, strict Zod DTO validation, PII masking, and offline Security Red-Team + `test:ai-e2e` suites.

---

## Tech Stack

| Layer | Technologies |
| --- | --- |
| **Monorepo** | `pnpm 10.33.2`, Turborepo, TypeScript 5.9 |
| **Backend (`apps/api`)** | NestJS 11, Fastify (`@fastify/cookie`, `@fastify/multipart`), Prisma 6 (PostgreSQL 16, **12 migrations**), BullMQ + `ioredis` (Redis 7), `sharp`, `zxing-wasm`, `unpdf`, Zod |
| **Frontend (`apps/web`)** | Next.js 15 (App Router), React 19, Tailwind CSS v4, shadcn/ui, TanStack Query, Recharts, `lucide-react` |
| **Math & Testing** | `decimal.js`, Vitest (`@fincopilot/financial-math`, `apps/api`), Playwright (`tests/e2e`), `e2e` (`tests/ai-e2e`) |
| **Infrastructure** | Docker Compose (`postgres:16-alpine`, `redis:7-alpine`) |

---

## Repository Structure

```text
AI-DSF/
├── apps/
│   ├── api/                  # NestJS 11 + Fastify (:4000), Prisma schema, 12 migrations & seed scripts
│   └── web/                  # Next.js 15 App Router (:3000), persistent AppShell & editorial pages
├── packages/
│   ├── shared-types/         # Shared Zod DTOs, enums, route handoffs & AI gateway contracts
│   └── financial-math/       # Pure TypeScript + decimal.js formulas & Vitest specs
├── config/
│   ├── sources.yaml          # 8 Radar & forensic reference sources
│   └── ai-routing.yaml       # Multi-LLM task routing (primary + fallbacks)
├── docs/specs/               # Architecture, ERD, API contracts & specs
├── tests/
│   ├── e2e/                  # Playwright Chromium suites (1280px, 390px, 320px)
│   └── ai-e2e/               # Strict-cache AI-E2E smoke suite (e2e.config.ts)
└── e2e.config.ts             # Offline cache-only e2e runner configuration
```

---

## Getting Started & Test Data Setup (For Teammates)

### Prerequisites

- **Node.js** `>= 24`
- **pnpm** `10.33.2` (`corepack enable`)
- **Docker Desktop** (for PostgreSQL 16 and Redis 7)

### 1. Clone or Switch to This Branch

```bash
git clone -b feat/unified-editorial-ux-survey-ops https://github.com/XLaiHuy/AI-DSF.git
cd AI-DSF
```

Or if you already cloned the repo:

```bash
git fetch origin
git checkout feat/unified-editorial-ux-survey-ops
git pull origin feat/unified-editorial-ux-survey-ops
```

### 2. Configure `.env`

```powershell
# PowerShell
Copy-Item .env.example .env
```

```bash
# macOS / Linux
cp .env.example .env
```

> **Notes:**
> - Replace `JWT_SECRET` in `.env` with a local random string before testing login/OAuth.
> - AI provider keys (`OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`) and OAuth keys (`GOOGLE_*`, `GITHUB_*`) can stay **empty** — core deterministic calculation, `FERS-v1` forensics, Radar, Survey, and Admin workflows still work offline.
> - Default seeded Admin credentials (from `.env.example` / `prisma/seed.ts`): **`admin@fincopilot.vn`** / **`Admin@FinCopilot2026!`** (and in non-production mode without `ADMIN_API_KEY`, `AdminGuard` also accepts local development auth via logged-in `ADMIN` session). **Never commit `.env` to Git.**

### 3. Install Dependencies, Start Postgres/Redis & Apply All 12 Migrations + Seed

```bash
pnpm install
docker compose up -d --wait
pnpm --filter api exec prisma migrate deploy
pnpm db:seed
pnpm --filter api exec prisma migrate status
```

What these commands set up in your local PostgreSQL database:
- **`prisma migrate deploy`**: Applies all **12 migrations** through `20261127020000_threat_alert_taxonomy_trends` (`migrate status` must report `Database schema is up to date!`).
- **`pnpm db:seed`**: Seeds idempotently:
  - Admin user (`admin@fincopilot.vn`)
  - **8 configured Radar sources** (`config/sources.yaml`)
  - **18 NHNN/UBCKNN-licensed institutions** & **31 reference financial products** (initially inactive until synced/verified from sources).

### 4. Start the Application

**Option A — Standard Dev Mode:**

```bash
pnpm dev
```

**Option B — Smooth Production-Web Local Mode (best to feel Phase 0 navigation speed):**

```bash
pnpm build
```
Then run in two terminals:
```bash
# Terminal 1 (API on :4000)
pnpm --filter api dev

# Terminal 2 (Production Web on :3000)
pnpm --filter web start
```

> **Important note if you run Playwright (`pnpm test:e2e`) before Option B:** Playwright rebuilds `apps/web/.next` targeting `API_PORT=4400`. Always re-run `pnpm --filter web build` before `pnpm --filter web start` so `/api/v1/*` proxies to `:4000` again.

- **Web App:** `http://localhost:3000`
- **API Health Check:** `http://localhost:4000/api/v1/health`

### 5. Populate Live Market & Scam Data to Test Everything (2-Minute Checklist)

1. **Sync real articles, bank rates & alert drafts (1-click):**
   - Open `http://localhost:3000/admin` and log in with `admin@fincopilot.vn` / `Admin@FinCopilot2026!`.
   - Go to **Nguồn dữ liệu & Kho sản phẩm** → click **Quét nóng toàn bộ** (`Hot Crawl All`) to fetch Radar articles and sync/activate live interest rates (populates the Benchmark chart, Survey, and Refinance bank comparison).
   - Optionally open **Kiểm duyệt, Góp ý & R&D** to approve/publish 1–2 alerts so the Radar **Cảnh báo** tab & **Xu hướng thủ đoạn (`ThreatTrendBoard`)** display verified alerts.
2. **Test Forensics + Refinance instantly with 5 built-in samples:**
   - Open `http://localhost:3000/forensic` and click any sample chip (e.g., **`Lãi phẳng và phí giữ lại`** or **`Bẫy lỗi 102`**).
   - Inspect the `FERS-v1` assessment, click **`?`**, expand **`Sổ bằng chứng & Chuẩn đối chiếu`**, download **STIX 2.1 JSON**, then click **`So sánh hợp đồng này với ngân hàng`** to jump straight into the `/survey?mode=refinance` break-even calculator.

---

## Useful Scripts & Verification Commands

| Command | Description |
| --- | --- |
| `pnpm dev` | Run `apps/api` (`:4000`) and `apps/web` (`:3000`) in watch mode |
| `pnpm build` | Build all packages and apps |
| `pnpm typecheck` | Run TypeScript checks across the monorepo |
| `pnpm lint` | Run ESLint across all 4 packages |
| `pnpm --filter @fincopilot/shared-types build` | Build shared Zod schemas & contracts |
| `pnpm --filter @fincopilot/financial-math test` | Run pure `decimal.js` financial math unit tests (18 tests) |
| `pnpm --filter api test` | Run API unit, security red-team, FERS, trends & 101-case benchmark suite (562 tests) |
| `pnpm db:migrate` | Create/apply Prisma migrations in dev (`prisma migrate dev`) |
| `pnpm --filter api exec prisma migrate deploy` | Apply all committed migrations cleanly |
| `pnpm db:seed` | Seed admin account, 8 sources, 18 institutions & 31 reference products |
| `pnpm test:e2e` | Run Playwright Chromium E2E suite (93 tests across 1280px, 390px, 320px) |
| `pnpm test:ai-e2e` | Run offline strict-cache AI-E2E smoke check (`E2E_TELEMETRY_DISABLED=1`) |

---

## Branching Workflow & Contributors

### Git Branching Model

- **`dev`**: Active integration branch. Feature branches merge into `dev`.
- **`feat/unified-editorial-ux-survey-ops`**: Integrated workspace, security hardening, Phase 0–3 R&D upgrades (`FERS-v1`, Refinance X-Ray, `VN-AIS` Threat Trends).
- **`main`**: Protected release branch.

### Team & Module Ownership

| Contributor | Branch | Subsystem | Owned Paths & Responsibilities |
| --- | --- | --- | --- |
| **Huy** | `dev`, `feat/p3-forensic` | **Platform Core (P0) & Forensics (P3)** | Root configs, `packages/shared-types/**`, `apps/api/prisma/schema.prisma`, `apps/api/src/common/**`, `ai-gateway`, `profile-auth`, `forensic` (`FERS-v1`, `STIX 2.1`, QR/PDF, PII purge), `AppShell`, and pages `/`, `/profile`, `/forensic`. |
| **Tân** | `feat/p2-survey-calc` | **Survey & Financial Math (P2)** | `packages/financial-math/**` (`decimal.js` formulas & Refinance Break-Even), `apps/api/src/modules/survey-calc/**`, `apps/web/src/app/survey/**`, and `apps/web/src/components/survey/**`. |
| **Tài** | `feat/p1-radar-admin` | **Radar, Admin, Seed & E2E (P1)** | `apps/api/prisma/seed.ts`, `apps/api/src/modules/radar/**` (BullMQ cron, 2-tier dedup, `ThreatTrendBoard`), `apps/api/src/modules/admin/**`, `apps/web/src/app/{radar,admin}/**`, `apps/web/src/components/{radar,admin}/**`, and `tests/e2e/**`. |

---

## Specifications & Documentation

- [Project Cheatsheet & Rules](docs/specs/00_CHEATSHEET_CHOT.md)
- [Tech Stack, Architecture & ERD](docs/specs/03_TechStack_KienTruc_ERD.md)
- [Agent Coding Spec, API Contracts & Golden Vectors](docs/specs/05_Agent_Coding_Spec.md)
- [Work Breakdown Plan & Integration Sockets](docs/specs/06_Work_Breakdown_Plan.md)
