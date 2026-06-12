export const CODEX_APP_SERVER_DAEMON_VERSION = "3"

export const CODEX_APP_SERVER_DAEMON_SCRIPT = String.raw`import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
import fs from "node:fs"
import net from "node:net"

const VERSION = "3"
const REQUEST_TIMEOUT_MS = Number(process.env.CLOUDCODE_APP_SERVER_REQUEST_TIMEOUT_MS || "45000")
const SOCKET_PATH = requiredEnv("CLOUDCODE_DAEMON_SOCKET")
const STATE_PATH = requiredEnv("CLOUDCODE_DAEMON_STATE")
const CODEX_LAUNCHER = requiredEnv("CLOUDCODE_CODEX_LAUNCHER")
const REPO_PATH = requiredEnv("CLOUDCODE_REPO_PATH")
const CODEX_HOME = requiredEnv("CODEX_HOME")
const OAUTH_ISSUER = process.env.OPENAI_CODEX_ISSUER || "https://auth.openai.com"
const OAUTH_CLIENT_ID = process.env.OPENAI_CODEX_CLIENT_ID || "app_EMoamEEZ73f0CkXaXp7hrann"

let codex = null
let codexExited = false
let initializePromise = null
let initializedAuthHash = null
let writtenAuthHash = null
let nextRpcId = 1
let rpcBuffer = ""
const pending = new Map()
let activeRun = null
const stderrBacklog = []

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error("Missing required environment variable: " + name)
  }
  return value
}

function objectRecord(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value
  return undefined
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function writeLine(socket, value) {
  if (socket.destroyed) return
  socket.write(JSON.stringify(value) + "\n")
}

function compactLine(value, max = 1000) {
  const line = String(value || "").replace(/\s+/g, " ").trim()
  return line.length > max ? line.slice(0, max - 3) + "..." : line
}

function isBundledBubblewrapWarning(value) {
  const normalized = compactLine(value).toLowerCase()
  return (
    normalized.includes("codex could not find bubblewrap on path") &&
    normalized.includes("bundled bubblewrap")
  )
}

function routeForNotification(notification) {
  const params = objectRecord(notification.params)
  const thread = objectRecord(params && params.thread)
  const turn = objectRecord(params && params.turn)
  return {
    threadId:
      stringValue(thread && thread.id) ||
      stringValue(params && params.threadId) ||
      stringValue(turn && turn.threadId),
    turnId:
      stringValue(turn && turn.id) ||
      stringValue(params && params.turnId) ||
      stringValue(params && params.turn_id),
  }
}

function notificationMatchesRun(run, notification) {
  const route = routeForNotification(notification)
  if (run.threadId && route.threadId && route.threadId !== run.threadId) {
    return false
  }
  if (run.turnId && route.turnId && route.turnId !== run.turnId) {
    return false
  }
  return true
}

function agentMessageFromTurn(turn) {
  const items = Array.isArray(turn && turn.items) ? turn.items : []
  const messages = items.flatMap((item) => {
    const record = objectRecord(item)
    if (!record || record.type !== "agentMessage") return []
    const text = stringValue(record.text)
    return text ? [text] : []
  })
  return messages.at(-1) || ""
}

function turnErrorMessage(turn) {
  const error = objectRecord(turn && turn.error)
  if (!error) return ""
  const message = stringValue(error.message)
  const details = stringValue(error.additionalDetails)
  return [message, details].filter(Boolean).join("\n")
}

function emitNotification(notification) {
  const run = activeRun
  if (!run || run.socket.destroyed) return

  const route = routeForNotification(notification)
  if (
    notification.method === "turn/started" &&
    route.turnId &&
    (!run.threadId || !route.threadId || route.threadId === run.threadId)
  ) {
    run.turnId ||= route.turnId
  }

  writeLine(run.socket, { notification, type: "notification" })

  if (notification.method !== "turn/completed") return
  if (!notificationMatchesRun(run, notification)) return
  const params = objectRecord(notification.params)
  const turn = objectRecord(params && params.turn)
  run.completedTurn = turn || null
  run.resolve()
}

function handleRpcLine(line) {
  if (!line.trim()) return

  let message
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
    void respondToServerRequest(id, method, record.params)
    return
  }

  if (id !== undefined) {
    const request = pending.get(id)
    if (!request) return
    clearTimeout(request.timeout)
    pending.delete(id)
    const error = objectRecord(record.error)
    if (error) {
      const rpcError = new Error(
        stringValue(error.message) || "Codex app-server request failed."
      )
      rpcError.code = error.code
      rpcError.data = error.data
      request.reject(rpcError)
    } else {
      request.resolve(record.result)
    }
    return
  }

  emitNotification(record)
}

function handleRpcData(data) {
  rpcBuffer += data
  const lines = rpcBuffer.split(/\r?\n/)
  rpcBuffer = lines.pop() || ""
  for (const line of lines) handleRpcLine(line)
}

function rejectPending(error) {
  for (const [id, request] of pending) {
    clearTimeout(request.timeout)
    request.reject(error)
    pending.delete(id)
  }
}

function stopCodexAppServer() {
  if (!codex || codexExited) return
  codexExited = true
  rejectPending(new Error("Codex app-server is restarting."))
  try {
    codex.kill()
  } catch {}
  codex = null
  initializePromise = null
}

function sendRpc(message) {
  if (!codex || !codex.stdin || codex.stdin.destroyed || codexExited) {
    throw new Error("Codex app-server is not running.")
  }
  codex.stdin.write(JSON.stringify(message) + "\n")
}

function request(method, params, timeoutMs = REQUEST_TIMEOUT_MS) {
  const id = nextRpcId++
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error("Codex app-server request timed out: " + method))
    }, timeoutMs)
    pending.set(id, { reject, resolve, timeout })
    try {
      sendRpc({ id, method, params })
    } catch (error) {
      clearTimeout(timeout)
      pending.delete(id)
      reject(error)
    }
  })
}

function notify(method, params) {
  sendRpc(params === undefined ? { method } : { method, params })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function emitStderr(line) {
  if (isBundledBubblewrapWarning(line)) {
    if (activeRun && !activeRun.socket.destroyed) {
      writeLine(activeRun.socket, {
        message: "Codex using bundled bubblewrap sandbox helper",
        type: "setup",
      })
    }
    return
  }

  const message = compactLine(line)
  if (!message) return
  stderrBacklog.push(message)
  if (stderrBacklog.length > 50) stderrBacklog.shift()
  if (activeRun && !activeRun.socket.destroyed) {
    writeLine(activeRun.socket, { line: message, type: "stderr" })
  }
}

function startCodexAppServer() {
  codexExited = false
  rpcBuffer = ""
  const child = spawn(CODEX_LAUNCHER, ["app-server"], {
    cwd: REPO_PATH,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  })
  codex = child
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  child.stdout.on("data", (chunk) => {
    if (codex !== child) return
    handleRpcData(chunk)
  })
  child.stderr.on("data", (chunk) => {
    if (codex !== child) return
    for (const line of String(chunk).split(/\r?\n/)) emitStderr(line)
  })
  child.on("exit", (code) => {
    if (codex !== child) return
    codexExited = true
    const error = new Error(
      "Codex app-server exited" + (code === null ? "." : " with code " + code + ".")
    )
    rejectPending(error)
    if (activeRun && !activeRun.socket.destroyed) {
      writeLine(activeRun.socket, { message: error.message, type: "error" })
      activeRun.reject(error)
    }
  })
  child.on("error", (error) => {
    if (codex !== child) return
    codexExited = true
    rejectPending(error)
    if (activeRun && !activeRun.socket.destroyed) {
      writeLine(activeRun.socket, { message: error.message, type: "error" })
      activeRun.reject(error)
    }
  })
}

async function ensureCodexInitialized(authHash) {
  if (
    codex &&
    !codexExited &&
    initializePromise &&
    (!authHash || initializedAuthHash === authHash)
  ) {
    await initializePromise
    return
  }

  if (codex && !codexExited && authHash && initializedAuthHash !== authHash) {
    stopCodexAppServer()
  }

  startCodexAppServer()
  initializedAuthHash = authHash || null
  initializePromise = (async () => {
    await request("initialize", {
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
      },
      clientInfo: {
        name: "cloudcode-daemon",
        title: "Cloudcode",
        version: VERSION,
      },
    })
    notify("initialized")
  })()
  await initializePromise
}

function base64UrlDecodeJson(token) {
  const parts = String(token || "").split(".")
  const payload = parts[1]
  if (!payload) throw new Error("id_token must be a JWT.")
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  )
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"))
}

function getAccountIdFromIdToken(idToken) {
  const payload = base64UrlDecodeJson(idToken)
  const claims = objectRecord(payload["https://api.openai.com/auth"])
  const accountId = claims && claims.chatgpt_account_id
  return typeof accountId === "string" && accountId ? accountId : null
}

function parseAuthJson(authJson) {
  const parsed = JSON.parse(authJson)
  const tokens = objectRecord(parsed.tokens)
  if (!tokens) throw new Error("auth.json tokens are missing.")
  if (
    typeof tokens.id_token !== "string" ||
    typeof tokens.access_token !== "string" ||
    typeof tokens.refresh_token !== "string"
  ) {
    throw new Error("auth.json tokens must include id_token, access_token, and refresh_token.")
  }
  return {
    accessToken: tokens.access_token,
    accountId:
      typeof tokens.account_id === "string"
        ? tokens.account_id
        : getAccountIdFromIdToken(tokens.id_token),
    idToken: tokens.id_token,
    lastRefresh:
      typeof parsed.last_refresh === "string"
        ? parsed.last_refresh
        : new Date().toISOString(),
    openaiApiKey:
      typeof parsed.OPENAI_API_KEY === "string" ? parsed.OPENAI_API_KEY : undefined,
    refreshToken: tokens.refresh_token,
  }
}

function buildAuthJson(auth) {
  return JSON.stringify(
    {
      auth_mode: "chatgpt",
      ...(auth.openaiApiKey ? { OPENAI_API_KEY: auth.openaiApiKey } : {}),
      last_refresh: auth.lastRefresh,
      tokens: {
        access_token: auth.accessToken,
        account_id: auth.accountId,
        id_token: auth.idToken,
        refresh_token: auth.refreshToken,
      },
    },
    null,
    2
  )
}

function writeAuthJson(authJson, authHash) {
  fs.mkdirSync(CODEX_HOME, { mode: 0o700, recursive: true })
  fs.writeFileSync(CODEX_HOME + "/auth.json", authJson, "utf8")
  try {
    fs.chmodSync(CODEX_HOME + "/auth.json", 0o600)
  } catch {}
  writtenAuthHash = authHash || sha256(authJson)
}

function ensureAuthJson(authJson, authHash) {
  const auth = parseAuthJson(authJson)
  const authPath = CODEX_HOME + "/auth.json"
  if (!(authHash && writtenAuthHash === authHash && fs.existsSync(authPath))) {
    writeAuthJson(authJson, authHash)
  }
  return auth
}

async function refreshChatgptAuthTokens(params) {
  if (!activeRun || !activeRun.auth) {
    throw new Error("No active Codex auth is available for token refresh.")
  }
  const previousAccountId = stringValue(objectRecord(params) && objectRecord(params).previousAccountId)
  const endpoint = new URL("/oauth/token", OAUTH_ISSUER)
  const body = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: activeRun.auth.refreshToken,
  })
  const response = await fetch(endpoint, {
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  })
  if (!response.ok) {
    throw new Error("Token refresh failed with status " + response.status + ".")
  }
  const data = await response.json()
  if (typeof data.access_token !== "string") {
    throw new Error("Token refresh response did not include access_token.")
  }

  const idToken = typeof data.id_token === "string" ? data.id_token : activeRun.auth.idToken
  const accountId =
    (typeof data.id_token === "string" ? getAccountIdFromIdToken(idToken) : activeRun.auth.accountId) ||
    previousAccountId ||
    null
  activeRun.auth = {
    ...activeRun.auth,
    accessToken: data.access_token,
    accountId,
    idToken,
    lastRefresh: new Date().toISOString(),
    refreshToken:
      typeof data.refresh_token === "string" ? data.refresh_token : activeRun.auth.refreshToken,
  }
  const authJson = buildAuthJson(activeRun.auth)
  activeRun.authJson = authJson
  writeAuthJson(authJson)
  initializedAuthHash = writtenAuthHash

  return {
    accessToken: activeRun.auth.accessToken,
    chatgptAccountId: activeRun.auth.accountId || "",
    chatgptPlanType: null,
  }
}

function emptyToolInputAnswers(params) {
  const record = objectRecord(params)
  const questions = Array.isArray(record && record.questions) ? record.questions : []
  return Object.fromEntries(
    questions.flatMap((question) => {
      const questionRecord = objectRecord(question)
      const id = stringValue(questionRecord && questionRecord.id)
      return id ? [[id, { answers: [] }]] : []
    })
  )
}

function unsupportedDynamicToolMessage(params) {
  const record = objectRecord(params)
  const namespace = stringValue(record && record.namespace) || "unknown"
  const tool = stringValue(record && record.tool) || "tool"
  return (
    "Cloudcode cannot execute app-server dynamic tool request " +
    namespace +
    "." +
    tool +
    " in this worker."
  )
}

async function serverRequestResult(method, params) {
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
      return await refreshChatgptAuthTokens(params)
    case "attestation/generate":
      return { token: "" }
    default:
      return undefined
  }
}

async function respondToServerRequest(id, method, params) {
  try {
    const result = await serverRequestResult(method, params)
    if (result === undefined) {
      sendRpc({
        error: {
          code: -32601,
          message: "Cloudcode does not implement Codex app-server request: " + method,
        },
        id,
      })
      return
    }
    sendRpc({ id, result })
  } catch (error) {
    sendRpc({
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : "Cloudcode failed to handle Codex app-server request: " + method,
      },
      id,
    })
  }
}

async function interruptActiveRun(run, reason) {
  if (!run || run.interrupting) return
  run.interrupting = true

  try {
    if (run.threadId && run.turnId) {
      await request(
        "turn/interrupt",
        { threadId: run.threadId, turnId: run.turnId },
        5000
      )
    } else {
      stopCodexAppServer()
    }
  } catch {
    stopCodexAppServer()
  } finally {
    if (activeRun === run) activeRun = null
    run.reject?.(new Error(reason || "Codex turn interrupted."))
  }
}

function statusHasTools(status) {
  const record = objectRecord(status)
  const data = Array.isArray(record && record.data) ? record.data : []
  return data.some((server) => {
    const serverRecord = objectRecord(server)
    const tools = objectRecord(serverRecord && serverRecord.tools)
    return tools && Object.keys(tools).length > 0
  })
}

async function emitMcpStatus(socket, threadId) {
  if (!threadId || socket.destroyed) return
  try {
    let status = null
    for (const delayMs of [0, 250, 750, 1500, 2500]) {
      if (delayMs) await sleep(delayMs)
      status = await request(
        "mcpServerStatus/list",
        {
          detail: "toolsAndAuthOnly",
          limit: 500,
          threadId,
        },
        10000
      )
      if (statusHasTools(status)) break
    }
    writeLine(socket, { status, type: "mcpStatus" })
  } catch (error) {
    writeLine(socket, {
      message:
        "Unable to discover MCP tools: " +
        (error instanceof Error ? compactLine(error.message) : "unknown error"),
      type: "setup",
    })
  }
}

async function runTurn(payload, socket) {
  if (activeRun) {
    if (activeRun.socket.destroyed) {
      await interruptActiveRun(
        activeRun,
        "Previous Codex turn client disconnected."
      )
      if (activeRun) {
        throw new Error(
          "A previous Codex turn is still interrupting in this sandbox daemon."
        )
      }
    } else {
      throw new Error("A Codex turn is already active in this sandbox daemon.")
    }
  }

  const authHash = stringValue(payload.authHash)
  const authJson =
    typeof payload.authJson === "string" && payload.authJson
      ? payload.authJson
      : undefined
  if (!authJson) {
    throw new Error("Codex app-server daemon run payload is missing authJson.")
  }
  const auth = ensureAuthJson(authJson, authHash)
  await ensureCodexInitialized(authHash)

  const run = {
    auth,
    authJson,
    completedTurn: null,
    interrupting: false,
    reject: null,
    resolve: null,
    socket,
    threadId: stringValue(payload.codexThreadIdToResume),
    turnId: undefined,
  }
  activeRun = run

  const socketClosed = () => {
    if (activeRun === run) {
      void interruptActiveRun(run, "Codex turn client disconnected.")
    }
  }
  socket.on("close", socketClosed)

  try {
    const completed = new Promise((resolve, reject) => {
      run.resolve = resolve
      run.reject = reject
    })

    const threadParams = objectRecord(payload.threadParams) || {}
    if (run.threadId) {
      let resumed
      try {
        resumed = await request("thread/resume", {
          ...threadParams,
          threadId: run.threadId,
        })
      } catch (error) {
        const message = error instanceof Error ? compactLine(error.message) : "Unable to resume Codex thread."
        throw new Error(
          "Codex app-server could not resume thread " +
            run.threadId +
            ". Refusing to start a fresh thread because fresh-thread recovery is disabled. " +
            message
        )
      }
      const thread = objectRecord(resumed && resumed.thread)
      run.threadId = stringValue(thread && thread.id) || run.threadId
      writeLine(socket, { threadId: run.threadId, type: "thread" })
      await emitMcpStatus(socket, run.threadId)
    } else {
      const started = await request("thread/start", threadParams)
      const thread = objectRecord(started && started.thread)
      run.threadId = stringValue(thread && thread.id)
      if (!run.threadId) throw new Error("Codex app-server did not return a thread id.")
      writeLine(socket, { threadId: run.threadId, type: "thread" })
      await emitMcpStatus(socket, run.threadId)
    }

    const turnParams = {
      ...(objectRecord(payload.turnParams) || {}),
      threadId: run.threadId,
    }
    const startedTurn = await request("turn/start", turnParams)
    const turn = objectRecord(startedTurn && startedTurn.turn)
    run.turnId = stringValue(turn && turn.id)
    const alreadyCompleted =
      stringValue(turn && turn.status) && stringValue(turn && turn.status) !== "inProgress"
        ? turn
        : undefined

    if (alreadyCompleted) {
      const notification = {
        method: "turn/completed",
        params: { threadId: run.threadId, turn: alreadyCompleted },
      }
      writeLine(socket, { notification, type: "notification" })
      run.completedTurn = alreadyCompleted
    } else {
      await completed
    }

    const completedTurn = run.completedTurn || alreadyCompleted || {}
    const status = stringValue(completedTurn.status) || "failed"
    writeLine(socket, {
      finalAssistantText: agentMessageFromTurn(completedTurn),
      status,
      threadId: run.threadId,
      turnError: turnErrorMessage(completedTurn),
      type: "result",
      updatedAuthJson: run.authJson,
    })
  } finally {
    socket.off("close", socketClosed)
    if (activeRun === run) activeRun = null
  }
}

async function handleClientPayload(payload, socket) {
  const type = stringValue(payload && payload.type)
  if (type === "health") {
    await ensureCodexInitialized()
    writeLine(socket, {
      envHash: process.env.CLOUDCODE_DAEMON_ENV_HASH || "",
      ok: true,
      pid: process.pid,
      type: "health",
      version: VERSION,
    })
    socket.end()
    return
  }
  if (type === "stop") {
    writeLine(socket, { ok: true, type: "stopping" })
    socket.end()
    setTimeout(() => {
      try {
        server.close()
      } catch {}
      try {
        codex && codex.kill()
      } catch {}
      try {
        fs.unlinkSync(SOCKET_PATH)
      } catch {}
      process.exit(0)
    }, 10)
    return
  }
  if (type === "interrupt") {
    if (activeRun) {
      await interruptActiveRun(
        activeRun,
        "Codex turn interrupted by client request."
      )
      writeLine(socket, { ok: true, type: "interrupted" })
    } else {
      writeLine(socket, { ok: true, type: "idle" })
    }
    socket.end()
    return
  }
  if (type === "run") {
    await runTurn(payload, socket)
    socket.end()
    return
  }
  throw new Error("Unknown daemon request type: " + String(type || "missing"))
}

const server = net.createServer((socket) => {
  socket.setEncoding("utf8")
  let buffer = ""
  socket.on("data", (chunk) => {
    buffer += chunk
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() || ""
    for (const line of lines) {
      if (!line.trim()) continue
      let payload
      try {
        payload = JSON.parse(line)
      } catch (error) {
        writeLine(socket, { message: "Invalid daemon request JSON.", type: "error" })
        socket.end()
        continue
      }
      void handleClientPayload(payload, socket).catch((error) => {
        writeLine(socket, {
          message: error instanceof Error ? error.message : "Codex app-server daemon request failed.",
          type: "error",
        })
        socket.end()
      })
    }
  })
})

try {
  fs.unlinkSync(SOCKET_PATH)
} catch {}
fs.mkdirSync(CODEX_HOME, { mode: 0o700, recursive: true })
fs.mkdirSync(SOCKET_PATH.slice(0, SOCKET_PATH.lastIndexOf("/")), {
  mode: 0o700,
  recursive: true,
})
server.listen(SOCKET_PATH, () => {
  fs.chmodSync(SOCKET_PATH, 0o600)
  fs.writeFileSync(
    STATE_PATH,
    JSON.stringify(
      {
        envHash: process.env.CLOUDCODE_DAEMON_ENV_HASH || "",
        pid: process.pid,
        socketPath: SOCKET_PATH,
        startedAt: new Date().toISOString(),
        version: VERSION,
      },
      null,
      2
    ),
    "utf8"
  )
})

process.on("SIGTERM", () => {
  try {
    codex && codex.kill()
  } catch {}
  try {
    fs.unlinkSync(SOCKET_PATH)
  } catch {}
  process.exit(0)
})
`

export const CODEX_APP_SERVER_DAEMON_CLIENT_SCRIPT = String.raw`import fs from "node:fs"
import net from "node:net"

const socketPath = process.env.CLOUDCODE_DAEMON_SOCKET
const payloadPath = process.argv[2]

if (!socketPath) {
  console.error("CLOUDCODE_DAEMON_SOCKET is required.")
  process.exit(1)
}
if (!payloadPath) {
  console.error("Payload path is required.")
  process.exit(1)
}

const payload = fs.readFileSync(payloadPath, "utf8")
const socket = net.createConnection(socketPath)

socket.setEncoding("utf8")
socket.on("connect", () => {
  socket.write(payload.trim() + "\n")
})
socket.on("data", (chunk) => {
  process.stdout.write(chunk)
})
socket.on("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
socket.on("close", () => {
  process.exit(process.exitCode || 0)
})
`
