import { spawn, type ChildProcess } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import process from "node:process"

import {
  CodexAppServerStdioRpcClient,
  type CodexAppServerTransport,
  type CodexAppServerThreadResponse,
} from "@/lib/codex/app-server"
import {
  CODEX_APP_SERVER_DAEMON_CLIENT_SCRIPT,
  CODEX_APP_SERVER_DAEMON_SCRIPT,
} from "@/lib/codex/app-server-daemon-script"
import { appServerThreadParams } from "@/lib/codex/app-server-run-params"

const REQUEST_TIMEOUT_MS = 45_000

function smokeMcpServerScript() {
  return String.raw`#!/usr/bin/env node
import { createInterface } from "node:readline";

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

async function handle(message) {
  if (!message || typeof message !== "object") return;
  const { id, method, params } = message;

  if (method === "initialize") {
    if (id !== undefined) {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion || "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "cloudcode-smoke-mcp", version: "1.0.0" },
        },
      });
    }
    return;
  }

  if (method === "notifications/initialized") return;
  if (method === "ping") {
    if (id !== undefined) send({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  if (method === "tools/list") {
    if (id !== undefined) {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "echo",
              description: "Echo smoke-test text.",
              inputSchema: {
                type: "object",
                properties: { text: { type: "string" } },
              },
            },
          ],
        },
      });
    }
    return;
  }
  if (method === "tools/call") {
    const text =
      params?.name === "echo" && typeof params?.arguments?.text === "string"
        ? params.arguments.text
        : "missing text";
    if (id !== undefined) {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text }],
          structuredContent: { echoed: text },
        },
      });
    }
    return;
  }

  if (id !== undefined) {
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Method not found: " + method },
    });
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  try {
    void handle(JSON.parse(line));
  } catch (error) {
    send({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32700,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
});
`
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
    new Promise((resolve) => setTimeout(resolve, 2_000)),
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

async function runDaemonHealthSmoke(root: string) {
  const daemonScriptPath = join(root, "cloudcode-codex-daemon.mjs")
  const daemonClientPath = join(root, "cloudcode-codex-daemon-client.mjs")
  const socketPath = join(root, "codex-app-server.sock")
  const statePath = join(root, "codex-app-server-daemon.json")
  const healthPayloadPath = join(root, "daemon-health.json")
  const stopPayloadPath = join(root, "daemon-stop.json")

  await Promise.all([
    writeFile(daemonScriptPath, CODEX_APP_SERVER_DAEMON_SCRIPT, {
      mode: 0o600,
    }),
    writeFile(daemonClientPath, CODEX_APP_SERVER_DAEMON_CLIENT_SCRIPT, {
      mode: 0o600,
    }),
    writeFile(healthPayloadPath, JSON.stringify({ type: "health" })),
    writeFile(stopPayloadPath, JSON.stringify({ type: "stop" })),
  ])

  const env = {
    ...process.env,
    CLOUDCODE_CODEX_LAUNCHER: "codex",
    CLOUDCODE_DAEMON_ENV_HASH: "smoke-env",
    CLOUDCODE_DAEMON_SOCKET: socketPath,
    CLOUDCODE_DAEMON_STATE: statePath,
    CLOUDCODE_REPO_PATH: root,
    CODEX_HOME: root,
    HOME: root,
  }
  const daemon = spawn(process.execPath, [daemonScriptPath], {
    detached: true,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  })

  let daemonStderr = ""
  daemon.stderr?.on("data", (chunk) => {
    daemonStderr += chunk.toString()
  })

  try {
    const deadline = Date.now() + REQUEST_TIMEOUT_MS
    while (Date.now() < deadline) {
      const health = await new Promise<{
        exitCode: number | null
        stdout: string
        stderr: string
      }>((resolve) => {
        const child = spawn(
          process.execPath,
          [daemonClientPath, healthPayloadPath],
          {
            env,
            stdio: ["ignore", "pipe", "pipe"],
          }
        )
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
      const event = health.stdout
        .split(/\r?\n/)
        .flatMap((line) => {
          if (!line.trim()) return []
          try {
            return [JSON.parse(line) as { type?: string; ok?: boolean }]
          } catch {
            return []
          }
        })
        .find((candidate) => candidate.type === "health")
      if (health.exitCode === 0 && event?.ok) return event
      await new Promise((resolve) => setTimeout(resolve, 250))
    }

    throw new Error(
      `Codex app-server daemon smoke did not become healthy.\n${daemonStderr.trim()}`
    )
  } finally {
    await new Promise<void>((resolve) => {
      const child = spawn(
        process.execPath,
        [daemonClientPath, stopPayloadPath],
        {
          env,
          stdio: ["ignore", "ignore", "ignore"],
        }
      )
      child.once("exit", () => resolve())
      child.once("error", () => resolve())
      setTimeout(resolve, 500)
    })
    await stopProcessGroup(daemon)
  }
}

const root = await mkdtemp(join(tmpdir(), "cloudcode-codex-app-server-"))
let child: ChildProcess | undefined

try {
  const mcpScriptPath = join(root, "cloudcode-smoke-mcp.mjs")
  await mkdir(root, { recursive: true })
  await writeFile(mcpScriptPath, smokeMcpServerScript(), { mode: 0o755 })
  await writeFile(
    join(root, "config.toml"),
    [
      "[mcp_servers.cloudcode_smoke]",
      `command = ${JSON.stringify(mcpScriptPath)}`,
      "startup_timeout_sec = 5",
      "",
    ].join("\n")
  )

  const server = spawn("codex", ["app-server"], {
    detached: true,
    env: {
      ...process.env,
      CODEX_HOME: root,
      HOME: root,
    },
    stdio: ["pipe", "pipe", "pipe"],
  })
  child = server

  let stderr = ""
  const transport: CodexAppServerTransport = {
    close: () => stopProcessGroup(server),
    isConnected: () => server.exitCode === null && !server.killed,
    send: (data) =>
      new Promise<void>((resolve, reject) => {
        server.stdin?.write(data, (error) => {
          if (error) reject(error)
          else resolve()
        })
      }),
  }
  const client = new CodexAppServerStdioRpcClient(transport, {
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
  })

  server.stdout?.on("data", (chunk) => {
    client.receive(chunk.toString())
  })
  server.stderr?.on("data", (chunk) => {
    stderr += chunk.toString()
  })
  server.once("exit", (code) => {
    client.terminate(
      new Error(`Codex app-server exited with code ${code ?? "unknown"}.`)
    )
  })

  await client.connect()
  try {
    const initialized = await client.request(
      "initialize",
      {
        capabilities: { experimentalApi: true, requestAttestation: false },
        clientInfo: {
          name: "cloudcode-smoke",
          title: "Cloudcode Smoke",
          version: "0",
        },
      },
      { timeoutMs: REQUEST_TIMEOUT_MS }
    )
    await client.notify("initialized")
    const thread = await client.request<
      "thread/start",
      CodexAppServerThreadResponse
    >(
      "thread/start",
      appServerThreadParams({
        model: "gpt-5",
        paths: {
          baseRefPath: join(root, "base-ref"),
          cloudcodeProfilePath: join(root, "profile"),
          codexHome: root,
          codexLauncherPath: "codex",
          home: root,
          lastMessagePath: join(root, "last-message"),
          presetEnvPath: join(root, "env"),
          previousDiffPath: join(root, "previous-diff"),
          promptPath: join(root, "prompt"),
          repoPath: root,
          runtimeHome: root,
        },
        reasoningEffort: "medium",
        speed: "standard",
      }),
      { timeoutMs: REQUEST_TIMEOUT_MS }
    )
    const threadId = thread.thread?.id
    if (!threadId) throw new Error("Codex app-server did not start a thread.")

    const mcpStatus = await client.request<
      "mcpServerStatus/list",
      {
        data: Array<{
          name: string
          tools?: Record<string, unknown>
        }>
      }
    >(
      "mcpServerStatus/list",
      {
        detail: "toolsAndAuthOnly",
        threadId,
      },
      { timeoutMs: REQUEST_TIMEOUT_MS }
    )
    const smokeServer = mcpStatus.data.find(
      (server) => server.name === "cloudcode_smoke"
    )
    if (!smokeServer?.tools?.echo) {
      throw new Error("Codex app-server did not load smoke MCP tools.")
    }

    const mcpToolResult = await client.request<
      "mcpServer/tool/call",
      {
        content: Array<{ text?: string; type?: string }>
        structuredContent?: { echoed?: string }
      }
    >(
      "mcpServer/tool/call",
      {
        arguments: { text: "hello mcp" },
        server: "cloudcode_smoke",
        threadId,
        tool: "echo",
      },
      { timeoutMs: REQUEST_TIMEOUT_MS }
    )
    if (mcpToolResult.structuredContent?.echoed !== "hello mcp") {
      throw new Error("Codex app-server MCP tool call returned the wrong data.")
    }

    await client.close()
    const daemonHealth = await runDaemonHealthSmoke(root)

    console.log(
      JSON.stringify(
        {
          daemonHealth: Boolean(daemonHealth),
          initialized: Boolean(initialized),
          mcpEcho: mcpToolResult.structuredContent.echoed,
          mcpTools: Object.keys(smokeServer.tools),
          threadId,
        },
        null,
        2
      )
    )
  } catch (error) {
    if (stderr.trim() && error instanceof Error) {
      throw new Error(`${error.message}\n\n${stderr.trim()}`)
    }
    throw error
  } finally {
    await client.close()
  }
} finally {
  if (child) await stopProcessGroup(child)
  await rm(root, { force: true, recursive: true })
}
