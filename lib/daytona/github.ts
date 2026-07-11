import { createHash } from "node:crypto"

import type { Sandbox } from "@daytona/sdk"

import {
  runDaytonaCommand,
  shellQuote,
  writeDaytonaTextFile,
  type DaytonaSandboxPaths,
} from "@/lib/daytona/sandbox"

const GITHUB_TOOL_VERSION = "3"

type GitHubConfigInput = {
  enabled: boolean
  paths: Pick<DaytonaSandboxPaths, "codexHome">
}

type GitHubStateInput = {
  baseBranch?: string
  repoUrl: string
  tokenPath?: string
}

function base64FileCommand(path: string, content: string) {
  const encoded = Buffer.from(content, "utf8").toString("base64")
  return `printf '%s' ${shellQuote(encoded)} | base64 -d > ${shellQuote(path)}`
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

export function cloudcodeGitHubToolVersion() {
  return GITHUB_TOOL_VERSION
}

export function cloudcodeGitHubStatePath(
  paths: Pick<DaytonaSandboxPaths, "codexHome">
) {
  return `${paths.codexHome}/github/current-run.json`
}

export function cloudcodeGitHubToolFingerprint(
  paths: Pick<DaytonaSandboxPaths, "codexHome">
) {
  return sha256(
    [
      GITHUB_TOOL_VERSION,
      githubMcpServerScript(),
      `${paths.codexHome}/github/cloudcode-github-mcp.mjs`,
      cloudcodeGitHubStatePath(paths),
    ].join("\0")
  )
}

function githubMcpServerScript() {
  return String.raw`#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const statePath = process.env.CLOUDCODE_GITHUB_STATE_PATH || "";
const missingGitHubTokenMessage = "Cloudcode GitHub tools need the GitHub App installed on this repository and your GitHub user authorized before they can access pull requests.";

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
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function optionalString(value) {
  const clean = stringValue(value);
  return clean || undefined;
}

function boolValue(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseGitHubRepoUrl(repoUrl) {
  const ssh = String(repoUrl || "").trim().match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  try {
    const url = new URL(repoUrl);
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;
    const match = url.pathname.replace(/\/+$/, "").match(/^\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
    return match ? { owner: match[1], repo: match[2] } : null;
  } catch {
    return null;
  }
}

function readState() {
  if (!statePath) throw new Error("Cloudcode GitHub is not configured for this run.");
  let state;
  try {
    state = readJson(statePath);
  } catch {
    throw new Error("Cloudcode GitHub is not configured for this run.");
  }
  const repoUrl = stringValue(state.repoUrl);
  const repoPath = stringValue(state.repoPath);
  const tokenPath = optionalString(state.tokenPath);
  const repo = parseGitHubRepoUrl(repoUrl);
  if (!repoUrl || !repoPath || !repo) {
    throw new Error("Cloudcode GitHub state is incomplete.");
  }
  return {
    baseBranch: optionalString(state.baseBranch),
    repo,
    repoPath,
    repoUrl,
    tokenPath,
  };
}

function readToken(tokenPath) {
  if (!tokenPath) throw new Error(missingGitHubTokenMessage);
  const token = readFileSync(tokenPath, "utf8").trim();
  if (!token) throw new Error("Cloudcode GitHub token is unavailable.");
  return token;
}

function currentBranch(repoPath) {
  const branch = execFileSync("git", ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (!branch || branch === "HEAD") {
    throw new Error("Cannot create a pull request from a detached HEAD.");
  }
  return branch;
}

function repoApiUrl(repo, path = "") {
  return "https://api.github.com/repos/" + encodeURIComponent(repo.owner) + "/" + encodeURIComponent(repo.repo) + path;
}

async function githubRequest(state, path, init = {}) {
  const response = await fetch(repoApiUrl(state.repo, path), {
    ...init,
    cache: "no-store",
    headers: {
      accept: "application/vnd.github+json",
      authorization: "Bearer " + readToken(state.tokenPath),
      "x-github-api-version": "2022-11-28",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : {};
  if (!response.ok) {
    const message = typeof data.message === "string" ? data.message : "GitHub request failed with status " + response.status + ".";
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function normalizePullRequest(data) {
  const number = typeof data.number === "number" ? data.number : undefined;
  const htmlUrl = optionalString(data.html_url);
  const headRef = optionalString(data.head && data.head.ref);
  const headSha = optionalString(data.head && data.head.sha);
  const baseRef = optionalString(data.base && data.base.ref);
  if (!number || !htmlUrl || !headRef || !headSha || !baseRef) return null;
  return {
    baseRef,
    draft: data.draft === true,
    headRef,
    headSha,
    htmlUrl,
    mergeable: typeof data.mergeable === "boolean" ? data.mergeable : null,
    mergeableState: optionalString(data.mergeable_state) || null,
    merged: data.merged === true || typeof data.merged_at === "string",
    number,
    state: data.state === "closed" ? "closed" : "open",
    title: optionalString(data.title) || "#" + number,
  };
}

async function defaultBaseBranch(state) {
  if (state.baseBranch) return state.baseBranch;
  const metadata = await githubRequest(state, "");
  const branch = optionalString(metadata.default_branch);
  if (!branch) throw new Error("Unable to determine the repository default branch.");
  return branch;
}

async function listPullRequestsForBranch(state, branch, prState = "all") {
  const query = new URLSearchParams({
    head: state.repo.owner + ":" + branch,
    per_page: "30",
    state: prState,
  });
  const data = await githubRequest(state, "/pulls?" + query.toString());
  return Array.isArray(data) ? data.map(normalizePullRequest).filter(Boolean) : [];
}

async function createPullRequest(args = {}) {
  const state = readState();
  const title = stringValue(args.title);
  if (!title) throw new Error("A pull request title is required.");
  const head = optionalString(args.head) || currentBranch(state.repoPath);
  const base = optionalString(args.base) || await defaultBaseBranch(state);
  if (head === base) {
    throw new Error("Pull request head and base branches must be different.");
  }

  try {
    const data = await githubRequest(state, "/pulls", {
      body: JSON.stringify({
        base,
        body: optionalString(args.body) || undefined,
        draft: boolValue(args.draft) || undefined,
        head,
        title,
      }),
      method: "POST",
    });
    const pr = normalizePullRequest(data);
    if (!pr) throw new Error("GitHub returned an invalid pull request response.");
    return text("Created pull request #" + pr.number + ": " + pr.htmlUrl, { pr });
  } catch (error) {
    if (error && error.status === 422) {
      const existing = (await listPullRequestsForBranch(state, head, "open")).find((pr) => pr.baseRef === base);
      if (existing) {
        return text("Pull request already exists #" + existing.number + ": " + existing.htmlUrl, { pr: existing });
      }
      throw new Error("GitHub could not create the pull request. Make sure the branch has been pushed with git push and the base branch is correct. " + error.message);
    }
    if (error && (error.status === 401 || error.status === 403)) {
      throw new Error("GitHub authorization failed for the Cloudcode GitHub App token. The token may have expired or the app may not have permission for this repository. " + error.message);
    }
    throw error;
  }
}

async function listPullRequests(args = {}) {
  const state = readState();
  const branch = optionalString(args.branch) || currentBranch(state.repoPath);
  const prState = ["open", "closed", "all"].includes(args.state) ? args.state : "all";
  const prs = await listPullRequestsForBranch(state, branch, prState);
  if (!prs.length) return text("No pull requests found for " + branch + ".", { branch, prs });
  return text(
    prs.map((pr) => "#" + pr.number + " " + pr.state + " " + pr.title + " " + pr.htmlUrl).join("\n"),
    { branch, prs }
  );
}

const tools = [
  {
    name: "pull_request_create",
    description: "Create a GitHub pull request for the current Cloudcode repository using the Cloudcode GitHub App bot. Push the branch with git before calling this tool.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: {
        base: { type: "string", description: "Base branch. Defaults to the selected base branch or repository default branch." },
        body: { type: "string", description: "Pull request body." },
        draft: { type: "boolean", description: "Create the pull request as a draft." },
        head: { type: "string", description: "Head branch. Defaults to the current local branch." },
        title: { type: "string", description: "Pull request title." },
      },
    },
  },
  {
    name: "pull_request_list",
    description: "List GitHub pull requests for the current branch in the Cloudcode repository.",
    inputSchema: {
      type: "object",
      properties: {
        branch: { type: "string", description: "Branch to search. Defaults to the current local branch." },
        state: { type: "string", enum: ["open", "closed", "all"], description: "Pull request state. Defaults to all." },
      },
    },
  },
];

async function callTool(name, args = {}) {
  switch (name) {
    case "pull_request_create":
      return await createPullRequest(args);
    case "pull_request_list":
      return await listPullRequests(args);
    default:
      throw new Error("Unknown Cloudcode GitHub tool: " + name);
  }
}

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
          serverInfo: { name: "cloudcode-github", version: "1.0.0" },
          instructions: "Use this MCP server for every GitHub operation in the current Cloudcode repository. Ordinary git commands remain available for local repository work and authenticated fetch/push. Never use the gh CLI, call the GitHub API directly, or use another GitHub integration.",
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

export function cloudcodeGitHubAgentInstructions({
  authenticated,
}: {
  authenticated: boolean
}) {
  return [
    "# Cloudcode GitHub",
    "",
    authenticated
      ? "Cloudcode provides GitHub pull request tools through the `cloudcode_github` MCP server for this repository."
      : "Cloudcode exposes the `cloudcode_github` MCP server for this repository, but pull request tool calls need the GitHub App installed on this repository and your GitHub user authorized.",
    "",
    "Use ordinary `git` commands for repository writes:",
    "- `git status`",
    "- `git add`",
    "- `git commit`",
    "- `git push`",
    "",
    authenticated
      ? "After pushing a branch, use `cloudcode_github.pull_request_create` to open a pull request as the Cloudcode GitHub App bot."
      : "If the user asks for a pull request, explain that GitHub must be connected for this repository before `cloudcode_github.pull_request_create` can succeed.",
    "Use the `cloudcode_github` MCP server for every GitHub operation other than ordinary `git` repository work and authenticated fetch/push.",
    "Never use the `gh` CLI, call the GitHub REST or GraphQL API directly (including through `curl`, `fetch`, or scripts), or use another GitHub MCP server or integration.",
    "If `cloudcode_github` does not support a requested GitHub operation, do not fall back to another interface; explain the limitation to the user.",
  ].join("\n")
}

export function cloudcodeGitHubAgentContext({
  authenticated,
}: {
  authenticated: boolean
}) {
  return [
    authenticated
      ? "Cloudcode provides GitHub pull request tools through the `cloudcode_github` MCP server for this repository."
      : "Cloudcode exposes the `cloudcode_github` MCP server for this repository, but pull request tool calls need the GitHub App installed on this repository and your GitHub user authorized.",
    authenticated
      ? "Use git for commit and push, then use `cloudcode_github.pull_request_create` to create pull requests as the Cloudcode GitHub App bot."
      : "If the user asks for a pull request, explain that GitHub must be connected for this repository before `cloudcode_github.pull_request_create` can succeed.",
    "Use the `cloudcode_github` MCP server for every GitHub operation other than ordinary git repository work and authenticated fetch/push.",
    "Never use the `gh` CLI, call the GitHub REST or GraphQL API directly, or use another GitHub MCP server or integration.",
    "If the Cloudcode MCP does not support an operation, do not fall back to another GitHub interface.",
  ].join("\n")
}

export function cloudcodeGitHubCodexConfig({
  enabled,
  paths,
}: GitHubConfigInput) {
  if (!enabled) return ""

  return [
    "[mcp_servers.cloudcode_github]",
    "enabled = true",
    "required = true",
    `command = ${JSON.stringify(`${paths.codexHome}/github/cloudcode-github-mcp.mjs`)}`,
    "startup_timeout_sec = 20",
    "tool_timeout_sec = 60",
    'enabled_tools = ["pull_request_create", "pull_request_list"]',
    'default_tools_approval_mode = "prompt"',
    "",
    "[mcp_servers.cloudcode_github.env]",
    `CLOUDCODE_GITHUB_STATE_PATH = ${JSON.stringify(cloudcodeGitHubStatePath(paths))}`,
    "",
    "[mcp_servers.cloudcode_github.tools.pull_request_create]",
    'approval_mode = "auto"',
    "",
    "[mcp_servers.cloudcode_github.tools.pull_request_list]",
    'approval_mode = "auto"',
    "",
  ].join("\n")
}

export async function writeCloudcodeGitHubState(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  input: GitHubStateInput
) {
  await writeDaytonaTextFile(
    sandbox,
    cloudcodeGitHubStatePath(paths),
    JSON.stringify({
      baseBranch: input.baseBranch,
      repoPath: paths.repoPath,
      repoUrl: input.repoUrl,
      tokenPath: input.tokenPath,
    })
  )
}

export async function installCloudcodeGitHubTools(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  signal?: AbortSignal
) {
  const script = githubMcpServerScript()
  const scriptPath = `${paths.codexHome}/github/cloudcode-github-mcp.mjs`
  const binPath = `${paths.home}/.local/bin/cloudcode-github`
  const markerPath = `${paths.codexHome}/github/tool-version`
  const fingerprint = cloudcodeGitHubToolFingerprint(paths)

  const result = await runDaytonaCommand(
    sandbox,
    [
      "set -e",
      `fingerprint=${shellQuote(fingerprint)}`,
      `if [ -x ${shellQuote(scriptPath)} ] && grep -qxF -- "$fingerprint" ${shellQuote(markerPath)} 2>/dev/null; then exit 0; fi`,
      `mkdir -p ${shellQuote(`${paths.codexHome}/github`)}`,
      base64FileCommand(scriptPath, script),
      `chmod +x ${shellQuote(scriptPath)}`,
      `if [ -L ${shellQuote(binPath)} ] && [ "$(readlink ${shellQuote(binPath)})" = ${shellQuote(scriptPath)} ]; then rm -f ${shellQuote(binPath)}; fi`,
      `printf '%s\\n' "$fingerprint" > ${shellQuote(markerPath)}`,
    ].join("\n"),
    { signal, timeoutMs: 10_000 }
  )

  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        "Unable to install Cloudcode GitHub tools."
    )
  }
}
