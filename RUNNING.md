# PepeteX — Running Guide

Step-by-step instructions for running PepeteX locally and deploying it to production.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Local Development](#2-local-development)
3. [Running Tests](#3-running-tests)
4. [Production — Docker Compose (Self-Hosted / GCE VM)](#4-production--docker-compose-self-hosted--gce-vm)
5. [Production — Google Cloud Run](#5-production--google-cloud-run)
6. [Environment Variable Reference](#6-environment-variable-reference)
7. [Common Commands](#7-common-commands)

---

## 1. Prerequisites

Install these tools before you begin.

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 24.x | https://nodejs.org or `nvm use` |
| Corepack | bundled with Node 24 | `corepack enable` |
| Docker | 24+ | https://docs.docker.com/get-docker/ |
| Docker Compose | v2 (bundled with Docker Desktop) | — |
| Git | any | — |

> **Windows users:** all `corepack yarn` commands below work in PowerShell. Do not use bare `yarn` — use `corepack yarn`.

---

## 2. Local Development

### Step 1 — Clone and install

```bash
git clone https://github.com/your-org/pepetex.git
cd pepetex

# Enable Corepack so Yarn 4 is used automatically
corepack enable

# Install all workspace dependencies
corepack yarn install
```

### Step 2 — Start infrastructure services

PostgreSQL runs on **port 5435** (not 5432) to avoid conflicts with a local Postgres installation. Redis runs on **port 6379**.

```bash
docker compose up -d postgres redis
```

Verify services are up:

```bash
docker compose ps
```

### Step 3 — Set up environment variables

```bash
cp .env.example .env
```

Edit `.env`. The minimum required values for local development:

```env
# Already set to correct defaults for local Docker Compose:
APP_URL=http://localhost:3000
DATABASE_URL=postgresql://pepetex:pepetex@localhost:5435/pepetex
REDIS_URL=redis://localhost:6379
GCS_BUCKET=pepetex-dev

# Generate a 32-byte base64 key for credential encryption:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
PROVIDER_CREDENTIAL_ENCRYPTION_KEY=<your-32-byte-base64-key>

# First admin account (used by db:seed, only needed once)
FIRST_ADMIN_EMAIL=admin@example.com
FIRST_ADMIN_NAME=PepeteX Admin
# Generate a scrypt hash:
#   corepack yarn tsx -e "import { hashPassword } from '@pepetex/auth'; hashPassword('yourpassword').then(console.log)"
FIRST_ADMIN_PASSWORD_HASH=<scrypt-hash>
```

For local development, GCS is the only external service required. Either:
- Use a real GCS bucket (set up credentials — see [GCS Setup](#gcs-setup) below), or
- Point `GCS_BUCKET` to a local emulator (e.g., [fake-gcs-server](https://github.com/fsouza/fake-gcs-server))

### Step 4 — Run database migrations

```bash
corepack yarn db:migrate --name init
```

> **Prisma `.env` note:** Prisma CLI looks for `.env` in `packages/db/`, not in the repo root.
> A `packages/db/.env` file with the default local `DATABASE_URL` is included in the repo.
> If you changed `DATABASE_URL` in the root `.env`, update `packages/db/.env` to match,
> or prefix the command with the env var:
> ```powershell
> # PowerShell
> $env:DATABASE_URL='postgresql://pepetex:pepetex@localhost:5435/pepetex'; corepack yarn db:migrate --name init
> ```
> ```bash
> # bash/zsh
> DATABASE_URL='postgresql://pepetex:pepetex@localhost:5435/pepetex' corepack yarn db:migrate --name init
> ```

> If `prisma migrate dev` is blocked by a checksum mismatch on your machine, use:
> ```bash
> corepack yarn workspace @pepetex/db db:migrate:deploy
> ```

### Step 5 — Build shared packages

The DB package (Prisma client) must be built before starting any app:

```bash
corepack yarn workspace @pepetex/db build
```

### Step 5b — Install Chromium for local PPTX export

The worker uses `playwright-core` for PPTX export. Docker already includes Chromium, but local development needs a browser installed before export jobs can run:

```bash
corepack yarn playwright:install
```

Restart the worker after installing Chromium. If you already have a compatible Chromium or headless-shell binary, you can skip the install and set this in `.env` instead:

```env
PEPETEX_CHROMIUM_EXECUTABLE_PATH=C:\\path\\to\\chrome.exe
```

### Step 6 — Seed the first admin

```bash
corepack yarn db:seed
```

This creates the global admin account using the credentials from your `.env` file. Skip if the account already exists.

### Step 7 — Start the development servers

In one terminal, start the web app:

```bash
corepack yarn dev:web
```

In a second terminal, start the worker:

```bash
corepack yarn dev:worker
```

The web app will be available at **http://localhost:3000**.

> `corepack yarn dev` runs both with Turborepo in parallel if you prefer a single command:
> ```bash
> corepack yarn dev
> ```

### GCS Setup

1. Create a GCS bucket in the [Google Cloud Console](https://console.cloud.google.com/storage).
2. Grant object read/write access to the identity you will use, for example `roles/storage.objectAdmin` on the bucket.
3. Configure Google Application Default Credentials using one of these options:

  Service-account JSON key:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
   ```

  gcloud user ADC for local development:
  ```bash
  gcloud auth application-default login
  ```

  On Google Compute Engine, prefer an attached VM service account with bucket access. The app can use metadata credentials automatically.

---

## 3. Running Tests

Run all tests across all workspaces:

```bash
corepack yarn test --run
```

Run only a specific suite:

```bash
# Unit tests
corepack yarn test:unit --run

# API integration tests
corepack yarn test:api --run

# HTML contract tests
corepack yarn test:html-contract --run

# Export fidelity tests
corepack yarn test:export --run

# Single workspace
corepack yarn workspace @pepetex/web vitest run
corepack yarn workspace @pepetex/providers vitest run
```

Run TypeScript type checks:

```bash
corepack yarn typecheck
```

Run lint:

```bash
corepack yarn lint
```

Expected result: **23 test files, 160 tests — all pass**.

---

## 4. Production — Docker Compose (Self-Hosted / GCE VM)

Use this for on-premises or single-VM deployments, including Google Compute Engine. The VM Compose stack runs:

- Web app from `apps/web/Dockerfile`
- Worker from `apps/worker/Dockerfile`
- Nginx reverse proxy
- Certbot for Let's Encrypt certificates
- Optional local PostgreSQL 16
- Optional local Redis 7
- One-shot migration and seed containers

The full VM-specific guide is in [docs/gce-docker-compose.md](docs/gce-docker-compose.md).

### Step 1 — Prepare the environment file

```bash
cp deploy/vm.env.example .env
# Edit .env with real production values (see Environment Variable Reference)
```

Critical production values to set:

```env
APP_URL=https://pepetex.your-company.com
NGINX_SERVER_NAME=pepetex.your-company.com
LETSENCRYPT_EMAIL=admin@your-company.com
GCS_BUCKET=your-prod-gcs-bucket
PROVIDER_CREDENTIAL_ENCRYPTION_KEY=<32-byte-base64-key>
FIRST_ADMIN_EMAIL=admin@your-company.com
FIRST_ADMIN_NAME=PepeteX Admin
FIRST_ADMIN_PASSWORD_HASH='<scrypt-hash>'
```

PepeteX stores uploaded files, thumbnails, generated images, and PPTX exports in GCS. The app uses Google Application Default Credentials, so configure one of these auth paths:

1. **Recommended on Google Compute Engine:** attach a VM service account with object read/write permissions on the bucket, for example `roles/storage.objectAdmin`. The containers use Compute Engine metadata credentials automatically; no JSON key file is needed.

   Two things must both be true for this to work:
   - The VM's **service account** has `roles/storage.objectAdmin` (or `roles/storage.objectUser`) on the bucket — set this in IAM → Grant Access on the bucket in Cloud Console.
   - The VM's **access scopes** include Cloud Storage — in Compute Engine → VM → Edit, set Access Scopes to **Allow full access to all Cloud APIs** (requires stopping the VM first if not already set).
2. **Service-account JSON key:** store the key outside the repo, set `GOOGLE_APPLICATION_CREDENTIALS_HOST` to that host path, and run Compose with `docker-compose.gcp-auth.yml`.
3. **gcloud ADC:** run `gcloud auth application-default login` or use service-account impersonation on the host, set `GOOGLE_APPLICATION_CREDENTIALS_HOST` to the generated ADC JSON file, and run Compose with `docker-compose.gcp-auth.yml`. This is convenient for testing, but a VM service account or dedicated service-account key is preferred for production.

### Step 2 — Choose bundled or existing Postgres/Redis

If you use service-account JSON or gcloud ADC instead of the GCE metadata service account, add this to `.env`:

```env
GOOGLE_APPLICATION_CREDENTIALS_HOST=/opt/pepetex-secrets/gcp-credentials.json
GOOGLE_APPLICATION_CREDENTIALS_CONTAINER=/var/secrets/google/application_default_credentials.json
```

Then include the auth override in every Compose command that starts app or tool containers:

```bash
docker compose -f docker-compose.vm.yml -f docker-compose.gcp-auth.yml up -d --build
docker compose -f docker-compose.vm.yml -f docker-compose.gcp-auth.yml --profile tools run --rm migrate
```

For bundled Postgres and Redis, keep these values in `.env`:

```env
COMPOSE_PROFILES=local-postgres,local-redis,certbot-renew
POSTGRES_DB=pepetex
POSTGRES_USER=pepetex
POSTGRES_PASSWORD=<strong-database-password>
DATABASE_URL=postgresql://pepetex:<strong-database-password>@postgres:5432/pepetex
REDIS_URL=redis://redis:6379
```

For existing Postgres and Redis, remove the local profiles and point the URLs at your managed services:

```env
COMPOSE_PROFILES=certbot-renew
DATABASE_URL=postgresql://user:password@postgres-host:5432/pepetex
REDIS_URL=redis://redis-host:6379
```

`COMPOSE_PROFILES` is the switch: Docker Compose cannot conditionally create services from arbitrary env booleans, so profiles are the reliable way to opt local Postgres/Redis in or out.

### Step 3 — Start infrastructure and run database setup

If you use bundled Postgres/Redis, start them first:

```bash
docker compose -f docker-compose.vm.yml up -d postgres redis
docker compose -f docker-compose.vm.yml ps
```

Run migrations through Compose:

```bash
docker compose -f docker-compose.vm.yml --profile tools run --rm migrate
```

Seed the first admin once:

```bash
docker compose -f docker-compose.vm.yml --profile tools run --rm seed
```

### Step 4 — Build and start the full stack

```bash
docker compose -f docker-compose.vm.yml up -d --build
docker compose -f docker-compose.vm.yml ps
```

This builds and starts the `web`, `worker`, `nginx`, and any enabled profile services. Nginx starts with a temporary self-signed certificate so it can boot before Let's Encrypt has issued the real certificate.

### Step 5 — Issue the Let's Encrypt certificate

Make sure DNS points `NGINX_SERVER_NAME` to the VM public IP, then run:

```bash
docker compose -f docker-compose.vm.yml --profile certbot-init run --rm certbot-init
docker compose -f docker-compose.vm.yml restart nginx
```

The `certbot-renew` profile keeps renewal running. Nginx checks for renewed certificates and reloads periodically.

### Step 6 — Verify

```bash
docker compose -f docker-compose.vm.yml ps
docker compose -f docker-compose.vm.yml logs web --tail=50
docker compose -f docker-compose.vm.yml logs worker --tail=50
docker compose -f docker-compose.vm.yml logs nginx --tail=50
```

### Updating to a new version

```bash
git pull

# Rebuild and restart only affected services (faster than rebuilding everything)
# Changed apps/web/** only:
docker compose -f docker-compose.vm.yml build web && docker compose -f docker-compose.vm.yml up -d web

# Changed apps/worker/** only:
docker compose -f docker-compose.vm.yml build worker && docker compose -f docker-compose.vm.yml up -d worker

# Changed packages/** (shared code bundled at build time — rebuild both):
docker compose -f docker-compose.vm.yml build web worker && docker compose -f docker-compose.vm.yml up -d web worker
```

If the update includes a schema change, run migrations after restarting:

```bash
docker compose -f docker-compose.vm.yml --profile tools run --rm migrate
```

To rebuild everything at once (safe but slower):

```bash
docker compose -f docker-compose.vm.yml up -d --build
docker compose -f docker-compose.vm.yml --profile tools run --rm migrate
docker compose -f docker-compose.vm.yml ps
```

### Changing the admin password

Generate a new hash on the VM and update it directly in the database:

```bash
# 1. Generate a hash for the new password
docker exec pepetex-web-1 node -e \
  "import('@pepetex/auth').then(m => m.hashPassword('YourNewPassword').then(console.log))"

# 2. Open a psql shell
docker exec -it pepetex-postgres-1 psql -U pepetex -d pepetex

# 3. Update the hash (paste the hash from step 1, keep the single quotes)
UPDATE "User" SET "passwordHash" = 'scrypt$...' WHERE email = 'admin@your-company.com';
\q
```

---

## 5. Production — Google Cloud Run

Use this for fully managed, auto-scaling deployments.

### Prerequisites

- Google Cloud project with billing enabled
- `gcloud` CLI installed and authenticated: `gcloud auth login`
- APIs enabled: Cloud Run, Artifact Registry, Cloud SQL Admin (if using Cloud SQL)
- Set variables:
  ```bash
  export PROJECT_ID=your-gcp-project-id
  export REGION=asia-southeast1    # or your preferred region
  export REPO=pepetex              # Artifact Registry repo name
  ```

### Step 1 — Create Artifact Registry repository

```bash
gcloud artifacts repositories create $REPO \
  --repository-format=docker \
  --location=$REGION
```

### Step 2 — Authenticate Docker to Artifact Registry

```bash
gcloud auth configure-docker $REGION-docker.pkg.dev
```

### Step 3 — Build and push images

```bash
# Web image
docker build -f apps/web/Dockerfile \
  -t $REGION-docker.pkg.dev/$PROJECT_ID/$REPO/web:latest .
docker push $REGION-docker.pkg.dev/$PROJECT_ID/$REPO/web:latest

# Worker image
docker build -f apps/worker/Dockerfile \
  -t $REGION-docker.pkg.dev/$PROJECT_ID/$REPO/worker:latest .
docker push $REGION-docker.pkg.dev/$PROJECT_ID/$REPO/worker:latest
```

### Step 4 — Store secrets in Secret Manager

```bash
# Repeat for each secret value:
echo -n "postgresql://user:pass@host/pepetex" | \
  gcloud secrets create pepetex-db-url --data-file=-

echo -n "redis://..." | \
  gcloud secrets create pepetex-redis-url --data-file=-

echo -n "your-gcs-bucket" | \
  gcloud secrets create pepetex-gcs-bucket --data-file=-

echo -n "https://pepetex.your-company.com" | \
  gcloud secrets create pepetex-app-url --data-file=-

echo -n "<32-byte-base64-key>" | \
  gcloud secrets create pepetex-credential-key --data-file=-
```

### Step 5 — Create service account

```bash
gcloud iam service-accounts create pepetex-sa \
  --display-name="PepeteX Service Account"

# Grant necessary permissions
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:pepetex-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"

# Grant access to secrets
for secret in pepetex-db-url pepetex-redis-url pepetex-gcs-bucket pepetex-app-url pepetex-credential-key; do
  gcloud secrets add-iam-policy-binding $secret \
    --member="serviceAccount:pepetex-sa@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
```

### Step 6 — Run database migrations (one-time Cloud Run job)

```bash
gcloud run jobs create pepetex-migrate \
  --image $REGION-docker.pkg.dev/$PROJECT_ID/$REPO/web:latest \
  --region $REGION \
  --service-account pepetex-sa@$PROJECT_ID.iam.gserviceaccount.com \
  --set-secrets "DATABASE_URL=pepetex-db-url:latest" \
  --command sh \
  --args "-c,cd /app && npx prisma migrate deploy"

gcloud run jobs execute pepetex-migrate --region $REGION --wait
```

### Step 7 — Deploy the web service

```bash
gcloud run deploy pepetex-web \
  --image $REGION-docker.pkg.dev/$PROJECT_ID/$REPO/web:latest \
  --region $REGION \
  --platform managed \
  --service-account pepetex-sa@$PROJECT_ID.iam.gserviceaccount.com \
  --set-secrets \
    "DATABASE_URL=pepetex-db-url:latest,\
     REDIS_URL=pepetex-redis-url:latest,\
     GCS_BUCKET=pepetex-gcs-bucket:latest,\
     APP_URL=pepetex-app-url:latest,\
     PROVIDER_CREDENTIAL_ENCRYPTION_KEY=pepetex-credential-key:latest" \
  --set-env-vars "NODE_ENV=production" \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 10 \
  --memory 1Gi \
  --cpu 1
```

### Step 8 — Deploy the worker service

The worker must always have **at least 1 instance** running to process BullMQ jobs.

```bash
gcloud run deploy pepetex-worker \
  --image $REGION-docker.pkg.dev/$PROJECT_ID/$REPO/worker:latest \
  --region $REGION \
  --platform managed \
  --service-account pepetex-sa@$PROJECT_ID.iam.gserviceaccount.com \
  --set-secrets \
    "DATABASE_URL=pepetex-db-url:latest,\
     REDIS_URL=pepetex-redis-url:latest,\
     GCS_BUCKET=pepetex-gcs-bucket:latest,\
     PROVIDER_CREDENTIAL_ENCRYPTION_KEY=pepetex-credential-key:latest" \
  --set-env-vars "NODE_ENV=production" \
  --no-allow-unauthenticated \
  --min-instances 1 \
  --max-instances 5 \
  --memory 4Gi \
  --cpu 2
```

> The worker needs 4 GB / 2 vCPU minimum because it runs Playwright (Chromium) for PPTX export and thumbnail generation.

### Step 9 — Seed first admin (one-time)

```bash
gcloud run jobs create pepetex-seed \
  --image $REGION-docker.pkg.dev/$PROJECT_ID/$REPO/web:latest \
  --region $REGION \
  --service-account pepetex-sa@$PROJECT_ID.iam.gserviceaccount.com \
  --set-secrets "DATABASE_URL=pepetex-db-url:latest" \
  --set-env-vars \
    "FIRST_ADMIN_EMAIL=admin@your-company.com,\
     FIRST_ADMIN_NAME=PepeteX Admin,\
     FIRST_ADMIN_PASSWORD_HASH=<scrypt-hash>" \
  --command sh \
  --args "-c,cd /app && npx tsx packages/db/prisma/seed.ts"

gcloud run jobs execute pepetex-seed --region $REGION --wait
```

### Updating Cloud Run

```bash
# Rebuild and push
docker build -f apps/web/Dockerfile -t $REGION-docker.pkg.dev/$PROJECT_ID/$REPO/web:latest .
docker push $REGION-docker.pkg.dev/$PROJECT_ID/$REPO/web:latest

docker build -f apps/worker/Dockerfile -t $REGION-docker.pkg.dev/$PROJECT_ID/$REPO/worker:latest .
docker push $REGION-docker.pkg.dev/$PROJECT_ID/$REPO/worker:latest

# Deploy new revision
gcloud run deploy pepetex-web --image $REGION-docker.pkg.dev/$PROJECT_ID/$REPO/web:latest --region $REGION
gcloud run deploy pepetex-worker --image $REGION-docker.pkg.dev/$PROJECT_ID/$REPO/worker:latest --region $REGION

# Run migrations
gcloud run jobs execute pepetex-migrate --region $REGION --wait
```

---

## 6. Environment Variable Reference

| Variable | Required | Default (dev) | Description |
|----------|----------|---------------|-------------|
| `NODE_ENV` | No | `development` | Set to `production` in prod |
| `APP_URL` | Yes | `http://localhost:3000` | Full public URL of the web app |
| `DATABASE_URL` | Yes | `postgresql://pepetex:pepetex@localhost:5435/pepetex` | PostgreSQL connection string |
| `REDIS_URL` | Yes | `redis://localhost:6379` | Redis connection string |
| `GCS_BUCKET` | Yes | `pepetex-dev` | Google Cloud Storage bucket name |
| `GOOGLE_APPLICATION_CREDENTIALS_HOST` | VM Compose file auth only | — | Host path to a service-account JSON key or gcloud ADC JSON file |
| `GOOGLE_APPLICATION_CREDENTIALS_CONTAINER` | VM Compose file auth only | `/var/secrets/google/application_default_credentials.json` | Container path mounted by `docker-compose.gcp-auth.yml` and exposed as `GOOGLE_APPLICATION_CREDENTIALS` |
| `PROVIDER_CREDENTIAL_ENCRYPTION_KEY` | Yes | — | 32-byte base64 key for encrypting AI provider API keys at rest |
| `MAX_UPLOAD_FILE_BYTES` | No | `31457280` (30 MB) | Max allowed upload file size |
| `REFERENCE_FILE_RETENTION_DAYS` | No | `30` | Days before unused reference files are deleted |
| `DISABLE_EXTERNAL_TELEMETRY` | No | `false` | Set `true` to suppress outbound Mastra/AI telemetry (air-gapped deployments) |
| `FIRST_ADMIN_EMAIL` | Seed only | — | Email of the initial global admin (used by `db:seed` once) |
| `FIRST_ADMIN_NAME` | Seed only | — | Display name of the initial global admin |
| `COMPOSE_PROFILES` | VM Compose only | — | Enables optional Compose services, e.g. `local-postgres,local-redis,certbot-renew` |
| `NGINX_SERVER_NAME` | VM Compose only | — | Public host name served by the Nginx container |
| `LETSENCRYPT_EMAIL` | VM Compose only | — | Email used for Let's Encrypt certificate issuance |
| `POSTGRES_DB` | VM Compose local Postgres only | `pepetex` | Database name for the bundled Postgres container |
| `POSTGRES_USER` | VM Compose local Postgres only | `pepetex` | Database user for the bundled Postgres container |
| `POSTGRES_PASSWORD` | VM Compose local Postgres only | `pepetex` | Database password for the bundled Postgres container |
| `FIRST_ADMIN_PASSWORD_HASH` | Seed only | — | scrypt hash of the initial admin password |

### Generating the encryption key

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Generating the password hash

```bash
corepack yarn tsx -e "import { hashPassword } from '@pepetex/auth'; hashPassword('your-secure-password').then(console.log)"
```

When pasting the generated hash into `.env`, keep it single-quoted because scrypt hashes contain dollar signs:

```env
FIRST_ADMIN_PASSWORD_HASH='scrypt$...$...'
```

---

## 7. Common Commands

```bash
# Install dependencies
corepack yarn install

# Start all dev servers (web + worker)
corepack yarn dev

# Start only the web app
corepack yarn dev:web

# Start only the worker
corepack yarn dev:worker

# Run all tests
corepack yarn test --run

# Type check all packages
corepack yarn typecheck

# Lint all packages
corepack yarn lint

# Build all packages
corepack yarn build

# Run a database migration (dev)
corepack yarn db:migrate --name <migration-name>

# Seed the database
corepack yarn db:seed

# Start infrastructure only (dev)
docker compose up -d postgres redis

# Start full VM production stack
docker compose -f docker-compose.vm.yml up -d --build

# Run production migrations through Compose
docker compose -f docker-compose.vm.yml --profile tools run --rm migrate

# Seed the first production admin once
docker compose -f docker-compose.vm.yml --profile tools run --rm seed

# Issue the first Let's Encrypt certificate
docker compose -f docker-compose.vm.yml --profile certbot-init run --rm certbot-init

# Connect to the Postgres container with psql
docker exec -it pepetex-postgres-1 psql -U pepetex -d pepetex

# Stop everything
docker compose -f docker-compose.vm.yml down

# View logs
docker compose -f docker-compose.vm.yml logs -f web
docker compose -f docker-compose.vm.yml logs -f worker
docker compose -f docker-compose.vm.yml logs -f nginx
```
