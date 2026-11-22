# AI-DSF

FinCopilot AI là bộ khung monorepo cho Radar, Khảo sát tài chính và Giám định. Phase 1 cung cấp hợp đồng dùng chung, API khung, App Shell và hạ tầng local.

## Chạy local

Cần Node.js 24, pnpm 10.33.2 và Docker Compose.

```powershell
Copy-Item .env.example .env
pnpm install
docker compose up -d --wait
pnpm db:migrate
pnpm dev
```

Web chạy ở [localhost:3000](http://localhost:3000). API chạy ở [localhost:4000/api/v1/health](http://localhost:4000/api/v1/health). Dùng `pnpm db:seed` để chạy khung seed. Các khóa AI và Google OAuth có thể để trống trong Phase 1. Thay `JWT_SECRET` trong `.env` bằng chuỗi ngẫu nhiên riêng cho máy trước khi dùng xác thực.

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e --list
```

## Phân công

| Thành viên | Nhánh | Phạm vi |
| --- | --- | --- |
| Lead | `main`, `feat/p3-forensic` | Root configs, `packages/shared-types/**`, `apps/api/prisma/schema.prisma`, `apps/api/src/common/**`, module `ai-gateway`, `profile-auth`, `forensic`, App Shell, API client và trang Home, Profile, Forensic. |
| Tân | `feat/p2-survey-calc` | `packages/financial-math/**`, module `survey-calc`, trang và components Survey. |
| Tài | `feat/p1-radar-admin` | Module `radar` và `admin`, trang và components Radar/Admin, `apps/api/prisma/seed.ts`, `tests/e2e/**`. |

Xem [kế hoạch phân công](docs/specs/06_Work_Breakdown_Plan.md) và [hợp đồng API](docs/specs/05_Agent_Coding_Spec.md).
