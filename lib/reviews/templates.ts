import type { Model, Speed, Thinking } from "@/lib/chat/options"
import {
  DEFAULT_REVIEW_AUTOFIX_PROMPT,
  DEFAULT_REVIEW_PROMPT,
} from "@/lib/reviews/prompt"

/** Config presets a template applies to the composer draft alongside its
 * prompt — e.g. "Review & fix" switches autofix on, audits raise thinking. */
export type ReviewTemplateConfig = {
  autofix?: boolean
  model?: Model
  reasoningEffort?: Thinking
  reviewOnPush?: boolean
  reviewReadyForReview?: boolean
  speed?: Speed
}

export type ReviewTemplate = {
  config: ReviewTemplateConfig
  description: string
  id: string
  name: string
  prompt: string
}

const SECURITY_AUDIT_PROMPT = `You are performing a security audit of a pull request. The PR head is already checked out on the current branch; the base branch is available as origin/<base> (see the pull request context below). Inspect the change with \`git diff origin/<base>...HEAD\`.

Method — do not just read the diff:
1. Trace every piece of untrusted input the change touches (request params, headers, webhooks, file contents, env, third-party API responses) from entry point to sink.
2. For every new or changed endpoint, handler, or query: check authentication, authorization, and object ownership (IDOR) explicitly — name the check that protects it, or flag its absence.
3. Review dependency and configuration changes (lockfiles, CI, Dockerfiles, IaC) as part of the attack surface.
4. Think like an attacker: for each finding, work out a concrete exploitation path before reporting it.

Scan for vulnerabilities in these categories:
- Injection: SQL/NoSQL, command, template, XSS (stored/reflected/DOM), header/CRLF, LDAP, log injection
- Auth & session flaws: missing/broken access control, IDOR, privilege escalation, auth bypass, session fixation, weak or unverified JWT handling, insecure password reset flows
- Secrets exposure: hardcoded keys, tokens in logs or error messages, credentials in source, secrets in client bundles
- Request forgery & traversal: SSRF, path traversal, zip slip, open redirects, CSRF on state-changing endpoints
- Unsafe data handling: insecure deserialization, prototype pollution, mass assignment, missing validation on untrusted data (including file uploads: type, size, path)
- Weak cryptography: broken algorithms, predictable randomness, poor key management, non-constant-time comparisons of secrets
- Transport & browser security: missing HTTPS enforcement, permissive CORS, insecure cookie flags, missing/weakened CSP, clickjacking
- Concurrency: race conditions and TOCTOU windows with security impact (double-spend, duplicate redemption)
- Availability: unbounded loops or allocations driven by untrusted input, ReDoS-prone regexes, missing rate limits on expensive or sensitive operations
- Supply chain: new or updated dependencies (typosquats, install scripts, known-vulnerable versions), CI workflow changes that leak secrets or run untrusted code
- Privacy & information leaks: PII in logs, verbose errors exposing internals, debug endpoints left enabled
- Insecure defaults or misconfigurations introduced by the PR

Produce one Markdown report with exactly these sections:

## Summary
What the PR does, its attack surface, and its overall security posture, in a few sentences.

## Security findings
Numbered findings ordered by severity, each with a file:line reference and one label:
- **Critical** — high-confidence vulnerabilities that should be fixed before merging.
- **Warning** — potential security weaknesses worth investigating.
For every finding include: the concrete attack scenario (who sends what, and what they gain) and a proposed fix. Write "No security findings." if there are none.

## Hardening opportunities
Optional defense-in-depth improvements adjacent to the change (better defaults, missing headers, stricter validation) that are not vulnerabilities themselves. Write "None." if there are none.

End the report with exactly these two final lines:
Confidence to merge: X/5
Reason: <one or two sentences naming what drives the score — the specific vulnerabilities holding it down, or the checks and evidence supporting it>
(1 = do not merge, 5 = safe to merge. Never give the score without the Reason line.)`

const TEST_GAPS_PROMPT = `You are reviewing the test coverage of a pull request. The PR head is already checked out on the current branch; the base branch is available as origin/<base> (see the pull request context below). Inspect the change with \`git diff origin/<base>...HEAD\`, find the project's existing test setup, and run the tests that cover the changed code to see what actually executes.

Judge coverage by behavior, not line counts:
- New logic: is every branch, error path, and boundary condition exercised?
- Changed logic: do existing tests still pin the old behavior, or did they silently start asserting the new one without review?
- Bug-fix PRs: is there a regression test that fails without the fix?
- Edge inputs: empty, null, oversized, malformed, concurrent, and unauthorized cases for anything touching IO or user input.

Produce one Markdown report with exactly these sections:

## Summary
What the PR does and how it is currently tested (which suites, what they cover), in a few sentences.

## Coverage gaps
Numbered gaps ordered by risk, each with a file:line reference to the untested code and a note on what could break silently. Write "No significant gaps." if coverage is adequate.

## Proposed tests
Concrete test cases for each gap, matched by number — name the file they belong in and sketch the test code in the project's existing style and framework.

End the report with exactly these two final lines:
Confidence to merge: X/5
Reason: <one or two sentences naming what drives the score — the riskiest untested behavior holding it down, or the coverage evidence supporting it>
(1 = do not merge, 5 = safe to merge. Never give the score without the Reason line.)`

export const REVIEW_TEMPLATES: ReviewTemplate[] = [
  {
    config: { reviewOnPush: true },
    description: "Findings, flags, security scan, and a confidence score.",
    id: "review",
    name: "Review only",
    prompt: DEFAULT_REVIEW_PROMPT,
  },
  {
    config: { autofix: true, reviewOnPush: true },
    description:
      "Standard review with autofix on: clear bugs get fixed, committed, and pushed to the PR branch.",
    id: "review-fix",
    name: "Review & fix",
    prompt: DEFAULT_REVIEW_AUTOFIX_PROMPT,
  },
  {
    config: { reasoningEffort: "high", reviewOnPush: true },
    description:
      "Deep vulnerability audit with attack scenarios; high thinking effort.",
    id: "security-audit",
    name: "Security audit",
    prompt: SECURITY_AUDIT_PROMPT,
  },
  {
    config: { autofix: true, reasoningEffort: "high", reviewOnPush: true },
    description:
      "Security audit with autofix on: clear vulnerabilities get patched and pushed.",
    id: "security-fix",
    name: "Security audit & fix",
    prompt: SECURITY_AUDIT_PROMPT,
  },
  {
    config: { reviewOnPush: true },
    description: "Find untested behavior and propose concrete tests.",
    id: "test-gaps",
    name: "Test gaps",
    prompt: TEST_GAPS_PROMPT,
  },
]
