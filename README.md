# Cloudcode

Cloudcode is a Next.js app for running Codex CLI on GitHub repositories inside
Daytona sandboxes. It uses Clerk for sign-in, ChatGPT OAuth for Codex auth, a
GitHub App for repository access, Convex for app data, and Trigger.dev for
background Codex runs.

## Setup

Install dependencies:

```bash
pnpm install
```

Copy `.env.example` to `.env.local` and fill in the Convex, Clerk, Daytona,
Trigger.dev, GitHub App, and encryption key values.

Convex also needs these deployment env vars:

```bash
pnpm exec convex env set CLERK_JWT_ISSUER_DOMAIN https://your-app.clerk.accounts.dev
pnpm exec convex env set TRIGGER_WORKER_SECRET your-shared-worker-secret
```

In Clerk, create a JWT template named `convex` with audience `convex`.

For the GitHub App, configure:

```text
Homepage URL: http://localhost:3000
Callback URL: http://localhost:3000/api/github/app/oauth/callback
Setup URL: http://localhost:3000/api/github/app/setup
Webhook: disabled
```

Grant the app repository permissions for **Contents: Read and write** and
**Pull requests: Read and write**.

## Run

```bash
pnpm dev
pnpm exec convex dev
pnpm trigger:dev
```

## Useful Scripts

```bash
pnpm lint
pnpm fmt
pnpm typecheck
pnpm format:check
pnpm daytona:snapshot -- --name cloudcode-batteries-included
```
