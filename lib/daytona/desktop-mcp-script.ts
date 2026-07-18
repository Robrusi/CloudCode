import { DESKTOP_BROWSER_COMMAND } from "@/lib/daytona/desktop-dependencies"
import {
  DESKTOP_AGENT_COMPLETED_RECORDING_STATE_FILE,
  DESKTOP_AGENT_RECORDING_STATE_FILE,
  DESKTOP_AGENT_RUN_STATE_FILE,
} from "@/lib/daytona/desktop-recordings"
import {
  daytonaRecordingClientScriptFragment,
  playwrightRuntimeScriptFragment,
} from "@/lib/daytona/mcp-script-shared"

export function desktopMcpServerScript() {
  return String.raw`#!/usr/bin/env node
import { execFile, execSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

${playwrightRuntimeScriptFragment()}
${daytonaRecordingClientScriptFragment()}
const repoPath = process.env.CLOUDCODE_REPO_PATH || process.cwd();
const miseTrustedPaths = process.env.MISE_TRUSTED_CONFIG_PATHS || repoPath;
const stateDir = process.env.CLOUDCODE_DESKTOP_STATE_DIR || join(homedir(), ".cache", "cloudcode-desktop");
const cloudcodeBrowserCommand = process.env.CLOUDCODE_BROWSER_COMMAND || ${JSON.stringify(DESKTOP_BROWSER_COMMAND)};
const terminalHome = process.env.CLOUDCODE_TERMINAL_HOME || homedir();
const terminalPath = process.env.CLOUDCODE_TERMINAL_PATH || process.env.PATH || "";
const codexHome = process.env.CODEX_HOME || join(terminalHome, ".codex");
const browserProfileDir =
  process.env.CLOUDCODE_BROWSER_PROFILE ||
  join(process.env.HOME || homedir(), ".cache", "cloudcode-chromium");
const browserCdpPort = Number(process.env.CLOUDCODE_BROWSER_CDP_PORT || "9377");
const playwrightRuntimeRoot =
  process.env.CLOUDCODE_PLAYWRIGHT_RUNTIME_DIR ||
  join(codexHome, "ui-tests", "runtime");
const activeRecordingPath = join(stateDir, ${JSON.stringify(DESKTOP_AGENT_RECORDING_STATE_FILE)});
const completedRecordingPath = join(stateDir, ${JSON.stringify(DESKTOP_AGENT_COMPLETED_RECORDING_STATE_FILE)});
const runStatePath = join(stateDir, ${JSON.stringify(DESKTOP_AGENT_RUN_STATE_FILE)});
const displayCandidates = [
  process.env.CLOUDCODE_DESKTOP_DISPLAY,
  process.env.DISPLAY,
  ":0",
  ":1",
  ":99",
].filter(Boolean);
mkdirSync(stateDir, { recursive: true });

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function text(text, structuredContent) {
  return {
    content: [{ type: "text", text }],
    ...(structuredContent ? { structuredContent } : {}),
  };
}

function toolError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: message }], isError: true };
}

function commandExists(command) {
  try {
    execSync("command -v " + command, {
      shell: "/bin/bash",
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function run(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      encoding: options.encoding ?? "utf8",
      env: { ...process.env, ...(options.env ?? {}) },
      maxBuffer: options.maxBuffer ?? 20 * 1024 * 1024,
      timeout: options.timeout ?? 30_000,
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = stderr || stdout || error.message;
        reject(new Error(detail.trim() || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

function shell(script, options = {}) {
  return run("/bin/bash", ["-lc", script], options);
}

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

async function displayWorks(display) {
  if (!commandExists("xdpyinfo")) return false;
  try {
    await run("xdpyinfo", ["-display", display], { timeout: 2_000 });
    return true;
  } catch {
    return false;
  }
}

async function activeDisplay() {
  for (const display of displayCandidates) {
    if (await displayWorks(display)) return display;
  }
  return displayCandidates[0] || ":0";
}

async function displayGeometry(display) {
  if (!commandExists("xdpyinfo")) return { height: 900, width: 1440 };
  try {
    const output = await run("xdpyinfo", ["-display", display], {
      timeout: 2_000,
    });
    const match = /dimensions:\s+(\d+)x(\d+)\s+pixels/i.exec(output);
    const width = Number(match?.[1]);
    const height = Number(match?.[2]);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { height, width };
    }
  } catch {
  }
  return { height: 900, width: 1440 };
}

function desktopEnv(display) {
  return { DISPLAY: display };
}

async function ensureDesktopInfo() {
  const display = await activeDisplay();
  if (await displayWorks(display)) {
    return { display, ...(await displayGeometry(display)) };
  }

  const logDir = join(stateDir, "logs");
  mkdirSync(logDir, { recursive: true });
  const shellScript = [
    "set -e",
    "export DISPLAY=" + JSON.stringify(display),
    "if ! command -v Xvfb >/dev/null 2>&1; then echo 'Xvfb is not installed.' >&2; exit 1; fi",
    "nohup Xvfb \"$DISPLAY\" -screen 0 1440x900x24 -ac > " + JSON.stringify(join(logDir, "xvfb.log")) + " 2>&1 &",
    "for i in $(seq 1 30); do xdpyinfo -display \"$DISPLAY\" >/dev/null 2>&1 && break; sleep 0.2; done",
    "xdpyinfo -display \"$DISPLAY\" >/dev/null 2>&1",
    "if command -v startxfce4 >/dev/null 2>&1; then nohup startxfce4 > " + JSON.stringify(join(logDir, "xfce4.log")) + " 2>&1 & fi",
    "if command -v x11vnc >/dev/null 2>&1 && ! pgrep -f 'x11vnc .*$DISPLAY' >/dev/null 2>&1; then nohup x11vnc -display \"$DISPLAY\" -forever -shared -nopw -rfbport 5900 -localhost > " + JSON.stringify(join(logDir, "x11vnc.log")) + " 2>&1 & fi",
    "if command -v websockify >/dev/null 2>&1 && ! pgrep -f 'websockify.*6080' >/dev/null 2>&1; then nohup websockify --web=/usr/share/novnc/ 6080 localhost:5900 > " + JSON.stringify(join(logDir, "novnc.log")) + " 2>&1 & fi",
  ].join("\n");
  await shell(shellScript, { timeout: 10_000 });
  return { display, ...(await displayGeometry(display)) };
}

async function ensureDesktop() {
  return (await ensureDesktopInfo()).display;
}

async function screenshotPngBase64(showCursor = true) {
  const display = await ensureDesktop();
  if (!commandExists("import")) {
    throw new Error("ImageMagick 'import' is not installed in this sandbox snapshot.");
  }
  const args = showCursor ? ["-window", "root", "png:-"] : ["-window", "root", "png:-"];
  const buffer = await run("import", args, {
    encoding: "buffer",
    env: desktopEnv(display),
    maxBuffer: 32 * 1024 * 1024,
    timeout: 10_000,
  });
  return { base64: Buffer.from(buffer).toString("base64"), display };
}

async function xdotool(args) {
  const display = await ensureDesktop();
  if (!commandExists("xdotool")) {
    throw new Error("xdotool is not installed in this sandbox snapshot.");
  }
  await run("xdotool", args, { env: desktopEnv(display), timeout: 10_000 });
  return display;
}

function stringArg(args, key, fallback = "") {
  const value = args?.[key];
  return typeof value === "string" ? value : fallback;
}

function numberArg(args, key, fallback = 0) {
  const value = args?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function boolArg(args, key, fallback = false) {
  const value = args?.[key];
  return typeof value === "boolean" ? value : fallback;
}

function safeRecordingName(label) {
  const base = (label || "desktop-recording")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "desktop-recording";
  return base + "-" + Date.now();
}

function safeTerminalTitle(value) {
  return (value || "Cloudcode Terminal")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\w .:-]+/g, "-")
    .trim()
    .slice(0, 80) || "Cloudcode Terminal";
}

function desktopTerminalCommand() {
  for (const candidate of ["xfce4-terminal", "x-terminal-emulator"]) {
    if (commandExists(candidate)) return candidate;
  }
  return "";
}

function desktopTerminalEnv(display) {
  return {
    ...process.env,
    CODEX_HOME: codexHome,
    DISPLAY: display,
    HOME: terminalHome,
    MISE_TRUSTED_CONFIG_PATHS: miseTrustedPaths,
    PATH: terminalPath,
    TAR_OPTIONS: process.env.TAR_OPTIONS || "--no-same-owner --no-same-permissions",
    TERM: "xterm-256color",
  };
}

function currentRunId() {
  try {
    if (!existsSync(runStatePath)) return undefined;
    const parsed = JSON.parse(readFileSync(runStatePath, "utf8"));
    const runId = typeof parsed?.runId === "string" ? parsed.runId.trim() : "";
    return runId || undefined;
  } catch {
    return undefined;
  }
}

function recordingWithSandbox(recording, options = {}) {
  if (!recording || typeof recording !== "object") return undefined;
  const id = typeof recording.id === "string" ? recording.id : undefined;
  if (!id) return undefined;
  const runId = typeof recording.runId === "string" ? recording.runId.trim() : "";
  const activeRunId = currentRunId();
  if (options.requireCurrentRun && activeRunId && runId !== activeRunId) {
    return undefined;
  }
  const resolvedRunId = runId || (options.tagCurrentRun ? activeRunId : undefined);
  return {
    ...recording,
    ...(resolvedRunId ? { runId: resolvedRunId } : {}),
    sandboxId: process.env.CLOUDCODE_DAYTONA_SANDBOX_ID,
  };
}

function readActiveRecording() {
  try {
    if (!existsSync(activeRecordingPath)) return undefined;
    return recordingWithSandbox(JSON.parse(readFileSync(activeRecordingPath, "utf8")), {
      requireCurrentRun: true,
    });
  } catch {
    return undefined;
  }
}

function rememberActiveRecording(recording) {
  const active = recordingWithSandbox(recording, { tagCurrentRun: true });
  if (!active) return undefined;
  writeFileSync(activeRecordingPath, JSON.stringify(active));
  return active;
}

function rememberCompletedRecording(recording) {
  const completed = recordingWithSandbox(recording, { tagCurrentRun: true });
  if (!completed) return undefined;
  const existing = readCompletedRecordings().filter(
    (entry) => entry.id !== completed.id
  );
  writeFileSync(completedRecordingPath, JSON.stringify([...existing, completed]));
  return completed;
}

function readCompletedRecordings() {
  try {
    if (!existsSync(completedRecordingPath)) return [];
    const parsed = JSON.parse(readFileSync(completedRecordingPath, "utf8"));
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    return entries.flatMap((entry) => {
      const recording = recordingWithSandbox(entry, {
        requireCurrentRun: true,
      });
      return recording?.id ? [recording] : [];
    });
  } catch {
    return [];
  }
}

function clearActiveRecording(id) {
  const active = readActiveRecording();
  if (id && active?.id && active.id !== id) return;
  try {
    unlinkSync(activeRecordingPath);
  } catch {
  }
}

async function startRecording(args) {
  await ensureDesktop();
  const label = safeRecordingName(stringArg(args, "label"));
  const recording = await cloudcodeDaytonaRecordingRequest("/computeruse/recordings/start", { label });
  return { ...recording, sandboxId: process.env.CLOUDCODE_DAYTONA_SANDBOX_ID };
}

async function stopRecording(args) {
  const active = readActiveRecording();
  const id = stringArg(args, "id") || stringArg(args, "recordingId") || active?.id;
  if (!id) throw new Error("recording id required");
  const remember = boolArg(args, "remember", true);
  const recording = await cloudcodeDaytonaRecordingRequest("/computeruse/recordings/stop", { id });
  clearActiveRecording(id);
  const stopped = { id, ...recording, sandboxId: process.env.CLOUDCODE_DAYTONA_SANDBOX_ID };
  return remember ? rememberCompletedRecording(stopped) : recordingWithSandbox(stopped, { tagCurrentRun: true });
}

async function openBrowser(args) {
  const display = await ensureDesktop();
  const url = stringArg(args, "url", "about:blank") || "about:blank";
  if (!commandExists(cloudcodeBrowserCommand)) {
    throw new Error("Cloudcode Browser is not installed at " + cloudcodeBrowserCommand + ".");
  }
  const logPath = join(stateDir, "browser.log");
  // Always expose the automation endpoint so the browser_* tools can attach to
  // the same headed browser instance later.
  const child = spawn(cloudcodeBrowserCommand, ["--remote-debugging-port=" + browserCdpPort, url], {
    detached: true,
    env: { ...process.env, DISPLAY: display },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let log = "";
  child.stderr.on("data", (chunk) => {
    log += chunk.toString();
    if (log.length > 20_000) log = log.slice(-20_000);
    writeFileSync(logPath, log);
  });
  child.unref();
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const windows = commandExists("wmctrl")
    ? await run("wmctrl", ["-l", "-G"], { env: desktopEnv(display) }).catch(() => "")
    : "";
  if (/chromium|chrome/i.test(windows) || child.exitCode === null) {
    return { browser: cloudcodeBrowserCommand, display, url, pid: child.pid, windows };
  }
  const savedLog = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  throw new Error((log || savedLog).trim() || "Browser did not open.");
}

async function openTerminal(args) {
  const display = await ensureDesktop();
  const terminal = desktopTerminalCommand();
  if (!terminal) {
    throw new Error("No desktop terminal is installed. Install xfce4-terminal or x-terminal-emulator.");
  }

  const cwd = (stringArg(args, "cwd", repoPath).trim() || repoPath);
  if (!existsSync(cwd)) throw new Error("Terminal working directory does not exist: " + cwd + ".");

  const command = stringArg(args, "command").trim();
  const title = safeTerminalTitle(stringArg(args, "title", command ? "Cloudcode Dev Server" : "Cloudcode Terminal"));
  const env = desktopTerminalEnv(display);
  const launchArgs = ["--working-directory", cwd, "--title", title];

  if (command) {
    const scriptPath = join(
      stateDir,
      "terminal-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".sh"
    );
    const script = [
      "#!/usr/bin/env bash",
      "cd " + shellQuote(cwd) + " || exit $?",
      "export CODEX_HOME=" + shellQuote(env.CODEX_HOME || ""),
      "export MISE_TRUSTED_CONFIG_PATHS=" + shellQuote(miseTrustedPaths),
      "export PATH=" + shellQuote(env.PATH || ""),
      "export TAR_OPTIONS=" + shellQuote(env.TAR_OPTIONS || "--no-same-owner --no-same-permissions"),
      "printf '%s\\n' " + shellQuote("$ " + command),
      "bash -lc " + shellQuote(command),
      "code=$?",
      "printf '\\nCommand exited with code %s. Press Ctrl-D or close the window when finished.\\n' \"$code\"",
      "exec bash -l",
      "",
    ].join("\n");
    writeFileSync(scriptPath, script, { mode: 0o700 });
    launchArgs.push("--command", "/bin/bash " + shellQuote(scriptPath));
  }

  const logPath = join(stateDir, "terminal.log");
  const child = spawn(terminal, launchArgs, {
    detached: true,
    env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let log = "";
  let spawnError = "";
  child.stderr.on("data", (chunk) => {
    log += chunk.toString();
    if (log.length > 20_000) log = log.slice(-20_000);
    writeFileSync(logPath, log);
  });
  child.on("error", (error) => {
    spawnError = error instanceof Error ? error.message : String(error);
  });
  child.unref();

  await new Promise((resolve) => setTimeout(resolve, 1_500));
  if (spawnError) throw new Error(spawnError);

  const windows = commandExists("wmctrl")
    ? await run("wmctrl", ["-l", "-G"], { env: desktopEnv(display) }).catch(() => "")
    : "";
  if (windows.includes(title) || /terminal/i.test(windows) || child.exitCode === null) {
    return { command: command || undefined, cwd, display, pid: child.pid, terminal, title, windows };
  }

  const savedLog = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  throw new Error((log || savedLog).trim() || "Terminal did not open.");
}

// ---------------------------------------------------------------------------
// Playwright-driven browser navigation.
//
// These tools attach Playwright over CDP to the headed Cloudcode Browser on
// the desktop display, so every action is a real, trusted input event on a
// visible page - the same thing a human does. Only user-level interactions are
// exposed: no evaluate, no network interception, no storage mutation.
// ---------------------------------------------------------------------------

const BROWSER_ACTION_TIMEOUT_MS = 10_000;
const BROWSER_SNAPSHOT_MAX_CHARS = 24_000;

function truncateText(value, max) {
  if (typeof value !== "string") return "";
  return value.length > max ? value.slice(0, max - 3) + "..." : value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cdpEndpointAlive() {
  try {
    const response = await fetch(
      "http://127.0.0.1:" + browserCdpPort + "/json/version",
      { signal: AbortSignal.timeout(1_500) }
    );
    return response.ok;
  } catch {
    return false;
  }
}

async function launchCdpBrowser(display) {
  if (!commandExists(cloudcodeBrowserCommand)) {
    throw new Error("Cloudcode Browser is not installed at " + cloudcodeBrowserCommand + ".");
  }
  // A Chromium instance launched without the debugging flag can never expose
  // it afterwards, so replace any instance already using the shared profile.
  await shell(
    "pkill -f -- " + shellQuote("--user-data-dir=" + browserProfileDir) + " >/dev/null 2>&1 || true",
    { timeout: 5_000 }
  ).catch(() => "");
  await sleep(500);
  const logPath = join(stateDir, "browser-cdp.log");
  const child = spawn(
    cloudcodeBrowserCommand,
    ["--remote-debugging-port=" + browserCdpPort, "about:blank"],
    {
      detached: true,
      env: { ...process.env, DISPLAY: display },
      stdio: ["ignore", "ignore", "pipe"],
    }
  );
  let log = "";
  child.stderr.on("data", (chunk) => {
    log += chunk.toString();
    if (log.length > 20_000) log = log.slice(-20_000);
    writeFileSync(logPath, log);
  });
  child.unref();
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await cdpEndpointAlive()) return;
    await sleep(300);
  }
  throw new Error(
    ("Cloudcode Browser did not expose its automation endpoint.\n" + log).trim()
  );
}

let browserSession = null;

async function connectBrowserSession() {
  if (browserSession?.browser?.isConnected()) return browserSession;
  const runtime = await resolveCloudcodePlaywrightRuntime({
    repoPath,
    runtimeRoot: playwrightRuntimeRoot,
  });
  const playwright = requireCloudcodePlaywrightCore(runtime);
  const browser = await playwright.chromium.connectOverCDP(
    "http://127.0.0.1:" + browserCdpPort,
    { timeout: 10_000 }
  );
  const context = browser.contexts()[0] ?? (await browser.newContext());
  browserSession = { browser, context, page: undefined };
  return browserSession;
}

async function browserPage() {
  const display = await ensureDesktop();
  if (!(await cdpEndpointAlive())) {
    browserSession = null;
    await launchCdpBrowser(display);
  }
  let session;
  try {
    session = await connectBrowserSession();
  } catch {
    browserSession = null;
    await launchCdpBrowser(display);
    session = await connectBrowserSession();
  }
  if (!session.page || session.page.isClosed()) {
    const pages = session.context.pages().filter((page) => !page.isClosed());
    session.page = pages.at(-1) ?? (await session.context.newPage());
  }
  await session.page.bringToFront().catch(() => undefined);
  return { display, page: session.page };
}

const browserTargetKeys = ["role", "label", "placeholder", "testId", "selector"];

function hasBrowserTarget(args, { allowText = true } = {}) {
  if (allowText && stringArg(args, "text").trim()) return true;
  return browserTargetKeys.some((key) => stringArg(args, key).trim());
}

function buildBrowserLocator(page, args, { allowText = true } = {}) {
  const exact = boolArg(args, "exact", false);
  const role = stringArg(args, "role").trim();
  const label = stringArg(args, "label").trim();
  const placeholder = stringArg(args, "placeholder").trim();
  const textValue = allowText ? stringArg(args, "text").trim() : "";
  const testId = stringArg(args, "testId").trim();
  const selector = stringArg(args, "selector").trim();
  let locator;
  if (role) {
    const name = stringArg(args, "name").trim();
    locator = page.getByRole(role, name ? { exact, name } : {});
  } else if (label) {
    locator = page.getByLabel(label, { exact });
  } else if (placeholder) {
    locator = page.getByPlaceholder(placeholder, { exact });
  } else if (textValue) {
    locator = page.getByText(textValue, { exact });
  } else if (testId) {
    locator = page.getByTestId(testId);
  } else if (selector) {
    locator = page.locator(selector);
  } else {
    throw new Error(
      "Target an element with role (plus name), label, placeholder, text, testId, or selector."
    );
  }
  const nth = args?.nth;
  if (typeof nth === "number" && Number.isFinite(nth)) {
    locator = locator.nth(Math.round(nth));
  }
  return locator;
}

function describeBrowserTarget(args) {
  const role = stringArg(args, "role").trim();
  const name = stringArg(args, "name").trim();
  if (role) return role + (name ? ' "' + name + '"' : "");
  for (const key of ["label", "placeholder", "text", "testId", "selector"]) {
    const value = stringArg(args, key).trim();
    if (value) return key + ' "' + value + '"';
  }
  return "element";
}

async function browserPageState(page) {
  let snapshot = "";
  try {
    snapshot = await page.locator("body").ariaSnapshot({ timeout: 5_000 });
  } catch {
  }
  const title = await page.title().catch(() => "");
  return {
    snapshot: truncateText(snapshot, BROWSER_SNAPSHOT_MAX_CHARS),
    title,
    url: page.url(),
  };
}

async function browserResult(message, page) {
  const state = await browserPageState(page);
  const parts = [
    message,
    "URL: " + state.url + (state.title ? " - " + state.title : ""),
  ];
  if (state.snapshot) {
    parts.push("Page snapshot (accessibility tree):\n" + state.snapshot);
  }
  return text(parts.join("\n\n"), { title: state.title, url: state.url });
}

async function settleAfterAction(page) {
  await page
    .waitForLoadState("domcontentloaded", { timeout: 5_000 })
    .catch(() => undefined);
}

async function callTool(name, args = {}) {
  const recorded = (result) => result;

  switch (name) {
    case "desktop_start": {
      const desktop = await ensureDesktopInfo();
      return recorded(text("Desktop ready on " + desktop.display + ".", desktop));
    }
    case "desktop_open_browser": {
      const browser = await openBrowser(args);
      return recorded(text("Browser opened on " + browser.display + ".", browser));
    }
    case "desktop_open_terminal": {
      const terminal = await openTerminal(args);
      return recorded(text("Terminal opened on " + terminal.display + ".", terminal));
    }
    case "desktop_screenshot": {
      const shot = await screenshotPngBase64(boolArg(args, "showCursor", true));
      return recorded({
        content: [
          { type: "text", text: "Screenshot captured from " + shot.display + "." },
          { type: "image", data: shot.base64, mimeType: "image/png" },
        ],
        structuredContent: { display: shot.display },
      });
    }
    case "desktop_click": {
      const x = Math.round(numberArg(args, "x"));
      const y = Math.round(numberArg(args, "y"));
      const button = stringArg(args, "button", "left");
      const clicks = boolArg(args, "double") ? 2 : 1;
      const buttonNumber = button === "right" ? "3" : button === "middle" ? "2" : "1";
      const display = await xdotool(["mousemove", String(x), String(y), "click", "--repeat", String(clicks), buttonNumber]);
      return recorded(text("Clicked " + x + ", " + y + " on " + display + ".", { display, x, y }));
    }
    case "desktop_move": {
      const x = Math.round(numberArg(args, "x"));
      const y = Math.round(numberArg(args, "y"));
      const display = await xdotool(["mousemove", String(x), String(y)]);
      return recorded(text("Moved pointer to " + x + ", " + y + " on " + display + ".", { display, x, y }));
    }
    case "desktop_type": {
      const value = stringArg(args, "text");
      const delay = Math.max(0, Math.round(numberArg(args, "delayMs", 8)));
      const display = await xdotool(["type", "--delay", String(delay), value]);
      return recorded(text("Typed " + value.length + " characters on " + display + ".", { display, length: value.length }));
    }
    case "desktop_key": {
      const key = stringArg(args, "key");
      if (!key) throw new Error("key required");
      const display = await xdotool(["key", key]);
      return recorded(text("Pressed " + key + " on " + display + ".", { display, key }));
    }
    case "desktop_hotkey": {
      const keys = stringArg(args, "keys");
      if (!keys) throw new Error("keys required");
      const display = await xdotool(["key", keys]);
      return recorded(text("Pressed " + keys + " on " + display + ".", { display, keys }));
    }
    case "desktop_scroll": {
      const direction = stringArg(args, "direction", "down");
      const amount = Math.max(1, Math.min(20, Math.round(numberArg(args, "amount", 4))));
      const button = direction === "up" ? "4" : direction === "left" ? "6" : direction === "right" ? "7" : "5";
      const display = await xdotool(["click", "--repeat", String(amount), button]);
      return recorded(text("Scrolled " + direction + " " + amount + " ticks on " + display + ".", { display, direction, amount }));
    }
    case "desktop_windows": {
      const display = await ensureDesktop();
      if (!commandExists("wmctrl")) return recorded(text("wmctrl is not installed.", { display, windows: [] }));
      const output = await run("wmctrl", ["-l", "-G"], { env: desktopEnv(display) });
      return recorded(text(output.trim() || "No windows found.", { display, output }));
    }
    case "desktop_record_start": {
      const replaceActive = boolArg(args, "replaceActive", false);
      const active = readActiveRecording();
      if (active?.id && replaceActive) {
        await stopRecording({ id: active.id, remember: false });
      }
      const recording =
        !replaceActive && active?.id
          ? active
          : rememberActiveRecording(await startRecording(args));
      if (!recording?.id) throw new Error("Unable to start Daytona desktop recording.");
      return text("Daytona recording active.", { id: recording.id, recording });
    }
    case "desktop_record_stop": {
      const recording = await stopRecording(args);
      return text("Daytona recording stopped.", { id: recording?.id, recording });
    }
    case "browser_open": {
      const { display, page } = await browserPage();
      const url = stringArg(args, "url").trim();
      if (url) {
        await page.goto(url, { timeout: 30_000, waitUntil: "domcontentloaded" });
        await page
          .waitForLoadState("load", { timeout: 10_000 })
          .catch(() => undefined);
      }
      return await browserResult(
        (url ? "Opened " + url : "Attached to the desktop browser") +
          " on " + display + ".",
        page
      );
    }
    case "browser_snapshot": {
      const { page } = await browserPage();
      return await browserResult("Current page state.", page);
    }
    case "browser_click": {
      const { page } = await browserPage();
      const locator = buildBrowserLocator(page, args);
      const button = stringArg(args, "button", "left");
      await locator.click({
        button: button === "right" ? "right" : button === "middle" ? "middle" : "left",
        clickCount: boolArg(args, "double") ? 2 : 1,
        timeout: BROWSER_ACTION_TIMEOUT_MS,
      });
      await settleAfterAction(page);
      return await browserResult("Clicked " + describeBrowserTarget(args) + ".", page);
    }
    case "browser_type": {
      const { page } = await browserPage();
      const value = stringArg(args, "text");
      if (!value) throw new Error("text required");
      if (hasBrowserTarget(args, { allowText: false })) {
        const locator = buildBrowserLocator(page, args, { allowText: false });
        await locator.click({ timeout: BROWSER_ACTION_TIMEOUT_MS });
        if (boolArg(args, "clear")) {
          await locator.press("ControlOrMeta+a", { timeout: BROWSER_ACTION_TIMEOUT_MS });
          await locator.press("Delete", { timeout: BROWSER_ACTION_TIMEOUT_MS });
        }
        await locator.pressSequentially(value, {
          delay: 25,
          timeout: Math.max(BROWSER_ACTION_TIMEOUT_MS, value.length * 50 + 5_000),
        });
      } else {
        await page.keyboard.type(value, { delay: 25 });
      }
      if (boolArg(args, "pressEnter")) {
        await page.keyboard.press("Enter");
        await settleAfterAction(page);
      }
      return await browserResult("Typed " + value.length + " characters.", page);
    }
    case "browser_press": {
      const { page } = await browserPage();
      const key = stringArg(args, "key").trim();
      if (!key) throw new Error("key required");
      await page.keyboard.press(key);
      await settleAfterAction(page);
      return await browserResult("Pressed " + key + ".", page);
    }
    case "browser_scroll": {
      const { page } = await browserPage();
      const direction = stringArg(args, "direction", "down");
      const amount = Math.max(1, Math.min(20, Math.round(numberArg(args, "amount", 4))));
      const delta = amount * 120;
      const dx = direction === "left" ? -delta : direction === "right" ? delta : 0;
      const dy = direction === "up" ? -delta : direction === "down" ? delta : 0;
      await page.mouse.wheel(dx, dy);
      return await browserResult(
        "Scrolled " + direction + " " + amount + " ticks.",
        page
      );
    }
    case "browser_back": {
      const { page } = await browserPage();
      await page.goBack({ timeout: 15_000, waitUntil: "domcontentloaded" });
      return await browserResult("Navigated back.", page);
    }
    case "browser_reload": {
      const { page } = await browserPage();
      await page.reload({ timeout: 30_000, waitUntil: "domcontentloaded" });
      return await browserResult("Reloaded the page.", page);
    }
    case "browser_wait_for": {
      const { page } = await browserPage();
      const value = stringArg(args, "text").trim();
      if (!value) throw new Error("text required");
      const timeout = Math.min(
        Math.max(Math.round(numberArg(args, "timeoutMs", 10_000)), 1_000),
        60_000
      );
      const hidden = boolArg(args, "hidden", false);
      await page
        .getByText(value)
        .first()
        .waitFor({ state: hidden ? "hidden" : "visible", timeout });
      return await browserResult(
        '"' + value + '" is now ' + (hidden ? "hidden" : "visible") + ".",
        page
      );
    }
    case "browser_screenshot": {
      const { page } = await browserPage();
      const buffer = await page.screenshot({ timeout: 10_000, type: "png" });
      const title = await page.title().catch(() => "");
      return {
        content: [
          {
            type: "text",
            text: "Browser page screenshot captured (" + page.url() + ").",
          },
          {
            type: "image",
            data: Buffer.from(buffer).toString("base64"),
            mimeType: "image/png",
          },
        ],
        structuredContent: { title, url: page.url() },
      };
    }
    default:
      throw new Error("Unknown desktop tool: " + name);
  }
}

const browserTargetProperties = {
  role: {
    type: "string",
    description: "ARIA role of the element, such as button, link, textbox, or checkbox. Combine with name.",
  },
  name: { type: "string", description: "Accessible name to match together with role." },
  label: { type: "string", description: "Match a form control by its label text." },
  placeholder: { type: "string", description: "Match an input by its placeholder text." },
  text: { type: "string", description: "Match an element by its visible text." },
  testId: { type: "string", description: "Match an element by data-testid." },
  selector: {
    type: "string",
    description: "CSS selector fallback when no accessible target works.",
  },
  exact: { type: "boolean", description: "Require an exact text/name match." },
  nth: { type: "number", description: "Zero-based index when several elements match." },
};

// browser_type uses "text" for the typed value, so it cannot target by text.
const { text: _browserTypeTextTarget, ...browserTypeTargetProperties } =
  browserTargetProperties;

const tools = [
  {
    name: "desktop_start",
    description: "Start or verify the sandbox desktop session.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "desktop_open_browser",
    description: "Open Cloudcode Browser at /usr/local/bin/cloudcode-browser to a URL.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
    },
  },
  {
    name: "desktop_open_terminal",
    description: "Open a visible desktop terminal, optionally running a shell command from the repository. Use this for long-running dev servers during desktop testing.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string" },
        title: { type: "string" },
      },
    },
  },
  {
    name: "desktop_screenshot",
    description: "Capture the current desktop as an image for visual inspection.",
    inputSchema: {
      type: "object",
      properties: { showCursor: { type: "boolean" } },
    },
  },
  {
    name: "desktop_click",
    description: "Click a desktop coordinate.",
    inputSchema: {
      type: "object",
      required: ["x", "y"],
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        button: { type: "string", enum: ["left", "middle", "right"] },
        double: { type: "boolean" },
      },
    },
  },
  {
    name: "desktop_move",
    description: "Move the pointer to a desktop coordinate.",
    inputSchema: {
      type: "object",
      required: ["x", "y"],
      properties: { x: { type: "number" }, y: { type: "number" } },
    },
  },
  {
    name: "desktop_type",
    description: "Type text into the active desktop application.",
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string" },
        delayMs: { type: "number" },
      },
    },
  },
  {
    name: "desktop_key",
    description: "Press a single key, such as enter, escape, tab, or ctrl+l.",
    inputSchema: {
      type: "object",
      required: ["key"],
      properties: { key: { type: "string" } },
    },
  },
  {
    name: "desktop_hotkey",
    description: "Press a key combination accepted by xdotool, such as ctrl+l or alt+tab.",
    inputSchema: {
      type: "object",
      required: ["keys"],
      properties: { keys: { type: "string" } },
    },
  },
  {
    name: "desktop_scroll",
    description: "Scroll the active desktop window.",
    inputSchema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down", "left", "right"] },
        amount: { type: "number" },
      },
    },
  },
  {
    name: "desktop_windows",
    description: "List visible desktop windows.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "desktop_record_start",
    description: "Start an explicit Daytona Computer Use recording, or return the active explicit recording. Pass replaceActive to discard any active recording first and start a fresh one.",
    inputSchema: {
      type: "object",
      properties: {
        label: { type: "string" },
        replaceActive: { type: "boolean" },
      },
    },
  },
  {
    name: "desktop_record_stop",
    description: "Stop the active Daytona Computer Use recording and return its video artifact.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        remember: { type: "boolean" },
      },
    },
  },
  {
    name: "browser_open",
    description:
      "Open the desktop browser (Playwright-driven, headed, visible on the desktop) and navigate to a URL like a user entering it in the address bar. This is the default way to verify UI changes in the running app. Returns the page URL, title, and accessibility snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to open; omit to attach to the current tab." },
      },
    },
  },
  {
    name: "browser_snapshot",
    description:
      "Read the current page state: URL, title, and an accessibility snapshot of the visible UI. Use the snapshot's roles and names to target browser_click and browser_type.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "browser_click",
    description:
      "Click a visible element in the desktop browser with a real mouse click, targeted by role+name, label, placeholder, text, testId, or selector.",
    inputSchema: {
      type: "object",
      properties: {
        ...browserTargetProperties,
        button: { type: "string", enum: ["left", "middle", "right"] },
        double: { type: "boolean" },
      },
    },
  },
  {
    name: "browser_type",
    description:
      "Type text with real key presses. With a target, the element is clicked first (optionally cleared); without one, typing goes to the focused element.",
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        ...browserTypeTargetProperties,
        text: { type: "string", description: "The text to type." },
        clear: { type: "boolean", description: "Select-all and delete before typing." },
        pressEnter: { type: "boolean", description: "Press Enter after typing." },
      },
    },
  },
  {
    name: "browser_press",
    description:
      "Press a key or combination in the desktop browser, such as Enter, Escape, Tab, or ControlOrMeta+a.",
    inputSchema: {
      type: "object",
      required: ["key"],
      properties: { key: { type: "string" } },
    },
  },
  {
    name: "browser_scroll",
    description: "Scroll the page with real mouse-wheel ticks.",
    inputSchema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down", "left", "right"] },
        amount: { type: "number", description: "Wheel ticks, 1-20 (default 4)." },
      },
    },
  },
  {
    name: "browser_back",
    description: "Navigate back in the desktop browser history, like the back button.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "browser_reload",
    description: "Reload the current page in the desktop browser.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "browser_wait_for",
    description:
      "Wait until the given text is visible (or hidden) on the page. Use for async UI instead of fixed sleeps.",
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string" },
        hidden: { type: "boolean" },
        timeoutMs: { type: "number" },
      },
    },
  },
  {
    name: "browser_screenshot",
    description:
      "Capture a screenshot of the current browser page. Only needed when visual appearance (layout, styling, rendering) is what you are verifying; functional outcomes are already covered by the snapshot each browser action returns.",
    inputSchema: { type: "object", properties: {} },
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
          serverInfo: { name: "cloudcode-desktop", version: "1.0.0" },
          instructions: "Tools for GUI and browser work in the Daytona sandbox desktop. The browser_* tools drive the headed desktop browser through Playwright with real, trusted input on visible elements, the way a user browses; the desktop_* tools control the desktop outside the browser. Read the cloudcode-computer-use skill before the first call and follow it exactly - it holds the verification rules (end-to-end flows, never fake state), the dev-server workflow (never assume one is running), and the efficient tool sequences (act on the returned page state instead of screenshotting, browser_wait_for for async UI).",
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
  if (!command) {
    console.log("Usage: cloudcode-computer <start|open-browser|terminal|screenshot|click|type|key|hotkey|scroll|windows|record-start|record-stop>");
    return;
  }
  const args = {};
  if (command === "click") {
    args.x = Number(rest[0]);
    args.y = Number(rest[1]);
    args.button = rest[2] || "left";
  } else if (command === "type") {
    args.text = rest.join(" ");
  } else if (command === "key" || command === "hotkey") {
    args[command === "key" ? "key" : "keys"] = rest[0];
  } else if (command === "scroll") {
    args.direction = rest[0] || "down";
    args.amount = Number(rest[1] || 4);
  } else if (command === "record-start") {
    const remaining = [];
    for (const part of rest) {
      if (part === "--fresh" || part === "--replace-active") {
        args.replaceActive = true;
      } else {
        remaining.push(part);
      }
    }
    args.label = remaining.join(" ");
  } else if (command === "record-stop") {
    const remaining = [];
    for (const part of rest) {
      if (part === "--forget") {
        args.remember = false;
      } else {
        remaining.push(part);
      }
    }
    args.id = remaining[0];
  } else if (command === "open-browser") {
    args.url = rest[0] || "about:blank";
  } else if (command === "terminal") {
    args.command = rest.join(" ");
  }
  const toolName = {
    start: "desktop_start",
    "open-browser": "desktop_open_browser",
    terminal: "desktop_open_terminal",
    screenshot: "desktop_screenshot",
    click: "desktop_click",
    type: "desktop_type",
    key: "desktop_key",
    hotkey: "desktop_hotkey",
    scroll: "desktop_scroll",
    windows: "desktop_windows",
    "record-start": "desktop_record_start",
    "record-stop": "desktop_record_stop",
  }[command];
  if (!toolName) throw new Error("Unknown command: " + command);
  const result = await callTool(toolName, args);
  const image = result.content?.find((item) => item.type === "image");
  if (image && command === "screenshot") {
    const path = join(stateDir, "screenshot-" + Date.now() + ".png");
    writeFileSync(path, Buffer.from(image.data, "base64"));
    console.log(path);
    return;
  }
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
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: error instanceof Error ? error.message : String(error) } });
    }
  });
}
`
}
