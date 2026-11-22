# AI-DSF — FinCopilot AI

**FinCopilot AI** is a personal wealth, credit comparison, and anti-scam risk copilot built as a `pnpm` + Turborepo monorepo. It combines an AI-assisted financial planning workflow with deterministic financial mathematics, real-time market/threat radar ingestion, and VietQR / loan contract forensics.

---

## What FinCopilot AI Does

The platform connects four subsystems into a closed-loop user journey:

1. **Profile & Shared AI Gateway (`SCR-01`, `SCR-08` · `/`, `/profile`)**
   - Supports anonymous signed `HttpOnly` guest sessions and Google OAuth.
   - Stores personal financial context (`R07`: monthly income, expenses, existing debt, savings goals) used across Radar and Survey.
   - Routes AI tasks through a unified gateway (`config/ai-routing.yaml`) with OpenAI primary models, Gemini/Claude fallbacks, and PII masking.

2. **Market & Threat Radar (`SCR-02`, `SCR-03` · `/radar`, `/radar/[id]`)**
   - Collects market news and official alerts from 5 configured sources (`config/sources.yaml`: CafeF, VnEconomy, Vietstock, NHNN, NCSC).
   - Performs two-tier deduplication, evaluates personal `R07` impact, extracts verified threat indicators (`threat_indicator`), and passes interest-rate shock parameters to Survey.

3. **Financial Survey & Precision Calculator (`SCR-04`, `SCR-05` · `/survey`)**
   - Uses a deterministic `decimal.js` engine (`packages/financial-math`) for EMI, equal-principal schedules, flat-rate to APR/EAR conversion, DTI ratio, compound interest, and open-end fund projections.
   - Enforces a **Trust Filter** against verified financial institutions, redirecting suspicious entities directly to Forensics.
   - Visualizes loan comparisons, amortization schedules, DTI gauges, and rate-shock scenarios.

4. **Contract & VietQR Forensics (`SCR-06`, `SCR-07` · `/forensic`)**
   - Accepts transfer screenshots, VietQR codes (`sharp` + `zxing-wasm`), and loan contract PDFs (`unpdf`).
   - Evaluates **7 Hard Rules (`RULE_01..07`)** plus NCSC threat indicators to produce a 3-tier verdict (`Safe` / `Warning` / `Danger`), purges sensitive PII after processing, and hands off valid loan parameters to Survey.

5. **Admin Console (`SCR-09` · `/admin`)**
   - Monitors Radar ingestion status, triggers manual crawls/retries, and manages the financial product catalog (protected by `AdminGuard` / `x-admin-key`).

---

## Tech Stack

| Layer | Technologies |
| --- | --- |
| **Monorepo** | `pnpm 10.33.2`, Turborepo, TypeScript 5.9 |
| **Backend (`apps/api`)** | NestJS 11, Fastify (`@fastify/cookie`, `@fastify/multipart`), Prisma 6 (PostgreSQL 16, 17 tables), BullMQ (Redis 7), Zod |
| **Frontend (`apps/web`)** | Next.js 15 (App Router), React 19, Tailwind CSS v4, shadcn/ui, TanStack Query, `lucide-react` |
| **Math & Testing** | `decimal.js`, Vitest, Playwright (`tests/e2e`) |
| **Infrastructure** | Docker Compose (`postgres:16-alpine`, `redis:7-alpine`) |

---

## Repository Structure

```text
AI-DSF/
├── apps/
│   ├── api/                  # NestJS 11 + Fastify backend (:4000), Prisma 17-table schema & 6 modules
│   └── web/                  # Next.js 15 App Router frontend (:3000), AppShell & shared UI kit
├── packages/
│   ├── shared-types/         # Shared Zod schemas, DTOs, enums, error codes, URL handoff builders, IAiGatewayService
│   └── financial-math/       # Pure TypeScript + decimal.js financial formulas & Vitest Golden Vectors (V1..V4)
├── config/
│   ├── sources.yaml          # 5 Radar news/alert sources (CafeF, VnEconomy, Vietstock, NHNN, NCSC)
│   └── ai-routing.yaml       # Multi-LLM task routing (primary + fallbacks)
├── docs/specs/               # Architecture, ERD, API contracts, wireframes & work breakdown specs
└── tests/e2e/                # Playwright end-to-end test suite
```

---

## Getting Started (Local Development)

### Prerequisites

- **Node.js** `>= 24`
- **pnpm** `10.33.2` (`corepack enable`)
- **Docker Desktop** (for PostgreSQL 16 and Redis 7)

### 1. Clone & Configure Environment

```bash
git clone -b dev https://github.com/XLaiHuy/AI-DSF.git
cd AI-DSF
```

Copy the environment template and adjust values for local development:

```powershell
# PowerShell
Copy-Item .env.example .env
```

```bash
# macOS / Linux
cp .env.example .env
```

> **Note:** Replace `JWT_SECRET` in `.env` with a local random secret before testing authentication. AI provider keys (`OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `ANTHROPIC_API_KEY`), Google OAuth credentials, and `ADMIN_API_KEY` can remain empty during initial local setup (in non-production mode, `AdminGuard` allows requests when `ADMIN_API_KEY` is unset). **Never commit `.env` to Git.**

### 2. Install, Start Infrastructure & Run Migrations

```bash
pnpm install
docker compose up -d --wait
pnpm db:migrate
pnpm dev
```

- **Web App:** [http://localhost:3000](http://localhost:3000)
- **API Health Check:** [http://localhost:4000/api/v1/health](http://localhost:4000/api/v1/health)

### Useful Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Run `apps/api` (`:4000`) and `apps/web` (`:3000`) in watch mode via Turborepo |
| `pnpm build` | Build all packages and apps |
| `pnpm typecheck` | Run TypeScript checks across the monorepo |
| `pnpm lint` | Run ESLint across all packages and apps |
| `pnpm test` | Run unit tests (`@fincopilot/financial-math` Vitest suite) |
| `pnpm db:migrate` | Run Prisma migrations (`apps/api`) |
| `pnpm db:seed` | Seed Radar sources, 18 institutions/products, and NCSC indicators |
| `pnpm test:e2e --list` | List Playwright E2E scenarios (`tests/e2e`) |

---

## Branching Workflow & Contributors

### Git Branching Model

- **`dev`**: Active development and integration branch. All contributors branch off `dev` and merge completed features back into `dev`.
- **`main`**: Protected final release branch for verified builds and project submission.

### Team & Module Ownership

| Contributor | Branch | Subsystem | Owned Paths & Responsibilities |
| --- | --- | --- | --- |
| **Huy** | `dev`, `feat/p3-forensic` | **Platform Core (P0) & Forensics (P3)** | Root configs, `packages/shared-types/**`, `apps/api/prisma/schema.prisma`, `apps/api/src/common/**`, `ai-gateway`, `profile-auth`, `forensic` (`sharp`/`zxing-wasm`, `unpdf`, 7 Hard Rules, PII purge), `AppShell`, `api-client`, and pages `/`, `/profile`, `/forensic`. |
| **Tân** | `feat/p2-survey-calc` | **Survey & Financial Math (P2)** | `packages/financial-math/**` (`decimal.js` formulas & Golden Vectors `V1..V4`), `apps/api/src/modules/survey-calc/**` (Trust Filter, Hybrid Catalog, DTI, Rate Shock), `apps/web/src/app/survey/**`, and `apps/web/src/components/survey/**`. |
| **Tài** | `feat/p1-radar-admin` | **Radar, Admin, Seed & E2E (P1)** | `apps/api/prisma/seed.ts`, `apps/api/src/modules/radar/**` (BullMQ cron, 2-tier dedup, `R07`, `threat_indicator`), `apps/api/src/modules/admin/**`, `apps/web/src/app/{radar,admin}/**`, `apps/web/src/components/{radar,admin}/**`, and `tests/e2e/**`. |

---

## Specifications & Documentation

- [Project Cheatsheet & Rules](docs/specs/00_CHEATSHEET_CHOT.md)
- [Tech Stack, Architecture & 17-Table ERD](docs/specs/03_TechStack_KienTruc_ERD.md)
- [Agent Coding Spec, API Contracts & Golden Vectors](docs/specs/05_Agent_Coding_Spec.md)
- [Work Breakdown Plan & Integration Sockets](docs/specs/06_Work_Breakdown_Plan.md)
