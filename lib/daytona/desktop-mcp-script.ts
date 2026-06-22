import { DESKTOP_BROWSER_COMMAND } from "@/lib/daytona/desktop-dependencies"
import {
  DESKTOP_AGENT_COMPLETED_RECORDING_STATE_FILE,
  DESKTOP_AGENT_RECORDING_STATE_FILE,
} from "@/lib/daytona/desktop-recordings"

export function desktopMcpServerScript() {
  return String.raw`#!/usr/bin/env node
import { execFile, execSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const repoPath = process.env.CLOUDCODE_REPO_PATH || process.cwd();
const miseTrustedPaths = process.env.MISE_TRUSTED_CONFIG_PATHS || repoPath;
const stateDir = process.env.CLOUDCODE_DESKTOP_STATE_DIR || join(homedir(), ".cache", "cloudcode-desktop");
const cloudcodeBrowserCommand = process.env.CLOUDCODE_BROWSER_COMMAND || ${JSON.stringify(DESKTOP_BROWSER_COMMAND)};
const terminalHome = process.env.CLOUDCODE_TERMINAL_HOME || homedir();
const terminalPath = process.env.CLOUDCODE_TERMINAL_PATH || process.env.PATH || "";
const codexHome = process.env.CODEX_HOME || join(terminalHome, ".codex");
const activeRecordingPath = join(stateDir, ${JSON.stringify(DESKTOP_AGENT_RECORDING_STATE_FILE)});
const completedRecordingPath = join(stateDir, ${JSON.stringify(DESKTOP_AGENT_COMPLETED_RECORDING_STATE_FILE)});
const autoRecordedToolNames = new Set([
  "desktop_start",
  "desktop_open_browser",
  "desktop_open_terminal",
  "desktop_screenshot",
  "desktop_click",
  "desktop_move",
  "desktop_type",
  "desktop_key",
  "desktop_hotkey",
  "desktop_scroll",
  "desktop_windows",
]);
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

function desktopEnv(display) {
  return { DISPLAY: display };
}

async function ensureDesktop() {
  const display = await activeDisplay();
  if (await displayWorks(display)) return display;

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
  return display;
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

function daytonaToolboxBaseUrl() {
  const rawBaseUrl = process.env.CLOUDCODE_DAYTONA_TOOLBOX_BASE_URL;
  const sandboxId = process.env.CLOUDCODE_DAYTONA_SANDBOX_ID;
  const authKey = process.env.CLOUDCODE_DAYTONA_TOOLBOX_AUTH_KEY;
  if (!rawBaseUrl || !sandboxId || !authKey) {
    throw new Error("Daytona recording is unavailable because toolbox context is missing.");
  }
  const baseUrl = rawBaseUrl.endsWith("/") ? rawBaseUrl.slice(0, -1) : rawBaseUrl;
  const sandboxBaseUrl = baseUrl.endsWith("/" + sandboxId) ? baseUrl : baseUrl + "/" + sandboxId;
  return sandboxBaseUrl + "?DAYTONA_SANDBOX_AUTH_KEY=" + encodeURIComponent(authKey);
}

async function daytonaRecordingRequest(path, body) {
  const baseUrl = daytonaToolboxBaseUrl();
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
    const message = data?.message || data?.error || textBody || "Daytona recording request failed.";
    throw new Error(message);
  }
  return data;
}

function recordingWithSandbox(recording) {
  if (!recording || typeof recording !== "object") return undefined;
  const id = typeof recording.id === "string" ? recording.id : undefined;
  if (!id) return undefined;
  return { ...recording, sandboxId: process.env.CLOUDCODE_DAYTONA_SANDBOX_ID };
}

function readActiveRecording() {
  try {
    if (!existsSync(activeRecordingPath)) return undefined;
    return recordingWithSandbox(JSON.parse(readFileSync(activeRecordingPath, "utf8")));
  } catch {
    return undefined;
  }
}

function rememberActiveRecording(recording) {
  const active = recordingWithSandbox(recording);
  if (!active) return undefined;
  writeFileSync(activeRecordingPath, JSON.stringify(active));
  return active;
}

function rememberCompletedRecording(recording) {
  const completed = recordingWithSandbox(recording);
  if (!completed) return undefined;
  writeFileSync(completedRecordingPath, JSON.stringify(completed));
  return completed;
}

function clearActiveRecording(id) {
  const active = readActiveRecording();
  if (id && active?.id && active.id !== id) return;
  try {
    unlinkSync(activeRecordingPath);
  } catch {
  }
}

async function ensureAutomaticRecording(toolName) {
  const active = readActiveRecording();
  if (active?.id) return active;
  const label = "agent-" + toolName.replace(/^desktop_/, "").replace(/_/g, "-");
  const recording = rememberActiveRecording(await startRecording({ label }));
  if (!recording?.id) throw new Error("Unable to start automatic Daytona desktop recording.");
  return recording;
}

async function startRecording(args) {
  await ensureDesktop();
  const label = safeRecordingName(stringArg(args, "label"));
  const recording = await daytonaRecordingRequest("/computeruse/recordings/start", { label });
  return { ...recording, sandboxId: process.env.CLOUDCODE_DAYTONA_SANDBOX_ID };
}

async function stopRecording(args) {
  const active = readActiveRecording();
  const id = stringArg(args, "id") || stringArg(args, "recordingId") || active?.id;
  if (!id) throw new Error("recording id required");
  const recording = await daytonaRecordingRequest("/computeruse/recordings/stop", { id });
  clearActiveRecording(id);
  return rememberCompletedRecording({ id, ...recording, sandboxId: process.env.CLOUDCODE_DAYTONA_SANDBOX_ID });
}

async function openBrowser(args) {
  const display = await ensureDesktop();
  const url = stringArg(args, "url", "about:blank") || "about:blank";
  if (!commandExists(cloudcodeBrowserCommand)) {
    throw new Error("Cloudcode Browser is not installed at " + cloudcodeBrowserCommand + ".");
  }
  const logPath = join(stateDir, "browser.log");
  const child = spawn(cloudcodeBrowserCommand, [url], {
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

async function callTool(name, args = {}) {
  if (autoRecordedToolNames.has(name)) {
    await ensureAutomaticRecording(name);
  }
  const recorded = (result) => result;

  switch (name) {
    case "desktop_start": {
      const display = await ensureDesktop();
      return recorded(text("Desktop ready on " + display + ".", { display }));
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
      const recording =
        readActiveRecording() ?? rememberActiveRecording(await startRecording(args));
      if (!recording?.id) throw new Error("Unable to start Daytona desktop recording.");
      return text("Daytona recording active.", { id: recording.id });
    }
    case "desktop_record_stop": {
      const recording = await stopRecording(args);
      return text("Daytona recording stopped.", { id: recording?.id });
    }
    default:
      throw new Error("Unknown desktop tool: " + name);
  }
}

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
    description: "Return the active Daytona Computer Use recording; one starts automatically before desktop actions.",
    inputSchema: {
      type: "object",
      properties: { label: { type: "string" } },
    },
  },
  {
    name: "desktop_record_stop",
    description: "Stop the active Daytona Computer Use recording and return its video artifact.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
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
          serverInfo: { name: "cloudcode-desktop", version: "1.0.0" },
          instructions: "Use these tools for visual desktop work in the Daytona sandbox. Open URLs only with desktop_open_browser, which launches Cloudcode Browser at /usr/local/bin/cloudcode-browser. Use desktop_open_terminal for long-running dev servers, watchers, and other processes needed during desktop testing. Desktop actions automatically start a Daytona recording; Cloudcode stops it after the run. Start with desktop_start, inspect with desktop_screenshot, then act with click/type/key tools. Take another screenshot after each meaningful action. For UI verification, never bypass visible controls with javascript: URLs, direct DOM mutation, localStorage edits, console commands, injected scripts, or headless assertions unless the user explicitly asks. Confirm local app pages actually loaded in the browser screenshot before reporting verification; browser errors, blank pages, stale tabs, unavailable screenshots, or unreadable screenshots mean the behavior is unverified.",
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
    args.label = rest.join(" ");
  } else if (command === "record-stop") {
    args.id = rest[0];
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
