# Contributing to PepeteX

First off — thank you for taking the time to contribute! PepeteX is a self-hosted, AI-powered presentation generator, and we welcome bug reports, feature ideas, documentation improvements, and code contributions of any size.

This document explains how to get set up, the standards we follow, and the process for getting a change merged.

> By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## Table of contents

- [Ways to contribute](#ways-to-contribute)
- [Getting set up](#getting-set-up)
- [Project layout](#project-layout)
- [Development workflow](#development-workflow)
- [Coding standards](#coding-standards)
- [Commit messages](#commit-messages)
- [Pull request process](#pull-request-process)
- [Testing](#testing)
- [Reporting bugs](#reporting-bugs)
- [Requesting features](#requesting-features)
- [Security issues](#security-issues)
- [License](#license)

---

## Ways to contribute

- **Report bugs** — open an issue using the [bug report template](.github/ISSUE_TEMPLATE/bug_report.yml)
- **Suggest features** — open an issue using the [feature request template](.github/ISSUE_TEMPLATE/feature_request.yml)
- **Improve documentation** — typos, clarifications, new guides — all welcome
- **Add or improve tests** — coverage gains are always appreciated
- **Fix bugs or implement features** — see open issues labelled `good first issue` or `help wanted`
- **Translate the UI** — see [i18n](#translations) below

---

## Getting set up

### Prerequisites

- [Node.js 24.x](https://nodejs.org) (use the `.nvmrc` file)
- [Docker & Docker Compose v2](https://docs.docker.com/get-docker/)
- Yarn 4 (via Corepack — bundled with Node)

### First-time setup

```bash
# 1. Fork the repository on GitHub, then clone your fork
git clone https://github.com/<your-username>/pepetex.git
cd pepetex

# 2. Add upstream so you can sync later
git remote add upstream https://github.com/busto-dev/pepetex.git

# 3. Enable Corepack and install dependencies
corepack enable
corepack yarn install

# 4. Start Postgres and Redis
docker compose up -d postgres redis

# 5. Set up environment variables
cp .env.example .env
# Edit .env and fill in required values — see README.md for details

# 6. Run migrations and seed the database
corepack yarn workspace @pepetex/db build
corepack yarn db:migrate --name init
corepack yarn db:seed

# 7. Start the dev server
corepack yarn dev
```

For a full deployment walkthrough, see [RUNNING.md](RUNNING.md).

---

## Project layout

```
pepetex/
├─ apps/
│  ├─ web/           Nuxt 4 app + all Nitro API routes
│  └─ worker/        BullMQ workers + Mastra AI workflows
└─ packages/
   ├─ ai/            Mastra agents and generation workflows
   ├─ auth/          Password hashing, sessions, password reset
   ├─ config/        Typed env validation
   ├─ db/            Prisma schema, migrations, seed
   ├─ design-systems/  Token + component schema
   ├─ export/        PPTX dom-to-pptx bridge + export page
   ├─ html-contract/ HTML/CSS sanitizer + slide schema validator
   ├─ i18n/          English + Indonesian translations
   ├─ image-providers/  Imagen, GPT-image, OpenAI-compatible
   ├─ prompts/       Prompt assembly + policy hierarchy
   ├─ providers/     Gemini, OpenAI-compatible, CLI proxy
   ├─ queue/         BullMQ queue names + payload schemas
   ├─ rbac/          Workspace + global permission helpers
   ├─ storage/       Pluggable object storage (local, GCS)
   ├─ usage/         Token + cost accounting
   └─ audit/         Audit log helpers
```

When changing functionality, please keep related logic in the package it belongs to and avoid creating cross-package leaks.

---

## Development workflow

1. **Sync with upstream first**
   ```bash
   git checkout main
   git pull upstream main
   ```

2. **Create a feature branch**
   ```bash
   git checkout -b <type>/<short-description>
   # e.g. feat/openai-provider-streaming
   #      fix/export-thumbnail-race
   #      docs/contributing-guide
   ```

3. **Make your changes**, following the [coding standards](#coding-standards) below.

4. **Run the full check suite** before committing:
   ```bash
   corepack yarn lint
   corepack yarn typecheck
   corepack yarn test --run
   ```

5. **Commit** following the [commit message convention](#commit-messages).

6. **Push** to your fork and open a pull request.

### Branch naming

Use a short, descriptive name with a prefix:

| Prefix | Meaning |
|--------|---------|
| `feat/` | New feature |
| `fix/` | Bug fix |
| `docs/` | Documentation only |
| `refactor/` | Code change that neither fixes a bug nor adds a feature |
| `test/` | Adding or improving tests |
| `chore/` | Tooling, build, dependencies |
| `ci/` | CI configuration changes |

---

## Coding standards

- **Language:** TypeScript 5.8 with `strict` mode — no `any` unless absolutely unavoidable.
- **Formatting:** Prettier (config in `.prettierrc.json`). Run `corepack yarn lint --fix` to auto-format.
- **Linting:** ESLint (config in `eslint.config.mjs`). Code must pass `corepack yarn lint` with no warnings.
- **Type safety:** Code must pass `corepack yarn typecheck`.
- **Style:** Match the surrounding code. Prefer small, focused functions and descriptive names.
- **No secrets in code:** Never commit API keys, passwords, tokens, or `.env` files.
- **Imports:** Use workspace imports (`@pepetex/<package>`) rather than relative paths across packages.

### Translations

UI strings live in `packages/i18n/`. When adding or changing user-visible strings:

- Add the key to **both** English and Indonesian translation files
- Use existing namespacing conventions
- Keep keys descriptive and stable

---

## Commit messages

We follow a lightweight version of [Conventional Commits](https://www.conventionalcommits.org):

```
<type>(<scope>): <short summary>

<optional body explaining what and why>

<optional footer — refs, breaking changes>
```

**Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `perf`, `style`

**Examples:**

```
feat(providers): add streaming support for OpenAI-compatible chat
fix(export): correct image aspect ratio on cropped slides
docs: clarify GCS service account setup in RUNNING.md
test(rbac): cover workspace owner removal edge case
```

Keep the subject line under ~72 characters and use the imperative mood (*"add"*, not *"added"*).

---

## Pull request process

1. **Open the PR** against `main`. Use the [PR template](.github/PULL_REQUEST_TEMPLATE.md) — fill in the summary, link related issues, and check the testing boxes.
2. **Keep PRs focused.** One logical change per PR. Split unrelated work into separate PRs.
3. **Make sure CI passes.** All lint, typecheck, and test checks must be green.
4. **Update documentation** if your change affects user-visible behavior, env vars, or APIs.
5. **Be responsive to review.** Maintainers may ask for changes — please address feedback or explain why a different approach is better.
6. **Squash before merge.** Maintainers will typically squash-merge to keep history clean.

### What to expect

- Small, well-scoped PRs are reviewed faster than large ones
- We may close PRs that are off-roadmap, but we will always explain why
- Draft PRs are welcome — open early if you want feedback on direction

---

## Testing

PepeteX has 160+ tests across 23 suites. Please add tests for any new behavior.

```bash
corepack yarn test --run             # all tests
corepack yarn test:unit              # unit tests only
corepack yarn test:api               # API integration tests
corepack yarn test:html-contract     # sanitizer + CSS validator
corepack yarn test:export            # PPTX export fidelity
```

Per-package tests:

```bash
corepack yarn workspace @pepetex/providers vitest run
```

### Test guidelines

- New features need tests covering happy path + at least one edge case
- Bug fixes need a regression test that fails without the fix
- Prefer integration tests at the Nitro route level over deep unit tests when both apply
- Keep test data deterministic — no `Math.random`, no real network calls
- Mock external services (AI providers, GCS) — never hit real APIs in tests

---

## Reporting bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.yml). A good report includes:

- Clear reproduction steps
- Expected vs actual behavior
- Environment details (Node version, OS, deployment mode, AI provider)
- Relevant logs (with secrets redacted)

---

## Requesting features

Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.yml). Describe the **problem** you're trying to solve before proposing a solution — it helps us evaluate alternatives.

---

## Security issues

**Do not open public issues for security vulnerabilities.** See [SECURITY.md](SECURITY.md) for our private disclosure process.

---

## License

By contributing, you agree that your contributions will be licensed under the [Apache 2.0 License](LICENSE).
