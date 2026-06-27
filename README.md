# CloudCode

<p align="center">
  <img alt="image" src="/public/Readme.png" />
</p>

<p align="center">
  <a href="https://github.com/robrusi/cloudcode"><img alt="badge" src="https://shieldcn.dev/github/robrusi/cloudcode/stars.svg?variant=secondary" /></a>
  <a href="https://x.com/robrusinek"><img alt="follow" src="https://shieldcn.dev/x/follow/robrusinek.svg?variant=secondary" /></a>
</p>

Cloudcode is a platform for running Codex in sandboxes.

- It has every tool it needs (desktop, terminal, etc)
- Outputs videos of UI changes it tested in the desktop
- Full enviroment setup
- Configure MCP servers for external integrations
- Share project notes so agents and humans can share context
- Connect over SSH.



## Demo

[Watch the demo](https://drive.google.com/file/d/1TXkPj7NiCo4qouHJE5VemrvAAb7LsD-o/view?usp=sharing)


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

<p align="center">
  <img alt="chart" src="https://shieldcn.dev/chart/github/stars/robrusi/cloudcode.svg" />
</p>
