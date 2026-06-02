# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Stage 1: builder — install all deps and build the Nuxt 4 production bundle
# ---------------------------------------------------------------------------
FROM node:24-slim AS builder

WORKDIR /app

# Enable Corepack so Yarn 4 is available
RUN corepack enable

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
COPY apps/web           ./apps/web

# Generate Prisma client (linux binary targets already declared in schema)
RUN yarn workspace @pepetex/db build

# Build the Nuxt 4 server output
RUN yarn workspace @pepetex/web build

# ---------------------------------------------------------------------------
# Stage 2: runner — lean image that only ships the server output
# ---------------------------------------------------------------------------
FROM node:24-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# Copy the self-contained Nitro server output
COPY --from=builder /app/apps/web/.output ./

# The internal PPTX export route streams dom-to-pptx's browser bundle at runtime.
COPY --from=builder /app/node_modules/dom-to-pptx ./node_modules/dom-to-pptx

# Nitro traces some packages as directory symlinks; Docker's COPY does not
# dereference directory symlinks, leaving them broken in the runner. Copy the
# real package files to the exact absolute path the bundle references at runtime.
COPY --from=builder /app/node_modules/zod ./server/node_modules/zod
COPY --from=builder /app/node_modules/@mastra ./server/node_modules/@mastra

EXPOSE 3000

CMD ["node", "server/index.mjs"]
