import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import {
  CodexAppServerStdioRpcClient,
  type CodexAppServerTransport,
  createCodexAppServerTurnReducer,
  type CodexAppServerNotification,
} from "@/lib/codex-app-server"
import {
  buildCodexAuthJsonFromParsed,
  parseCodexAuthJson,
} from "@/lib/codex-auth-json"
import { getFilePathFromHref, normalizeLinkHref } from "@/lib/chat-link-path"
import { refreshCodexOAuthTokens } from "@/lib/codex-oauth-refresh"
import {
  inlineToolMarker,
  shouldPersistRunLog,
  stripInlineToolMarkers,
} from "@/lib/codex-run-log"
import { workerRunFinalContent } from "@/lib/codex-run-worker"
import { cloudcodeContextCodexConfig } from "@/lib/daytona-context"
import {
  codexAppServerDaemonCommand,
  appServerThreadParams,
  codexAppServerNotificationRoute,
  codexAppServerStderrLogForLine,
  codexAppServerStdioCommand,
  parseCodexAppServerDaemonEventLine,
} from "@/lib/daytona-codex-agent"
import type {
  RunCodexInSandboxResult,
  RunCodexLog,
} from "@/lib/daytona-codex-agent"

const testPaths = {
  baseRefPath: "/tmp/base-ref",
  cloudcodeProfilePath: "/tmp/profile",
  codexHome: "/tmp/codex",
  codexLauncherPath: "/tmp/codex-launcher",
  home: "/tmp/home",
  lastMessagePath: "/tmp/last-message",
  presetEnvPath: "/tmp/preset-env",
  previousDiffPath: "/tmp/previous-diff",
  promptPath: "/tmp/prompt",
  repoPath: "/workspace/repo",
  runtimeHome: "/tmp/runtime-home",
}
const stdioCommand = codexAppServerStdioCommand({
  env: {
    CODEX_HOME: "/tmp/codex",
    HOME: "/tmp/home",
    "bad-name": "ignored",
  },
  paths: testPaths,
})
assert.ok(stdioCommand.includes("app-server"))
assert.ok(!stdioCommand.includes("--listen"))
assert.ok(stdioCommand.includes("CODEX_HOME="))
assert.ok(!stdioCommand.includes("bad-name"))
const daemonCommand = codexAppServerDaemonCommand({
  daemonPaths: {
    clientPath: "/tmp/daemon-client.mjs",
    scriptPath: "/tmp/daemon.mjs",
    sessionId: "daemon-session",
    socketPath: "/tmp/daemon.sock",
    statePath: "/tmp/daemon.json",
  },
  env: {
    CLOUDCODE_DAEMON_SOCKET: "/tmp/daemon.sock",
    CODEX_HOME: "/tmp/codex",
    HOME: "/tmp/home",
  },
  paths: testPaths,
})
assert.ok(daemonCommand.includes("exec node"))
assert.ok(daemonCommand.includes("/tmp/daemon.mjs"))
assert.ok(daemonCommand.includes("CLOUDCODE_DAEMON_SOCKET="))
assert.ok(!daemonCommand.includes("--listen"))
assert.deepEqual(
  parseCodexAppServerDaemonEventLine(
    '{"type":"thread","threadId":"thread-from-daemon"}'
  ),
  { threadId: "thread-from-daemon", type: "thread" }
)
assert.deepEqual(
  parseCodexAppServerDaemonEventLine(
    '{"type":"result","threadId":"thread-from-daemon","status":"completed","updatedAuthJson":"{\\"auth_mode\\":\\"chatgpt\\"}"}'
  ),
  {
    status: "completed",
    threadId: "thread-from-daemon",
    type: "result",
    updatedAuthJson: '{"auth_mode":"chatgpt"}',
  }
)
assert.deepEqual(
  parseCodexAppServerDaemonEventLine(
    '{"type":"setup","message":"Codex using bundled bubblewrap sandbox helper"}'
  ),
  {
    message: "Codex using bundled bubblewrap sandbox helper",
    type: "setup",
  }
)
assert.equal(parseCodexAppServerDaemonEventLine("not-json"), undefined)
const daytonaCodexAgentSource = await readFile(
  new URL("../lib/daytona-codex-agent.ts", import.meta.url),
  "utf8"
)
assert.ok(!daytonaCodexAgentSource.includes("restoredConversationPrompt"))
assert.ok(!daytonaCodexAgentSource.includes("resumeFallbackPrompt"))
assert.ok(!daytonaCodexAgentSource.includes("restoring conversation context"))
assert.ok(!daytonaCodexAgentSource.includes("runCodexViaEphemeralAppServer"))
assert.ok(!daytonaCodexAgentSource.includes("Preparing Codex auth"))
assert.ok(
  !daytonaCodexAgentSource.includes("Codex app-server daemon already running")
)
assert.ok(!daytonaCodexAgentSource.includes("Repo already prepared"))
assert.ok(daytonaCodexAgentSource.includes("authHash: sha256(input.authJson)"))
const daemonScriptSource = await readFile(
  new URL("../lib/codex-app-server-daemon-script.ts", import.meta.url),
  "utf8"
)
assert.ok(daemonScriptSource.includes("initializedAuthHash"))
assert.ok(daemonScriptSource.includes("fs.chmodSync(CODEX_HOME"))
assert.ok(daemonScriptSource.includes("isBundledBubblewrapWarning"))
assert.deepEqual(
  codexAppServerStderrLogForLine(
    "Codex could not find bubblewrap on PATH. Codex will use the bundled bubblewrap in the meantime."
  ),
  {
    kind: "setup",
    message: "Codex using bundled bubblewrap sandbox helper",
  }
)
assert.equal(
  codexAppServerStderrLogForLine(
    "Codex could not find bubblewrap on PATH. Codex will use the bundled bubblewrap in the meantime.",
    { bundledBubblewrapWarningAlreadyLogged: true }
  ),
  undefined
)
assert.deepEqual(
  codexAppServerStderrLogForLine("\u001b[31mreal error\u001b[0m"),
  {
    kind: "stderr",
    message: "real error",
  }
)
const contextMcpConfig = cloudcodeContextCodexConfig({
  convexUrl: "https://example.convex.cloud",
  notesAccessToken: "notes-token",
  paths: testPaths,
  runId: "run-1",
  threadId: "thread-1",
})
assert.ok(contextMcpConfig.includes("[mcp_servers.cloudcode_context]"))
assert.ok(contextMcpConfig.includes("cloudcode-context-mcp.mjs"))
assert.ok(contextMcpConfig.includes("CLOUDCODE_RUN_ID"))
assert.ok(contextMcpConfig.includes("CLOUDCODE_THREAD_ID"))
assert.equal(
  cloudcodeContextCodexConfig({
    convexUrl: "",
    notesAccessToken: "notes-token",
    paths: testPaths,
    runId: "run-1",
    threadId: "thread-1",
  }),
  ""
)
assert.deepEqual(
  codexAppServerNotificationRoute({
    method: "turn/completed",
    params: { threadId: "thread-1", turn: { id: "turn-1" } },
  }),
  { threadId: "thread-1", turnId: "turn-1" }
)
assert.deepEqual(
  appServerThreadParams({
    model: "gpt-5.4",
    paths: testPaths,
    reasoningEffort: "high",
    speed: "fast",
  }).config,
  {
    approval_policy: "never",
    model_reasoning_effort: "high",
    sandbox_mode: "danger-full-access",
    service_tier: "fast",
  }
)

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value))
    .toString("base64url")
    .replace(/=+$/, "")
}

const idToken = [
  base64UrlJson({ alg: "none" }),
  base64UrlJson({
    "https://api.openai.com/auth": {
      chatgpt_account_id: "account-from-id-token",
    },
  }),
  "signature",
].join(".")
const authJson = buildCodexAuthJsonFromParsed({
  accessToken: "access-token",
  accountId: null,
  idToken,
  lastRefresh: "2026-06-06T00:00:00.000Z",
  refreshToken: "refresh-token",
})
assert.deepEqual(parseCodexAuthJson(authJson), {
  accessToken: "access-token",
  accountId: "account-from-id-token",
  idToken,
  lastRefresh: "2026-06-06T00:00:00.000Z",
  openaiApiKey: undefined,
  refreshToken: "refresh-token",
})

const originalFetch = globalThis.fetch
let refreshRequestBody = ""
globalThis.fetch = async (_url, init) => {
  refreshRequestBody = String(init?.body)
  return new Response(
    JSON.stringify({
      access_token: "new-access-token",
      id_token: "new-id-token",
      refresh_token: "new-refresh-token",
    }),
    {
      headers: { "Content-Type": "application/json" },
      status: 200,
    }
  )
}
const refreshedTokens = await refreshCodexOAuthTokens("old-refresh-token")
globalThis.fetch = originalFetch
assert.deepEqual(refreshedTokens, {
  accessToken: "new-access-token",
  idToken: "new-id-token",
  refreshToken: "new-refresh-token",
})
assert.ok(refreshRequestBody.includes("grant_type=refresh_token"))
assert.ok(refreshRequestBody.includes("refresh_token=old-refresh-token"))

const deltas: string[] = []
const logs: RunCodexLog[] = []
const reducer = createCodexAppServerTurnReducer({
  onContentDelta: (delta) => {
    deltas.push(delta)
  },
  onLog: (log) => {
    logs.push(log)
  },
})

reducer.handleNotification({
  method: "turn/started",
  params: {
    threadId: "thread-1",
    turn: { id: "turn-1", status: "inProgress" },
  },
})
reducer.handleNotification({
  method: "item/agentMessage/delta",
  params: {
    delta: "Hello",
    itemId: "agent-1",
    threadId: "thread-1",
    turnId: "turn-1",
  },
})
reducer.handleNotification({
  method: "item/agentMessage/delta",
  params: {
    delta: " world",
    itemId: "agent-1",
    threadId: "thread-1",
    turnId: "turn-1",
  },
})
reducer.handleNotification({
  method: "item/started",
  params: {
    item: {
      id: "cmd-1",
      aggregatedOutput: null,
      command: "pnpm typecheck",
      cwd: "/workspace/repo",
      exitCode: null,
      status: "inProgress",
      type: "commandExecution",
    },
    threadId: "thread-1",
    turnId: "turn-1",
  },
})
reducer.handleNotification({
  method: "item/commandExecution/outputDelta",
  params: {
    delta: "checking types\n",
    itemId: "cmd-1",
    threadId: "thread-1",
    turnId: "turn-1",
  },
})
reducer.handleNotification({
  method: "item/mcpToolCall/progress",
  params: {
    itemId: "mcp-1",
    message: "Calling cloudcode_desktop.desktop_open_browser",
    threadId: "thread-1",
    turnId: "turn-1",
  },
})
reducer.handleNotification({
  method: "item/completed",
  params: {
    item: {
      id: "cmd-1",
      aggregatedOutput: null,
      command: "pnpm typecheck",
      cwd: "/workspace/repo",
      exitCode: 0,
      status: "completed",
      type: "commandExecution",
    },
    threadId: "thread-1",
    turnId: "turn-1",
  },
})
reducer.handleNotification({
  method: "item/fileChange/patchUpdated",
  params: {
    changes: [
      {
        diff: "@@ @@\n-old\n+new\n",
        kind: { type: "update" },
        path: "src/example.ts",
      },
    ],
    itemId: "file-1",
    threadId: "thread-1",
    turnId: "turn-1",
  },
})
reducer.handleNotification({
  method: "item/completed",
  params: {
    item: {
      id: "file-1",
      changes: [],
      status: "completed",
      type: "fileChange",
    },
    threadId: "thread-1",
    turnId: "turn-1",
  },
})
reducer.handleNotification({
  method: "item/completed",
  params: {
    item: {
      id: "mcp-1",
      arguments: { url: "http://localhost:3000" },
      result: { content: [{ text: "opened", type: "text" }] },
      server: "cloudcode_desktop",
      status: "completed",
      tool: "desktop_open_browser",
      type: "mcpToolCall",
    },
    threadId: "thread-1",
    turnId: "turn-1",
  },
})
for (const item of [
  {
    id: "plan-1",
    text: "Do the thing",
    type: "plan",
  },
  {
    id: "collab-1",
    agentsStates: {},
    model: "gpt-5",
    prompt: "Check this",
    reasoningEffort: "medium",
    receiverThreadIds: ["thread-2"],
    senderThreadId: "thread-1",
    status: "completed",
    tool: "spawn",
    type: "collabAgentToolCall",
  },
  {
    id: "image-1",
    path: "/tmp/screenshot.png",
    type: "imageView",
  },
  {
    id: "image-generation-1",
    result: "done",
    revisedPrompt: "A screenshot",
    savedPath: "/tmp/generated.png",
    status: "completed",
    type: "imageGeneration",
  },
  {
    id: "review-1",
    review: "review-id",
    type: "enteredReviewMode",
  },
  {
    id: "compact-1",
    type: "contextCompaction",
  },
]) {
  reducer.handleNotification({
    method: "item/completed",
    params: {
      item,
      threadId: "thread-1",
      turnId: "turn-1",
    },
  })
}
reducer.handleNotification({
  method: "turn/plan/updated",
  params: {
    explanation: "Need a small plan",
    plan: [{ status: "completed", step: "Read protocol" }],
    threadId: "thread-1",
    turnId: "turn-1",
  },
})
reducer.handleNotification({
  method: "configWarning",
  params: {
    details: "Unknown key was ignored",
    path: "/tmp/config.toml",
    summary: "Config warning",
  },
})
reducer.handleNotification({
  method: "deprecationNotice",
  params: {
    details: "Use the new field",
    summary: "Deprecated config",
  },
})
reducer.handleNotification({
  method: "model/rerouted",
  params: {
    fromModel: "gpt-5.4",
    reason: "unavailable",
    threadId: "thread-1",
    toModel: "gpt-5.4-mini",
    turnId: "turn-1",
  },
})
reducer.handleNotification({
  method: "thread/compacted",
  params: {
    threadId: "thread-1",
    turnId: "turn-1",
  },
})
reducer.handleNotification({
  method: "mcpServer/oauthLogin/completed",
  params: {
    name: "demo_mcp",
    success: true,
  },
})
reducer.handleNotification({
  method: "thread/status/changed",
  params: {
    status: "running",
    threadId: "thread-1",
  },
})
reducer.handleNotification({
  method: "thread/tokenUsage/updated",
  params: {
    threadId: "thread-1",
    tokenUsage: { inputTokens: 10, totalTokens: 15 },
    turnId: "turn-1",
  },
})
reducer.handleNotification({
  method: "item/autoApprovalReview/completed",
  params: {
    action: { type: "commandExecution" },
    decisionSource: "policy",
    reviewId: "review-1",
    targetItemId: "cmd-1",
    threadId: "thread-1",
    turnId: "turn-1",
  },
})
reducer.handleNotification({
  method: "process/outputDelta",
  params: {
    capReached: false,
    deltaBase64: Buffer.from("process stderr\n").toString("base64"),
    processHandle: "process-1",
    stream: "stderr",
  },
})
reducer.handleNotification({
  method: "process/exited",
  params: {
    exitCode: 1,
    processHandle: "process-1",
    stderr: "failed",
    stderrCapReached: false,
    stdout: "",
    stdoutCapReached: false,
  },
})
reducer.handleNotification({
  method: "item/reasoning/summaryPartAdded",
  params: {
    itemId: "reasoning-1",
    summaryIndex: 0,
    threadId: "thread-1",
    turnId: "turn-1",
  },
})
reducer.handleNotification({
  method: "model/verification",
  params: {
    threadId: "thread-1",
    turnId: "turn-1",
    verifications: [{ model: "gpt-5" }],
  },
})
reducer.handleNotification({
  method: "rawResponseItem/completed",
  params: {
    item: { type: "message" },
    threadId: "thread-1",
    turnId: "turn-1",
  },
})
reducer.handleNotification({
  method: "turn/completed",
  params: {
    threadId: "thread-1",
    turn: {
      error: null,
      id: "turn-1",
      items: [
        {
          id: "agent-1",
          text: "Hello world",
          type: "agentMessage",
        },
      ],
      status: "completed",
    },
  },
})

assert.deepEqual(deltas, ["Hello", " world"])
assert.equal(reducer.summary().finalAssistantText, "Hello world")
assert.equal(reducer.summary().status, "completed")
assert.ok(logs.some((log) => log.message === "Shell command"))
assert.ok(
  logs.some((log) => log.kind === "stdout" && log.message === "checking types")
)
const completedCommandLog = logs
  .filter((log) => log.message === "Shell command")
  .at(-1)
assert.ok(completedCommandLog?.detail?.includes("checking types"))
const fileChangeLog = logs.find((log) => log.message === "File change")
assert.ok(fileChangeLog?.detail?.includes('"kind":"update"'))
assert.ok(fileChangeLog?.detail?.includes("src/example.ts"))
assert.ok(
  logs.some((log) => log.message === "cloudcode_desktop.desktop_open_browser")
)
assert.ok(logs.some((log) => log.message === "Plan"))
assert.ok(logs.some((log) => log.message === "spawn"))
assert.ok(logs.some((log) => log.message === "Image view"))
assert.ok(logs.some((log) => log.message === "Image generation"))
assert.ok(logs.some((log) => log.message === "Entered review mode"))
assert.ok(logs.some((log) => log.message === "Plan updated"))
assert.ok(
  logs.some(
    (log) => log.kind === "stderr" && log.message.includes("Config warning")
  )
)
assert.ok(
  logs.some(
    (log) => log.kind === "stderr" && log.message.includes("Deprecated config")
  )
)
assert.ok(logs.some((log) => log.message.includes("Model rerouted")))
assert.ok(logs.some((log) => log.message === "Codex compacted context"))
assert.ok(logs.some((log) => log.message.includes("OAuth login completed")))
assert.ok(logs.some((log) => log.message === "Codex thread status: running"))
assert.equal(
  logs.some((log) => log.message === "Codex token usage updated"),
  false
)
assert.equal(
  logs.some((log) => log.message === "Codex rate limits updated"),
  false
)
assert.equal(
  logs.some((log) => log.message === "Codex turn started"),
  false
)
assert.ok(
  logs.some((log) => log.message === "Automatic approval review completed")
)
for (const message of ["Codex diff updated", "File change", "Shell command"]) {
  assert.equal(shouldPersistRunLog({ message }), false)
}
assert.equal(shouldPersistRunLog({ message: "Codex run completed" }), true)
assert.equal(shouldPersistRunLog({ message: "Reasoning summary" }), true)
assert.ok(
  logs.some((log) => log.kind === "stderr" && log.message === "process stderr")
)
assert.ok(logs.some((log) => log.message === "Process exited with code 1"))
assert.ok(logs.some((log) => log.message === "Reasoning summary part added"))
assert.ok(logs.some((log) => log.message === "Model verification updated"))
assert.ok(logs.some((log) => log.message === "Raw response item completed"))
const mcpLog = logs.find(
  (log) => log.message === "cloudcode_desktop.desktop_open_browser"
)
assert.ok(mcpLog)
assert.ok(mcpLog.detail?.includes("opened"))
assert.ok(mcpLog.detail?.includes('"itemId":"mcp-1"'))
const mcpMarker = inlineToolMarker(mcpLog)
assert.ok(mcpMarker)
assert.ok(mcpMarker.includes("mcp-1"))
const mcpProgressLog = logs.find(
  (log) => log.message === "Calling cloudcode_desktop.desktop_open_browser"
)
assert.ok(mcpProgressLog)
assert.ok(mcpProgressLog.detail?.includes('"itemId":"mcp-1"'))
assert.equal(inlineToolMarker(mcpProgressLog), null)

const authoritativeResult = {
  branchName: "codex/test",
  diff: "",
  exitCode: 0,
  lastMessage: "Final answer",
  lastMessageAuthoritative: true,
  recoveredSandbox: false,
  repoUrl: "https://github.com/example/repo",
  sandboxId: "sandbox-1",
  status: "",
  stderr: "",
  stdout: "",
  updatedAuthJson: "{}",
} satisfies RunCodexInSandboxResult
const authoritativeContent = workerRunFinalContent(
  `Partial stale stream${mcpMarker}`,
  authoritativeResult
)
assert.equal(
  stripInlineToolMarkers(authoritativeContent),
  "Partial stale stream\n\nFinal answer"
)
assert.ok(authoritativeContent.includes("<codex-tool>"))
assert.equal(
  stripInlineToolMarkers(
    workerRunFinalContent(`${mcpMarker}Final answer`, authoritativeResult)
  ),
  "Final answer"
)

const nonAuthoritativeContent = workerRunFinalContent(
  `Partial stale stream${mcpMarker}`,
  { ...authoritativeResult, lastMessageAuthoritative: false }
)
assert.equal(
  stripInlineToolMarkers(nonAuthoritativeContent),
  "Partial stale stream"
)
assert.equal(
  normalizeLinkHref("https://example.com/repo/app/page.tsx"),
  "https://example.com/repo/app/page.tsx"
)
assert.equal(
  getFilePathFromHref("https://example.com/repo/app/page.tsx", "repo"),
  null
)
assert.equal(
  getFilePathFromHref("/root/repo/app/page.tsx:12", "repo"),
  "app/page.tsx"
)
assert.equal(
  getFilePathFromHref("components/chat.tsx", "repo"),
  "components/chat.tsx"
)

const failed = createCodexAppServerTurnReducer({})
failed.handleNotification({
  method: "turn/completed",
  params: {
    threadId: "thread-1",
    turn: {
      error: {
        additionalDetails: "full details",
        message: "boom",
      },
      id: "turn-2",
      items: [],
      status: "failed",
    },
  },
})

assert.equal(failed.summary().status, "failed")
assert.equal(failed.summary().turnError, "boom\nfull details")

const finalOnlyLogs: RunCodexLog[] = []
const finalOnly = createCodexAppServerTurnReducer({
  onLog: (log) => {
    finalOnlyLogs.push(log)
  },
})
finalOnly.handleNotification({
  method: "turn/completed",
  params: {
    threadId: "thread-final-only",
    turn: {
      error: null,
      id: "turn-final-only",
      items: [
        {
          id: "cmd-final-only",
          aggregatedOutput: "from final turn",
          command: "pnpm test",
          cwd: "/workspace/repo",
          exitCode: 0,
          status: "completed",
          type: "commandExecution",
        },
        {
          id: "mcp-final-only",
          arguments: {},
          result: { content: [{ text: "from final mcp", type: "text" }] },
          server: "cloudcode_context",
          status: "completed",
          tool: "notes_read",
          type: "mcpToolCall",
        },
        {
          id: "agent-final-only",
          text: "Final only answer",
          type: "agentMessage",
        },
      ],
      status: "completed",
    },
  },
})
assert.equal(finalOnly.summary().finalAssistantText, "Final only answer")
assert.ok(
  finalOnlyLogs.some(
    (log) =>
      log.message === "Shell command" && log.detail?.includes("pnpm test")
  )
)
assert.ok(
  finalOnlyLogs.some((log) => log.message === "cloudcode_context.notes_read")
)

const dedupeLogs: RunCodexLog[] = []
const dedupe = createCodexAppServerTurnReducer({
  onLog: (log) => {
    dedupeLogs.push(log)
  },
})
const dedupeCommand = {
  id: "cmd-dedupe",
  aggregatedOutput: "already logged",
  command: "pnpm lint",
  cwd: "/workspace/repo",
  exitCode: 0,
  status: "completed",
  type: "commandExecution",
}
dedupe.handleNotification({
  method: "item/completed",
  params: {
    item: dedupeCommand,
    threadId: "thread-dedupe",
    turnId: "turn-dedupe",
  },
})
dedupe.handleNotification({
  method: "turn/completed",
  params: {
    threadId: "thread-dedupe",
    turn: {
      error: null,
      id: "turn-dedupe",
      items: [dedupeCommand],
      status: "completed",
    },
  },
})
assert.equal(
  dedupeLogs.filter((log) => log.message === "Shell command").length,
  1
)

const mcpStartupLogs: RunCodexLog[] = []
const mcpStartup = createCodexAppServerTurnReducer({
  onLog: (log) => {
    mcpStartupLogs.push(log)
  },
})
for (const status of ["starting", "ready", "starting", "ready"]) {
  mcpStartup.handleNotification({
    method: "mcpServer/startupStatus/updated",
    params: {
      name: "cloudcode_context",
      status,
    },
  })
}
mcpStartup.handleNotification({
  method: "mcpServer/startupStatus/updated",
  params: {
    error: "boom",
    name: "cloudcode_context",
    status: "failed",
  },
})
assert.deepEqual(
  mcpStartupLogs.map((log) => [log.kind, log.message]),
  [["stderr", "cloudcode_context: failed: boom"]]
)

let resolveApprovalResponse!: (value: Record<string, unknown>) => void
let resolveDynamicToolResponse!: (value: Record<string, unknown>) => void
let resolveElicitationResponse!: (value: Record<string, unknown>) => void
let resolveAuthRefreshResponse!: (value: Record<string, unknown>) => void
let resolveAttestationResponse!: (value: Record<string, unknown>) => void
let resolveUnknownResponse!: (value: Record<string, unknown>) => void
const approvalResponse = new Promise<Record<string, unknown>>((resolve) => {
  resolveApprovalResponse = resolve
})
const dynamicToolResponse = new Promise<Record<string, unknown>>((resolve) => {
  resolveDynamicToolResponse = resolve
})
const elicitationResponse = new Promise<Record<string, unknown>>((resolve) => {
  resolveElicitationResponse = resolve
})
const authRefreshResponse = new Promise<Record<string, unknown>>((resolve) => {
  resolveAuthRefreshResponse = resolve
})
const attestationResponse = new Promise<Record<string, unknown>>((resolve) => {
  resolveAttestationResponse = resolve
})
const unknownResponse = new Promise<Record<string, unknown>>((resolve) => {
  resolveUnknownResponse = resolve
})
let connected = true
let client!: CodexAppServerStdioRpcClient
const receiveJson = (value: unknown, suffix = "\n") => {
  client.receive(`${JSON.stringify(value)}${suffix}`)
}
const handleClientMessage = (message: Record<string, unknown>) => {
  if (message.id === "approval-1") {
    resolveApprovalResponse(message)
    return
  }
  if (message.id === "dynamic-tool-1") {
    resolveDynamicToolResponse(message)
    return
  }
  if (message.id === "elicitation-1") {
    resolveElicitationResponse(message)
    return
  }
  if (message.id === "auth-refresh-1") {
    resolveAuthRefreshResponse(message)
    return
  }
  if (message.id === "attestation-1") {
    resolveAttestationResponse(message)
    return
  }
  if (message.id === "unknown-1") {
    resolveUnknownResponse(message)
    return
  }
  if (message.method !== "initialize") return

  receiveJson({
    id: "approval-1",
    method: "item/commandExecution/requestApproval",
    params: {
      itemId: "cmd-approval",
      startedAtMs: Date.now(),
      threadId: "thread-1",
      turnId: "turn-1",
    },
  })
  receiveJson({
    id: "dynamic-tool-1",
    method: "item/tool/call",
    params: {
      arguments: {},
      callId: "call-1",
      namespace: "demo",
      threadId: "thread-1",
      tool: "unsupported",
      turnId: "turn-1",
    },
  })
  receiveJson({
    id: "elicitation-1",
    method: "mcpServer/elicitation/request",
    params: {
      _meta: null,
      message: "Need input",
      mode: "url",
      serverName: "demo",
      threadId: "thread-1",
      turnId: "turn-1",
      url: "https://example.com",
    },
  })
  receiveJson({
    id: "auth-refresh-1",
    method: "account/chatgptAuthTokens/refresh",
    params: {
      previousAccountId: "account-1",
      reason: "token_expired",
    },
  })
  receiveJson({
    id: "attestation-1",
    method: "attestation/generate",
    params: {},
  })
  receiveJson({
    id: "unknown-1",
    method: "cloudcode/unknown",
    params: {},
  })
  client.receive(
    [
      JSON.stringify({ id: message.id, result: { ok: true } }),
      JSON.stringify({
        method: "warning",
        params: { message: "heads up", threadId: null },
      }),
      "",
    ].join("\n")
  )
}
const transport: CodexAppServerTransport = {
  close: () => {
    connected = false
  },
  isConnected: () => connected,
  send: (data) => {
    for (const line of data.split(/\r?\n/)) {
      if (line.trim()) {
        handleClientMessage(JSON.parse(line) as Record<string, unknown>)
      }
    }
  },
}
client = new CodexAppServerStdioRpcClient(transport, {
  generateAttestationToken: () => "attestation-token",
  refreshChatgptAuthTokens: () => ({
    accessToken: "fresh-access-token",
    chatgptAccountId: "account-1",
    chatgptPlanType: null,
  }),
})
const notifications: CodexAppServerNotification[] = []
const notificationReceived = new Promise<void>((resolve) => {
  client.onNotification((notification) => {
    notifications.push(notification)
    resolve()
  })
})

await client.connect()
const response = await client.request("initialize", {
  capabilities: {
    experimentalApi: true,
    requestAttestation: false,
  },
  clientInfo: {
    name: "cloudcode-test",
    title: "Cloudcode Test",
    version: "0.0.0",
  },
})
await notificationReceived
const [
  approvalRequest,
  dynamicToolRequest,
  elicitationRequest,
  authRefreshRequest,
  attestationRequest,
  unknownRequest,
] = await Promise.all([
  approvalResponse,
  dynamicToolResponse,
  elicitationResponse,
  authRefreshResponse,
  attestationResponse,
  unknownResponse,
])
await client.close()

assert.deepEqual(response, { ok: true })
assert.deepEqual(approvalRequest.result, { decision: "decline" })
assert.deepEqual(dynamicToolRequest.result, {
  contentItems: [
    {
      text: "Cloudcode cannot execute app-server dynamic tool request demo.unsupported in this worker.",
      type: "inputText",
    },
  ],
  success: false,
})
assert.deepEqual(elicitationRequest.result, {
  _meta: null,
  action: "decline",
  content: null,
})
assert.deepEqual(authRefreshRequest.result, {
  accessToken: "fresh-access-token",
  chatgptAccountId: "account-1",
  chatgptPlanType: null,
})
assert.deepEqual(attestationRequest.result, {
  token: "attestation-token",
})
assert.deepEqual(unknownRequest.error, {
  code: -32601,
  message:
    "Cloudcode does not implement Codex app-server request: cloudcode/unknown",
})
assert.deepEqual(notifications, [
  { method: "warning", params: { message: "heads up", threadId: null } },
])

let closingConnected = true
const closingClient = new CodexAppServerStdioRpcClient({
  close: () => {
    closingConnected = false
  },
  isConnected: () => closingConnected,
  send: () => undefined,
})
let resolveClosed!: () => void
const closed = new Promise<void>((resolve) => {
  resolveClosed = resolve
})
closingClient.onClose(() => {
  resolveClosed()
})
await closingClient.connect()
closingClient.terminate(new Error("Codex app-server connection closed."))
await assert.rejects(
  closingClient.request("initialize", {
    capabilities: {
      experimentalApi: true,
      requestAttestation: false,
    },
    clientInfo: {
      name: "cloudcode-test",
      title: "Cloudcode Test",
      version: "0.0.0",
    },
  }),
  /closed|not connected/
)
await closed
await closingClient.close()

let partialConnected = true
const partialClient = new CodexAppServerStdioRpcClient({
  close: () => {
    partialConnected = false
  },
  isConnected: () => partialConnected,
  send: () => undefined,
})
const partialNotifications: CodexAppServerNotification[] = []
partialClient.onNotification((notification) => {
  partialNotifications.push(notification)
})
await partialClient.connect()
partialClient.receive('{"method":"warning","params":{"message":"partial"')
assert.equal(partialNotifications.length, 0)
partialClient.receive("}}\n")
assert.deepEqual(partialNotifications, [
  { method: "warning", params: { message: "partial" } },
])
await partialClient.close()
