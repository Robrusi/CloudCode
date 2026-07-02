export const PLAYWRIGHT_TEST_VERSION = "1.61.0"

/**
 * Self-contained script fragments shared by the generated in-sandbox MCP
 * servers (`cloudcode-desktop-mcp.mjs` and `cloudcode-ui-tests-mcp.mjs`).
 *
 * Both servers are emitted as standalone ESM files, so shared behavior must be
 * spliced in as source. Every fragment uses namespaced `__cc*` imports and
 * helper names to avoid colliding with identifiers in the host script.
 */

/**
 * Resolves (and installs on demand) the pinned `@playwright/test` runtime that
 * powers both the deterministic UI test runner and the desktop browser tools.
 * Defines:
 * - `resolveCloudcodePlaywrightRuntime({ repoPath, runtimeRoot })`
 * - `requireCloudcodePlaywrightCore(runtime)`
 */
export function playwrightRuntimeScriptFragment() {
  return String.raw`// Shared Cloudcode Playwright runtime resolution (generated fragment).
import { execFile as __ccPwExecFile } from "node:child_process";
import {
  existsSync as __ccPwExistsSync,
  mkdirSync as __ccPwMkdirSync,
  readFileSync as __ccPwReadFileSync,
  writeFileSync as __ccPwWriteFileSync,
} from "node:fs";
import { createRequire as __ccPwCreateRequire } from "node:module";
import { join as __ccPwJoin } from "node:path";

const CLOUDCODE_PLAYWRIGHT_VERSION = ${JSON.stringify(PLAYWRIGHT_TEST_VERSION)};

function __ccPwJsonFile(path, fallback) {
  try {
    return JSON.parse(__ccPwReadFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function __ccPwExec(command, args, options = {}) {
  return new Promise((resolve) => {
    __ccPwExecFile(
      command,
      args,
      {
        encoding: "utf8",
        env: { ...process.env, ...(options.env ?? {}) },
        maxBuffer: 20 * 1024 * 1024,
        timeout: options.timeout ?? 30_000,
      },
      (error, stdout, stderr) => {
        resolve({
          exitCode: typeof error?.code === "number" ? error.code : error ? 1 : 0,
          stderr: stderr || "",
          stdout: stdout || "",
        });
      }
    );
  });
}

function installedCloudcodePlaywrightRuntime(root) {
  const packageJsonPath = __ccPwJoin(
    root,
    "node_modules",
    "@playwright",
    "test",
    "package.json"
  );
  const cliPath = __ccPwJoin(root, "node_modules", "@playwright", "test", "cli.js");
  const installed = __ccPwJsonFile(packageJsonPath, null);
  if (typeof installed?.version !== "string" || !__ccPwExistsSync(cliPath)) {
    return undefined;
  }
  return {
    cliPath,
    nodePath: __ccPwJoin(root, "node_modules"),
    packageJsonPath,
    root,
    version: installed.version,
  };
}

async function resolveCloudcodePlaywrightRuntime({ repoPath, runtimeRoot }) {
  const repoRuntime = installedCloudcodePlaywrightRuntime(repoPath);
  if (repoRuntime) return repoRuntime;

  const preparedRuntime = installedCloudcodePlaywrightRuntime(runtimeRoot);
  if (preparedRuntime?.version === CLOUDCODE_PLAYWRIGHT_VERSION) {
    return preparedRuntime;
  }

  __ccPwMkdirSync(runtimeRoot, { recursive: true });
  const npmCheck = await __ccPwExec("npm", ["--version"], { timeout: 10_000 });
  if (npmCheck.exitCode !== 0) {
    throw new Error("npm is required to prepare the Cloudcode Playwright runtime.");
  }
  __ccPwWriteFileSync(
    __ccPwJoin(runtimeRoot, "package.json"),
    JSON.stringify(
      {
        private: true,
        dependencies: { "@playwright/test": CLOUDCODE_PLAYWRIGHT_VERSION },
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  const result = await __ccPwExec(
    "npm",
    [
      "install",
      "--prefix",
      runtimeRoot,
      "--no-audit",
      "--no-fund",
      "@playwright/test@" + CLOUDCODE_PLAYWRIGHT_VERSION,
    ],
    {
      env: { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
      timeout: 180_000,
    }
  );
  const runtime = installedCloudcodePlaywrightRuntime(runtimeRoot);
  if (result.exitCode !== 0 || !runtime) {
    const detail =
      result.stderr.trim() ||
      result.stdout.trim() ||
      "Unable to install @playwright/test.";
    throw new Error(detail.length > 2000 ? detail.slice(0, 1997) + "..." : detail);
  }
  return runtime;
}

function requireCloudcodePlaywrightCore(runtime) {
  return __ccPwCreateRequire(runtime.packageJsonPath)("playwright-core");
}
`
}

/**
 * Daytona toolbox recording client shared by both servers. Defines:
 * - `cloudcodeDaytonaRecordingRequest(path, body)`
 */
export function daytonaRecordingClientScriptFragment() {
  return String.raw`// Shared Daytona toolbox recording client (generated fragment).
function __ccDaytonaToolboxBaseUrl() {
  const rawBaseUrl = process.env.CLOUDCODE_DAYTONA_TOOLBOX_BASE_URL;
  const sandboxId = process.env.CLOUDCODE_DAYTONA_SANDBOX_ID;
  const authKey = process.env.CLOUDCODE_DAYTONA_TOOLBOX_AUTH_KEY;
  if (!rawBaseUrl || !sandboxId || !authKey) {
    throw new Error(
      "Daytona recording is unavailable because toolbox context is missing."
    );
  }
  const baseUrl = rawBaseUrl.endsWith("/") ? rawBaseUrl.slice(0, -1) : rawBaseUrl;
  const sandboxBaseUrl = baseUrl.endsWith("/" + sandboxId)
    ? baseUrl
    : baseUrl + "/" + sandboxId;
  return (
    sandboxBaseUrl + "?DAYTONA_SANDBOX_AUTH_KEY=" + encodeURIComponent(authKey)
  );
}

async function cloudcodeDaytonaRecordingRequest(path, body) {
  const baseUrl = __ccDaytonaToolboxBaseUrl();
  const separator = path.includes("?") ? "&" : "?";
  const [proxyBaseUrl, authQuery] = baseUrl.split("?");
  const response = await fetch(proxyBaseUrl + path + separator + authQuery, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const textBody = await response.text();
  let data = {};
  if (textBody) {
    try {
      data = JSON.parse(textBody);
    } catch {
      data = { message: textBody };
    }
  }
  if (!response.ok) {
    const message =
      data?.message || data?.error || textBody || "Daytona recording request failed.";
    throw new Error(message);
  }
  return data;
}
`
}
