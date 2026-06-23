import { createHash } from "node:crypto"

import type { Sandbox } from "@daytona/sdk"

import {
  runDaytonaCommand,
  shellQuote,
  writeDaytonaTextFile,
  type DaytonaSandboxPaths,
} from "@/lib/daytona/sandbox"

const CONTEXT_TOOL_VERSION = "2"

type ContextConfigInput = {
  convexUrl?: string
  notesAccessToken?: string
  paths: Pick<DaytonaSandboxPaths, "codexHome">
  runId?: string
  threadId?: string
}

function base64FileCommand(path: string, content: string) {
  const encoded = Buffer.from(content, "utf8").toString("base64")
  return `printf '%s' ${shellQuote(encoded)} | base64 -d > ${shellQuote(path)}`
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

export function cloudcodeContextToolVersion() {
  return CONTEXT_TOOL_VERSION
}

export function cloudcodeContextStatePath(
  paths: Pick<DaytonaSandboxPaths, "codexHome">
) {
  return `${paths.codexHome}/context/current-run.json`
}

export function cloudcodeContextToolFingerprint(
  paths: Pick<DaytonaSandboxPaths, "codexHome" | "home">
) {
  return sha256(
    [
      CONTEXT_TOOL_VERSION,
      contextMcpServerScript(),
      `${paths.codexHome}/context/cloudcode-context-mcp.mjs`,
      `${paths.home}/.local/bin/cloudcode-notes`,
      cloudcodeContextStatePath(paths),
    ].join("\0")
  )
}

function contextMcpServerScript() {
  return String.raw`#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const contextStatePath = process.env.CLOUDCODE_CONTEXT_STATE_PATH || "";

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function text(message, structuredContent) {
  return {
    content: [{ type: "text", text: message }],
    ...(structuredContent ? { structuredContent } : {}),
  };
}

function toolError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: message }], isError: true };
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readContextState() {
  let state = {};
  if (contextStatePath) {
    try {
      state = JSON.parse(readFileSync(contextStatePath, "utf8"));
    } catch (error) {
      throw new Error("Shared notes context is not configured for this run.");
    }
  }

  const convexUrl = stringValue(state.convexUrl || process.env.CLOUDCODE_CONVEX_URL).replace(/\/+$/, "");
  const runId = stringValue(state.runId || process.env.CLOUDCODE_RUN_ID);
  const threadId = stringValue(state.threadId || process.env.CLOUDCODE_THREAD_ID);
  const notesAccessToken = stringValue(state.notesAccessToken || process.env.CLOUDCODE_NOTES_ACCESS_TOKEN);
  return { convexUrl, notesAccessToken, runId, threadId };
}

function requireContext() {
  const state = readContextState();
  if (!state.convexUrl || !state.runId || !state.threadId || !state.notesAccessToken) {
    throw new Error("Shared notes context is not configured for this run.");
  }
  return state;
}

function stringArg(args, key, fallback = "") {
  const value = args?.[key];
  return typeof value === "string" ? value : fallback;
}

function boolArg(args, key, fallback = false) {
  const value = args?.[key];
  return typeof value === "boolean" ? value : fallback;
}

function numberArg(args, key, fallback = 1) {
  const value = args?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function accessArgs() {
  const state = requireContext();
  return {
    notesAccessToken: state.notesAccessToken,
    runId: state.runId,
    threadId: state.threadId,
  };
}

async function convex(kind, path, args) {
  const state = requireContext();
  const response = await fetch(state.convexUrl + "/api/" + kind, {
    body: JSON.stringify({
      args: [args],
      format: "convex_encoded_json",
      path,
    }),
    headers: {
      "content-type": "application/json",
      "convex-client": "cloudcode-context-mcp-1",
    },
    method: "POST",
  });
  if (!response.ok && response.status !== 560) {
    throw new Error((await response.text()) || "Convex request failed.");
  }
  const data = await response.json();
  if (data.status === "success") return data.value;
  if (data.status === "error") {
    throw new Error(data.errorMessage || "Convex function failed.");
  }
  throw new Error("Invalid Convex response.");
}

async function readNotes() {
  return await convex("query", "chats:workerGetThreadNotes", accessArgs());
}

function notesStatus(prefix, result) {
  const count = result.notes.length;
  const suffix = count === 1 ? "character" : "characters";
  return text(prefix + " Shared notes now have " + count + " " + suffix + ".", result);
}

async function callTool(name, args = {}) {
  switch (name) {
    case "notes_read": {
      const result = await readNotes();
      return text(
        result.notes ? "Shared notes:\n" + result.notes : "Shared notes are empty.",
        result
      );
    }
    case "notes_replace": {
      const notes = stringArg(args, "notes");
      const expectedRevision = stringArg(args, "expectedRevision");
      const result = await convex("mutation", "chats:workerReplaceThreadNotes", {
        ...accessArgs(),
        ...(expectedRevision ? { expectedRevision } : {}),
        notes,
      });
      return notesStatus("Replaced.", result);
    }
    case "notes_append": {
      const result = await convex("mutation", "chats:workerAppendThreadNotes", {
        ...accessArgs(),
        text: stringArg(args, "text"),
      });
      return notesStatus("Appended.", result);
    }
    case "todo_add": {
      const result = await convex("mutation", "chats:workerAddThreadTodo", {
        ...accessArgs(),
        checked: boolArg(args, "checked", false),
        text: stringArg(args, "text"),
      });
      return notesStatus("Added todo.", result);
    }
    case "todo_update_status": {
      const result = await convex("mutation", "chats:workerSetThreadTodoStatus", {
        ...accessArgs(),
        checked: boolArg(args, "checked", false),
        occurrence: numberArg(args, "occurrence", 1),
        text: stringArg(args, "text"),
      });
      if (!result.updated) {
        return {
          content: [{ type: "text", text: "No matching todo was found in shared notes." }],
          structuredContent: result,
          isError: true,
        };
      }
      return notesStatus("Updated todo.", result);
    }
    default:
      throw new Error("Unknown shared notes tool: " + name);
  }
}

const tools = [
  {
    name: "notes_read",
    description: "Read the shared thread notes shown in the Cloudcode Context panel.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "notes_replace",
    description: "Replace the entire shared notes document. Prefer passing expectedRevision from notes_read to avoid overwriting user edits.",
    inputSchema: {
      type: "object",
      required: ["notes"],
      properties: {
        expectedRevision: { type: "string" },
        notes: { type: "string" },
      },
    },
  },
  {
    name: "notes_append",
    description: "Append text to the shared thread notes shown in the Cloudcode Context panel.",
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: { text: { type: "string" } },
    },
  },
  {
    name: "todo_add",
    description: "Append a Markdown todo item to the shared thread notes.",
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        checked: { type: "boolean" },
        text: { type: "string" },
      },
    },
  },
  {
    name: "todo_update_status",
    description: "Mark a matching shared-note todo complete or incomplete by exact visible todo text.",
    inputSchema: {
      type: "object",
      required: ["text", "checked"],
      properties: {
        checked: { type: "boolean" },
        occurrence: { type: "number" },
        text: { type: "string" },
      },
    },
  },
];

async function handle(message) {
  if (!message || typeof message !== "object") return;
  const { id, method, params } = message;
  try {
    if (method === "initialize") {
      if (id !== undefined) send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion || "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "cloudcode-context", version: "1.0.0" },
          instructions: "Use these tools to read and update the same shared notes the user sees in the Cloudcode Context panel. Use notes_replace sparingly and include expectedRevision from notes_read when replacing the full document.",
        },
      });
      return;
    }
    if (method === "notifications/initialized") return;
    if (method === "ping") {
      if (id !== undefined) send({ jsonrpc: "2.0", id, result: {} });
      return;
    }
    if (method === "tools/list") {
      if (id !== undefined) send({ jsonrpc: "2.0", id, result: { tools } });
      return;
    }
    if (method === "tools/call") {
      const result = await callTool(params?.name, params?.arguments || {});
      if (id !== undefined) send({ jsonrpc: "2.0", id, result });
      return;
    }
    if (id !== undefined) {
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found: " + method } });
    }
  } catch (error) {
    if (method === "tools/call" && id !== undefined) {
      send({ jsonrpc: "2.0", id, result: toolError(error) });
      return;
    }
    if (id !== undefined) {
      send({
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
      });
    }
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  try {
    void handle(JSON.parse(line));
  } catch (error) {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: error instanceof Error ? error.message : String(error) } });
  }
});
`
}

export function cloudcodeContextAgentInstructions() {
  return [
    "# Cloudcode Shared Notes",
    "",
    "The right Context panel contains shared notes for this Cloudcode thread.",
    "",
    "Use the `cloudcode_context` MCP tools when notes are relevant:",
    "- `notes_read` reads the current shared notes.",
    "- `notes_append` appends text to the shared notes.",
    "- `notes_replace` replaces the full shared notes document. Use it sparingly, and pass `expectedRevision` from `notes_read` when replacing.",
    "- `todo_add` appends a Markdown todo item.",
    "- `todo_update_status` marks an existing todo complete or incomplete by exact visible todo text.",
    "",
    "These tools update the same notes the user sees and edits. Do not create a separate notes file for thread notes.",
  ].join("\n")
}

export function cloudcodeContextAgentContext() {
  return [
    "Cloudcode provides shared thread notes through the `cloudcode_context` MCP tools.",
    "These notes are the same notes the user sees and edits in the right Context panel.",
    "Use `notes_read` when current notes matter, use `notes_append`, `todo_add`, and `todo_update_status` to track useful shared state, and use `notes_replace` only when replacing the full document is clearly intended.",
  ].join("\n")
}

export function cloudcodeContextCodexConfig({
  convexUrl,
  notesAccessToken,
  paths,
  runId,
  threadId,
}: ContextConfigInput) {
  if (!convexUrl || !notesAccessToken || !runId || !threadId) return ""

  return [
    "[mcp_servers.cloudcode_context]",
    `command = ${JSON.stringify(`${paths.codexHome}/context/cloudcode-context-mcp.mjs`)}`,
    "startup_timeout_sec = 20",
    "",
    "[mcp_servers.cloudcode_context.env]",
    `CLOUDCODE_CONTEXT_STATE_PATH = ${JSON.stringify(cloudcodeContextStatePath(paths))}`,
    "",
  ].join("\n")
}

export async function writeCloudcodeContextState(
  sandbox: Sandbox,
  paths: Pick<DaytonaSandboxPaths, "codexHome">,
  input: Pick<
    ContextConfigInput,
    "convexUrl" | "notesAccessToken" | "runId" | "threadId"
  >
) {
  if (
    !input.convexUrl ||
    !input.notesAccessToken ||
    !input.runId ||
    !input.threadId
  ) {
    return
  }

  await writeDaytonaTextFile(
    sandbox,
    cloudcodeContextStatePath(paths),
    JSON.stringify({
      convexUrl: input.convexUrl,
      notesAccessToken: input.notesAccessToken,
      runId: input.runId,
      threadId: input.threadId,
    })
  )
}

export async function installCloudcodeContextTools(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  signal?: AbortSignal
) {
  const script = contextMcpServerScript()
  const scriptPath = `${paths.codexHome}/context/cloudcode-context-mcp.mjs`
  const binPath = `${paths.home}/.local/bin/cloudcode-notes`
  const markerPath = `${paths.codexHome}/context/tool-version`
  const fingerprint = cloudcodeContextToolFingerprint(paths)

  const result = await runDaytonaCommand(
    sandbox,
    [
      "set -e",
      `fingerprint=${shellQuote(fingerprint)}`,
      `if [ -x ${shellQuote(scriptPath)} ] && [ -L ${shellQuote(binPath)} ] && grep -qxF -- "$fingerprint" ${shellQuote(markerPath)} 2>/dev/null; then exit 0; fi`,
      `mkdir -p ${shellQuote(`${paths.codexHome}/context`)} ${shellQuote(`${paths.home}/.local/bin`)}`,
      base64FileCommand(scriptPath, script),
      `ln -sf ${shellQuote(scriptPath)} ${shellQuote(binPath)}`,
      `chmod +x ${shellQuote(scriptPath)} ${shellQuote(binPath)}`,
      `printf '%s\\n' "$fingerprint" > ${shellQuote(markerPath)}`,
    ].join("\n"),
    { signal, timeoutMs: 10_000 }
  )

  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        "Unable to install Cloudcode shared notes tools."
    )
  }
}
