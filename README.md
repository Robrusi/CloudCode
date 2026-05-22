# Cloudcode

Cloudcode runs OpenAI Codex CLI tasks inside Daytona sandboxes.
Instead of asking users for API keys, it lets them sign in with ChatGPT through
the Codex OAuth flow, stores the resulting OAuth fields in Convex under the
authenticated Clerk user, and reconstructs `$CODEX_HOME/auth.json` inside each
sandbox just before `codex exec` runs.

## Environment

Create `.env.local` with:

```bash
DAYTONA_API_KEY=...
DAYTONA_API_URL=... # optional
DAYTONA_TARGET=... # optional
DAYTONA_DEFAULT_SNAPSHOT=cloudcode-batteries-included # optional override
DAYTONA_DEFAULT_IMAGE=mcr.microsoft.com/devcontainers/universal:2-linux # optional fallback
DAYTONA_CODEX_RUNTIME_HOME=... # optional clean Codex home parent inside sandboxes
DAYTONA_CREATE_TIMEOUT_SECONDS=480 # optional, useful for large cold snapshots
DAYTONA_COMMAND_STATUS_POLL_MS=2000 # optional, Daytona async command status polling
DAYTONA_COMMAND_STATUS_MAX_POLL_MS=5000 # optional, max polling backoff
DAYTONA_AUTO_STOP_MINUTES=30 # optional
DAYTONA_AUTO_ARCHIVE_MINUTES=10080 # optional
DAYTONA_AUTO_DELETE_MINUTES=43200 # optional
DAYTONA_SANDBOX_CPU=2 # optional; also used for rebuilt snapshots
DAYTONA_SANDBOX_MEMORY=4 # optional, GB; also used for rebuilt snapshots
DAYTONA_SANDBOX_DISK=10 # optional, GB; also used for rebuilt snapshots
NEXT_PUBLIC_CONVEX_URL=...
NEXT_PUBLIC_CONVEX_SITE_URL=...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
GITHUB_TOKEN=... # optional, required for private repos or pushing elsewhere
CLOUDCODE_SECRET_ENCRYPTION_KEY=... # required for Trigger workers if CLERK_SECRET_KEY is not set there
TRIGGER_PROJECT_REF=...
TRIGGER_SECRET_KEY=...
TRIGGER_WORKER_SECRET=... # same value in Trigger and Convex env; local Trigger dev can read it here
```

Convex also needs `CLERK_JWT_ISSUER_DOMAIN` set on the deployment, for example:

```bash
pnpm exec convex env set CLERK_JWT_ISSUER_DOMAIN https://your-app.clerk.accounts.dev
pnpm exec convex env set TRIGGER_WORKER_SECRET your-long-random-shared-secret
```

In Clerk, create a JWT template named `convex` with audience `convex`.

In production, the Next/Vercel app needs `TRIGGER_SECRET_KEY` so API routes can
queue and cancel Trigger runs. The Trigger.dev project needs the worker runtime
variables: `NEXT_PUBLIC_CONVEX_URL`, `TRIGGER_WORKER_SECRET`, Daytona settings,
and `CLOUDCODE_SECRET_ENCRYPTION_KEY` when preset secrets are encrypted with that
dedicated key. Convex must use the exact same `TRIGGER_WORKER_SECRET` value as
the Trigger worker; generate it once and reuse it rather than creating separate
values.

## Daytona base image

Blank Cloudcode presets use `DAYTONA_DEFAULT_SNAPSHOT`, which defaults to
`cloudcode-batteries-included`. Set `DAYTONA_DEFAULT_IMAGE` only as the fallback
for an environment where no default snapshot is configured.

For faster and more reproducible startup, you can build a Cloudcode snapshot:

```bash
pnpm daytona:snapshot -- --name cloudcode-batteries-included
```

The snapshot builder starts from `DAYTONA_DEFAULT_IMAGE` and adds broad CLI,
build, and language tooling: Git, ripgrep, jq, shellcheck, tmux, database
clients, Corepack package managers, Vite+, Bun, `uv`, `mise`, TypeScript
helpers, the Codex CLI, Java, Dart, Flutter, Ruby, Go, Rust, Python, PHP, .NET,
Swift, and Kotlin.
Use the printed snapshot name in a preset, or leave the built-in
`DAYTONA_DEFAULT_SNAPSHOT` default in place. Rebuild an existing snapshot with
`pnpm daytona:snapshot -- --name cloudcode-batteries-included --rebuild`.

Per-preset Daytona snapshot names still win over the configured global snapshot.
Use those when a repo needs a stricter image, for example a specific CUDA, Java,
Android, or language-runtime setup. Presets can also include a repo install
script, which runs from the cloned repo root before Codex starts.

## OAuth setup

1. Start the app and open `/`.
2. Click **Sign in with ChatGPT**.
3. Complete the ChatGPT OAuth flow.

The login route requires a Clerk session, then starts a short-lived local
callback server on `localhost:1455`
or `localhost:1457`, matching the Codex CLI OAuth callback ports. After the
callback succeeds, Convex stores the ChatGPT OAuth record for the signed-in
Clerk user:

- `authMode: "chatgpt"`
- `idToken`
- `accessToken`
- `refreshToken`
- `accountId`
- `lastRefresh`

Codex OAuth refresh tokens can be single-use during refresh. This app stores one
canonical ChatGPT OAuth record per Clerk user/profile in Convex and hydrates it
into a fresh sandbox for each run. If Codex refreshes credentials during a
sandbox run, the updated auth is parsed and persisted back to Convex.

## API

Read the current sanitized auth status:

```bash
curl http://localhost:3000/api/codex-auth
```

Run Codex on a cloned GitHub repository:

```bash
curl -X POST http://localhost:3000/api/codex-run \
  -H 'content-type: application/json' \
  -d '{
    "repoUrl": "https://github.com/your-org/your-repo.git",
    "baseBranch": "main",
    "branchName": "cloudcode/my-change",
    "model": "gpt-5.5",
    "reasoningEffort": "high",
    "speed": "fast",
    "prompt": "Add error handling to all API endpoints"
  }'
```

The runner creates or reconnects a Daytona sandbox, using the selected Daytona
preset snapshot when provided, then the default `cloudcode-batteries-included`
snapshot, then `DAYTONA_DEFAULT_IMAGE` only when no snapshot is configured. It
clones the repo to the sandbox user's `~/repo`, creates the requested branch,
writes preset secrets to `.env.local`, runs any preset install script inside
`~/repo`, runs `codex exec`, and returns the branch name, status, diff, stdout,
stderr, and final Codex message. Daytona owns the lifecycle: Cloudcode only
adjusts auto-stop while a Codex run is active and deletes the sandbox when its
chat is deleted.

`reasoningEffort` maps to Codex `model_reasoning_effort` and accepts `none`,
`low`, `medium`, `high`, or `xhigh`. `speed` accepts `standard` or `fast`;
`fast` maps to Codex `service_tier = "fast"`.

## Run

```bash
pnpm dev
```

Trigger.dev runs Codex jobs outside the request/response lifecycle. In a second
terminal, start the Trigger worker:

```bash
pnpm trigger:dev
```

Deploy the worker with:

```bash
pnpm trigger:deploy
```
