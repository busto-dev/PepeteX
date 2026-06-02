> [!WARNING]
> **This repo is 100% vibecoded.** Every line was generated through AI-assisted, conversational development. It is provided **as-is, with no warranty** — it may contain bugs, security gaps, or incomplete logic. Review, test, and audit it thoroughly before using it in production. Use at your own risk.

> [!WARNING]
> **Known Issue.** This app is tested only using Gemini as provider, using other provider (e.g OpenAI Compatible) are still on-progress and might not working properly


<div align="center">

# PepeteX

**AI-powered presentation generator for teams.**  
Generate, edit, and export polished PPTX slides using your own AI providers — fully self-hosted.


[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node 24](https://img.shields.io/badge/node-24.x-brightgreen)](https://nodejs.org)
[![Built with Nuxt 4](https://img.shields.io/badge/Nuxt-4-00DC82?logo=nuxt.js)](https://nuxt.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/tests-160%20passing-brightgreen)](#running-tests)

[Quick Start](#quick-start) · [Features](#features) · [Architecture](#architecture) · [Deployment](#deployment) · [Contributing](#contributing)

</div>

---

## What is PepeteX?

PepeteX is a **self-hosted, chat-based presentation generator** built for internal company use. You describe what you need — PepeteX generates a full PPTX deck, refines individual slides, and handles all the design work automatically using your existing AI provider subscriptions.

<img width="1965" height="1154" alt="frame_generic_light (1)" src="https://github.com/user-attachments/assets/107d7146-bc8e-4e5f-87d6-990dffb372c7" />


No SaaS lock-in. No data leaving your infrastructure. Bring your own AI keys.

---

## Features

See how it generate design system

<img width="800" height="450" alt="ezgif-2d0057cff5ba09be" src="https://github.com/user-attachments/assets/7cbea3d5-ebfa-424b-88a1-55052c2d7bdf" />

Use it when generating deck

<img width="800" height="450" alt="ezgif-264e783af054d66b" src="https://github.com/user-attachments/assets/5ab08235-6a8f-4590-878a-e90d9ba4cd2b" />


### Core Generation
- **Full-deck generation** — describe a topic in chat, get a complete PPTX in minutes
- **Single-slide regeneration** — rewrite or redesign individual slides without touching the rest
- **Tweak system** — apply targeted changes (tone, layout, colors, wording) per slide or per deck
- **Comment loop** — add comments to slides and let the AI revise them in context
- **Revision history** — browse and restore any previous version of a deck

### AI & Providers
- **Multi-provider text generation** — Gemini, OpenAI-compatible, CLI proxy
- **Optional image generation** — Imagen, Gemini Images, GPT-image-2, or any OpenAI-compatible image API
- **Per-workspace provider & model selection** — different teams can use different providers
- **Admin credential management** — encrypted at rest (AES-256-GCM), masked in UI, revealed only to global admins with full audit trail
- **Custom prompts** — global and per-workspace prompt overrides with English/Indonesian language support
- **Telemetry opt-out** — fully air-gapped operation with `DISABLE_EXTERNAL_TELEMETRY=true`

### Design Systems
- **Versioned design system snapshots** — immutable version history, rollback-safe
- **Design system duplication** — clone and modify from a baseline
- **Import/export** — transfer design systems between PepeteX instances
- **Live preview** — see how your design system renders before applying it to a deck

### Export & Files
- **PPTX export** — server-side headless rendering with pixel-accurate layout
- **Slide thumbnails** — auto-generated after every revision
- **Reference file uploads** — attach documents and images as context for generation
- **Automatic reference file cleanup** — configurable retention policy

### Administration
- **Workspace management** — create personal and shared workspaces, invite members
- **Role-based access control** — workspace roles (Owner, Admin, Member, Viewer) and a Global Admin tier
- **Admin dashboard** — live counts of users, decks, generation runs, failures
- **Usage & cost tracking** — per-provider token and cost aggregation
- **Audit log** — tamper-evident trail of all admin actions
- **Provider failure surface** — see which AI calls failed and why, without exposing credentials
- **Example deck management** — curated prompt examples to inspire users

### UX
- **English / Indonesian UI** — full i18n support for both languages
- **In-app notifications** — generation complete, export ready, errors
- **Slide preview** — sandboxed iframe rendering with strict CSP

---

## Quick Start

### Prerequisites

- [Node.js 24.x](https://nodejs.org)
- [Docker & Docker Compose v2](https://docs.docker.com/get-docker/)
- A Google Cloud Storage bucket (or local emulator)

```bash
# 1. Clone
git clone https://github.com/your-org/pepetex.git
cd pepetex

# 2. Enable Yarn 4
corepack enable && corepack yarn install

# 3. Start Postgres + Redis
docker compose up -d postgres redis

# 4. Configure environment
cp .env.example .env
# Edit .env — set PROVIDER_CREDENTIAL_ENCRYPTION_KEY and FIRST_ADMIN_* fields

# 5. Run migrations & seed
corepack yarn workspace @pepetex/db build
corepack yarn db:migrate --name init
corepack yarn db:seed

# 6. Start the app
corepack yarn dev
```

App is at **http://localhost:3000**. Log in with the email and password you set in `.env`.

> **Full setup guide →** [RUNNING.md](RUNNING.md)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Browser                             │
│                     Vue 3 + Nuxt UI                         │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTPS
┌───────────────────────────▼─────────────────────────────────┐
│              apps/web  (Nuxt 4 + Nitro)                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Nitro API Routes (/api/...)                         │   │
│  │  Auth · Workspaces · Decks · Providers · Admin       │   │
│  └──────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │ BullMQ jobs via Redis
┌───────────────────────────▼─────────────────────────────────┐
│              apps/worker  (Node.js + BullMQ)                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Generation · Export PPTX · Thumbnails               │   │
│  │  Image Generation · Reference File Cleanup           │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Mastra AI Workflows (8 workflows)                   │   │
│  │  Full Deck · Single Slide · Tweaks · Comments …      │   │
│  └──────────────────────────────────────────────────────┘   │
└──────┬──────────────────────────────────────────────────────┘
       │
┌──────▼──────────┐  ┌────────────┐  ┌──────────────────────┐
│   PostgreSQL     │  │   Redis    │  │  Google Cloud Storage │
│  (data + audit) │  │  (queues)  │  │  (assets, PPTX, refs) │
└─────────────────┘  └────────────┘  └──────────────────────┘
```

### Monorepo layout

```
pepetex/
├─ apps/
│  ├─ web/          Nuxt 4 app + all Nitro API routes
│  └─ worker/       BullMQ workers + Mastra AI workflows
├─ packages/
│  ├─ ai/           Mastra agents and 8 generation workflows
│  ├─ auth/         Password hashing, sessions, password reset
│  ├─ config/       Typed env validation
│  ├─ db/           Prisma schema, migrations, seed
│  ├─ design-systems/ Token/component schema + validation
│  ├─ export/       PPTX dom-to-pptx bridge + export page
│  ├─ html-contract/ HTML/CSS sanitizer + slide schema validator
│  ├─ i18n/         English + Indonesian translations
│  ├─ image-providers/ Imagen, GPT-image, OpenAI-compatible
│  ├─ prompts/      Prompt assembly + policy hierarchy
│  ├─ providers/    Gemini, OpenAI-compatible, CLI proxy adapters
│  ├─ queue/        BullMQ queue names + payload schemas
│  ├─ rbac/         Workspace + global permission helpers
│  ├─ storage/      GCS adapter, signed URLs, asset metadata
│  ├─ usage/        Token + cost accounting
│  └─ audit/        Audit log helpers
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vue 3 + Nuxt 4 + Nuxt UI + Tailwind CSS |
| Backend API | Nuxt/Nitro server routes |
| AI orchestration | [Mastra](https://mastra.ai) 1.28+ |
| Database ORM | Prisma 5 + PostgreSQL 16 |
| Job queue | BullMQ + Redis 7 |
| Object storage | Google Cloud Storage |
| PPTX export | Playwright (headless Chromium) + dom-to-pptx |
| Package manager | Yarn 4 (Corepack) |
| Monorepo | Turborepo |
| Language | TypeScript 5.8 (strict) |
| Runtime | Node.js 24 |

---

## Deployment

### Docker Compose (self-hosted)

```bash
cp deploy/vm.env.example .env   # fill in production values
docker compose -f docker-compose.vm.yml up -d postgres redis
docker compose -f docker-compose.vm.yml --profile tools run --rm migrate
docker compose -f docker-compose.vm.yml --profile tools run --rm seed
docker compose -f docker-compose.vm.yml up -d --build
docker compose -f docker-compose.vm.yml --profile certbot-init run --rm certbot-init
docker compose -f docker-compose.vm.yml restart nginx
```

The VM Compose stack runs the web app, worker, Nginx reverse proxy, Certbot, and optional bundled PostgreSQL/Redis. Set `COMPOSE_PROFILES=local-postgres,local-redis,certbot-renew` for bundled services, or remove the local profiles and point `DATABASE_URL` / `REDIS_URL` at existing managed services. GCS auth can use the VM service account on Compute Engine, or mount a service-account JSON / gcloud ADC file with `docker-compose.gcp-auth.yml`.

### Google Cloud Run

```bash
docker build -f apps/web/Dockerfile -t gcr.io/$PROJECT/pepetex-web:latest .
docker build -f apps/worker/Dockerfile -t gcr.io/$PROJECT/pepetex-worker:latest .
gcloud run deploy pepetex-web   --image gcr.io/$PROJECT/pepetex-web:latest   ...
gcloud run deploy pepetex-worker --image gcr.io/$PROJECT/pepetex-worker:latest ...
```

**Full step-by-step instructions →** [RUNNING.md](RUNNING.md).

---

## Running Tests

```bash
corepack yarn test --run       # all 160 tests across 23 suites
corepack yarn typecheck         # TypeScript strict check
corepack yarn lint              # ESLint
```

Test categories:

| Suite | Command | Coverage |
|-------|---------|---------|
| Unit | `yarn test:unit` | Config, RBAC, auth helpers |
| API integration | `yarn test:api` | All Nitro route handlers |
| HTML contract | `yarn test:html-contract` | Slide sanitizer + CSS validator |
| Export fidelity | `yarn test:export` | PPTX layout + image embedding |
| Provider adapters | `yarn workspace @pepetex/providers vitest run` | Gemini, OpenAI adapters |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `GCS_BUCKET` | Google Cloud Storage bucket |
| `GOOGLE_APPLICATION_CREDENTIALS_HOST` | Optional host path to service-account JSON or gcloud ADC credentials for VM Compose file-based GCS auth |
| `GOOGLE_APPLICATION_CREDENTIALS_CONTAINER` | Optional container path for mounted GCP credentials when using `docker-compose.gcp-auth.yml` |
| `APP_URL` | Full public URL (e.g. `https://pepetex.company.com`) |
| `PROVIDER_CREDENTIAL_ENCRYPTION_KEY` | 32-byte base64 key for encrypting AI API keys at rest |
| `DISABLE_EXTERNAL_TELEMETRY` | `true` to suppress all outbound AI telemetry |
| `FIRST_ADMIN_EMAIL` | Email for initial admin account (seed only) |
| `FIRST_ADMIN_PASSWORD_HASH` | scrypt hash of initial admin password (seed only) |

See [.env.example](.env.example) for all variables with defaults.

### Generating secrets

```bash
# PROVIDER_CREDENTIAL_ENCRYPTION_KEY — 32-byte base64 key
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# FIRST_ADMIN_PASSWORD_HASH — scrypt hash (format: scrypt$<salt>$<key>)
corepack yarn tsx -e "import { hashPassword } from '@pepetex/auth'; hashPassword('your-secure-password').then(console.log)"
```

> Keep `FIRST_ADMIN_PASSWORD_HASH` single-quoted in `.env` — scrypt hashes contain `$` characters. Full details in [RUNNING.md](RUNNING.md).

---

## Security

- Passwords hashed with scrypt
- Session tokens: 32-byte random, `HttpOnly` + `SameSite=Strict` cookies
- Provider API keys encrypted at rest with AES-256-GCM (per-key random IV)
- Slide HTML sanitized and validated on every generation (blocked: `<script>`, inline handlers, external URLs, `@import`)
- Slide preview runs in a sandboxed iframe with strict CSP
- All admin actions write to a tamper-evident audit log
- No secrets committed to the repository

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make changes — follow the existing TypeScript and ESLint style
4. Run checks: `corepack yarn lint && corepack yarn typecheck && corepack yarn test --run`
5. Open a pull request

Follow the existing TypeScript and ESLint style.

---

## License

[Apache 2.0](LICENSE)

---

<div align="center">
Built with ❤️ for teams that want great presentations without the PowerPoint grind.
</div>
