# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Stage 1: builder — compile TypeScript worker to dist/
# ---------------------------------------------------------------------------
FROM node:24-slim AS builder

WORKDIR /app

RUN corepack enable
RUN npm install -g typescript@5.8.3

# Copy workspace-level manifests and lock file
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn

# Copy every package.json so Yarn resolves workspace links before source copy
COPY apps/web/package.json             ./apps/web/
COPY apps/worker/package.json          ./apps/worker/
COPY packages/ai/package.json          ./packages/ai/
COPY packages/audit/package.json       ./packages/audit/
COPY packages/auth/package.json        ./packages/auth/
COPY packages/config/package.json      ./packages/config/
COPY packages/db/package.json          ./packages/db/
COPY packages/design-systems/package.json ./packages/design-systems/
COPY packages/export/package.json      ./packages/export/
COPY packages/html-contract/package.json ./packages/html-contract/
COPY packages/i18n/package.json        ./packages/i18n/
COPY packages/image-providers/package.json ./packages/image-providers/
COPY packages/prompts/package.json     ./packages/prompts/
COPY packages/providers/package.json   ./packages/providers/
COPY packages/queue/package.json       ./packages/queue/
COPY packages/rbac/package.json        ./packages/rbac/
COPY packages/storage/package.json     ./packages/storage/
COPY packages/test-utils/package.json  ./packages/test-utils/
COPY packages/usage/package.json       ./packages/usage/

RUN yarn install --immutable

# Copy source
COPY tsconfig.base.json ./
COPY packages           ./packages
COPY apps/worker        ./apps/worker

# Generate Prisma client (linux binary targets already declared in schema)
# and compile every shared package the worker resolves at runtime.
RUN yarn workspace @pepetex/db build && \
    yarn workspace @pepetex/worker exec tsc -p ../../packages/db/tsconfig.json && \
    yarn workspace @pepetex/ai build && \
    yarn workspace @pepetex/audit build && \
    yarn workspace @pepetex/auth build && \
    yarn workspace @pepetex/config build && \
    yarn workspace @pepetex/design-systems build && \
    yarn workspace @pepetex/export build && \
    yarn workspace @pepetex/html-contract build && \
    yarn workspace @pepetex/i18n build && \
    yarn workspace @pepetex/image-providers build && \
    yarn workspace @pepetex/prompts build && \
    yarn workspace @pepetex/providers build && \
    yarn workspace @pepetex/queue build && \
    yarn workspace @pepetex/rbac build && \
    yarn workspace @pepetex/storage build && \
    yarn workspace @pepetex/usage build && \
    yarn workspace @pepetex/worker build

# ---------------------------------------------------------------------------
# Stage 2: runner — Playwright base for headless-browser PPTX/thumbnail work
# The official Playwright image ships all Chromium system dependencies.
# ---------------------------------------------------------------------------
FROM mcr.microsoft.com/playwright:v1.59.1-jammy AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install matching Node 24 from NodeSource (Playwright image ships Node 20)
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy compiled worker output and all workspace node_modules
COPY --from=builder /app/apps/worker/dist      ./dist
RUN --mount=from=builder,source=/app/node_modules,target=/builder_node_modules \
    cp -a /builder_node_modules/. ./node_modules
COPY --from=builder /app/packages              ./packages

# Workspace package manifests point at src/index.ts for local development.
# The production image loads compiled JS, so point the copied manifests at dist.
RUN node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const packagesDir = '/app/packages';
for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;

  const manifestPath = path.join(packagesDir, entry.name, 'package.json');
  if (!fs.existsSync(manifestPath)) continue;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest.name?.startsWith('@pepetex/')) continue;

  const packageDir = path.dirname(manifestPath);
  const candidates = ['dist/index.js', 'dist/src/index.js'];
  const main = candidates.find((candidate) => fs.existsSync(path.join(packageDir, candidate)));
  if (!main) continue;

  manifest.main = main;
  manifest.types = main.replace(/\.js$/, '.d.ts');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
NODE

# Tell playwright-core to use the bundled Chromium from the Playwright image
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

CMD ["node", "--import=tsx", "dist/index.js"]
