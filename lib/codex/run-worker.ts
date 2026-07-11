import { randomUUID } from "node:crypto"

import { ConvexHttpClient } from "convex/browser"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { redactCodexAuthPayloads } from "@/lib/codex/auth-redaction"
import { requireConvexUrl } from "@/lib/convex/env"
import { getWorkerSecret } from "@/lib/security/worker-secret"
import {
  buildCodexAuthJson,
  codexAuthFingerprint,
  invalidateCodexAuthForWorker,
  saveCodexAuthJsonForWorker,
  type CodexChatGptAuth,
} from "@/lib/codex/auth"
import {
  buildCodexAuthJsonFromParsed,
  getCodexProfileFromIdToken,
} from "@/lib/codex/auth-json"
import { isCodexRefreshTokenReusedError } from "@/lib/codex/auth-errors"
import { refreshCodexOAuthTokens } from "@/lib/codex/oauth-refresh"
import { WorkerRunCanceledError } from "@/lib/codex/run-cancel-error"
import type {
  RunCodexInSandboxInput,
  RunCodexInSandboxResult,
} from "@/lib/daytona/codex-agent-types"
import type { McpServerInput } from "@/lib/daytona/codex-runtime"
import type { CodexRunLog as RunCodexLog } from "@/lib/codex/run-log"
import type { McpDiscoveredServer } from "@/lib/mcp/discovery"
import {
  extractInlineToolMarkers,
  stripInlineToolMarkers,
} from "@/lib/codex/run-log"
import type { ChatImageAttachment } from "@/lib/chat/attachments"
import type { SandboxPresetForRun } from "@/lib/sandbox/presets"
import { refreshMcpOauthToken } from "@/lib/mcp/oauth"
import { mcpOauthProvider } from "@/lib/mcp/oauth-providers"
import { getInitializedIntegrationsBot } from "@/lib/integrations/bot"
import { slackIntegrationEnv } from "@/lib/integrations/config"
import { refreshSlackMcpToken } from "@/lib/integrations/slack-oauth"
import { decryptSecret, encryptSecret } from "@/lib/security/secret-crypto"
import type {
  BillingUsageSource,
  DaytonaBillingResources,
  DaytonaBillingState,
} from "@/lib/billing/model"

const WORKER_CONVEX_URL_ERROR =
  "Set NEXT_PUBLIC_CONVEX_URL before running Trigger tasks."
const AUTH_REFRESH_MAX_WAIT_MS = 2 * 60 * 1000
const AUTH_REFRESH_MAX_RETRY_MS = 5_000

export type WorkerRunPayload = {
  runId: Id<"codexRuns">
}

type WorkerRunRecord = {
  assistantMessageId: Id<"messages">
  baseBranch?: string
  branchMode?: RunCodexInSandboxInput["branchMode"]
  branchName?: string
  codexThreadId?: string
  ephemeralSandbox?: boolean
  githubToken?: string
  githubUserEmail?: string
  githubUserName?: string
  githubUsername?: string
  imageAttachments?: ChatImageAttachment[]
  model: string
  notesAccessToken?: string
  previousDiff?: string
  prNumber?: number
  profile?: string
  prompt: string
  reasoningEffort: RunCodexInSandboxInput["reasoningEffort"]
  repoUrl: string
  resumeContext?: string
  sandboxId?: string
  sandboxPresetId?: Id<"sandboxPresets">
  speed: RunCodexInSandboxInput["speed"]
  threadId: Id<"threads">
  userId: Id<"users">
}

type WorkerAuthRecord = Parameters<typeof buildCodexAuthJson>[0]

// Token refresh only applies to OAuth ("chatgpt") credentials.
type WorkerRefreshAuth = Pick<
  CodexChatGptAuth,
  | "accessToken"
  | "accountId"
  | "fingerprint"
  | "idToken"
  | "lastRefresh"
  | "openaiApiKey"
  | "profile"
  | "refreshToken"
>

type WorkerPresetRecord = Omit<SandboxPresetForRun, "secrets"> & {
  secrets: Array<{ name: string; value: string }>
}

type WorkerMcpOauthRecord = {
  clientId: string
  connectionId: Id<"mcpOauthConnections">
  encryptedAccessToken: string
  encryptedClientSecret?: string
  encryptedRefreshToken?: string
  expiresAt?: number
  provider: string
  serverUrl: string
  tokenEndpoint: string
}

type WorkerIntegrationMcpRecord = {
  credential?: {
    encryptedAccessToken: string
    encryptedRefreshToken?: string
    expiresAt?: number
  }
  externalId: string
  installationId: Id<"integrationInstallations">
  provider: "slack" | "linear"
}

type WorkerMcpServerRecord = Omit<McpServerInput, "secrets"> & {
  integration?: WorkerIntegrationMcpRecord
  oauth?: WorkerMcpOauthRecord
  secrets: Array<{
    kind: "env" | "httpHeader" | "envHttpHeader"
    name: string
    value: string
  }>
}

type WorkerRunInputResponse =
  | { canceled: true }
  | {
      agentInstructions?: string
      auth: WorkerAuthRecord
      canceled: false
      mcpServers?: WorkerMcpServerRecord[]
      run: WorkerRunRecord
      sandboxIdleMinutes?: number
      sandboxPreset?: WorkerPresetRecord
    }

export {
  isWorkerRunCanceledError,
  WorkerRunCanceledError,
} from "@/lib/codex/run-cancel-error"

export type LoadedWorkerRun = {
  authFingerprint: string
  authJson: string
  // The sandbox exists only for this run and is deleted when it finishes.
  ephemeralSandbox: boolean
  input: Omit<
    RunCodexInSandboxInput,
    "mcpServers" | "onContentDelta" | "onLog" | "sandboxPreset" | "signal"
  > & {
    mcpServers?: McpServerInput[]
    sandboxPreset?: SandboxPresetForRun
  }
  profile?: string
  userId: Id<"users">
}

function throwIfCanceled(response: unknown) {
  if (
    response &&
    typeof response === "object" &&
    "canceled" in response &&
    response.canceled === true
  ) {
    throw new WorkerRunCanceledError()
  }
}

export { getWorkerSecret }

export function workerConvexClient() {
  return new ConvexHttpClient(requireConvexUrl(WORKER_CONVEX_URL_ERROR))
}

export type WorkerConvexClient = ReturnType<typeof workerConvexClient>

function decryptPreset(
  preset: WorkerPresetRecord | undefined
): SandboxPresetForRun | undefined {
  if (!preset) return undefined

  return {
    ...preset,
    secrets: preset.secrets.map((secret) => ({
      name: secret.name,
      value: decryptSecret(secret.value),
    })),
  }
}

const MCP_OAUTH_REFRESH_WINDOW_MS = 120_000
const INTEGRATION_MCP_REFRESH_MAX_WAIT_MS = 70_000

// Resolves the OAuth-backed access token for a server, refreshing it (and
// persisting the rotated tokens) when it expires within the refresh window.
// Returns null when the server can no longer authenticate.
async function resolveMcpOauthAccessToken(
  client: ConvexHttpClient,
  runId: Id<"codexRuns">,
  serverName: string,
  oauth: WorkerMcpOauthRecord
) {
  const accessToken = decryptSecret(oauth.encryptedAccessToken)
  const expiresSoon =
    oauth.expiresAt !== undefined &&
    oauth.expiresAt < Date.now() + MCP_OAUTH_REFRESH_WINDOW_MS
  if (!expiresSoon) return accessToken

  const refreshToken = oauth.encryptedRefreshToken
    ? decryptSecret(oauth.encryptedRefreshToken)
    : undefined
  if (!refreshToken) {
    console.warn(
      `Skipping MCP server ${serverName}: the authorization expired and no refresh token is available. Reconnect it in Settings.`
    )
    return null
  }

  try {
    const provider = mcpOauthProvider(oauth.provider)
    const tokens = await refreshMcpOauthToken({
      clientId: oauth.clientId,
      clientSecretAuthMethod: provider?.clientSecretAuthMethod,
      clientSecret: oauth.encryptedClientSecret
        ? decryptSecret(oauth.encryptedClientSecret)
        : undefined,
      refreshToken,
      resource: oauth.serverUrl,
      tokenEndpoint: oauth.tokenEndpoint,
    })
    await client.mutation(api.mcpOauthConnections.workerSaveTokens, {
      connectionId: oauth.connectionId,
      encryptedAccessToken: encryptSecret(tokens.accessToken),
      encryptedRefreshToken: tokens.refreshToken
        ? encryptSecret(tokens.refreshToken)
        : undefined,
      expiresAt: tokens.expiresAt,
      runId,
      workerSecret: getWorkerSecret(),
    })
    return tokens.accessToken
  } catch (error) {
    console.warn(
      `Skipping MCP server ${serverName}: refreshing the authorization failed. Reconnect it in Settings.`,
      error
    )
    return null
  }
}

async function resolveSlackIntegrationMcpAccessToken(
  client: ConvexHttpClient,
  runId: Id<"codexRuns">,
  integration: WorkerIntegrationMcpRecord
) {
  const credential = integration.credential
  if (!credential) return null
  const expiresSoon =
    credential.expiresAt !== undefined &&
    credential.expiresAt < Date.now() + MCP_OAUTH_REFRESH_WINDOW_MS
  if (!expiresSoon) return decryptSecret(credential.encryptedAccessToken)
  if (!credential.encryptedRefreshToken) {
    console.warn(
      "Skipping Slack MCP: the user authorization expired without a refresh token. Reconnect Slack in Settings."
    )
    return null
  }

  const env = slackIntegrationEnv()
  if (!env || env.mode !== "oauth") return null
  const leaseId = randomUUID()
  const deadline = Date.now() + INTEGRATION_MCP_REFRESH_MAX_WAIT_MS

  while (Date.now() < deadline) {
    const lease = await client.mutation(
      api.integrations.workerBeginMcpCredentialRefresh,
      {
        installationId: integration.installationId,
        leaseId,
        refreshBefore: Date.now() + MCP_OAUTH_REFRESH_WINDOW_MS,
        runId,
        workerSecret: getWorkerSecret(),
      }
    )
    if (lease.status === "current") {
      return decryptSecret(lease.credential.encryptedAccessToken)
    }
    if (lease.status === "wait") {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, lease.retryAfterMs)
      )
      continue
    }

    try {
      const refreshToken = lease.credential.encryptedRefreshToken
        ? decryptSecret(lease.credential.encryptedRefreshToken)
        : undefined
      if (!refreshToken) {
        await client.mutation(
          api.integrations.workerReleaseMcpCredentialRefresh,
          {
            installationId: integration.installationId,
            leaseId,
            runId,
            workerSecret: getWorkerSecret(),
          }
        )
        return null
      }
      const refreshed = await refreshSlackMcpToken({
        clientId: env.clientId,
        clientSecret: env.clientSecret,
        refreshToken,
      })
      await client.mutation(
        api.integrations.workerCompleteMcpCredentialRefresh,
        {
          encryptedAccessToken: encryptSecret(refreshed.accessToken),
          encryptedRefreshToken: refreshed.refreshToken
            ? encryptSecret(refreshed.refreshToken)
            : undefined,
          expiresAt: refreshed.expiresAt,
          installationId: integration.installationId,
          leaseId,
          runId,
          workerSecret: getWorkerSecret(),
        }
      )
      return refreshed.accessToken
    } catch (error) {
      await client
        .mutation(api.integrations.workerReleaseMcpCredentialRefresh, {
          installationId: integration.installationId,
          leaseId,
          runId,
          workerSecret: getWorkerSecret(),
        })
        .catch(() => undefined)
      console.warn(
        "Skipping Slack MCP: refreshing the user authorization failed. Reconnect Slack in Settings.",
        error
      )
      return null
    }
  }

  console.warn("Skipping Slack MCP: timed out waiting for token refresh.")
  return null
}

async function resolveIntegrationMcpAccessToken(
  client: ConvexHttpClient,
  runId: Id<"codexRuns">,
  integration: WorkerIntegrationMcpRecord
) {
  if (integration.provider === "slack") {
    return await resolveSlackIntegrationMcpAccessToken(
      client,
      runId,
      integration
    )
  }

  const { linear } = await getInitializedIntegrationsBot()
  if (!linear) return null
  await linear.withInstallation(integration.externalId, async () => undefined)
  const installation = await linear.getInstallation(integration.externalId)
  return installation?.accessToken ?? null
}

function serverWithAuthorization(
  server: Omit<WorkerMcpServerRecord, "integration" | "oauth">,
  secrets: McpServerInput["secrets"],
  accessToken: string
): McpServerInput {
  return {
    ...server,
    secrets: [
      ...secrets.filter(
        (secret) =>
          secret.kind !== "httpHeader" ||
          secret.name.toLowerCase() !== "authorization"
      ),
      {
        kind: "httpHeader",
        name: "Authorization",
        value: `Bearer ${accessToken}`,
      },
    ],
  }
}

async function resolveWorkerMcpServers(
  client: ConvexHttpClient,
  runId: Id<"codexRuns">,
  servers: WorkerMcpServerRecord[] | undefined
): Promise<McpServerInput[] | undefined> {
  if (!servers?.length) return undefined

  const resolved: McpServerInput[] = []
  for (const { integration, oauth, ...server } of servers) {
    const secrets = server.secrets.map((secret) => ({
      kind: secret.kind,
      name: secret.name,
      value: decryptSecret(secret.value),
    }))

    if (integration) {
      const accessToken = await resolveIntegrationMcpAccessToken(
        client,
        runId,
        integration
      ).catch((error) => {
        console.warn(
          `Skipping MCP server ${server.name}: integration authorization failed.`,
          error
        )
        return null
      })
      if (accessToken) {
        resolved.push(serverWithAuthorization(server, secrets, accessToken))
      }
      continue
    }

    if (!oauth) {
      resolved.push({ ...server, secrets })
      continue
    }

    const accessToken = await resolveMcpOauthAccessToken(
      client,
      runId,
      server.name,
      oauth
    )
    if (accessToken === null) continue

    resolved.push(serverWithAuthorization(server, secrets, accessToken))
  }

  return resolved.length ? resolved : undefined
}

function waitForAuthRefreshLease(ms: number, signal?: AbortSignal) {
  if (!signal) return new Promise<void>((resolve) => setTimeout(resolve, ms))
  if (signal.aborted) return Promise.reject(new WorkerRunCanceledError())

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(done, ms)

    function done() {
      clearTimeout(timeout)
      signal?.removeEventListener("abort", abort)
      resolve()
    }

    function abort() {
      clearTimeout(timeout)
      signal?.removeEventListener("abort", abort)
      reject(new WorkerRunCanceledError())
    }

    signal.addEventListener("abort", abort, { once: true })
  })
}

function authJsonFromRefreshAuth(auth: WorkerRefreshAuth) {
  return buildCodexAuthJsonFromParsed({
    accessToken: auth.accessToken,
    accountId: auth.accountId,
    idToken: auth.idToken,
    lastRefresh: auth.lastRefresh,
    openaiApiKey: auth.openaiApiKey,
    refreshToken: auth.refreshToken,
  })
}

function authRefreshResult(
  auth: Pick<WorkerRefreshAuth, "accessToken" | "accountId">
) {
  return {
    accessToken: auth.accessToken,
    chatgptAccountId: auth.accountId ?? "",
    chatgptPlanType: null,
  }
}

export async function refreshWorkerAuthForRun({
  client,
  previousAccountId,
  profile,
  runId,
  signal,
  userId,
}: {
  client: ConvexHttpClient
  previousAccountId?: string
  profile: string | undefined
  runId: Id<"codexRuns">
  signal?: AbortSignal
  userId: Id<"users">
}) {
  if (!profile) throw new Error("Codex run is missing a ChatGPT profile.")

  const leaseId = randomUUID()
  const startedAt = Date.now()
  let auth: WorkerRefreshAuth | undefined

  while (!auth) {
    const lease = (await client.mutation(
      api.codexAuth.beginOAuthRefreshForWorker,
      {
        leaseId,
        profile,
        runId,
        userId,
        workerSecret: getWorkerSecret(),
      }
    )) as
      | {
          acquired: true
          auth: WorkerRefreshAuth
        }
      | {
          acquired: false
          message?: string
          retryAfterMs?: number
        }

    if (lease.acquired) {
      auth = lease.auth
      break
    }

    if (lease.message) throw new Error(lease.message)
    if (Date.now() - startedAt >= AUTH_REFRESH_MAX_WAIT_MS) {
      throw new Error("Timed out waiting for ChatGPT token refresh lock.")
    }

    await waitForAuthRefreshLease(
      Math.min(
        AUTH_REFRESH_MAX_RETRY_MS,
        Math.max(250, lease.retryAfterMs ?? 500)
      ),
      signal
    )
  }

  try {
    const refreshed = await refreshCodexOAuthTokens(auth.refreshToken)
    const idToken = refreshed.idToken ?? auth.idToken
    const idTokenProfile = getCodexProfileFromIdToken(idToken)
    const accountId =
      idTokenProfile.accountId ?? auth.accountId ?? previousAccountId ?? null
    const refreshToken = refreshed.refreshToken ?? auth.refreshToken
    const lastRefresh = new Date().toISOString()
    const nextAuth = {
      accessToken: refreshed.accessToken,
      accountId,
      fingerprint: codexAuthFingerprint(idToken, refreshToken, lastRefresh),
      idToken,
      lastRefresh,
      openaiApiKey: auth.openaiApiKey,
      profile,
      refreshToken,
    } satisfies WorkerRefreshAuth
    const complete = (await client.mutation(
      api.codexAuth.completeOAuthRefreshForWorker,
      {
        accessToken: nextAuth.accessToken,
        accountId: nextAuth.accountId,
        expectedFingerprint: auth.fingerprint,
        fingerprint: nextAuth.fingerprint,
        idToken: nextAuth.idToken,
        lastRefresh: nextAuth.lastRefresh,
        leaseId,
        openaiApiKey: nextAuth.openaiApiKey,
        profile,
        refreshToken: nextAuth.refreshToken,
        userId,
        workerSecret: getWorkerSecret(),
      }
    )) as { completed: boolean; message?: string }

    if (!complete.completed) {
      throw new Error(
        complete.message ?? "ChatGPT token refresh lease was lost."
      )
    }

    return {
      authJson: authJsonFromRefreshAuth(nextAuth),
      result: authRefreshResult(nextAuth),
    }
  } catch (error) {
    await client
      .mutation(api.codexAuth.failOAuthRefreshForWorker, {
        leaseId,
        profile,
        userId,
        workerSecret: getWorkerSecret(),
      })
      .catch(() => undefined)

    if (isCodexRefreshTokenReusedError(error)) {
      await invalidateWorkerAuthProfile(
        userId,
        profile,
        "refresh_token_reused"
      ).catch(() => undefined)
    }

    throw error
  }
}

export async function startAndLoadWorkerRun(
  client: ConvexHttpClient,
  runId: Id<"codexRuns">,
  triggerRunId: string
): Promise<LoadedWorkerRun | null> {
  const response = (await client.mutation(
    api.codexRuns.workerStartAndGetInput,
    {
      runId,
      triggerRunId,
      workerSecret: getWorkerSecret(),
    }
  )) as WorkerRunInputResponse

  if (response.canceled) return null

  const sandboxPreset = decryptPreset(response.sandboxPreset)
  const mcpServers = await resolveWorkerMcpServers(
    client,
    runId,
    response.mcpServers
  )
  // openaiApiKey is stored encrypted (always for API-key auth; possibly for
  // OAuth records that carried one). Decrypt before it reaches the sandbox
  // auth.json. decryptSecret is a no-op on already-plaintext values.
  const authJson = buildCodexAuthJson(
    response.auth.openaiApiKey
      ? {
          ...response.auth,
          openaiApiKey: decryptSecret(response.auth.openaiApiKey),
        }
      : response.auth
  )

  return {
    authFingerprint: response.auth.fingerprint,
    authJson,
    ephemeralSandbox: response.run.ephemeralSandbox === true,
    input: {
      agentInstructions: response.agentInstructions,
      authJson,
      baseBranch: response.run.baseBranch,
      branchMode: response.run.branchMode,
      branchName: response.run.branchName,
      codexThreadId: response.run.codexThreadId,
      githubToken: response.run.githubToken
        ? decryptSecret(response.run.githubToken)
        : undefined,
      githubUserEmail: response.run.githubUserEmail,
      githubUserName: response.run.githubUserName,
      githubUsername: response.run.githubUsername,
      imageAttachments: response.run.imageAttachments,
      model: response.run.model,
      convexUrl: requireConvexUrl(WORKER_CONVEX_URL_ERROR),
      mcpServers,
      notesAccessToken: response.run.notesAccessToken,
      previousDiff: response.run.previousDiff,
      prNumber: response.run.prNumber,
      prompt: response.run.prompt,
      reasoningEffort: response.run.reasoningEffort,
      repoUrl: response.run.repoUrl,
      resumeContext: response.run.resumeContext,
      runId: runId as string,
      sandboxId: response.run.sandboxId,
      sandboxIdleMinutes: response.sandboxIdleMinutes,
      sandboxPreset,
      speed: response.run.speed,
      threadId: response.run.threadId as string,
      userId: response.run.userId as string,
    },
    profile: response.run.profile,
    userId: response.run.userId,
  }
}

export async function appendWorkerRunLogs(
  client: ConvexHttpClient,
  runId: Id<"codexRuns">,
  logs: Array<RunCodexLog & { time: number }>
) {
  const response = await client.mutation(api.codexRuns.workerAppendLogs, {
    logs,
    runId,
    workerSecret: getWorkerSecret(),
  })
  throwIfCanceled(response)
  return response
}

export async function updateWorkerRunContent(
  client: ConvexHttpClient,
  runId: Id<"codexRuns">,
  content: string,
  lastStreamId?: string
) {
  const response = await client.mutation(api.codexRuns.workerUpdateContent, {
    content,
    lastStreamId,
    runId,
    workerSecret: getWorkerSecret(),
  })
  throwIfCanceled(response)
  return response
}

export async function syncWorkerMcpServerTools(
  client: ConvexHttpClient,
  runId: Id<"codexRuns">,
  servers: McpDiscoveredServer[]
) {
  if (!servers.length) return { synced: 0 }
  return await client.mutation(api.mcpServers.workerSyncDiscoveredTools, {
    runId,
    servers,
    workerSecret: getWorkerSecret(),
  })
}

export async function completeWorkerRun(
  client: ConvexHttpClient,
  runId: Id<"codexRuns">,
  content: string,
  result: RunCodexInSandboxResult
) {
  const response = await client.mutation(api.codexRuns.workerComplete, {
    branchName: result.branchName,
    codexThreadId: result.codexThreadId,
    content,
    diff: result.diff,
    exitCode: result.exitCode,
    runId,
    sandboxId: result.sandboxId,
    statusText: result.status,
    workerSecret: getWorkerSecret(),
  })
  throwIfCanceled(response)
  return response
}

export async function failWorkerRun(
  client: ConvexHttpClient,
  runId: Id<"codexRuns">,
  error: string,
  sandboxId?: string
) {
  return await client.mutation(api.codexRuns.workerFail, {
    error,
    runId,
    sandboxId,
    workerSecret: getWorkerSecret(),
  })
}

export async function cancelWorkerRun(
  client: ConvexHttpClient,
  runId: Id<"codexRuns">,
  sandboxId?: string
) {
  return await client.mutation(api.codexRuns.workerCancel, {
    runId,
    sandboxId,
    workerSecret: getWorkerSecret(),
  })
}

export async function saveWorkerAuthJson(
  userId: Id<"users">,
  profile: string | undefined,
  authJson: string,
  expectedFingerprint?: string
) {
  return await saveCodexAuthJsonForWorker({
    authJson,
    expectedFingerprint,
    profile,
    userId,
    workerSecret: getWorkerSecret(),
  })
}

export async function invalidateWorkerAuthProfile(
  userId: Id<"users">,
  profile: string | undefined,
  invalidReason: string
) {
  if (!profile) return null

  return await invalidateCodexAuthForWorker({
    invalidReason,
    profile,
    userId,
    workerSecret: getWorkerSecret(),
  })
}

export async function recordWorkerBillingUsage(
  client: ConvexHttpClient,
  args: {
    amountMicroUsd: number
    idempotencyKey: string
    metadata?: unknown
    resourceId?: string
    source: BillingUsageSource
    userId: Id<"users">
  }
) {
  return await client.action(api.billing.recordWorkerUsage, {
    ...args,
    workerSecret: getWorkerSecret(),
  })
}

export async function observeWorkerDaytonaSandbox(
  client: ConvexHttpClient,
  args: {
    observedAt: number
    resources: DaytonaBillingResources
    sandboxId: string
    source: "observed" | "webhook"
    state: DaytonaBillingState
    userId: Id<"users">
  }
) {
  return await client.action(api.billing.observeDaytonaSandboxForWorker, {
    cpu: args.resources.cpu,
    diskGiB: args.resources.diskGiB,
    memoryGiB: args.resources.memoryGiB,
    observedAt: args.observedAt,
    sandboxId: args.sandboxId,
    source: args.source,
    state: args.state,
    userId: args.userId,
    workerSecret: getWorkerSecret(),
  })
}

export function workerRunFinalContent(
  streamedContent: string,
  result: RunCodexInSandboxResult
) {
  const streamed = streamedContent.trim()
  const lastMessage = result.lastMessage.trim()
  const videoPaths = desktopRecordingVideoPaths(result)

  const withVideo = (content: string) => {
    const trimmed = content.trim()
    const missingVideoPaths = videoPaths.filter(
      (path) => !trimmed.includes(path)
    )
    if (missingVideoPaths.length === 0) return trimmed

    const heading =
      videoPaths.length === 1 && missingVideoPaths.length === 1
        ? "Video:"
        : "Videos:"
    return `${trimmed || "(no output)"}\n\n${heading}\n${missingVideoPaths.join("\n")}`
  }

  if (result.lastMessageAuthoritative && lastMessage) {
    return withVideo(authoritativeLastMessageContent(streamed, lastMessage))
  }

  if (streamed && stripInlineToolMarkers(streamed)) {
    return withVideo(streamed)
  }

  if (streamed && lastMessage) {
    return withVideo(`${streamed}\n\n${lastMessage}`)
  }

  // Prefer the error summary (stderr / normalized turnError) over the raw
  // app-server event stream (stdout). On a failed turn with no assistant
  // output — e.g. an out-of-usage error — stdout is the full NDJSON dump and
  // must never be surfaced to the user; stderr carries the minimal message.
  return withVideo(
    streamed ||
      lastMessage ||
      redactCodexAuthPayloads(result.stderr.trim()) ||
      redactCodexAuthPayloads(result.stdout.trim()) ||
      "(no output)"
  )
}

function desktopRecordingVideoPaths(result: RunCodexInSandboxResult) {
  const recordings = [
    ...(result.desktopRecordings ?? []),
    ...(result.desktopRecording ? [result.desktopRecording] : []),
  ]
  const paths: string[] = []
  const seen = new Set<string>()

  for (const recording of recordings) {
    const path =
      recording.filePath ||
      (recording.id ? `/root/.daytona/recordings/${recording.id}.mp4` : "")
    const key = recording.id || path
    if (!path || seen.has(key)) continue
    seen.add(key)
    paths.push(path)
  }

  return paths
}

function authoritativeLastMessageContent(
  streamed: string,
  lastMessage: string
) {
  const markers = extractInlineToolMarkers(streamed)
  const visibleStreamed = stripInlineToolMarkers(streamed)
  if (!visibleStreamed) {
    return `${markers.join("")}${lastMessage}`.trim()
  }

  if (
    visibleStreamed === lastMessage ||
    visibleStreamed.endsWith(lastMessage)
  ) {
    return streamed
  }

  if (lastMessage.startsWith(visibleStreamed)) {
    return `${markers.join("")}${lastMessage}`.trim()
  }

  return `${streamed.trimEnd()}\n\n${lastMessage}`.trim()
}
