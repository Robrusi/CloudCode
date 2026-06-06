import type { RunCodexLog } from "@/lib/daytona-codex-agent"

const REQUEST_TIMEOUT_MS = 30_000
const OVERLOAD_RETRY_DELAYS_MS = [250, 750, 1_500]
const JSON_RPC_INTERNAL_ERROR = -32603
const JSON_RPC_METHOD_NOT_FOUND = -32601

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue | undefined }

type JsonRecord = Record<string, unknown>
type JsonRpcId = number | string

type JsonRpcError = {
  code?: number
  data?: unknown
  message?: string
}

type PendingRequest = {
  reject: (error: Error) => void
  resolve: (value: unknown) => void
  timeout: ReturnType<typeof setTimeout>
}

export type CodexAppServerChatgptAuthTokens = {
  accessToken: string
  chatgptAccountId: string
  chatgptPlanType: string | null
}

export type CodexAppServerClientOptions = {
  generateAttestationToken?: () => string | Promise<string>
  requestTimeoutMs?: number
  refreshChatgptAuthTokens?: (
    params: unknown
  ) =>
    | CodexAppServerChatgptAuthTokens
    | Promise<CodexAppServerChatgptAuthTokens>
}

export type CodexAppServerRequestParams = {
  initialize: {
    capabilities: {
      experimentalApi: boolean
      requestAttestation: boolean
      optOutNotificationMethods?: string[] | null
    } | null
    clientInfo: {
      name: string
      title: string
      version: string
    }
  }
  "thread/start": CodexAppServerThreadParams
  "thread/resume": CodexAppServerThreadParams & { threadId: string }
  "turn/start": {
    approvalPolicy?: "never" | "on-failure" | "on-request" | "untrusted"
    cwd?: string
    effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | null
    input: Array<{ text: string; text_elements: []; type: "text" }>
    model?: string
    sandboxPolicy?: { type: "dangerFullAccess" }
    serviceTier?: string | null
    threadId: string
  }
  "turn/interrupt": {
    threadId: string
    turnId: string
  }
  "mcpServerStatus/list": {
    cursor?: string | null
    detail?: "full" | "toolsAndAuthOnly" | null
    limit?: number | null
    threadId?: string | null
  }
  "mcpServer/tool/call": {
    _meta?: JsonValue
    arguments?: JsonValue
    server: string
    threadId: string
    tool: string
  }
}

export type CodexAppServerThreadParams = {
  approvalPolicy?: "never" | "on-failure" | "on-request" | "untrusted"
  config?: { [key: string]: JsonValue | undefined } | null
  cwd?: string
  ephemeral?: boolean
  model?: string
  sandbox?: "danger-full-access" | "read-only" | "workspace-write"
  serviceName?: string
  serviceTier?: string | null
}

export type CodexAppServerThreadResponse = {
  thread?: {
    id?: string
  }
}

export type CodexAppServerTurnResponse = {
  turn?: CodexAppServerTurn
}

export type CodexAppServerTurn = {
  error?: {
    additionalDetails?: string | null
    message?: string
  } | null
  id?: string
  items?: CodexAppServerThreadItem[]
  status?: "completed" | "failed" | "inProgress" | "interrupted"
}

export type CodexAppServerThreadItem =
  | {
      id?: string
      memoryCitation?: unknown
      phase?: string | null
      text?: string
      type: "agentMessage"
    }
  | {
      content?: string[]
      id?: string
      summary?: string[]
      type: "reasoning"
    }
  | {
      aggregatedOutput?: string | null
      command?: string
      cwd?: string
      durationMs?: number | null
      exitCode?: number | null
      id?: string
      status?: string
      type: "commandExecution"
    }
  | {
      changes?: Array<{
        diff?: string
        kind?: unknown
        path?: string
      }>
      id?: string
      status?: string
      type: "fileChange"
    }
  | {
      arguments?: JsonValue
      durationMs?: number | null
      error?: { message?: string } | null
      id?: string
      pluginId?: string | null
      result?: unknown
      server?: string
      status?: string
      tool?: string
      type: "mcpToolCall"
    }
  | {
      arguments?: JsonValue
      contentItems?: unknown[] | null
      durationMs?: number | null
      id?: string
      namespace?: string | null
      status?: string
      success?: boolean | null
      tool?: string
      type: "dynamicToolCall"
    }
  | {
      id?: string
      query?: string
      type: "webSearch"
    }
  | {
      id?: string
      text?: string
      type: "plan"
    }
  | {
      id?: string
      type: string
      [key: string]: unknown
    }

export type CodexAppServerNotification = {
  method?: string
  params?: unknown
}

export class CodexAppServerError extends Error {
  code?: number
  data?: unknown

  constructor(message: string, error?: JsonRpcError) {
    super(message)
    this.name = "CodexAppServerError"
    this.code = error?.code
    this.data = error?.data
  }
}

export type CodexAppServerTransport = {
  close: () => void | Promise<void>
  isConnected: () => boolean
  send: (data: string) => void | Promise<void>
}

export class CodexAppServerJsonRpcClient {
  private nextId = 1
  private incomingBuffer = ""
  private pending = new Map<number, PendingRequest>()
  private transport?: CodexAppServerTransport
  private readonly closeHandlers = new Set<(error: Error) => void>()
  private readonly notificationHandlers = new Set<
    (notification: CodexAppServerNotification) => void
  >()

  constructor(protected readonly options: CodexAppServerClientOptions = {}) {}

  protected setTransport(transport: CodexAppServerTransport) {
    this.transport = transport
  }

  protected handleIncomingData(
    data: string,
    options: { flush?: boolean } = {}
  ) {
    this.incomingBuffer += data
    const lines = this.incomingBuffer.split(/\r?\n/)
    this.incomingBuffer = lines.pop() ?? ""

    for (const line of lines) {
      if (line.trim()) this.handleMessage(line)
    }

    if (options.flush && this.incomingBuffer.trim()) {
      this.handleMessage(this.incomingBuffer)
      this.incomingBuffer = ""
    }
  }

  protected flushIncomingData() {
    if (!this.incomingBuffer.trim()) {
      this.incomingBuffer = ""
      return
    }

    this.handleMessage(this.incomingBuffer)
    this.incomingBuffer = ""
  }

  protected handleConnectionClosed(error: Error) {
    this.rejectPending(error)
    for (const handler of this.closeHandlers) handler(error)
  }

  protected clearTransport() {
    this.transport = undefined
  }

  onNotification(handler: (notification: CodexAppServerNotification) => void) {
    this.notificationHandlers.add(handler)
    return () => this.notificationHandlers.delete(handler)
  }

  onClose(handler: (error: Error) => void) {
    this.closeHandlers.add(handler)
    return () => this.closeHandlers.delete(handler)
  }

  async notify(method: "initialized") {
    await this.send({ method })
  }

  async request<M extends keyof CodexAppServerRequestParams, R = unknown>(
    method: M,
    params: CodexAppServerRequestParams[M],
    options: { signal?: AbortSignal; timeoutMs?: number } = {}
  ): Promise<R> {
    return this.requestWithRetry(method, params, options, 0)
  }

  async close() {
    await this.transport?.close()
    this.rejectPending(new Error("Codex app-server connection closed."))
    this.clearTransport()
  }

  private async requestWithRetry<
    M extends keyof CodexAppServerRequestParams,
    R = unknown,
  >(
    method: M,
    params: CodexAppServerRequestParams[M],
    options: { signal?: AbortSignal; timeoutMs?: number },
    attempt: number
  ): Promise<R> {
    try {
      return await this.requestOnce<M, R>(method, params, options)
    } catch (error) {
      const delay = OVERLOAD_RETRY_DELAYS_MS[attempt]
      if (
        !(error instanceof CodexAppServerError) ||
        error.code !== -32001 ||
        delay === undefined
      ) {
        throw error
      }

      await wait(delay, options.signal)
      return this.requestWithRetry<M, R>(method, params, options, attempt + 1)
    }
  }

  private async requestOnce<
    M extends keyof CodexAppServerRequestParams,
    R = unknown,
  >(
    method: M,
    params: CodexAppServerRequestParams[M],
    options: { signal?: AbortSignal; timeoutMs?: number }
  ): Promise<R> {
    if (options.signal?.aborted)
      return Promise.reject(new Error("Run was canceled."))
    if (!this.transport?.isConnected()) {
      return Promise.reject(new Error("Codex app-server is not connected."))
    }

    const id = this.nextId++
    const timeout = setTimeout(
      () => {
        this.pending.delete(id)
        reject(
          new CodexAppServerError(
            `Codex app-server request timed out: ${method}`
          )
        )
      },
      options.timeoutMs ?? this.options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
    )
    let reject!: (error: Error) => void
    const promise = new Promise<R>((resolve, rejectRequest) => {
      reject = rejectRequest
      this.pending.set(id, {
        reject: rejectRequest,
        resolve: (value) => resolve(value as R),
        timeout,
      })
    })

    const onAbort = () => {
      const pending = this.pending.get(id)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.pending.delete(id)
      pending.reject(new Error("Run was canceled."))
    }
    options.signal?.addEventListener("abort", onAbort, { once: true })
    const cleanupAbortListener = () => {
      options.signal?.removeEventListener("abort", onAbort)
    }
    void promise.then(cleanupAbortListener, cleanupAbortListener)

    try {
      await this.send({ id, method, params })
    } catch (error) {
      const pending = this.pending.get(id)
      if (pending) {
        clearTimeout(pending.timeout)
        this.pending.delete(id)
        pending.reject(
          error instanceof Error
            ? error
            : new Error("Unable to send Codex app-server request.")
        )
      }
    }
    return promise
  }

  private handleMessage(line: string) {
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      return
    }

    const record = objectRecord(message)
    if (!record) return

    const id =
      typeof record.id === "number" || typeof record.id === "string"
        ? record.id
        : undefined
    const method = stringValue(record.method)
    if (id !== undefined && method) {
      void this.handleServerRequest(id, method, record.params)
      return
    }

    if (id !== undefined) {
      if (typeof id !== "number") return

      const pending = this.pending.get(id)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.pending.delete(id)

      const error = objectRecord(record.error) as JsonRpcError | undefined
      if (error) {
        pending.reject(
          new CodexAppServerError(
            error.message || "Codex app-server request failed.",
            error
          )
        )
      } else {
        pending.resolve(record.result)
      }
      return
    }

    for (const handler of this.notificationHandlers) {
      handler(record)
    }
  }

  private async handleServerRequest(
    id: JsonRpcId,
    method: string,
    params: unknown
  ) {
    try {
      const result = await serverRequestResult(method, params, this.options)
      if (result === undefined) {
        await this.send({
          error: {
            code: JSON_RPC_METHOD_NOT_FOUND,
            message: `Cloudcode does not implement Codex app-server request: ${method}`,
          },
          id,
        })
        return
      }

      await this.send({ id, result })
    } catch (error) {
      await this.send({
        error: {
          code: JSON_RPC_INTERNAL_ERROR,
          message:
            error instanceof Error
              ? error.message
              : `Cloudcode failed to handle Codex app-server request: ${method}`,
        },
        id,
      })
    }
  }

  private rejectPending(error: Error) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(error)
      this.pending.delete(id)
    }
  }

  private async send(message: unknown) {
    if (!this.transport?.isConnected()) {
      throw new Error("Codex app-server is not connected.")
    }
    await this.transport.send(`${JSON.stringify(message)}\n`)
  }
}

export class CodexAppServerStdioRpcClient extends CodexAppServerJsonRpcClient {
  constructor(
    private readonly stdioTransport: CodexAppServerTransport,
    options: CodexAppServerClientOptions = {}
  ) {
    super(options)
  }

  async connect(signal?: AbortSignal) {
    if (signal?.aborted) throw new Error("Run was canceled.")
    this.setTransport(this.stdioTransport)
  }

  receive(data: string) {
    this.handleIncomingData(data)
  }

  terminate(error = new Error("Codex app-server connection closed.")) {
    this.flushIncomingData()
    this.handleConnectionClosed(error)
    this.clearTransport()
  }
}

async function serverRequestResult(
  method: string,
  params: unknown,
  options: CodexAppServerClientOptions
): Promise<unknown> {
  switch (method) {
    case "item/commandExecution/requestApproval":
      return { decision: "decline" }
    case "item/fileChange/requestApproval":
      return { decision: "decline" }
    case "execCommandApproval":
    case "applyPatchApproval":
      return { decision: "denied" }
    case "mcpServer/elicitation/request":
      return { _meta: null, action: "decline", content: null }
    case "item/tool/requestUserInput":
      return { answers: emptyToolInputAnswers(params) }
    case "item/permissions/requestApproval":
      return { permissions: {}, scope: "turn", strictAutoReview: true }
    case "item/tool/call":
      return {
        contentItems: [
          {
            text: unsupportedDynamicToolMessage(params),
            type: "inputText",
          },
        ],
        success: false,
      }
    case "account/chatgptAuthTokens/refresh":
      return await options.refreshChatgptAuthTokens?.(params)
    case "attestation/generate":
      return { token: (await options.generateAttestationToken?.()) ?? "" }
    default:
      return undefined
  }
}

function emptyToolInputAnswers(params: unknown) {
  const record = objectRecord(params)
  const questions = Array.isArray(record?.questions) ? record.questions : []

  return Object.fromEntries(
    questions.flatMap((question) => {
      const questionRecord = objectRecord(question)
      const id = stringValue(questionRecord?.id)
      return id ? [[id, { answers: [] }]] : []
    })
  )
}

function unsupportedDynamicToolMessage(params: unknown) {
  const record = objectRecord(params)
  const name = [record?.namespace, record?.tool]
    .filter(
      (value): value is string => typeof value === "string" && Boolean(value)
    )
    .join(".")

  return name
    ? `Cloudcode cannot execute app-server dynamic tool request ${name} in this worker.`
    : "Cloudcode cannot execute this app-server dynamic tool request in this worker."
}

export type CodexAppServerTurnSummary = {
  finalAssistantText: string
  status: "completed" | "failed" | "inProgress" | "interrupted"
  turnError?: string
  turnId?: string
}

export function createCodexAppServerTurnReducer({
  onContentDelta,
  onLog,
}: {
  onContentDelta?: (delta: string) => void | Promise<void>
  onLog?: (log: RunCodexLog) => void | Promise<void>
}) {
  const assistantByItem = new Map<string, string>()
  const completedAssistantByItem = new Map<string, string>()
  const completedLoggedItemIds = new Set<string>()
  const commandOutputByItem = new Map<string, string>()
  const fileChangesByItem = new Map<
    string,
    Array<{ diff?: string; kind?: string; path?: string }>
  >()
  const mcpStartupMessages = new Set<string>()
  let completedTurn: CodexAppServerTurn | undefined
  let turnId: string | undefined

  function handleNotification(notification: CodexAppServerNotification) {
    const method = notification.method
    const params = objectRecord(notification.params)

    switch (method) {
      case "thread/started": {
        const thread = objectRecord(params?.thread)
        const threadId = stringValue(thread?.id)
        void onLog?.({
          detail: threadId ? logDetail({ threadId }) : undefined,
          kind: "setup",
          message: "Codex thread started",
        })
        return
      }
      case "thread/status/changed": {
        const status = stringValue(params?.status)
        if (status) {
          void onLog?.({
            detail: logDetail({ threadId: stringValue(params?.threadId) }),
            kind: "setup",
            message: `Codex thread status: ${status}`,
          })
        }
        return
      }
      case "thread/tokenUsage/updated": {
        void onLog?.({
          detail: logDetail({
            threadId: stringValue(params?.threadId),
            tokenUsage: objectRecord(params?.tokenUsage) ?? null,
            turnId: stringValue(params?.turnId),
          }),
          kind: "setup",
          message: "Codex token usage updated",
        })
        return
      }
      case "turn/started": {
        const turn = objectRecord(params?.turn)
        turnId = stringValue(turn?.id) ?? turnId
        void onLog?.({ kind: "setup", message: "Codex turn started" })
        return
      }
      case "hook/started":
      case "hook/completed": {
        const run = objectRecord(params?.run)
        const hookName =
          stringValue(run?.name) || stringValue(run?.hook) || "Hook"
        void onLog?.({
          detail: logDetail({
            run: run ?? null,
            threadId: stringValue(params?.threadId),
            turnId: stringValue(params?.turnId),
          }),
          kind: "command",
          message:
            method === "hook/started"
              ? `${hookName} started`
              : `${hookName} completed`,
        })
        return
      }
      case "turn/diff/updated": {
        const diff = stringValue(params?.diff) ?? ""
        void onLog?.({
          detail: logDetail({
            diffBytes: Buffer.byteLength(diff),
            threadId: stringValue(params?.threadId),
            turnId: stringValue(params?.turnId),
          }),
          kind: "command",
          message: "Codex diff updated",
        })
        return
      }
      case "item/agentMessage/delta": {
        const itemId = stringValue(params?.itemId)
        const delta = stringValue(params?.delta)
        if (!itemId || !delta) return
        assistantByItem.set(
          itemId,
          `${assistantByItem.get(itemId) ?? ""}${delta}`
        )
        void onContentDelta?.(delta)
        return
      }
      case "item/started": {
        const item = objectRecord(params?.item) as
          | CodexAppServerThreadItem
          | undefined
        if (item) emitItemLog(item, "started", onLog)
        return
      }
      case "item/autoApprovalReview/started":
      case "item/autoApprovalReview/completed": {
        void onLog?.({
          detail: logDetail({
            action: objectRecord(params?.action) ?? null,
            decisionSource: stringValue(params?.decisionSource),
            reviewId: stringValue(params?.reviewId),
            targetItemId: stringValue(params?.targetItemId),
            threadId: stringValue(params?.threadId),
            turnId: stringValue(params?.turnId),
          }),
          kind: "command",
          message:
            method === "item/autoApprovalReview/started"
              ? "Automatic approval review started"
              : "Automatic approval review completed",
        })
        return
      }
      case "item/completed": {
        const item = objectRecord(params?.item) as
          | CodexAppServerThreadItem
          | undefined
        if (!item) return
        if (item.type === "agentMessage" && typeof item.text === "string") {
          completedAssistantByItem.set(item.id ?? "", item.text)
        }
        emitItemLog(item, "completed", onLog, {
          commandOutput:
            item.type === "commandExecution" && item.id
              ? commandOutputByItem.get(item.id)
              : undefined,
          fileChanges:
            item.type === "fileChange" && item.id
              ? fileChangesByItem.get(item.id)
              : undefined,
        })
        if (item.id) {
          completedLoggedItemIds.add(item.id)
          commandOutputByItem.delete(item.id)
          fileChangesByItem.delete(item.id)
        }
        return
      }
      case "rawResponseItem/completed": {
        const item = objectRecord(params?.item)
        const type = stringValue(item?.type)
        if (type) {
          void onLog?.({
            detail: logDetail({
              itemType: type,
              threadId: stringValue(params?.threadId),
              turnId: stringValue(params?.turnId),
            }),
            kind: "command",
            message: "Raw response item completed",
          })
        }
        return
      }
      case "command/exec/outputDelta":
      case "process/outputDelta": {
        const delta = decodeBase64Text(params?.deltaBase64)
        if (delta) {
          void onLog?.({
            detail: logDetail({
              capReached: params?.capReached === true,
              processHandle:
                stringValue(params?.processHandle) ??
                stringValue(params?.processId),
              stream: stringValue(params?.stream),
            }),
            kind: outputLogKind(params?.stream),
            message: compactLine(delta),
          })
        }
        return
      }
      case "process/exited": {
        const exitCode = numberValue(params?.exitCode)
        const stdout = stringValue(params?.stdout)
        const stderr = stringValue(params?.stderr)
        void onLog?.({
          detail: logDetail({
            exitCode,
            processHandle: stringValue(params?.processHandle),
            stderr: stderr ? compactLine(stderr) : undefined,
            stderrCapReached: params?.stderrCapReached === true,
            stdout: stdout ? compactLine(stdout) : undefined,
            stdoutCapReached: params?.stdoutCapReached === true,
          }),
          kind: exitCode && exitCode !== 0 ? "stderr" : "command",
          message:
            exitCode === undefined
              ? "Process exited"
              : `Process exited with code ${exitCode}`,
        })
        return
      }
      case "item/commandExecution/outputDelta": {
        const itemId = stringValue(params?.itemId)
        const delta = stringValue(params?.delta)
        if (!itemId || !delta) return
        commandOutputByItem.set(
          itemId,
          `${commandOutputByItem.get(itemId) ?? ""}${delta}`
        )
        const message = compactLine(delta)
        if (message) void onLog?.({ kind: "stdout", message })
        return
      }
      case "item/commandExecution/terminalInteraction": {
        void onLog?.({
          detail: logDetail({
            itemId: stringValue(params?.itemId),
            processId: stringValue(params?.processId),
            stdin: stringValue(params?.stdin),
            threadId: stringValue(params?.threadId),
            turnId: stringValue(params?.turnId),
          }),
          kind: "command",
          message: "Terminal interaction",
        })
        return
      }
      case "item/fileChange/patchUpdated": {
        const itemId = stringValue(params?.itemId)
        if (!itemId) return
        const changes = normalizeFileChanges(params?.changes)
        if (changes.length > 0) fileChangesByItem.set(itemId, changes)
        return
      }
      case "item/fileChange/outputDelta": {
        const delta = stringValue(params?.delta)
        if (delta) void onLog?.({ kind: "stdout", message: compactLine(delta) })
        return
      }
      case "serverRequest/resolved": {
        void onLog?.({
          detail: logDetail({
            requestId:
              stringValue(params?.requestId) ?? numberValue(params?.requestId),
            threadId: stringValue(params?.threadId),
          }),
          kind: "setup",
          message: "Codex server request resolved",
        })
        return
      }
      case "turn/completed": {
        const turn = objectRecord(params?.turn) as
          | CodexAppServerTurn
          | undefined
        completedTurn = turn
        turnId = stringValue(turn?.id) ?? turnId
        emitMissingCompletedTurnItems(turn, onLog, {
          commandOutputByItem,
          completedLoggedItemIds,
          fileChangesByItem,
        })
        return
      }
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta": {
        const delta = stringValue(params?.delta)
        if (delta) {
          void onLog?.({ kind: "reasoning", message: compactLine(delta) })
        }
        return
      }
      case "item/reasoning/summaryPartAdded": {
        void onLog?.({
          detail: logDetail({
            itemId: stringValue(params?.itemId),
            summaryIndex: numberValue(params?.summaryIndex),
            threadId: stringValue(params?.threadId),
            turnId: stringValue(params?.turnId),
          }),
          kind: "reasoning",
          message: "Reasoning summary part added",
        })
        return
      }
      case "item/mcpToolCall/progress": {
        const message = stringValue(params?.message)
        if (message) {
          void onLog?.({
            detail: logDetail({ kind: "tool_call", status: "inProgress" }),
            kind: "command",
            message: compactLine(message),
          })
        }
        return
      }
      case "mcpServer/startupStatus/updated": {
        const name = stringValue(params?.name) ?? "MCP server"
        const status = stringValue(params?.status)
        const error = stringValue(params?.error)
        const message = compactLine(
          [name, status, error].filter(Boolean).join(": ")
        )
        if (!message || mcpStartupMessages.has(message)) return
        mcpStartupMessages.add(message)
        void onLog?.({
          kind: error ? "stderr" : "setup",
          message,
        })
        return
      }
      case "mcpServer/oauthLogin/completed": {
        const name = stringValue(params?.name) ?? "MCP server"
        const success = params?.success === true
        const error = stringValue(params?.error)
        void onLog?.({
          kind: success ? "setup" : "stderr",
          message: compactLine(
            [
              name,
              success ? "OAuth login completed" : "OAuth login failed",
              error,
            ]
              .filter(Boolean)
              .join(": ")
          ),
        })
        return
      }
      case "account/updated": {
        void onLog?.({
          detail: logDetail({
            authMode: stringValue(params?.authMode),
            planType: stringValue(params?.planType),
          }),
          kind: "setup",
          message: "Codex account updated",
        })
        return
      }
      case "account/rateLimits/updated": {
        void onLog?.({
          detail: logDetail({
            rateLimits: objectRecord(params?.rateLimits) ?? null,
          }),
          kind: "setup",
          message: "Codex rate limits updated",
        })
        return
      }
      case "turn/plan/updated": {
        const explanation = stringValue(params?.explanation)
        const plan = normalizePlanSteps(params?.plan)
        void onLog?.({
          detail: logDetail({ explanation, kind: "plan", plan }),
          kind: "command",
          message: "Plan updated",
        })
        return
      }
      case "item/plan/delta": {
        const delta = stringValue(params?.delta)
        if (delta) void onLog?.({ kind: "stdout", message: compactLine(delta) })
        return
      }
      case "thread/compacted": {
        void onLog?.({ kind: "setup", message: "Codex compacted context" })
        return
      }
      case "model/rerouted": {
        const fromModel = stringValue(params?.fromModel)
        const toModel = stringValue(params?.toModel)
        const reason = stringValue(params?.reason)
        void onLog?.({
          detail: logDetail({ fromModel, reason, toModel }),
          kind: "setup",
          message: compactLine(
            `Model rerouted${fromModel ? ` from ${fromModel}` : ""}${toModel ? ` to ${toModel}` : ""}`
          ),
        })
        return
      }
      case "model/verification": {
        void onLog?.({
          detail: logDetail({
            threadId: stringValue(params?.threadId),
            turnId: stringValue(params?.turnId),
            verifications: Array.isArray(params?.verifications)
              ? params.verifications
              : [],
          }),
          kind: "setup",
          message: "Model verification updated",
        })
        return
      }
      case "configWarning":
      case "deprecationNotice": {
        const summary = stringValue(params?.summary)
        const details = stringValue(params?.details)
        const path = stringValue(params?.path)
        const message = [summary, details, path].filter(Boolean).join(": ")
        if (message)
          void onLog?.({ kind: "stderr", message: compactLine(message) })
        return
      }
      case "windows/worldWritableWarning": {
        const samplePaths = Array.isArray(params?.samplePaths)
          ? params.samplePaths.filter(
              (path): path is string => typeof path === "string"
            )
          : []
        void onLog?.({
          detail: logDetail({
            extraCount: numberValue(params?.extraCount),
            failedScan: params?.failedScan === true,
            samplePaths,
          }),
          kind: "stderr",
          message: "World-writable PATH entries detected",
        })
        return
      }
      case "warning":
      case "guardianWarning": {
        const message = stringValue(params?.message)
        if (message)
          void onLog?.({ kind: "stderr", message: compactLine(message) })
        return
      }
      case "thread/archived":
      case "thread/unarchived":
      case "thread/closed":
      case "skills/changed":
      case "thread/name/updated":
      case "thread/goal/updated":
      case "thread/goal/cleared":
      case "thread/settings/updated":
      case "app/list/updated":
      case "remoteControl/status/changed":
      case "externalAgentConfig/import/completed":
      case "fs/changed":
      case "fuzzyFileSearch/sessionUpdated":
      case "fuzzyFileSearch/sessionCompleted":
      case "thread/realtime/started":
      case "thread/realtime/itemAdded":
      case "thread/realtime/transcript/delta":
      case "thread/realtime/transcript/done":
      case "thread/realtime/outputAudio/delta":
      case "thread/realtime/sdp":
      case "thread/realtime/error":
      case "thread/realtime/closed":
      case "windowsSandbox/setupCompleted":
      case "account/login/completed":
        return
      case "error": {
        const error = objectRecord(params?.error)
        const message =
          stringValue(error?.message) ||
          stringValue(error?.additionalDetails) ||
          "Codex reported an error"
        void onLog?.({ kind: "stderr", message: compactLine(message) })
        return
      }
      default:
        return
    }
  }

  function summary(): CodexAppServerTurnSummary {
    const finalAssistantText =
      finalAssistantTextFromTurn(completedTurn) ||
      Array.from(completedAssistantByItem.values()).at(-1) ||
      Array.from(assistantByItem.values()).at(-1) ||
      ""
    const status = completedTurn?.status ?? "inProgress"
    const error = completedTurn?.error
    const turnError = error
      ? [error.message, error.additionalDetails].filter(Boolean).join("\n")
      : undefined

    return {
      finalAssistantText,
      status,
      turnError,
      turnId: completedTurn?.id ?? turnId,
    }
  }

  return { handleNotification, summary }
}

function normalizePlanSteps(value: unknown) {
  if (!Array.isArray(value)) return []

  return value.flatMap((step) => {
    const record = objectRecord(step)
    const text = stringValue(record?.step)
    if (!text) return []
    return [
      {
        status: stringValue(record?.status),
        step: text,
      },
    ]
  })
}

function emitMissingCompletedTurnItems(
  turn: CodexAppServerTurn | undefined,
  onLog: ((log: RunCodexLog) => void | Promise<void>) | undefined,
  state: {
    commandOutputByItem: Map<string, string>
    completedLoggedItemIds: Set<string>
    fileChangesByItem: Map<
      string,
      Array<{ diff?: string; kind?: string; path?: string }>
    >
  }
) {
  if (!turn?.items?.length) return

  for (const item of turn.items) {
    if (item.id && state.completedLoggedItemIds.has(item.id)) continue

    emitItemLog(item, "completed", onLog, {
      commandOutput:
        item.type === "commandExecution" && item.id
          ? state.commandOutputByItem.get(item.id)
          : undefined,
      fileChanges:
        item.type === "fileChange" && item.id
          ? state.fileChangesByItem.get(item.id)
          : undefined,
    })

    if (item.id) {
      state.completedLoggedItemIds.add(item.id)
      state.commandOutputByItem.delete(item.id)
      state.fileChangesByItem.delete(item.id)
    }
  }
}

function emitItemLog(
  item: CodexAppServerThreadItem,
  phase: "completed" | "started",
  onLog?: (log: RunCodexLog) => void | Promise<void>,
  fallback: {
    commandOutput?: string
    fileChanges?: Array<{ diff?: string; kind?: string; path?: string }>
  } = {}
) {
  if (item.type === "commandExecution") {
    void onLog?.({
      detail: logDetail({
        command: item.command,
        exitCode: item.exitCode,
        kind: "command_execution",
        output: item.aggregatedOutput ?? fallback.commandOutput,
        status: item.status ?? phase,
      }),
      kind: "command",
      message: "Shell command",
    })
    return
  }

  if (item.type === "fileChange") {
    if (phase !== "completed") return
    void onLog?.({
      detail: logDetail({
        changes: normalizeFileChanges(item.changes).length
          ? normalizeFileChanges(item.changes)
          : (fallback.fileChanges ?? []),
        kind: "file_change",
        status: item.status ?? phase,
      }),
      kind: "command",
      message: "File change",
    })
    return
  }

  if (item.type === "mcpToolCall") {
    const name =
      [item.server, item.tool].filter(Boolean).join(".") || "MCP tool"
    const error = objectRecord(item.error)
    const text = stringValue(error?.message) ?? toolResultText(item.result)
    void onLog?.({
      detail: logDetail({
        error: stringValue(error?.message),
        kind: "tool_call",
        name,
        pluginId: item.pluginId,
        result: item.result,
        status: item.status ?? phase,
        text,
      }),
      kind: "command",
      message: name,
    })
    return
  }

  if (item.type === "dynamicToolCall") {
    const name = [item.namespace, item.tool].filter(Boolean).join(".") || "Tool"
    void onLog?.({
      detail: logDetail({
        kind: "tool_call",
        name,
        status: item.status ?? phase,
        success: item.success,
        text: toolContentText(item.contentItems),
      }),
      kind: "command",
      message: name,
    })
    return
  }

  if (item.type === "reasoning") {
    const summary = Array.isArray(item.summary)
      ? item.summary.filter(
          (value): value is string => typeof value === "string"
        )
      : []
    const content = Array.isArray(item.content)
      ? item.content.filter(
          (value): value is string => typeof value === "string"
        )
      : []
    const text = [...summary, ...content]
      .map(compactLine)
      .filter(Boolean)
      .join("\n")
    if (text) void onLog?.({ kind: "reasoning", message: text })
    return
  }

  if (item.type === "webSearch") {
    void onLog?.({
      detail: logDetail({
        kind: "tool_call",
        query: item.query,
        status: phase,
      }),
      kind: "command",
      message: "Web search",
    })
    return
  }

  const record = item as Extract<CodexAppServerThreadItem, { type: string }>
  if (record.type === "plan") {
    const text = typeof record.text === "string" ? record.text : undefined
    void onLog?.({
      detail: logDetail({ kind: "plan", status: phase, text }),
      kind: "command",
      message: "Plan",
    })
    return
  }

  if (record.type === "collabAgentToolCall") {
    const tool = stringValue(record.tool) ?? "collabAgentToolCall"
    void onLog?.({
      detail: logDetail({
        agentsStates: objectRecord(record.agentsStates) ?? null,
        kind: "tool_call",
        model: stringValue(record.model),
        prompt: stringValue(record.prompt),
        reasoningEffort: stringValue(record.reasoningEffort),
        receiverThreadIds: Array.isArray(record.receiverThreadIds)
          ? record.receiverThreadIds
          : [],
        senderThreadId: stringValue(record.senderThreadId),
        status: stringValue(record.status) ?? phase,
      }),
      kind: "command",
      message: tool,
    })
    return
  }

  if (record.type === "imageView") {
    void onLog?.({
      detail: logDetail({ path: stringValue(record.path), status: phase }),
      kind: "command",
      message: "Image view",
    })
    return
  }

  if (record.type === "imageGeneration") {
    void onLog?.({
      detail: logDetail({
        result: stringValue(record.result),
        revisedPrompt: stringValue(record.revisedPrompt),
        savedPath: stringValue(record.savedPath),
        status: stringValue(record.status) ?? phase,
      }),
      kind: "command",
      message: "Image generation",
    })
    return
  }

  if (
    record.type === "enteredReviewMode" ||
    record.type === "exitedReviewMode"
  ) {
    void onLog?.({
      detail: logDetail({
        review: stringValue(record.review),
        status: phase,
      }),
      kind: "setup",
      message:
        record.type === "enteredReviewMode"
          ? "Entered review mode"
          : "Exited review mode",
    })
    return
  }

  if (record.type === "contextCompaction") {
    void onLog?.({
      kind: "setup",
      message: "Codex compacted context",
    })
  }
}

function finalAssistantTextFromTurn(turn: CodexAppServerTurn | undefined) {
  if (!turn?.items?.length) return ""

  return (
    turn.items
      .filter(
        (
          item
        ): item is Extract<
          CodexAppServerThreadItem,
          { type: "agentMessage" }
        > => item.type === "agentMessage" && typeof item.text === "string"
      )
      .at(-1)?.text ?? ""
  )
}

function toolResultText(result: unknown) {
  const record = objectRecord(result)
  const content = record?.content
  if (!Array.isArray(content)) return undefined

  return toolContentText(content)
}

function normalizeFileChanges(value: unknown) {
  if (!Array.isArray(value)) return []

  return value.flatMap((change) => {
    const record = objectRecord(change)
    if (!record) return []

    const path = stringValue(record.path)
    if (!path) return []

    return [
      {
        diff: stringValue(record.diff),
        kind: normalizeFileChangeKind(record.kind),
        path,
      },
    ]
  })
}

function normalizeFileChangeKind(value: unknown) {
  if (typeof value === "string") return value

  const record = objectRecord(value)
  const type = stringValue(record?.type)
  if (type) return type

  return undefined
}

function toolContentText(content: unknown) {
  if (!Array.isArray(content)) return undefined

  const text = content
    .flatMap((item) => {
      if (typeof item === "string") return [item]
      const record = objectRecord(item)
      const text = stringValue(record?.text)
      return text ? [text] : []
    })
    .join("\n")
    .trim()

  return text || undefined
}

function objectRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined
}

function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : undefined
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function decodeBase64Text(value: unknown) {
  const encoded = stringValue(value)
  if (!encoded) return undefined

  try {
    return Buffer.from(encoded, "base64").toString("utf8")
  } catch {
    return undefined
  }
}

function outputLogKind(value: unknown): RunCodexLog["kind"] {
  const stream = stringValue(value)?.toLowerCase()
  return stream?.includes("err") ? "stderr" : "stdout"
}

function compactLine(value: string, maxLength = 500) {
  const compact = value.replace(/\s+/g, " ").trim()
  return compact.length > maxLength
    ? `${compact.slice(0, Math.max(0, maxLength - 1))}…`
    : compact
}

function logDetail(value: JsonRecord) {
  return JSON.stringify(value)
}

function wait(ms: number, signal?: AbortSignal) {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms))
  if (signal.aborted) return Promise.reject(new Error("Run was canceled."))

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(done, ms)

    function done() {
      clearTimeout(timeout)
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }
    function onAbort() {
      clearTimeout(timeout)
      signal?.removeEventListener("abort", onAbort)
      reject(new Error("Run was canceled."))
    }

    signal.addEventListener("abort", onAbort, { once: true })
  })
}
