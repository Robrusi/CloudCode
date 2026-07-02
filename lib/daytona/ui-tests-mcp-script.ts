import { DESKTOP_BROWSER_COMMAND } from "@/lib/daytona/desktop-dependencies"
import {
  daytonaRecordingClientScriptFragment,
  playwrightRuntimeScriptFragment,
  PLAYWRIGHT_TEST_VERSION,
} from "@/lib/daytona/mcp-script-shared"
import type { DaytonaSandboxPaths } from "@/lib/daytona/sandbox"

/**
 * Environment shared by the Cloudcode UI-tests runner whether it is launched as
 * a Codex MCP server (config.toml) or invoked directly as a CLI from the Next.js
 * server. Both must agree on the test, results, runtime, and desktop-state
 * directories so agent runs and server-triggered runs read and write the same
 * places.
 */
export function uiTestsServerEnv({
  paths,
  sandboxId,
  toolboxAuthKey,
  toolboxBaseUrl,
}: {
  paths: Pick<DaytonaSandboxPaths, "codexHome" | "home" | "repoPath">
  sandboxId: string
  toolboxAuthKey?: string
  toolboxBaseUrl?: string
}): Record<string, string> {
  const env: Record<string, string> = {
    CLOUDCODE_BROWSER_COMMAND: DESKTOP_BROWSER_COMMAND,
    CLOUDCODE_DAYTONA_SANDBOX_ID: sandboxId,
    CLOUDCODE_DESKTOP_DISPLAY: ":0",
    CLOUDCODE_DESKTOP_STATE_DIR: `${paths.codexHome}/desktop/state`,
    CLOUDCODE_DESKTOP_TOOL_COMMAND: `${paths.home}/.local/bin/cloudcode-computer`,
    CLOUDCODE_REPO_PATH: paths.repoPath,
    CLOUDCODE_UI_TEST_DIR: `${paths.repoPath}/.cloudcode/tests`,
    CLOUDCODE_UI_TEST_PACKAGE_DIR: `${paths.codexHome}/ui-tests/cloudcode-test`,
    CLOUDCODE_UI_TEST_REPORTER_PATH: `${paths.codexHome}/ui-tests/cloudcode-ui-tests-reporter.cjs`,
    CLOUDCODE_UI_TEST_RESULTS_DIR: `${paths.codexHome}/ui-tests/runs`,
    CLOUDCODE_UI_TEST_RUNTIME_DIR: `${paths.codexHome}/ui-tests/runtime`,
  }
  if (toolboxAuthKey) env.CLOUDCODE_DAYTONA_TOOLBOX_AUTH_KEY = toolboxAuthKey
  if (toolboxBaseUrl) env.CLOUDCODE_DAYTONA_TOOLBOX_BASE_URL = toolboxBaseUrl
  return env
}

export function uiTestsMcpServerScript() {
  return String.raw`#!/usr/bin/env node
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

${playwrightRuntimeScriptFragment()}
${daytonaRecordingClientScriptFragment()}
const repoPath = resolve(process.env.CLOUDCODE_REPO_PATH || process.cwd());
const testDir = resolve(
  process.env.CLOUDCODE_UI_TEST_DIR || join(repoPath, ".cloudcode", "tests")
);
const resultsDir = resolve(
  process.env.CLOUDCODE_UI_TEST_RESULTS_DIR ||
    join(homedir(), ".cloudcode", "ui-test-runs")
);
const scriptPath = fileURLToPath(import.meta.url);
const toolRoot = dirname(scriptPath);
const runtimeRoot = resolve(
  process.env.CLOUDCODE_UI_TEST_RUNTIME_DIR || join(toolRoot, "runtime")
);
const cloudcodeTestPackageDir = resolve(
  process.env.CLOUDCODE_UI_TEST_PACKAGE_DIR ||
    join(toolRoot, "cloudcode-test")
);
const reporterPath = resolve(
  process.env.CLOUDCODE_UI_TEST_REPORTER_PATH ||
    join(toolRoot, "cloudcode-ui-tests-reporter.cjs")
);
const desktopToolCommand =
  process.env.CLOUDCODE_DESKTOP_TOOL_COMMAND ||
  join(homedir(), ".local", "bin", "cloudcode-computer");
const defaultBaseUrl =
  process.env.CLOUDCODE_UI_TEST_BASE_URL || "http://127.0.0.1:3000";
const defaultDisplay = process.env.CLOUDCODE_DESKTOP_DISPLAY || ":0";
const defaultBrowserCommand =
  process.env.CLOUDCODE_UI_TEST_BROWSER_COMMAND ||
  process.env.CLOUDCODE_BROWSER_COMMAND ||
  ${JSON.stringify(DESKTOP_BROWSER_COMMAND)};
const TEST_FILE_RE = /\.(?:spec|test)\.(?:c|m)?[jt]sx?$/;
const SKIP_DIRS = new Set([
  ".git",
  ".next",
  "coverage",
  "node_modules",
  "playwright-report",
  "test-results",
]);

mkdirSync(resultsDir, { recursive: true });

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

function exec(command, args = [], options = {}) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        encoding: options.encoding ?? "utf8",
        env: { ...process.env, ...(options.env ?? {}) },
        maxBuffer: options.maxBuffer ?? 20 * 1024 * 1024,
        timeout: options.timeout ?? 30_000,
      },
      (error, stdout, stderr) => {
        resolve({
          exitCode:
            typeof error?.code === "number"
              ? error.code
              : error
                ? 1
                : 0,
          signal: error?.signal,
          stderr: stderr || "",
          stdout: stdout || "",
        });
      }
    );
  });
}

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function jsonFile(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function truncate(value, max = 2000) {
  if (typeof value !== "string") return "";
  return value.length > max ? value.slice(0, max - 3) + "..." : value;
}

function pathInside(parent, child) {
  const rel = relative(parent, child);
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

function safeRelativePath(path) {
  const rel = relative(repoPath, path);
  return rel && !rel.startsWith("..") ? rel.split(sep).join("/") : path;
}

function isTestFile(path) {
  return TEST_FILE_RE.test(path);
}

function discoverTests(dir = testDir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".cloudcode") continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      discoverTests(fullPath, acc);
      continue;
    }
    if (entry.isFile() && isTestFile(entry.name)) {
      const details = statSync(fullPath);
      acc.push({
        path: safeRelativePath(fullPath),
        sizeBytes: details.size,
        updatedAt: details.mtimeMs,
      });
    }
  }
  return acc.sort((a, b) => a.path.localeCompare(b.path));
}

function resolveTestPath(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return undefined;
  const candidate = isAbsolute(raw)
    ? resolve(raw)
    : raw.startsWith(".cloudcode/tests/") || raw === ".cloudcode/tests"
      ? resolve(repoPath, raw)
      : resolve(testDir, raw);
  if (!pathInside(testDir, candidate)) {
    throw new Error("Test path must be inside .cloudcode/tests.");
  }
  if (!existsSync(candidate)) {
    throw new Error("Test file does not exist: " + safeRelativePath(candidate));
  }
  if (!statSync(candidate).isFile() || !isTestFile(candidate)) {
    throw new Error(
      "Test path must be a .spec or .test JavaScript/TypeScript file."
    );
  }
  return candidate;
}

const sourceGuardrails = [
  {
    pattern: /\.(?:evaluate|evaluateAll|evaluateHandle)\s*\(/,
    message: "Do not evaluate JavaScript in the page; verify visible UI with locators and expect(...).",
  },
  {
    pattern: /\.dispatchEvent\s*\(/,
    message: "Do not dispatch synthetic DOM events; use visible Playwright actions such as click, fill, press, or type.",
  },
  {
    pattern: /\.setContent\s*\(/,
    message: "Do not replace the page HTML; navigate to the real app.",
  },
  {
    pattern: /\.addInitScript\s*\(/,
    message: "Do not inject scripts into the app under test.",
  },
  {
    pattern: /\.(?:route|routeFromHAR|unroute)\s*\(/,
    message: "Do not mock or intercept network requests for deterministic UI recordings.",
  },
  {
    pattern: /\b(?:localStorage|sessionStorage)\b/,
    message: "Do not mutate browser storage to fake UI state.",
  },
  {
    pattern: /\b(?:document|window)\s*\./,
    message: "Do not read or mutate the DOM directly; use locators and visible assertions.",
  },
  {
    pattern: /\brequest\.(?:delete|get|patch|post|put)\s*\(/,
    message: "Do not call backend APIs from UI tests to set up or fake the workflow.",
  },
];

function guardedTestFiles(normalized, discovered) {
  if (normalized.testPath) return [normalized.testPath];
  return discovered.map((entry) => resolve(repoPath, entry.path));
}

function enforceSourceGuardrails(files) {
  const violations = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const guardrail of sourceGuardrails) {
      if (guardrail.pattern.test(source)) {
        violations.push(safeRelativePath(file) + ": " + guardrail.message);
      }
    }
  }
  if (violations.length > 0) {
    throw new Error(
      "Cloudcode UI tests must exercise the real visible UI.\n" +
        violations.join("\n")
    );
  }
}

function readEvents(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line);
        return parsed && typeof parsed === "object" ? [parsed] : [];
      } catch {
        return [];
      }
    });
}

function runCounts(events) {
  const tests = events.filter((event) => event.type === "test_end");
  const passed = tests.filter((event) => event.status === "passed").length;
  const skipped = tests.filter((event) => event.status === "skipped").length;
  const failed = tests.filter(
    (event) => event.status && event.status !== "passed" && event.status !== "skipped"
  ).length;
  return { failed, passed, skipped };
}

// A "running" result older than this is a crashed runner, not a live run.
const RUN_STALE_MS = 20 * 60 * 1000;
const KEEP_RUNS = 20;
const runLockPath = join(resultsDir, "run.lock");

function normalizeStoredRun(result) {
  if (!result || result.status !== "running") return result;
  const lastTouched = result.updatedAt ?? result.createdAt ?? 0;
  if (Date.now() - lastTouched < RUN_STALE_MS) return result;
  return {
    ...result,
    error:
      result.error ||
      "The runner exited before writing a result for this run.",
    status: "failed",
  };
}

function currentRunResult(runId) {
  const resultPath = join(resultsDir, runId, "result.json");
  if (!existsSync(resultPath)) return null;
  return normalizeStoredRun(jsonFile(resultPath, null));
}

function acquireRunLock(runId) {
  const existing = jsonFile(runLockPath, null);
  if (existing && typeof existing.pid === "number") {
    let alive = false;
    try {
      process.kill(existing.pid, 0);
      alive = true;
    } catch {
    }
    const startedAt =
      typeof existing.startedAt === "number" ? existing.startedAt : 0;
    if (alive && Date.now() - startedAt < RUN_STALE_MS) {
      throw new Error(
        "A Cloudcode UI test run is already in progress" +
          (typeof existing.runId === "string" && existing.runId
            ? " (" + existing.runId + ")"
            : "") +
          ". Wait for it to finish before starting another run."
      );
    }
  }
  writeJson(runLockPath, { pid: process.pid, runId, startedAt: Date.now() });
}

function releaseRunLock() {
  try {
    unlinkSync(runLockPath);
  } catch {
  }
}

function pruneRuns() {
  if (!existsSync(resultsDir)) return;
  const runs = readdirSync(resultsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("uitest-"))
    .map((entry) => {
      const result = jsonFile(join(resultsDir, entry.name, "result.json"), null);
      return {
        name: entry.name,
        updatedAt: result?.updatedAt ?? result?.createdAt ?? 0,
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
  for (const run of runs.slice(KEEP_RUNS)) {
    try {
      rmSync(join(resultsDir, run.name), { force: true, recursive: true });
    } catch {
    }
  }
}

async function ensureDesktop() {
  if (!existsSync(desktopToolCommand)) {
    throw new Error(
      "Cloudcode desktop tool is not installed at " + desktopToolCommand + "."
    );
  }
  const result = await exec(desktopToolCommand, ["start"], {
    timeout: 60_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      truncate(result.stderr.trim() || result.stdout.trim() || "Unable to start desktop.")
    );
  }
  const parsed = parseDesktopToolJson(result.stdout);
  const display =
    typeof parsed.display === "string" && parsed.display.trim()
      ? parsed.display.trim()
      : defaultDisplay;
  const width = normalizePositiveInteger(parsed.width, 1280);
  const height = normalizePositiveInteger(parsed.height, 720);
  return { display, height, width };
}

function parseDesktopToolJson(output) {
  try {
    const parsed = JSON.parse(output);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function normalizePositiveInteger(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}

function safeRecordingName(label) {
  const base = (label || "ui-test")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "ui-test";
  return base + "-" + Date.now();
}

function recordingWithSandbox(recording) {
  if (!recording || typeof recording !== "object") return undefined;
  const id = typeof recording.id === "string" ? recording.id : undefined;
  if (!id) return undefined;
  return {
    ...recording,
    sandboxId:
      typeof recording.sandboxId === "string"
        ? recording.sandboxId
        : process.env.CLOUDCODE_DAYTONA_SANDBOX_ID,
  };
}

function recordingFromPayload(payload) {
  if (!payload || typeof payload !== "object") return undefined;
  return recordingWithSandbox(payload.recording) ?? recordingWithSandbox(payload);
}

async function startRecording(label) {
  const recording = recordingFromPayload(
    await cloudcodeDaytonaRecordingRequest("/computeruse/recordings/start", {
      label: safeRecordingName(label),
    })
  );
  if (!recording?.id) {
    throw new Error("Unable to start an isolated UI test recording.");
  }
  return recording;
}

async function stopRecording(recordingId) {
  if (!recordingId) throw new Error("recording id required");
  const stopped = await cloudcodeDaytonaRecordingRequest("/computeruse/recordings/stop", {
    id: recordingId,
  });
  return recordingFromPayload({ id: recordingId, ...stopped }) ?? {
    id: recordingId,
    sandboxId: process.env.CLOUDCODE_DAYTONA_SANDBOX_ID,
  };
}

async function commandOutput(command, args = []) {
  const result = await exec(command, args, { timeout: 5_000 });
  if (result.exitCode !== 0) return "";
  return result.stdout.trim();
}

async function chromiumExecutable() {
  const explicit = process.env.CLOUDCODE_UI_TEST_CHROMIUM;
  if (explicit && existsSync(explicit)) return explicit;
  for (const candidate of [
    "chromium",
    "chromium-browser",
    "google-chrome",
    "google-chrome-stable",
  ]) {
    const found = await commandOutput("bash", ["-lc", "command -v " + shellQuote(candidate)]);
    if (found) return found;
  }
  if (existsSync(defaultBrowserCommand)) return defaultBrowserCommand;
  throw new Error("Cloudcode UI tests require a Chromium-family browser.");
}

function linkCloudcodeTestPackage() {
  if (!existsSync(cloudcodeTestPackageDir)) {
    throw new Error(
      "Cloudcode test package is missing at " + cloudcodeTestPackageDir + "."
    );
  }
  const scopedDir = join(repoPath, ".cloudcode", "node_modules", "@cloudcode");
  const linkPath = join(scopedDir, "test");
  mkdirSync(scopedDir, { recursive: true });
  try {
    const existing = lstatSync(linkPath);
    if (existing.isSymbolicLink()) unlinkSync(linkPath);
    else rmSync(linkPath, { force: true, recursive: true });
  } catch {
  }
  symlinkSync(cloudcodeTestPackageDir, linkPath, "dir");
  return linkPath;
}

function cleanupCloudcodeTestPackageLink() {
  const linkPath = join(
    repoPath,
    ".cloudcode",
    "node_modules",
    "@cloudcode",
    "test"
  );
  try {
    unlinkSync(linkPath);
  } catch {
  }
}

function writePlaywrightConfig({
  baseUrl,
  browser,
  configPath,
  outputDir,
  screen,
  timeoutMs,
}) {
  const screenWidth = normalizePositiveInteger(screen?.width, 1280);
  const screenHeight = normalizePositiveInteger(screen?.height, 720);
  const viewportWidth = Math.max(480, screenWidth - 48);
  const viewportHeight = Math.max(360, screenHeight - 140);
  const config = [
    "const { defineConfig } = require('@playwright/test');",
    "module.exports = defineConfig({",
    "  testDir: " + JSON.stringify(testDir) + ",",
    "  fullyParallel: false,",
    "  forbidOnly: true,",
    "  retries: 0,",
    "  workers: 1,",
    "  timeout: " + JSON.stringify(timeoutMs) + ",",
    "  outputDir: " + JSON.stringify(outputDir) + ",",
    "  reporter: [[" + JSON.stringify(reporterPath) + "]],",
    "  use: {",
    "    baseURL: " + JSON.stringify(baseUrl) + ",",
    "    browserName: 'chromium',",
    "    headless: false,",
    "    screenshot: 'off',",
    "    trace: 'off',",
    "    video: 'off',",
    "    viewport: { width: " + JSON.stringify(viewportWidth) + ", height: " + JSON.stringify(viewportHeight) + " },",
    "    screen: { width: " + JSON.stringify(screenWidth) + ", height: " + JSON.stringify(screenHeight) + " },",
    "    deviceScaleFactor: 1,",
    "    launchOptions: {",
    "      executablePath: " + JSON.stringify(browser) + ",",
    "      // Pace every action so the recorded flow is watchable by a human.",
    "      slowMo: 200,",
    "      args: [",
    "        '--window-position=0,0',",
    "        " + JSON.stringify("--window-size=" + screenWidth + "," + screenHeight) + ",",
    "        '--no-sandbox',",
    "        '--disable-dev-shm-usage',",
    "        '--no-first-run',",
    "        '--no-default-browser-check',",
    "      ],",
    "    },",
    "  },",
    "});",
    "",
  ].join("\n");
  writeFileSync(configPath, config, "utf8");
  return {
    screen: { height: screenHeight, width: screenWidth },
    viewport: { height: viewportHeight, width: viewportWidth },
  };
}

function normalizeRunArgs(args) {
  const baseUrl =
    typeof args?.baseUrl === "string" && args.baseUrl.trim()
      ? args.baseUrl.trim()
      : defaultBaseUrl;
  const grep =
    typeof args?.grep === "string" && args.grep.trim()
      ? args.grep.trim()
      : undefined;
  const timeoutMs =
    typeof args?.timeoutMs === "number" &&
    Number.isFinite(args.timeoutMs) &&
    args.timeoutMs > 0
      ? Math.min(Math.round(args.timeoutMs), 10 * 60 * 1000)
      : 90_000;
  return {
    baseUrl,
    grep,
    testPath: resolveTestPath(args?.testPath),
    timeoutMs,
  };
}

function resultSummary(result) {
  const status = result.status === "passed" ? "passed" : "failed";
  const counts = [
    result.passed + " passed",
    result.failed + " failed",
    result.skipped + " skipped",
  ].join(", ");
  const recording = result.recording?.id
    ? " Recording: " + result.recording.id + "."
    : "";
  return "Cloudcode UI test run " + status + ": " + counts + "." + recording;
}

async function runUiTests(args = {}) {
  const normalized = normalizeRunArgs(args);
  const discovered = discoverTests();
  if (discovered.length === 0) {
    throw new Error("No tests found in .cloudcode/tests.");
  }
  enforceSourceGuardrails(guardedTestFiles(normalized, discovered));
  const runId = "uitest-" + randomUUID();
  acquireRunLock(runId);
  try {
    return await executeUiTestRun(runId, normalized);
  } finally {
    releaseRunLock();
    pruneRuns();
  }
}

async function executeUiTestRun(runId, normalized) {
  const runDir = join(resultsDir, runId);
  const eventsPath = join(runDir, "events.jsonl");
  const resultPath = join(runDir, "result.json");
  const configPath = join(runDir, "playwright.config.cjs");
  const outputDir = join(runDir, "playwright-output");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(eventsPath, "", "utf8");
  const startedResult = {
    baseUrl: normalized.baseUrl,
    createdAt: Date.now(),
    runId,
    status: "running",
    testPath: normalized.testPath ? safeRelativePath(normalized.testPath) : null,
  };
  writeJson(resultPath, startedResult);

  try {
    return await recordedUiTestRun(runId, normalized, {
      configPath,
      eventsPath,
      outputDir,
      resultPath,
    });
  } catch (error) {
    // Persist the failure so the run never lingers as "running" in the UI.
    writeJson(resultPath, {
      ...startedResult,
      error: truncate(error instanceof Error ? error.message : String(error)),
      status: "failed",
      updatedAt: Date.now(),
    });
    throw error;
  }
}

async function recordedUiTestRun(
  runId,
  normalized,
  { configPath, eventsPath, outputDir, resultPath }
) {
  const playwrightRuntime = await resolveCloudcodePlaywrightRuntime({
    repoPath,
    runtimeRoot,
  });
  const desktop = await ensureDesktop();
  const browser = await chromiumExecutable();
  const packageLink = linkCloudcodeTestPackage();
  let recordingStartMs = Date.now();
  let recording;
  let recordingId;
  let recordingStarted = false;
  let stopRecordingError = "";
  let layout = {
    screen: { height: desktop.height, width: desktop.width },
    viewport: { height: Math.max(360, desktop.height - 140), width: Math.max(480, desktop.width - 48) },
  };
  let playwright;
  try {
    recording = await startRecording(
      "ui-test-" +
        (normalized.testPath
          ? basename(normalized.testPath).replace(TEST_FILE_RE, "")
          : "all")
    );
    recordingId = recording.id;
    recordingStarted = true;
    recordingStartMs = Date.now();
    layout = writePlaywrightConfig({
      baseUrl: normalized.baseUrl,
      browser,
      configPath,
      outputDir,
      screen: desktop,
      timeoutMs: normalized.timeoutMs,
    });

    const playwrightArgs = ["test", "-c", configPath];
    if (normalized.grep) playwrightArgs.push("--grep", normalized.grep);
    if (normalized.testPath) playwrightArgs.push(normalized.testPath);

    playwright = await exec("node", [playwrightRuntime.cliPath, ...playwrightArgs], {
      cwd: repoPath,
      env: {
        CLOUDCODE_PLAYWRIGHT_PACKAGE: playwrightRuntime.packageJsonPath,
        CLOUDCODE_UI_TEST_BASE_URL: normalized.baseUrl,
        CLOUDCODE_UI_TEST_EVENTS: eventsPath,
        CLOUDCODE_UI_TEST_RECORDING_STARTED_AT: String(recordingStartMs),
        DISPLAY: desktop.display,
        NODE_PATH: playwrightRuntime.nodePath,
      },
      maxBuffer: 40 * 1024 * 1024,
      timeout: Math.max(normalized.timeoutMs + 60_000, 180_000),
    });
  } finally {
    if (recordingStarted) {
      try {
        recording = await stopRecording(recordingId);
      } catch (error) {
        stopRecordingError =
          error instanceof Error ? error.message : "Unable to stop recording.";
      }
    }
    cleanupCloudcodeTestPackageLink();
    try {
      const scopedDir = dirname(packageLink);
      if (!readdirSync(scopedDir).length) rmSync(scopedDir, { recursive: true });
    } catch {
    }
  }

  const events = readEvents(eventsPath);
  const counts = runCounts(events);
  const status =
    playwright?.exitCode === 0 && counts.failed === 0 ? "passed" : "failed";
  const timedOut = Boolean(playwright?.signal);
  const failureDetail =
    playwright?.stderr || playwright?.stdout || "UI tests failed.";
  const result = {
    baseUrl: normalized.baseUrl,
    createdAt: recordingStartMs,
    durationMs: Math.max(0, Date.now() - recordingStartMs),
    desktop: {
      display: desktop.display,
      height: desktop.height,
      width: desktop.width,
    },
    error:
      status === "failed"
        ? truncate(
            timedOut
              ? "The UI test run exceeded its time budget and was killed. Increase timeoutMs or narrow the run with testPath/grep.\n" +
                  failureDetail
              : failureDetail
          )
        : undefined,
    events,
    exitCode: playwright?.exitCode ?? 1,
    failed: counts.failed,
    passed: counts.passed,
    recording,
    runId,
    screen: layout.screen,
    skipped: counts.skipped,
    status,
    stderr: truncate(playwright?.stderr ?? "", 12000),
    stdout: truncate(playwright?.stdout ?? "", 12000),
    stopRecordingError: stopRecordingError || undefined,
    testPath: normalized.testPath ? safeRelativePath(normalized.testPath) : null,
    updatedAt: Date.now(),
    viewport: layout.viewport,
  };
  writeJson(resultPath, result);
  return result;
}

function listRuns() {
  if (!existsSync(resultsDir)) return [];
  return readdirSync(resultsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const result = currentRunResult(entry.name);
      return result ? [result] : [];
    })
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

function summarizeRun(result) {
  if (!result || typeof result !== "object") return null;
  const recording =
    result.recording && result.recording.id
      ? {
          fileName: result.recording.fileName,
          id: result.recording.id,
          sandboxId: result.recording.sandboxId,
          status: result.recording.status,
        }
      : undefined;
  return {
    baseUrl: result.baseUrl,
    createdAt: result.createdAt ?? null,
    desktop: result.desktop,
    durationMs: result.durationMs ?? 0,
    error: result.error,
    failed: result.failed ?? 0,
    passed: result.passed ?? 0,
    recording,
    runId: result.runId,
    skipped: result.skipped ?? 0,
    status: result.status,
    testPath: result.testPath ?? null,
    updatedAt: result.updatedAt ?? result.createdAt ?? null,
    viewport: result.viewport,
  };
}

// Event types worth returning to the agent; raw stdout/events stay on disk for
// the Cloudcode tests panel, which reads full results through the CLI.
const MCP_EVENT_TYPES = new Set([
  "annotation",
  "run_begin",
  "run_end",
  "step_end",
  "step_error",
  "test_begin",
  "test_end",
  "verification_error",
]);

function compactRunForMcp(result) {
  if (!result || typeof result !== "object") return result;
  const { events, stderr, stdout, ...rest } = result;
  const compactEvents = (Array.isArray(events) ? events : [])
    .filter((event) => MCP_EVENT_TYPES.has(event?.type))
    .slice(-80);
  return {
    ...rest,
    events: compactEvents,
    ...(result.status === "failed"
      ? {
          stderr: truncate(stderr ?? "", 4000),
          stdout: truncate(stdout ?? "", 2000),
        }
      : {}),
  };
}

async function callTool(name, args = {}, options = {}) {
  const runResult = (result) =>
    text(resultSummary(result), options.full ? result : compactRunForMcp(result));
  switch (name) {
    case "ui_tests_list": {
      const tests = discoverTests();
      return text(
        tests.length
          ? "Found " + tests.length + " Cloudcode UI test file(s)."
          : "No Cloudcode UI tests found in .cloudcode/tests.",
        { testDir: safeRelativePath(testDir), tests }
      );
    }
    case "ui_tests_run": {
      return runResult(await runUiTests(args));
    }
    case "ui_tests_status": {
      const runId = typeof args?.runId === "string" ? args.runId.trim() : "";
      if (!runId) throw new Error("runId required");
      const result = currentRunResult(runId);
      if (!result) throw new Error("Unknown UI test run: " + runId);
      return runResult(result);
    }
    case "ui_tests_result": {
      const runId = typeof args?.runId === "string" ? args.runId.trim() : "";
      const result = runId
        ? currentRunResult(runId)
        : listRuns().at(0) ?? null;
      if (!result) {
        throw new Error(runId ? "Unknown UI test run: " + runId : "No UI test runs found.");
      }
      return runResult(result);
    }
    case "ui_tests_runs": {
      const runs = listRuns().map(summarizeRun).filter(Boolean);
      return text(
        runs.length
          ? "Found " + runs.length + " Cloudcode UI test run(s)."
          : "No Cloudcode UI test runs found.",
        { runs }
      );
    }
    default:
      throw new Error("Unknown UI test tool: " + name);
  }
}

const tools = [
  {
    name: "ui_tests_list",
    description:
      "List deterministic Cloudcode UI test files under .cloudcode/tests.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "ui_tests_run",
    description:
      "Run deterministic Cloudcode UI tests as a headed, recorded browser flow in the Daytona desktop. Only use this when the user explicitly asked for deterministic, recorded UI tests; it is not the default verification path for UI changes. The run sizes the browser to the actual desktop, starts a fresh isolated recording for the test execution, and returns that completed recording artifact.",
    inputSchema: {
      type: "object",
      properties: {
        baseUrl: { type: "string" },
        grep: { type: "string" },
        testPath: { type: "string" },
        timeoutMs: { type: "number" },
      },
    },
  },
  {
    name: "ui_tests_status",
    description: "Read a Cloudcode UI test run result by run id.",
    inputSchema: {
      type: "object",
      required: ["runId"],
      properties: { runId: { type: "string" } },
    },
  },
  {
    name: "ui_tests_result",
    description:
      "Read the latest Cloudcode UI test run result, or a specific result by run id.",
    inputSchema: {
      type: "object",
      properties: { runId: { type: "string" } },
    },
  },
  {
    name: "ui_tests_runs",
    description:
      "List summaries of every Cloudcode UI test run, newest first.",
    inputSchema: { type: "object", properties: {} },
  },
];

async function handle(message) {
  if (!message || typeof message !== "object") return;
  const { id, method, params } = message;
  try {
    if (method === "initialize") {
      if (id !== undefined) {
        send({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: params?.protocolVersion || "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "cloudcode-ui-tests", version: "1.0.0" },
            instructions:
              "Deterministic Cloudcode UI tests are opt-in: only write or run .cloudcode/tests specs when the user explicitly asked for a deterministic, recorded test of a flow. Do not use these tools as the default way to verify UI changes; for ordinary verification navigate the app with the cloudcode_desktop browser tools instead. When the user has asked: import { test, expect } from @cloudcode/test, use step and annotate for video annotations, and run tests with ui_tests_run. The runner uses headed Playwright in the Daytona desktop, sizes the browser to the actual desktop, and records only the isolated UI test execution. Write normal Playwright against the real app: page.goto for navigation, role/label/text locators for controls, locator/page/keyboard actions for interaction, and expect(...) for verification. Every test must use step(), perform at least one action inside a step, and make an expect(...) assertion after the last action. Do not rehearse the same flow manually first, and do not create screenshot or trace artifacts for this flow.",
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
      if (id !== undefined) send({ jsonrpc: "2.0", id, result: { tools } });
      return;
    }
    if (method === "tools/call") {
      const result = await callTool(params?.name, params?.arguments || {});
      if (id !== undefined) send({ jsonrpc: "2.0", id, result });
      return;
    }
    if (id !== undefined) {
      send({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: "Method not found: " + method },
      });
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
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
}

async function cli() {
  const [, , command, ...rest] = process.argv;
  const toolName = {
    list: "ui_tests_list",
    run: "ui_tests_run",
    result: "ui_tests_result",
    runs: "ui_tests_runs",
    status: "ui_tests_status",
  }[command || "list"];
  if (!toolName) throw new Error("Unknown command: " + command);
  const args = {};
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--base-url") args.baseUrl = rest[(i += 1)];
    else if (arg === "--grep") args.grep = rest[(i += 1)];
    else if (arg === "--run-id") args.runId = rest[(i += 1)];
    else if (arg === "--timeout-ms") args.timeoutMs = Number(rest[(i += 1)]);
    else if (!args.testPath) args.testPath = arg;
  }
  const result = await callTool(toolName, args, { full: true });
  console.log(JSON.stringify(result.structuredContent ?? result, null, 2));
}

if (process.argv.length > 2) {
  cli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
} else {
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
}
`
}

export function uiTestsCloudcodeTestPackageJson() {
  return JSON.stringify(
    {
      name: "@cloudcode/test",
      private: true,
      type: "commonjs",
      main: "index.cjs",
      types: "index.d.ts",
    },
    null,
    2
  )
}

export function uiTestsCloudcodeTestIndex() {
  return String.raw`const fs = require("node:fs");
const { createRequire } = require("node:module");

const playwrightPackage = process.env.CLOUDCODE_PLAYWRIGHT_PACKAGE;
const requirePlaywright = playwrightPackage
  ? createRequire(playwrightPackage)
  : require;
const base = requirePlaywright("@playwright/test");
const testStartedAt = Number(process.env.CLOUDCODE_UI_TEST_RECORDING_STARTED_AT || Date.now());
const eventsPath = process.env.CLOUDCODE_UI_TEST_EVENTS || "";

const overlayScript = [
  "(function(){",
  "if (window.__cloudcodeSetUiTestOverlay) return;",
  "var root = document.createElement('div');",
  "root.setAttribute('data-cloudcode-ui-test-overlay', 'true');",
  "root.style.cssText = 'position:fixed;top:18px;left:18px;z-index:2147483647;max-width:min(560px,calc(100vw - 36px));padding:12px 14px;border-radius:10px;background:rgba(15,17,21,.88);color:white;font:13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;box-shadow:0 14px 40px rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.16);pointer-events:none;display:none;';",
  "var eyebrow = document.createElement('div');",
  "eyebrow.style.cssText = 'font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.62);margin-bottom:4px;';",
  "var title = document.createElement('div');",
  "title.style.cssText = 'font-weight:650;color:white;white-space:normal;overflow-wrap:anywhere;';",
  "root.appendChild(eyebrow);",
  "root.appendChild(title);",
  "document.documentElement.appendChild(root);",
  "var hideTimer = 0;",
  "window.__cloudcodeSetUiTestOverlay = function(payload){",
  "  if (!payload || !payload.title) return;",
  "  clearTimeout(hideTimer);",
  "  var status = payload.status ? ' - ' + payload.status : '';",
  "  eyebrow.textContent = (payload.kind || 'ui test') + status;",
  "  title.textContent = payload.title;",
  "  if (payload.kind === 'result') {",
  "    root.style.background = payload.status === 'passed' ? 'rgba(20,83,45,.92)' : 'rgba(127,29,29,.92)';",
  "  } else {",
  "    root.style.background = 'rgba(15,17,21,.88)';",
  "  }",
  "  root.style.display = 'block';",
  "  if (payload.kind === 'annotation') hideTimer = setTimeout(function(){ root.style.display = 'none'; }, payload.durationMs || 2600);",
  "};",
  "}());",
].join("");

function atMs() {
  return Math.max(0, Date.now() - testStartedAt);
}

function appendEvent(event) {
  if (!eventsPath) return;
  try {
    fs.appendFileSync(
      eventsPath,
      JSON.stringify({
        atMs: atMs(),
        ...event,
      }) + "\n",
      "utf8"
    );
  } catch {
  }
}

async function installOverlay(page) {
  try {
    await rawPageAction(page, (raw) =>
      raw.addInitScript({ content: overlayScript })
    );
  } catch {
  }
  try {
    await rawPageAction(page, (raw) => raw.evaluate(overlayScript));
  } catch {
  }
}

async function setOverlay(page, payload) {
  try {
    await installOverlay(page);
    await rawPageAction(page, (raw) =>
      raw.evaluate((value) => {
        window.__cloudcodeSetUiTestOverlay?.(value);
      }, payload)
    );
  } catch {
  }
}

const guardedPages = new WeakSet();
const rawPages = new WeakMap();
const guardedLocators = new WeakMap();
const blockedPageMethods = [
  "addInitScript",
  "evaluate",
  "evaluateHandle",
  "route",
  "routeFromHAR",
  "setContent",
  "unroute",
];
const pageActionMethods = new Set(["goBack", "goForward", "goto", "reload"]);
const pageLocatorMethods = [
  "frameLocator",
  "getByAltText",
  "getByLabel",
  "getByPlaceholder",
  "getByRole",
  "getByTestId",
  "getByText",
  "getByTitle",
  "locator",
];
const locatorActionMethods = new Set([
  "check",
  "click",
  "dblclick",
  "dragTo",
  "fill",
  "focus",
  "hover",
  "press",
  "selectOption",
  "setChecked",
  "setInputFiles",
  "tap",
  "type",
  "uncheck",
]);
const blockedLocatorMethods = new Set([
  "dispatchEvent",
  "evaluate",
  "evaluateAll",
  "evaluateHandle",
]);
const keyboardActionMethods = new Set(["down", "press", "type", "up"]);

let activeTestState = null;

function createTestState(testInfo) {
  return {
    actions: 0,
    actionsOutsideStep: 0,
    assertions: 0,
    pendingAssertionPromises: new Set(),
    stepCount: 0,
    stepDepth: 0,
    testTitle: testInfo.title,
    unverifiedActions: 0,
  };
}

function currentState() {
  return activeTestState;
}

function trackAssertionPromise(promise) {
  const state = currentState();
  if (!state || !promise || typeof promise.then !== "function") return promise;
  state.pendingAssertionPromises.add(promise);
  promise.then(
    () => state.pendingAssertionPromises.delete(promise),
    () => state.pendingAssertionPromises.delete(promise)
  );
  return promise;
}

async function settlePendingAssertions(state) {
  const pending = [...state.pendingAssertionPromises];
  if (pending.length === 0) return;
  const settled = await Promise.allSettled(pending);
  const rejected = settled.find((entry) => entry.status === "rejected");
  if (rejected) throw rejected.reason;
}

function markUserAction(title) {
  const state = currentState();
  if (state) {
    state.actions += 1;
    state.unverifiedActions += 1;
    if (state.stepDepth === 0) state.actionsOutsideStep += 1;
  }
  appendEvent({
    test: state?.testTitle,
    title,
    type: "user_action",
  });
}

function markVerification(title) {
  const state = currentState();
  if (!state) return;
  state.assertions += 1;
  state.unverifiedActions = 0;
  appendEvent({
    test: state.testTitle,
    title,
    type: "verification",
  });
}

function validationError(message) {
  appendEvent({
    error: message,
    test: activeTestState?.testTitle,
    title: "Cloudcode verification requirements",
    type: "verification_error",
  });
  return new Error(message);
}

async function validateStructuredTest(state) {
  await settlePendingAssertions(state);
  const failures = [];
  if (state.stepCount === 0) {
    failures.push("use at least one step() so the run has a visible checklist");
  }
  if (state.actions === 0) {
    failures.push("perform at least one visible user action such as page.goto(), locator.click(), locator.fill(), or keyboard.press()");
  }
  if (state.actionsOutsideStep > 0) {
    failures.push("put user actions inside step() blocks");
  }
  if (state.assertions === 0) {
    failures.push("verify the result with at least one expect(...) assertion");
  }
  if (state.unverifiedActions > 0) {
    failures.push("make an expect(...) assertion after the last user action");
  }
  if (failures.length > 0) {
    throw validationError(
      "Cloudcode UI tests must prove the user flow worked: " +
        failures.join("; ") +
        "."
    );
  }
}

// How long the pass/fail verdict stays on screen before the browser closes,
// so the recording ends on the visible outcome instead of cutting off.
const RESULT_HOLD_MS = 2500;

async function showTestResult(page, title, status) {
  await setOverlay(page, {
    kind: "result",
    status,
    title: (status === "passed" ? "Passed - " : "Failed - ") + title,
  });
  await new Promise((resolve) => setTimeout(resolve, RESULT_HOLD_MS));
}

function shortcutError(method, replacement) {
  return new Error(
    "Cloudcode deterministic UI tests must verify the visible UI. " +
      "Do not use " +
      method +
      "; use " +
      replacement +
      " instead."
  );
}

function wrapMatcher(matcher, label) {
  if (!matcher || (typeof matcher !== "object" && typeof matcher !== "function")) {
    return matcher;
  }
  return new Proxy(matcher, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "not" || prop === "resolves" || prop === "rejects") {
        return wrapMatcher(value, label + "." + String(prop));
      }
      if (typeof value !== "function") return value;
      return (...args) => {
        markVerification(label + "." + String(prop));
        const result = value.apply(target, args);
        return trackAssertionPromise(result);
      };
    },
  });
}

function wrapExpect(expectFn, label = "expect") {
  return new Proxy(expectFn, {
    apply(target, thisArg, args) {
      return wrapMatcher(Reflect.apply(target, thisArg, args), label);
    },
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "configure" && typeof value === "function") {
        return (...args) => wrapExpect(value.apply(target, args), label + ".configure");
      }
      if ((prop === "soft" || prop === "poll") && typeof value === "function") {
        return (...args) => wrapMatcher(value.apply(target, args), label + "." + String(prop));
      }
      return value;
    },
  });
}

const expect = wrapExpect(base.expect);

function defineMethod(target, name, value) {
  Object.defineProperty(target, name, {
    configurable: true,
    value,
  });
}

function guardLocator(locator) {
  if (!locator || typeof locator !== "object") return locator;
  const cached = guardedLocators.get(locator);
  if (cached) return cached;
  const guarded = new Proxy(locator, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop === "string" && blockedLocatorMethods.has(prop)) {
        return () => {
          throw shortcutError("locator." + prop + "()", "visible locator actions and expect(...) assertions");
        };
      }
      if (typeof value !== "function") return value;
      return (...args) => {
        if (typeof prop === "string" && locatorActionMethods.has(prop)) {
          markUserAction("locator." + prop + "()");
        }
        const result = value.apply(target, args);
        if (result && typeof result === "object" && typeof result.click === "function") {
          return guardLocator(result);
        }
        return result;
      };
    },
  });
  guardedLocators.set(locator, guarded);
  return guarded;
}

async function rawPageAction(page, action) {
  const raw = rawPages.get(page);
  if (!raw) {
    return await action({
      addInitScript: page.addInitScript.bind(page),
      evaluate: page.evaluate.bind(page),
      goto: page.goto.bind(page),
    });
  }
  raw.depth += 1;
  try {
    return await action(raw);
  } finally {
    raw.depth -= 1;
  }
}

function installUiGuard(page) {
  if (guardedPages.has(page)) return;
  const raw = {
    addInitScript: page.addInitScript.bind(page),
    depth: 0,
    evaluate: page.evaluate.bind(page),
    goto: page.goto.bind(page),
  };
  for (const name of blockedPageMethods) {
    if (typeof page[name] === "function") raw[name] = page[name].bind(page);
  }
  for (const name of pageActionMethods) {
    if (typeof page[name] === "function") raw[name] = page[name].bind(page);
  }
  for (const name of pageLocatorMethods) {
    if (typeof page[name] === "function") raw[name] = page[name].bind(page);
  }
  if (page.keyboard && typeof page.keyboard.insertText === "function") {
    raw.keyboardInsertText = page.keyboard.insertText.bind(page.keyboard);
  }
  rawPages.set(page, raw);
  guardedPages.add(page);

  for (const name of blockedPageMethods) {
    if (typeof raw[name] !== "function") continue;
    defineMethod(page, name, (...args) => {
      if (raw.depth > 0) return raw[name](...args);
      throw shortcutError("page." + name + "()", "visible page/locator actions and expect(...) assertions");
    });
  }
  for (const name of pageActionMethods) {
    if (typeof raw[name] !== "function") continue;
    defineMethod(page, name, (...args) => {
      if (raw.depth === 0) markUserAction("page." + name + "()");
      return raw[name](...args);
    });
  }
  for (const name of pageLocatorMethods) {
    if (typeof raw[name] !== "function") continue;
    defineMethod(page, name, (...args) => guardLocator(raw[name](...args)));
  }
  if (page.keyboard && typeof raw.keyboardInsertText === "function") {
    defineMethod(page.keyboard, "insertText", () => {
      throw shortcutError("keyboard.insertText()", "keyboard.type() or locator.fill() inside a step");
    });
  }
  if (page.keyboard) {
    for (const name of keyboardActionMethods) {
      if (typeof page.keyboard[name] !== "function") continue;
      const original = page.keyboard[name].bind(page.keyboard);
      defineMethod(page.keyboard, name, (...args) => {
        markUserAction("keyboard." + name + "()");
        return original(...args);
      });
    }
  }
}

const test = base.test.extend({
  _cloudcodeVerification: [
    async ({ page }, use, testInfo) => {
      const previousState = activeTestState;
      const state = createTestState(testInfo);
      activeTestState = state;
      let testError;
      try {
        await use();
      } catch (error) {
        testError = error;
      }
      if (!testError) {
        try {
          await validateStructuredTest(state);
        } catch (error) {
          testError = error;
        }
      }
      activeTestState = previousState;
      await showTestResult(
        page,
        testInfo.title,
        testError ? "failed" : "passed"
      );
      if (testError) throw testError;
    },
    { auto: true },
  ],
  page: async ({ page }, use) => {
    installUiGuard(page);
    await use(page);
  },
  annotate: async ({ page }, use, testInfo) => {
    await installOverlay(page);
    await use(async (title, options = {}) => {
      const cleanTitle = String(title || "").trim();
      if (!cleanTitle) return;
      const payload = {
        durationMs:
          typeof options.durationMs === "number" ? options.durationMs : 2600,
        kind: "annotation",
        status: options.status,
        title: cleanTitle,
      };
      appendEvent({
        test: testInfo.title,
        title: cleanTitle,
        type: "annotation",
      });
      await setOverlay(page, payload);
    });
  },
  step: async ({ page }, use, testInfo) => {
    await installOverlay(page);
    await use(async (title, body, options) => {
      const cleanTitle = String(title || "").trim();
      if (!cleanTitle) return await body();
      const state = currentState();
      if (state) state.stepCount += 1;
      await setOverlay(page, {
        kind: "step",
        status: "running",
        title: cleanTitle,
      });
      return await base.test.step(
        cleanTitle,
        async (stepInfo) => {
          const state = currentState();
          if (state) state.stepDepth += 1;
          try {
            const result = await body(stepInfo);
            await setOverlay(page, {
              kind: "step",
              status: "passed",
              title: cleanTitle,
            });
            return result;
          } catch (error) {
            appendEvent({
              error: error instanceof Error ? error.message : String(error),
              test: testInfo.title,
              title: cleanTitle,
              type: "step_error",
            });
            await setOverlay(page, {
              kind: "step",
              status: "failed",
              title: cleanTitle,
            });
            throw error;
          } finally {
            const state = currentState();
            if (state) state.stepDepth = Math.max(0, state.stepDepth - 1);
          }
        },
        options
      );
    });
  },
});

module.exports = {
  ...base,
  expect,
  test,
};
`
}

export function uiTestsCloudcodeTestTypes() {
  return String.raw`import type {
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestStepInfo,
  TestType,
  test as base,
} from "@playwright/test"

export type CloudcodeAnnotationOptions = {
  durationMs?: number
  status?: string
}

export type CloudcodeFixtures = {
  annotate: (
    title: string,
    options?: CloudcodeAnnotationOptions
  ) => Promise<void>
  step: <T>(
    title: string,
    body: (step: TestStepInfo) => T | Promise<T>,
    options?: Parameters<typeof base.step>[2]
  ) => Promise<T>
}

export const test: TestType<
  PlaywrightTestArgs & PlaywrightTestOptions & CloudcodeFixtures,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
> &
  typeof base
export { expect } from "@playwright/test"
export type { Page, TestInfo, TestStepInfo } from "@playwright/test"
export * from "@playwright/test"
`
}

export function uiTestsReporterScript() {
  return String.raw`const fs = require("node:fs");

const startedAt = Number(
  process.env.CLOUDCODE_UI_TEST_RECORDING_STARTED_AT || Date.now()
);
const eventsPath = process.env.CLOUDCODE_UI_TEST_EVENTS || "";
let seq = 0;

function atMs() {
  return Math.max(0, Date.now() - startedAt);
}

function append(event) {
  if (!eventsPath) return;
  try {
    fs.appendFileSync(
      eventsPath,
      JSON.stringify({
        atMs: atMs(),
        seq: ++seq,
        ...event,
      }) + "\n",
      "utf8"
    );
  } catch {
  }
}

function errorMessage(error) {
  if (!error) return undefined;
  if (typeof error.message === "string") return error.message;
  return String(error);
}

class CloudcodeUiTestReporter {
  onBegin(config, suite) {
    append({
      total: suite.allTests().length,
      type: "run_begin",
      workers: config.workers,
    });
  }

  onTestBegin(test) {
    append({
      file: test.location?.file,
      line: test.location?.line,
      title: test.title,
      type: "test_begin",
    });
  }

  onStepBegin(test, result, step) {
    if (step.category !== "test.step") return;
    append({
      category: step.category,
      test: test.title,
      title: step.title,
      type: "step_begin",
    });
  }

  onStepEnd(test, result, step) {
    if (step.category !== "test.step") return;
    append({
      category: step.category,
      durationMs: step.duration,
      error: errorMessage(step.error),
      status: step.error ? "failed" : "passed",
      test: test.title,
      title: step.title,
      type: "step_end",
    });
  }

  onTestEnd(test, result) {
    append({
      durationMs: result.duration,
      error: errorMessage(result.error),
      status: result.status,
      title: test.title,
      type: "test_end",
    });
  }

  onEnd(result) {
    append({
      status: result.status,
      type: "run_end",
    });
  }
}

module.exports = CloudcodeUiTestReporter;
`
}

export function uiTestsToolContentFingerprint() {
  return [
    PLAYWRIGHT_TEST_VERSION,
    uiTestsMcpServerScript(),
    uiTestsCloudcodeTestPackageJson(),
    uiTestsCloudcodeTestIndex(),
    uiTestsCloudcodeTestTypes(),
    uiTestsReporterScript(),
  ].join("\0")
}
