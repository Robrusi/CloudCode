import assert from "node:assert/strict"
import { spawn, type ChildProcess } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import process from "node:process"

import {
  CODEX_APP_SERVER_DAEMON_CLIENT_SCRIPT,
  CODEX_APP_SERVER_DAEMON_SCRIPT,
} from "@/lib/codex/app-server-daemon-script"
import { buildCodexAuthJsonFromParsed } from "@/lib/codex/auth-json"

const REQUEST_TIMEOUT_MS = 15_000

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value))
    .toString("base64url")
    .replace(/=+$/, "")
}

function testAuthJson(label: string) {
  const idToken = [
    base64UrlJson({ alg: "none" }),
    base64UrlJson({
      "https://api.openai.com/auth": {
        chatgpt_account_id: `account-${label}`,
      },
    }),
    "signature",
  ].join(".")

  return buildCodexAuthJsonFromParsed({
    accessToken: `access-${label}`,
    accountId: `account-${label}`,
    idToken,
    lastRefresh: "2026-06-06T00:00:00.000Z",
    refreshToken: `refresh-${label}`,
  })
}

function mockCodexAppServerScript() {
  return String.raw({
    raw: [
      `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const spawnLog = process.env.MOCK_CODEX_SPAWN_LOG;
const interruptLog = process.env.MOCK_CODEX_INTERRUPT_LOG;
if (spawnLog) appendFileSync(spawnLog, String(process.pid) + "\\n");

let turnCount = 0;

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  const { id, method, params } = message;

  if (method === "initialize") {
    send({ id, result: { userAgent: "mock-codex-app-server/0.0.0" } });
    return;
  }
  if (method === "initialized") return;
  if (method === "thread/start") {
    send({ id, result: { thread: { id: "thread-1" } } });
    return;
  }
  if (method === "thread/resume") {
    if (params?.threadId === "missing-thread") {
      send({
        id,
        error: { code: -32000, message: "thread not found" },
      });
      return;
    }
    send({ id, result: { thread: { id: params.threadId } } });
    return;
  }
  if (method === "turn/start") {
    turnCount += 1;
    const turnId = "turn-" + turnCount;
    const threadId = params.threadId;
    const shouldHang = params?.input?.[0]?.text === "hang";
    send({ id, result: { turn: { id: turnId, status: "inProgress" } } });
    setTimeout(() => {
      send({
        method: "turn/started",
        params: {
          threadId,
          turn: { id: turnId, status: "inProgress" },
        },
      });
      if (shouldHang) return;
      send({
        method: "item/agentMessage/delta",
        params: {
          delta: "answer " + turnCount,
          itemId: "agent-" + turnCount,
          threadId,
          turnId,
        },
      });
      send({
        method: "turn/completed",
        params: {
          threadId,
          turn: {
            error: null,
            id: turnId,
            items: [
              {
                id: "agent-" + turnCount,
                text: "answer " + turnCount,
                type: "agentMessage",
              },
            ],
            status: "completed",
          },
        },
      });
    }, 5);
    return;
  }
  if (method === "turn/interrupt") {
    if (interruptLog) appendFileSync(interruptLog, JSON.stringify(params) + "\\n");
    send({ id, result: {} });
    return;
  }

  send({
    id,
    error: { code: -32601, message: "Method not found: " + method },
  });
});
`,
    ],
  })
}

async function stopProcessGroup(child: ChildProcess) {
  if (child.exitCode !== null) return

  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM")
    } catch {
      child.kill("SIGTERM")
    }
  }

  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 1_000)),
  ])

  if (child.exitCode !== null) return
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGKILL")
    } catch {
      child.kill("SIGKILL")
    }
  }
}

async function requestDaemon({
  clientPath,
  env,
  payload,
  root,
}: {
  clientPath: string
  env: NodeJS.ProcessEnv
  payload: Record<string, unknown>
  root: string
}) {
  const payloadPath = join(root, `payload-${Date.now()}-${Math.random()}.json`)
  await writeFile(payloadPath, JSON.stringify(payload), "utf8")

  const result = await new Promise<{
    exitCode: number | null
    stderr: string
    stdout: string
  }>((resolve) => {
    const child = spawn(process.execPath, [clientPath, payloadPath], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    child.once("exit", (exitCode) => {
      resolve({ exitCode, stderr, stdout })
    })
  })

  const events = result.stdout.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return []
    return [JSON.parse(line) as Record<string, unknown>]
  })

  return { ...result, events }
}

function runPayload({
  authHash,
  authJson,
  codexThreadIdToResume,
  text = "hello",
}: {
  authHash: string
  authJson: string
  codexThreadIdToResume?: string
  text?: string
}) {
  return {
    authHash,
    authJson,
    codexThreadIdToResume,
    threadParams: {
      approvalPolicy: "never",
      cwd: "/tmp/mock-repo",
      ephemeral: false,
      sandbox: "danger-full-access",
      serviceName: "cloudcode",
    },
    turnParams: {
      approvalPolicy: "never",
      cwd: "/tmp/mock-repo",
      input: [{ text, text_elements: [], type: "text" }],
      sandboxPolicy: { type: "dangerFullAccess" },
      threadId: codexThreadIdToResume ?? "__pending__",
    },
    type: "run",
  }
}

function eventLines(events: Record<string, unknown>[]) {
  return events.map((event) => JSON.stringify(event)).join("\n")
}

function resultEvent(events: Record<string, unknown>[]) {
  return events.find((event) => event.type === "result")
}

async function spawnCount(spawnLogPath: string) {
  return (await readFile(spawnLogPath, "utf8")).trim().split(/\r?\n/).length
}

async function eventually(
  predicate: () => boolean | Promise<boolean>,
  label: string
) {
  const deadline = Date.now() + REQUEST_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${label}.`)
}

const root = await mkdtemp(join("/tmp", "ccd-"))
let daemon: ChildProcess | undefined

try {
  const daemonScriptPath = join(root, "cloudcode-codex-daemon.mjs")
  const daemonClientPath = join(root, "cloudcode-codex-daemon-client.mjs")
  const mockCodexPath = join(root, "mock-codex.mjs")
  const interruptLogPath = join(root, "mock-interrupts.log")
  const spawnLogPath = join(root, "mock-spawns.log")
  const socketPath = join(root, "codex-app-server.sock")
  const statePath = join(root, "codex-app-server-daemon.json")

  await Promise.all([
    writeFile(daemonScriptPath, CODEX_APP_SERVER_DAEMON_SCRIPT, {
      mode: 0o600,
    }),
    writeFile(daemonClientPath, CODEX_APP_SERVER_DAEMON_CLIENT_SCRIPT, {
      mode: 0o600,
    }),
    writeFile(mockCodexPath, mockCodexAppServerScript(), { mode: 0o755 }),
  ])

  const env = {
    ...process.env,
    CLOUDCODE_CODEX_LAUNCHER: mockCodexPath,
    CLOUDCODE_DAEMON_ENV_HASH: "daemon-test-env",
    CLOUDCODE_DAEMON_SOCKET: socketPath,
    CLOUDCODE_DAEMON_STATE: statePath,
    CLOUDCODE_REPO_PATH: root,
    CODEX_HOME: root,
    HOME: root,
    MOCK_CODEX_SPAWN_LOG: spawnLogPath,
    MOCK_CODEX_INTERRUPT_LOG: interruptLogPath,
  }

  daemon = spawn(process.execPath, [daemonScriptPath], {
    detached: true,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  })
  let daemonStderr = ""
  daemon.stderr?.on("data", (chunk) => {
    daemonStderr += chunk.toString()
  })

  const deadline = Date.now() + REQUEST_TIMEOUT_MS
  let healthy = false
  let lastHealth: Awaited<ReturnType<typeof requestDaemon>> | undefined
  while (Date.now() < deadline) {
    const health = await requestDaemon({
      clientPath: daemonClientPath,
      env,
      payload: { type: "health" },
      root,
    }).catch(() => undefined)
    lastHealth = health
    healthy = Boolean(
      health?.events.some((event) => event.type === "health" && event.ok)
    )
    if (healthy) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal(
    healthy,
    true,
    [
      "daemon did not become healthy",
      daemonStderr.trim(),
      lastHealth?.stderr.trim(),
      lastHealth?.stdout.trim(),
    ]
      .filter(Boolean)
      .join("\n")
  )

  const firstAuth = testAuthJson("one")
  const firstRun = await requestDaemon({
    clientPath: daemonClientPath,
    env,
    payload: runPayload({
      authHash: "auth-one",
      authJson: firstAuth,
    }),
    root,
  })
  assert.equal(firstRun.exitCode, 0)
  assert.ok(
    firstRun.events.some(
      (event) => event.type === "thread" && event.threadId === "thread-1"
    ),
    eventLines(firstRun.events)
  )
  assert.ok(
    firstRun.events.some(
      (event) =>
        event.type === "result" &&
        event.threadId === "thread-1" &&
        event.finalAssistantText === "answer 1"
    ),
    eventLines(firstRun.events)
  )
  assert.equal(resultEvent(firstRun.events)?.updatedAuthJson, firstAuth)
  const spawnsAfterFirstRun = await spawnCount(spawnLogPath)

  const secondRun = await requestDaemon({
    clientPath: daemonClientPath,
    env,
    payload: runPayload({
      authHash: "auth-one",
      authJson: firstAuth,
      codexThreadIdToResume: "thread-1",
    }),
    root,
  })
  assert.equal(secondRun.exitCode, 0)
  assert.ok(
    secondRun.events.some(
      (event) =>
        event.type === "result" &&
        event.threadId === "thread-1" &&
        event.finalAssistantText === "answer 2"
    ),
    eventLines(secondRun.events)
  )
  assert.equal(resultEvent(secondRun.events)?.updatedAuthJson, firstAuth)
  assert.equal(await spawnCount(spawnLogPath), spawnsAfterFirstRun)

  const secondAuth = testAuthJson("two")
  const thirdRun = await requestDaemon({
    clientPath: daemonClientPath,
    env,
    payload: runPayload({
      authHash: "auth-two",
      authJson: secondAuth,
      codexThreadIdToResume: "thread-1",
    }),
    root,
  })
  assert.equal(thirdRun.exitCode, 0)
  assert.ok(
    thirdRun.events.some(
      (event) =>
        event.type === "result" &&
        event.threadId === "thread-1" &&
        event.finalAssistantText === "answer 1"
    ),
    eventLines(thirdRun.events)
  )
  assert.equal(resultEvent(thirdRun.events)?.updatedAuthJson, secondAuth)
  assert.equal(await spawnCount(spawnLogPath), spawnsAfterFirstRun + 1)

  const hangingPayloadPath = join(root, "payload-hanging-run.json")
  await writeFile(
    hangingPayloadPath,
    JSON.stringify(
      runPayload({
        authHash: "auth-two",
        authJson: secondAuth,
        codexThreadIdToResume: "thread-1",
        text: "hang",
      })
    ),
    "utf8"
  )
  const hangingClient = spawn(
    process.execPath,
    [daemonClientPath, hangingPayloadPath],
    {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    }
  )
  let hangingStdout = ""
  hangingClient.stdout?.on("data", (chunk) => {
    hangingStdout += chunk.toString()
  })
  await eventually(
    () => hangingStdout.includes('"method":"turn/started"'),
    "hanging mock turn to start"
  )
  hangingClient.kill("SIGTERM")
  await Promise.race([
    new Promise((resolve) => hangingClient.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 1_000)),
  ])
  await eventually(
    async () =>
      await readFile(interruptLogPath, "utf8")
        .then((value) => value.includes('"turnId":"turn-2"'))
        .catch(() => false),
    "daemon to interrupt disconnected turn"
  )

  const afterInterruptedRun = await requestDaemon({
    clientPath: daemonClientPath,
    env,
    payload: runPayload({
      authHash: "auth-two",
      authJson: secondAuth,
      codexThreadIdToResume: "thread-1",
    }),
    root,
  })
  assert.equal(afterInterruptedRun.exitCode, 0)
  assert.ok(
    afterInterruptedRun.events.some(
      (event) =>
        event.type === "result" &&
        event.threadId === "thread-1" &&
        event.finalAssistantText === "answer 3"
    ),
    eventLines(afterInterruptedRun.events)
  )
  assert.ok(
    !afterInterruptedRun.events.some(
      (event) =>
        event.type === "error" &&
        typeof event.message === "string" &&
        event.message.includes("A Codex turn is already active")
    ),
    eventLines(afterInterruptedRun.events)
  )

  const missingResume = await requestDaemon({
    clientPath: daemonClientPath,
    env,
    payload: runPayload({
      authHash: "auth-two",
      authJson: testAuthJson("two"),
      codexThreadIdToResume: "missing-thread",
    }),
    root,
  })
  assert.equal(missingResume.exitCode, 0)
  assert.ok(
    missingResume.events.some(
      (event) =>
        event.type === "error" &&
        typeof event.message === "string" &&
        event.message.includes("Refusing to start a fresh thread")
    ),
    eventLines(missingResume.events)
  )

  await requestDaemon({
    clientPath: daemonClientPath,
    env,
    payload: { type: "stop" },
    root,
  })
} finally {
  if (daemon) await stopProcessGroup(daemon)
  await rm(root, { force: true, recursive: true })
}
