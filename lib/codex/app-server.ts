import { codexAppServerRequestResult } from "@/lib/codex/app-server-requests"
import { objectRecord, rawStringValue } from "@/lib/shared/unknown-values"

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
    effort?:
      | "none"
      | "minimal"
      | "low"
      | "medium"
      | "high"
      | "xhigh"
      | "max"
      | "ultra"
      | null
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
    // Structured error discriminant. The string form carries values such as
    // "usageLimitExceeded"; object forms describe transport failures.
    codexErrorInfo?: string | Record<string, unknown> | null
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

class CodexAppServerJsonRpcClient {
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
    const method = rawStringValue(record.method)
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
      const result = await codexAppServerRequestResult(
        method,
        params,
        this.options
      )
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

export {
  createCodexAppServerTurnReducer,
  type CodexAppServerTurnSummary,
} from "@/lib/codex/app-server-turn-reducer"

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
