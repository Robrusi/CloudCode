# Cloudcode

Cloudcode runs OpenAI Codex CLI tasks inside disposable E2B `codex` sandboxes.
Instead of asking users for API keys, it lets them sign in with ChatGPT through
the Codex OAuth flow, stores the resulting OAuth fields in Convex under the
authenticated Clerk user, and reconstructs `$CODEX_HOME/auth.json` inside each
sandbox just before `codex exec` runs.

## Environment

Create `.env.local` with:

```bash
E2B_API_KEY=...
NEXT_PUBLIC_CONVEX_URL=...
NEXT_PUBLIC_CONVEX_SITE_URL=...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
GITHUB_TOKEN=... # optional, required for private repos or pushing elsewhere
```

Convex also needs `CLERK_JWT_ISSUER_DOMAIN` set on the deployment, for example:

```bash
pnpm exec convex env set CLERK_JWT_ISSUER_DOMAIN https://your-app.clerk.accounts.dev
```

In Clerk, create a JWT template named `convex` with audience `convex`.

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

The runner creates an E2B sandbox from the `codex` template, clones the repo to
`/home/user/repo`, creates the requested branch, runs `codex exec -C
/home/user/repo`, and returns the branch name, status, diff, stdout, stderr, and
final Codex message.

`reasoningEffort` maps to Codex `model_reasoning_effort` and accepts `none`,
`low`, `medium`, `high`, or `xhigh`. `speed` accepts `standard` or `fast`;
`fast` maps to Codex `service_tier = "fast"`.

## Run

```bash
pnpm dev
```
