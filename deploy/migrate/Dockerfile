FROM node:24-slim

WORKDIR /app

RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn

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

COPY packages/db ./packages/db

RUN yarn workspace @pepetex/db build

CMD ["yarn", "workspace", "@pepetex/db", "db:migrate:deploy"]