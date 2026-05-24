## Task Completion Requirements

- Always assume a dev server is already running.
- For code changes, run the narrowest useful verification before handing back.
- Always run `pnpm lint`, `pnpm fmt`, `pnpm typecheck`, and `pnpm format:check`.
- Do not start or restart the dev server unless the user explicitly asks.

## Preferences

The user uses speech to text occasionally, so if sentences are weird or words
are not right, infer the likely intent and ask only when needed.

Code is cheap to write. Do not give time estimates; with agents, code is
practically instant to generate. Unless stated otherwise, time to implement is
not a blocker.

## Engineering Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).
   If a tradeoff is required, choose correctness and robustness over short-term convenience.

- Prefer correctness and predictable behavior over short-term convenience.
- Preserve runtime behavior when changing lint, typing, or test structure.
- Keep server, client, worker, and persistence boundaries clear.
- Extract shared logic only when the shared behavior is real and local patterns
  support it. Avoid broad generic abstractions for one-off duplication.
- Prefer shared parsers, validators, and domain helpers over ad hoc request
  parsing when a flow crosses API routes, Convex, Trigger, and sandbox code.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `app/api/*`: thin Next.js request/response plumbing. Validate inputs,
  authenticate/authorize, call domain helpers, and return responses.
- `app/*`: route-level Next.js UI entry points and global app wiring.
- `components/*`: client UI components. Keep browser-only behavior here and
  avoid importing server-only helpers.
- `components/ui/*`: reusable primitive UI pieces and variants.
- `convex/*`: persistence, schema, queries, mutations, and auth-enforced data
  access. Keep database invariants close to the Convex functions that mutate
  them.
- `hooks/*`: browser React hooks that coordinate UI state or client-side
  effects.
- `lib/daytona-*`: Daytona sandbox lifecycle, command execution, terminal, and
  sandbox filesystem integration.
- `lib/sandbox-*`: sandbox authorization, environment, presets, file cache,
  preview proxy, and GitHub setup helpers.
- `lib/codex-*`: Codex auth, run log parsing, worker loading, branch naming, and
  run orchestration helpers.
- `lib/github-*`: GitHub OAuth and token handling.
- `trigger/*`: asynchronous Trigger.dev jobs. Keep job orchestration here and
  push reusable runtime behavior into `lib/*`.
- `scripts/*`: local operational scripts such as snapshots and experiments.

## Reference Repos

Repos in `/Users/robertrusinek/examples/` are
available for patterns. Inspect them for structure and conventions, but adapt
ideas to Cloudcode's current Next.js, Convex, Trigger, and Daytona shape.

## Attribution

Do not add any AI assistant, Claude, Anthropic, or Co-Authored-By attribution
trailers to commits, commit messages, PRs, or generated files.
