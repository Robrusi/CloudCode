import { createHash } from "node:crypto"

import type { Sandbox } from "@daytona/sdk"

import {
  runDaytonaCommand,
  shellQuote,
  writeDaytonaTextFile,
  type DaytonaSandboxPaths,
} from "@/lib/daytona/sandbox"
import {
  FACTORY_WAIT_DEFAULT_TTL_MS,
  FACTORY_WAIT_MAX_TTL_MS,
} from "@/lib/factory/limits"

// Bumped for instruction changes too: the version feeds the hot-continuation
// fingerprint, forcing a cold setup that rewrites AGENTS.md on reused
// sandboxes so updated guidance actually reaches the agent.
const FACTORY_TOOL_VERSION = "8"

const WAIT_DEFAULT_TTL_DAYS = FACTORY_WAIT_DEFAULT_TTL_MS / (24 * 60 * 60_000)
const WAIT_MAX_TTL_DAYS = FACTORY_WAIT_MAX_TTL_MS / (24 * 60 * 60_000)

type FactoryConfigInput = {
  accessToken?: string
  convexUrl?: string
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

export function cloudcodeFactoryToolVersion() {
  return FACTORY_TOOL_VERSION
}

export function cloudcodeFactoryStatePath(
  paths: Pick<DaytonaSandboxPaths, "codexHome">
) {
  return `${paths.codexHome}/factory/current-run.json`
}

export function cloudcodeFactoryToolFingerprint(
  paths: Pick<DaytonaSandboxPaths, "codexHome" | "home">
) {
  return sha256(
    [
      FACTORY_TOOL_VERSION,
      factoryMcpServerScript(),
      `${paths.codexHome}/factory/cloudcode-factory-mcp.mjs`,
      `${paths.home}/.local/bin/cloudcode-factory`,
      cloudcodeFactoryStatePath(paths),
    ].join("\0")
  )
}

function factoryMcpServerScript() {
  return String.raw`#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const factoryStatePath = process.env.CLOUDCODE_FACTORY_STATE_PATH || "";

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

function readFactoryState() {
  let state = {};
  if (factoryStatePath) {
    try {
      state = JSON.parse(readFileSync(factoryStatePath, "utf8"));
    } catch (error) {
      throw new Error("Factory tools are not configured for this run.");
    }
  }

  const convexUrl = stringValue(state.convexUrl || process.env.CLOUDCODE_CONVEX_URL).replace(/\/+$/, "");
  const runId = stringValue(state.runId || process.env.CLOUDCODE_RUN_ID);
  const threadId = stringValue(state.threadId || process.env.CLOUDCODE_THREAD_ID);
  const accessToken = stringValue(state.accessToken || process.env.CLOUDCODE_FACTORY_ACCESS_TOKEN);
  return { accessToken, convexUrl, runId, threadId };
}

function requireState() {
  const state = readFactoryState();
  if (!state.convexUrl || !state.runId || !state.threadId || !state.accessToken) {
    throw new Error("Factory tools are not configured for this run.");
  }
  return state;
}

function accessArgs() {
  const state = requireState();
  return {
    accessToken: state.accessToken,
    runId: state.runId,
    threadId: state.threadId,
  };
}

function stringArg(args, key) {
  const value = args?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function requiredStringArg(args, key) {
  const value = stringArg(args, key);
  if (!value) throw new Error(key + " is required.");
  return value;
}

function boolArg(args, key) {
  const value = args?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function numberArg(args, key) {
  const value = args?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArrayArg(args, key) {
  const value = args?.[key];
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item) => typeof item === "string" && item.trim());
  return items.length ? items : undefined;
}

async function convex(kind, path, args) {
  const state = requireState();
  const response = await fetch(state.convexUrl + "/api/" + kind, {
    body: JSON.stringify({
      args: [args],
      format: "convex_encoded_json",
      path,
    }),
    headers: {
      "content-type": "application/json",
      "convex-client": "cloudcode-factory-mcp-1",
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

function optionalDispatchParams(args) {
  const notifyParent = boolArg(args, "notifyParent");
  return {
    ...(stringArg(args, "model") ? { model: stringArg(args, "model") } : {}),
    ...(notifyParent === undefined ? {} : { notifyParent }),
    ...(stringArg(args, "reasoningEffort") ? { reasoningEffort: stringArg(args, "reasoningEffort") } : {}),
    ...(stringArg(args, "speed") ? { speed: stringArg(args, "speed") } : {}),
  };
}

function runLine(run) {
  const parts = [run.runId, run.status];
  if (run.title) parts.push(run.title);
  if (run.branchName) parts.push("branch:" + run.branchName);
  if (run.prUrl) parts.push(run.prUrl);
  return parts.join(" | ");
}

function waitLine(wait) {
  const parts = [wait.waitId, wait.provider, wait.status, "events:" + wait.events.join(",")];
  if (wait.note) parts.push(wait.note);
  if (wait.channelId) parts.push("channel:" + wait.channelId + (wait.messageTs ? " ts:" + wait.messageTs : ""));
  if (wait.prNumber) parts.push("PR #" + wait.prNumber);
  if (wait.issueId) parts.push("issue:" + wait.issueId);
  if (wait.pendingEvents) parts.push(wait.pendingEvents + " queued event(s)");
  parts.push("expires:" + new Date(wait.expiresAt).toISOString());
  return parts.join(" | ");
}

function optionalWaitParams(args) {
  const ttlSeconds = numberArg(args, "ttlSeconds");
  const events = stringArrayArg(args, "events");
  return {
    ...(events ? { events } : {}),
    ...(stringArg(args, "note") ? { note: stringArg(args, "note") } : {}),
    ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
  };
}

async function callTool(name, args = {}) {
  switch (name) {
    case "run_dispatch": {
      const result = await convex("action", "factory:dispatchRun", {
        ...accessArgs(),
        ...optionalDispatchParams(args),
        ...(stringArg(args, "baseBranch") ? { baseBranch: stringArg(args, "baseBranch") } : {}),
        ...(stringArg(args, "branchMode") ? { branchMode: stringArg(args, "branchMode") } : {}),
        ...(stringArg(args, "branchName") ? { branchName: stringArg(args, "branchName") } : {}),
        ...(stringArg(args, "sandboxRetention") ? { sandboxRetention: stringArg(args, "sandboxRetention") } : {}),
        ...(stringArg(args, "title") ? { title: stringArg(args, "title") } : {}),
        prompt: requiredStringArg(args, "prompt"),
      });
      return text(
        "Dispatched run " + result.runId + " (thread " + result.threadId + "). It executes in parallel; when it finishes, a wake-up message is posted to this thread (unless notifyParent was false). You can also check run_status at any time.",
        result
      );
    }
    case "run_list": {
      const runs = await convex("query", "factory:listRuns", accessArgs());
      if (!runs.length) {
        return text("No runs have been dispatched from this tree yet.", { runs });
      }
      return text(runs.map(runLine).join("\n"), { runs });
    }
    case "run_status": {
      const result = await convex("query", "factory:getRunStatus", {
        ...accessArgs(),
        targetRunId: requiredStringArg(args, "runId"),
      });
      if (!result) throw new Error("Run not found in this dispatch tree.");
      return text(runLine(result), result);
    }
    case "run_output": {
      const result = await convex("query", "factory:getRunOutput", {
        ...accessArgs(),
        targetRunId: requiredStringArg(args, "runId"),
      });
      if (!result) throw new Error("Run not found in this dispatch tree.");
      const header = result.pending
        ? "Run is still " + result.status + "; partial output:"
        : "Run " + result.status + "; final message:";
      return text(header + "\n\n" + (result.output || "(no output yet)"), result);
    }
    case "sandbox_delete": {
      const result = await convex("action", "factory:deleteThreadSandbox", {
        ...accessArgs(),
        targetThreadId: requiredStringArg(args, "threadId"),
      });
      return text(
        result.queued
          ? "Queued deletion of sandbox " + result.sandboxId + "."
          : "That thread has no sandbox to delete.",
        result
      );
    }
    case "run_message": {
      const result = await convex("action", "factory:messageThread", {
        ...accessArgs(),
        ...optionalDispatchParams(args),
        prompt: requiredStringArg(args, "prompt"),
        targetThreadId: requiredStringArg(args, "threadId"),
      });
      return text(
        "Queued follow-up run " + result.runId + " on thread " + result.threadId + ".",
        result
      );
    }
    case "automation_create": {
      const result = await convex("mutation", "factory:createAutomation", {
        ...accessArgs(),
        ...optionalDispatchParams(args),
        cron: requiredStringArg(args, "cron"),
        ...(stringArg(args, "name") ? { name: stringArg(args, "name") } : {}),
        prompt: requiredStringArg(args, "prompt"),
        ...(stringArg(args, "sandboxRetention") ? { sandboxRetention: stringArg(args, "sandboxRetention") } : {}),
        ...(stringArg(args, "threadMode") ? { threadMode: stringArg(args, "threadMode") } : {}),
        ...(stringArg(args, "timezone") ? { timezone: stringArg(args, "timezone") } : {}),
      });
      return text(
        "Created automation " + result.automationId + " (" + result.cron + " " + result.timezone + "), next run at " + new Date(result.nextRunAt).toISOString() + ".",
        result
      );
    }
    case "automation_list": {
      const automations = await convex("query", "factory:listAutomations", accessArgs());
      if (!automations.length) {
        return text("No automations exist for this repository.", { automations });
      }
      return text(
        automations
          .map((automation) =>
            [
              automation.automationId,
              automation.enabled ? "enabled" : "disabled",
              automation.cron + " " + automation.timezone,
              automation.name,
              automation.agentCreated ? "(agent-created)" : "(user-created)",
            ].join(" | ")
          )
          .join("\n"),
        { automations }
      );
    }
    case "automation_set_enabled": {
      const enabled = boolArg(args, "enabled");
      if (enabled === undefined) throw new Error("enabled is required.");
      const result = await convex("mutation", "factory:setAutomationEnabled", {
        ...accessArgs(),
        automationId: requiredStringArg(args, "automationId"),
        enabled,
      });
      return text(result.enabled ? "Automation enabled." : "Automation disabled.", result);
    }
    case "ask_human": {
      const result = await convex("action", "factoryWaits:askHuman", {
        ...accessArgs(),
        ...optionalWaitParams(args),
        ...(stringArg(args, "channelId") ? { channelId: stringArg(args, "channelId") } : {}),
        message: requiredStringArg(args, "message"),
        ...(stringArg(args, "threadTs") ? { threadTs: stringArg(args, "threadTs") } : {}),
      });
      return text(
        "Question queued for posting to Slack channel " + result.channelId + " (wait " + result.waitId + ", expires " + new Date(result.expiresAt).toISOString() + "). Finish your turn with a status note - a wake-up run resumes this thread on a reply, reaction, or timeout.",
        result
      );
    }
    case "wait_create": {
      const prNumber = numberArg(args, "prNumber");
      const result = await convex("mutation", "factoryWaits:createWait", {
        ...accessArgs(),
        ...optionalWaitParams(args),
        ...(stringArg(args, "channelId") ? { channelId: stringArg(args, "channelId") } : {}),
        ...(stringArg(args, "issueId") ? { issueId: stringArg(args, "issueId") } : {}),
        kind: requiredStringArg(args, "kind"),
        ...(stringArg(args, "messageTs") ? { messageTs: stringArg(args, "messageTs") } : {}),
        ...(prNumber === undefined ? {} : { prNumber }),
        ...(stringArg(args, "prUrl") ? { prUrl: stringArg(args, "prUrl") } : {}),
        ...(stringArg(args, "threadTs") ? { threadTs: stringArg(args, "threadTs") } : {}),
      });
      return text(
        "Wait " + result.waitId + " armed for events [" + result.events.join(", ") + "], expires " + new Date(result.expiresAt).toISOString() + ". Finish your turn with a status note - a wake-up run resumes this thread when a matching event or the timeout arrives.",
        result
      );
    }
    case "wait_list": {
      const waits = await convex("query", "factoryWaits:listWaits", accessArgs());
      if (!waits.length) return text("No active waits on this thread.", { waits });
      return text(waits.map(waitLine).join("\n"), { waits });
    }
    case "wait_cancel": {
      const result = await convex("mutation", "factoryWaits:cancelWait", {
        ...accessArgs(),
        waitId: requiredStringArg(args, "waitId"),
      });
      return text(result.canceled ? "Wait canceled." : "Wait was already " + result.status + ".", result);
    }
    default:
      throw new Error("Unknown Cloudcode factory tool: " + name);
  }
}

const tools = [
  {
    name: "run_dispatch",
    description: "Dispatch a new autonomous Cloudcode agent run in a fresh thread on the same repository. Returns the child runId/threadId immediately; the child runs in parallel and shares nothing with you, so the prompt must contain every instruction and piece of context it needs. Poll run_status to follow it.",
    inputSchema: {
      type: "object",
      required: ["prompt"],
      properties: {
        prompt: { type: "string", description: "Complete, self-sufficient instructions for the child agent." },
        title: { type: "string", description: "Short thread title. Defaults to the first line of the prompt." },
        notifyParent: { type: "boolean", description: "Default true: when the child finishes, a wake-up run summarizing it is queued on this thread. Set false to fire-and-forget." },
        model: { type: "string", description: "Child model. Defaults to this run's model." },
        reasoningEffort: { type: "string", enum: ["none", "low", "medium", "high", "xhigh", "max", "ultra"], description: "Child reasoning effort. Availability depends on the selected model; defaults to this run's closest supported effort." },
        speed: { type: "string", enum: ["standard", "fast"], description: "Child speed. Defaults to this run's speed." },
        branchMode: { type: "string", enum: ["auto", "base", "custom"], description: "auto creates a new work branch (default); base commits on the base branch; custom uses branchName." },
        branchName: { type: "string", description: "Branch for branchMode custom, e.g. to stack on another run's branch." },
        baseBranch: { type: "string", description: "Base branch to start from. Defaults to this run's base branch." },
        sandboxRetention: { type: "string", enum: ["delete", "idle"], description: "idle (default) keeps the child's sandbox for fast run_message follow-ups until you remove it with sandbox_delete; delete removes it automatically when the run ends." },
      },
    },
  },
  {
    name: "sandbox_delete",
    description: "Delete the retained sandbox of a thread dispatched in this tree, once its work is accepted (e.g. PR merged or review passed). The thread and its conversation survive; a later run_message simply starts a fresh sandbox.",
    inputSchema: {
      type: "object",
      required: ["threadId"],
      properties: {
        threadId: { type: "string", description: "The threadId returned by run_dispatch or run_list. The thread must have no active run." },
      },
    },
  },
  {
    name: "run_list",
    description: "List all runs dispatched in this run's tree with their status, branch, and pull request URL.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "run_status",
    description: "Status of one dispatched run: queued/running/succeeded/failed/canceled, branch, PR URL, and error if any.",
    inputSchema: {
      type: "object",
      required: ["runId"],
      properties: {
        runId: { type: "string", description: "The runId returned by run_dispatch or run_list." },
      },
    },
  },
  {
    name: "run_output",
    description: "The final message of a finished dispatched run (or the freshest partial output of a live one).",
    inputSchema: {
      type: "object",
      required: ["runId"],
      properties: {
        runId: { type: "string", description: "The runId returned by run_dispatch or run_list." },
      },
    },
  },
  {
    name: "run_message",
    description: "Send a follow-up prompt to a thread that was dispatched in this tree (e.g. to request rework after a review). Resumes that agent's conversation and sandbox when possible. Fails while a run is still active on the thread.",
    inputSchema: {
      type: "object",
      required: ["threadId", "prompt"],
      properties: {
        threadId: { type: "string", description: "The threadId returned by run_dispatch or run_list." },
        prompt: { type: "string", description: "The follow-up request. Include the concrete findings or instructions to address." },
        notifyParent: { type: "boolean", description: "Default true: when the follow-up finishes, a wake-up run is queued on this thread." },
        model: { type: "string", description: "Defaults to the thread's previous run." },
        reasoningEffort: { type: "string", enum: ["none", "low", "medium", "high", "xhigh", "max", "ultra"], description: "Availability depends on the selected model; defaults to the thread's previous run's closest supported effort." },
        speed: { type: "string", enum: ["standard", "fast"], description: "Defaults to the thread's previous run." },
      },
    },
  },
  {
    name: "automation_create",
    description: "Create a recurring scheduled agent run (cron) on this repository, e.g. a heartbeat that wakes up every N minutes and checks on work. It appears in the user's Automations screen and can be disabled there at any time.",
    inputSchema: {
      type: "object",
      required: ["cron", "prompt"],
      properties: {
        cron: { type: "string", description: "5-field cron expression (minute hour day-of-month month day-of-week)." },
        prompt: { type: "string", description: "Complete instructions the scheduled agent executes on every tick." },
        name: { type: "string", description: "Display name. Defaults to the first line of the prompt." },
        timezone: { type: "string", description: "IANA time zone for the cron schedule. Defaults to UTC." },
        model: { type: "string", description: "Defaults to this run's model." },
        reasoningEffort: { type: "string", enum: ["none", "low", "medium", "high", "xhigh", "max", "ultra"], description: "Availability depends on the selected model; defaults to this run's closest supported effort." },
        speed: { type: "string", enum: ["standard", "fast"], description: "Defaults to this run's speed." },
        threadMode: { type: "string", enum: ["single", "per-run"], description: "single (default) reuses one chat thread across ticks; per-run opens a fresh thread per tick." },
        sandboxRetention: { type: "string", enum: ["delete", "idle"], description: "delete (default) removes the sandbox after each tick; idle keeps it for fast resumption." },
      },
    },
  },
  {
    name: "automation_list",
    description: "List the automations that exist for this repository, including whether each was created by an agent or by the user.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "automation_set_enabled",
    description: "Enable or disable an automation previously created by an agent run. User-created automations cannot be changed with this tool.",
    inputSchema: {
      type: "object",
      required: ["automationId", "enabled"],
      properties: {
        automationId: { type: "string", description: "The automationId from automation_create or automation_list." },
        enabled: { type: "boolean" },
      },
    },
  },
  {
    name: "ask_human",
    description: "Ask a human a question in Slack and durably wait for the answer: posts the message and registers a wait in one call. A wake-up run resumes this thread when someone replies in the message's thread or reacts to it (or when the wait times out) - even days later, after this run has finished and its sandbox is paused. Register, then finish your turn with a status note; never poll.",
    inputSchema: {
      type: "object",
      required: ["message"],
      properties: {
        message: { type: "string", description: "The question to post (markdown)." },
        channelId: { type: "string", description: "Slack channel ID (like C0123456789). Defaults to this session's originating Slack conversation when it started from Slack; otherwise required." },
        threadTs: { type: "string", description: "Post inside an existing Slack thread instead of top-level." },
        events: { type: "array", items: { type: "string", enum: ["reply", "reaction"] }, description: "Which events wake you. Default: both." },
        ttlSeconds: { type: "number", description: "Wait lifetime in seconds. Default ${WAIT_DEFAULT_TTL_DAYS} days, max ${WAIT_MAX_TTL_DAYS} days; on timeout you are woken with a timeout notice." },
        note: { type: "string", description: "Short label echoed in the wake-up message so you can tell waits apart." },
      },
    },
  },
  {
    name: "wait_create",
    description: "Register a durable wait on something that already exists: a Slack message or thread, a pull request on this repository (for example one you just created), or a Linear issue. A wake-up run resumes this thread with the event content when a matching event or the timeout arrives - even long after this run finished. Waits are single-shot: one wake-up consumes them; re-register from the wake-up run to keep listening. Register, then finish your turn; never poll.",
    inputSchema: {
      type: "object",
      required: ["kind"],
      properties: {
        kind: { type: "string", enum: ["slack_thread", "github_pr", "linear_issue"] },
        events: { type: "array", items: { type: "string" }, description: "Event filter. slack_thread: reply, reaction. github_pr: comment, review, merged, closed, reopened, checks. linear_issue: comment. Default: every event of the kind." },
        channelId: { type: "string", description: "slack_thread: channel ID of the watched message." },
        messageTs: { type: "string", description: "slack_thread: ts of the watched message (reactions match on it)." },
        threadTs: { type: "string", description: "slack_thread: thread root ts when the watched message sits inside a thread (replies match on it)." },
        prNumber: { type: "number", description: "github_pr: pull request number on this repository." },
        prUrl: { type: "string", description: "github_pr: pull request URL, as an alternative to prNumber." },
        issueId: { type: "string", description: "linear_issue: the Linear issue ID (UUID)." },
        ttlSeconds: { type: "number", description: "Wait lifetime in seconds. Default ${WAIT_DEFAULT_TTL_DAYS} days, max ${WAIT_MAX_TTL_DAYS} days; on timeout you are woken with a timeout notice." },
        note: { type: "string", description: "Short label echoed in the wake-up message so you can tell waits apart." },
      },
    },
  },
  {
    name: "wait_list",
    description: "List this thread's active waits with their targets, event filters, queued events, and expiry.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "wait_cancel",
    description: "Cancel an active wait registered on this thread. Events it already queued are dropped.",
    inputSchema: {
      type: "object",
      required: ["waitId"],
      properties: {
        waitId: { type: "string", description: "The waitId from ask_human, wait_create, or wait_list." },
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
          serverInfo: { name: "cloudcode-factory", version: "1.0.0" },
          instructions: "Use these tools to dispatch parallel Cloudcode agent runs on this repository, follow their progress, send follow-up work to them, schedule recurring agent runs, and register durable waits on external events (Slack replies/reactions via ask_human, PR activity and Linear comments via wait_create) that wake this thread when they fire. Read the cloudcode-factory skill before the first call - its argument contracts are exact. Dispatched runs bill usage like normal runs and are capped server-side.",
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

export function cloudcodeFactoryAgentInstructions() {
  return [
    "# Cloudcode Factory",
    "",
    "Cloudcode can dispatch autonomous child agent runs on this repository, schedule recurring runs, and register durable waits on humans and external events through the `cloudcode_factory` MCP tools (`run_dispatch`, `run_list`, `run_status`, `run_output`, `run_message`, `sandbox_delete`, `automation_create`, `automation_list`, `automation_set_enabled`, `ask_human`, `wait_create`, `wait_list`, `wait_cancel`).",
    "Before calling any of them, read the `cloudcode-factory` skill and follow its argument contracts exactly — several arguments have strict server-validated formats (Slack channel IDs, per-kind event names, TTLs in seconds, threadId vs runId) that fail otherwise.",
    "",
    "Rules that always apply:",
    "- Dispatches and waits are durable: register, finish your turn with a brief status note, and a wake-up run resumes this thread when the result or event arrives — even days later. Never poll or busy-wait (no run_status/wait_list loops).",
    '- When the user says "factory subagents", "factory agents", or asks to dispatch runs/threads, use `run_dispatch`. Plain "subagents" or "parallel agents" without "factory" means your built-in Codex collaborator subagents inside this run — not `run_dispatch`. If ambiguous, prefer built-in subagents and mention that factory dispatch is available for long-running parallel work.',
    "- Dispatched runs and automations consume the user's usage like normal runs and are capped server-side. Dispatch deliberately, with complete self-sufficient prompts, at the cheapest model/effort that fits.",
  ].join("\n")
}

export function cloudcodeFactoryAgentContext() {
  return [
    "Cloudcode provides the `cloudcode_factory` MCP tools to dispatch parallel child agent runs on this repository (`run_dispatch`), follow them (`run_list`, `run_status`, `run_output`), send follow-up work to them (`run_message`), schedule recurring agent runs (`automation_create`), and register durable waits on external events (`ask_human` for Slack questions, `wait_create` for PR or Linear activity). Read the `cloudcode-factory` skill before calling any of them — its argument contracts are exact.",
    "Dispatch prompts must be self-sufficient — children share none of your context. Dispatched work bills usage and is capped server-side, so dispatch deliberately.",
    "When a dispatched run finishes — or an event you registered a wait for arrives or times out — you are woken with a summary message on this thread. Dispatch or register the wait, end your turn with a status note, and continue when woken instead of polling.",
    'Reserve these tools for requests that say "factory" subagents/agents or ask for dispatched runs; a request for plain "subagents" means your built-in Codex collaborator subagents inside this run, not run_dispatch.',
  ].join("\n")
}

export function cloudcodeFactoryCodexConfig({
  accessToken,
  convexUrl,
  paths,
  runId,
  threadId,
}: FactoryConfigInput) {
  if (!convexUrl || !accessToken || !runId || !threadId) return ""

  return [
    "[mcp_servers.cloudcode_factory]",
    `command = ${JSON.stringify(`${paths.codexHome}/factory/cloudcode-factory-mcp.mjs`)}`,
    "startup_timeout_sec = 20",
    "tool_timeout_sec = 120",
    'default_tools_approval_mode = "auto"',
    "",
    "[mcp_servers.cloudcode_factory.env]",
    `CLOUDCODE_FACTORY_STATE_PATH = ${JSON.stringify(cloudcodeFactoryStatePath(paths))}`,
    "",
  ].join("\n")
}

export async function writeCloudcodeFactoryState(
  sandbox: Sandbox,
  paths: Pick<DaytonaSandboxPaths, "codexHome">,
  input: Pick<
    FactoryConfigInput,
    "accessToken" | "convexUrl" | "runId" | "threadId"
  >
) {
  if (
    !input.convexUrl ||
    !input.accessToken ||
    !input.runId ||
    !input.threadId
  ) {
    return
  }

  await writeDaytonaTextFile(
    sandbox,
    cloudcodeFactoryStatePath(paths),
    JSON.stringify({
      accessToken: input.accessToken,
      convexUrl: input.convexUrl,
      runId: input.runId,
      threadId: input.threadId,
    })
  )
}

export async function installCloudcodeFactoryTools(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  signal?: AbortSignal
) {
  const script = factoryMcpServerScript()
  const scriptPath = `${paths.codexHome}/factory/cloudcode-factory-mcp.mjs`
  const binPath = `${paths.home}/.local/bin/cloudcode-factory`
  const markerPath = `${paths.codexHome}/factory/tool-version`
  const fingerprint = cloudcodeFactoryToolFingerprint(paths)

  const result = await runDaytonaCommand(
    sandbox,
    [
      "set -e",
      `fingerprint=${shellQuote(fingerprint)}`,
      `if [ -x ${shellQuote(scriptPath)} ] && [ -L ${shellQuote(binPath)} ] && grep -qxF -- "$fingerprint" ${shellQuote(markerPath)} 2>/dev/null; then exit 0; fi`,
      `mkdir -p ${shellQuote(`${paths.codexHome}/factory`)} ${shellQuote(`${paths.home}/.local/bin`)}`,
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
        "Unable to install Cloudcode factory tools."
    )
  }
}
