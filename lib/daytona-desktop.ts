import { randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Sandbox } from "@daytona/sdk"

import {
  getStartedDaytonaSandbox,
  runDaytonaCommand,
  shellQuote,
  type DaytonaSandboxPaths,
} from "./daytona-sandbox"

const DAYTONA_DESKTOP_PORT = 6080
const DESKTOP_PREVIEW_TTL_SECONDS = 60 * 60
const DESKTOP_TOOL_VERSION = "5"
const DESKTOP_DEPENDENCY_TIMEOUT_MS = 10 * 60 * 1000
const DESKTOP_BROWSER_URL = "about:blank"
const DESKTOP_BROWSER_COMMAND = "/usr/local/bin/cloudcode-browser"
const DESKTOP_AGENT_RECORDING_STATE_FILE = "active-recording.json"
const DESKTOP_BROWSER_LAUNCHER = `#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
  set -- about:blank
fi

browser=""
for candidate in chromium chromium-browser google-chrome google-chrome-stable; do
  if command -v "$candidate" >/dev/null 2>&1; then
    browser="$(command -v "$candidate")"
    break
  fi
done

if [ -z "$browser" ]; then
  echo "Cloudcode Browser requires a Chromium-family browser." >&2
  exit 1
fi

profile="\${CLOUDCODE_BROWSER_PROFILE:-\${HOME:-/tmp}/.cache/cloudcode-chromium}"
mkdir -p "$profile"
exec "$browser" \\
  --no-sandbox \\
  --test-type \\
  --disable-dev-shm-usage \\
  --no-first-run \\
  --no-default-browser-check \\
  --password-store=basic \\
  --user-data-dir="$profile" \\
  "$@"
`
const DESKTOP_BROWSER_DESKTOP_ENTRY = `[Desktop Entry]
Version=1.0
Type=Application
Name=Cloudcode Browser
GenericName=Web Browser
Comment=Open the Daytona desktop browser
Exec=/usr/local/bin/cloudcode-browser %U
Terminal=false
Icon=chromium
Categories=Network;WebBrowser;
MimeType=x-scheme-handler/http;x-scheme-handler/https;text/html;
StartupNotify=true
`
const DESKTOP_BROWSER_XFCE_HELPER = `[Desktop Entry]
NoDisplay=true
Version=1.0
Type=X-XFCE-Helper
Name=Cloudcode Browser
X-XFCE-Category=WebBrowser
X-XFCE-Commands=/usr/local/bin/cloudcode-browser
X-XFCE-CommandsWithParameter=/usr/local/bin/cloudcode-browser "%s"
`
const DAYTONA_DESKTOP_PACKAGES = [
  "chromium",
  "dbus-x11",
  "libx11-6",
  "libxext6",
  "libxfixes3",
  "libxi6",
  "libxrandr2",
  "libxrender1",
  "libxss1",
  "libxtst6",
  "net-tools",
  "novnc",
  "websockify",
  "x11vnc",
  "xdg-utils",
  "xfce4",
  "xfce4-terminal",
  "xvfb",
]
const DAYTONA_DESKTOP_COMMANDS = [
  "Xvfb",
  "cloudcode-browser",
  "startxfce4",
  "websockify",
  "x11vnc",
  "xdg-open",
  "novnc_proxy",
]

export type DaytonaDesktopStatus = {
  previewUrl: string | null
  status: string
}

type RecordingLabelInput = {
  label?: string
}

type RecordingStopInput = {
  recordingId: string
}

export type DaytonaDesktopRecordingArtifact = {
  fileName?: string
  filePath?: string
  id: string
  sandboxId?: string
  status?: string
}

function cleanRecordingLabel(value?: string) {
  const normalized = value?.trim()
  if (!normalized) return undefined
  return normalized.replace(/[^\w .:-]+/g, "-").slice(0, 80)
}

function desktopAgentRecordingStatePath(paths: DaytonaSandboxPaths) {
  return `${paths.codexHome}/desktop/state/${DESKTOP_AGENT_RECORDING_STATE_FILE}`
}

function recordingArtifact(
  value: unknown,
  sandboxId: string,
  fallbackId?: string
): DaytonaDesktopRecordingArtifact | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallbackId ? { id: fallbackId, sandboxId } : undefined
  }

  const record = value as Record<string, unknown>
  const id =
    typeof record.id === "string" && record.id.trim()
      ? record.id.trim()
      : fallbackId
  if (!id) return undefined

  return {
    fileName: typeof record.fileName === "string" ? record.fileName : undefined,
    filePath: typeof record.filePath === "string" ? record.filePath : undefined,
    id,
    sandboxId:
      typeof record.sandboxId === "string" ? record.sandboxId : sandboxId,
    status: typeof record.status === "string" ? record.status : undefined,
  }
}

async function clearDesktopAgentRecordingState(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  signal?: AbortSignal
) {
  await runDaytonaCommand(
    sandbox,
    `rm -f ${shellQuote(desktopAgentRecordingStatePath(paths))}`,
    { signal, timeoutMs: 10_000 }
  ).catch(() => undefined)
}

export async function stopDaytonaDesktopAgentRecording(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  signal?: AbortSignal
) {
  const statePath = desktopAgentRecordingStatePath(paths)
  const activeResult = await runDaytonaCommand(
    sandbox,
    `[ -s ${shellQuote(statePath)} ] && cat ${shellQuote(statePath)} || true`,
    { signal, timeoutMs: 10_000 }
  )

  if (activeResult.exitCode !== 0 || !activeResult.stdout.trim()) {
    return undefined
  }

  let active: DaytonaDesktopRecordingArtifact | undefined
  try {
    active = recordingArtifact(JSON.parse(activeResult.stdout), sandbox.id)
  } catch {
    await clearDesktopAgentRecordingState(sandbox, paths, signal)
    return undefined
  }

  if (!active?.id) {
    await clearDesktopAgentRecordingState(sandbox, paths, signal)
    return undefined
  }

  const stopped = await sandbox.computerUse.recording.stop(active.id)
  await clearDesktopAgentRecordingState(sandbox, paths, signal)
  return (
    recordingArtifact(stopped, sandbox.id, active.id) ?? {
      ...active,
      sandboxId: sandbox.id,
      status: "completed",
    }
  )
}

async function safeDesktopPreviewUrl(sandbox: Sandbox) {
  try {
    const signed = await sandbox.getSignedPreviewUrl(
      DAYTONA_DESKTOP_PORT,
      DESKTOP_PREVIEW_TTL_SECONDS
    )
    return signed.url
  } catch {
    return null
  }
}

async function readComputerUseStatus(sandbox: Sandbox) {
  try {
    const status = await sandbox.computerUse.getStatus()
    return status.status || "unknown"
  } catch (error) {
    return error instanceof Error ? error.message : "unknown"
  }
}

function desktopDependencyCommand() {
  const packages = DAYTONA_DESKTOP_PACKAGES.map(shellQuote).join(" ")
  const commands = DAYTONA_DESKTOP_COMMANDS.map(shellQuote).join(" ")
  const browserLauncher = Buffer.from(
    DESKTOP_BROWSER_LAUNCHER,
    "utf8"
  ).toString("base64")
  const browserDesktopEntry = Buffer.from(
    DESKTOP_BROWSER_DESKTOP_ENTRY,
    "utf8"
  ).toString("base64")
  const browserXfceHelper = Buffer.from(
    DESKTOP_BROWSER_XFCE_HELPER,
    "utf8"
  ).toString("base64")

  return [
    "set -e",
    "missing_commands() {",
    '  for command_name in "$@"; do',
    '    command -v "$command_name" >/dev/null 2>&1 || printf \'%s\\n\' "$command_name"',
    "  done",
    "  [ -d /usr/share/novnc ] || printf '%s\\n' /usr/share/novnc",
    "}",
    "install_novnc_proxy() {",
    "  command -v novnc_proxy >/dev/null 2>&1 && return 0",
    "  for novnc_proxy_source in /usr/share/novnc/utils/novnc_proxy /usr/share/novnc/utils/launch.sh; do",
    '    [ -f "$novnc_proxy_source" ] || continue',
    '    if [ "$(id -u)" = "0" ]; then',
    '      chmod +x "$novnc_proxy_source"',
    '      ln -sf "$novnc_proxy_source" /usr/local/bin/novnc_proxy',
    "    elif command -v sudo >/dev/null 2>&1; then",
    '      sudo chmod +x "$novnc_proxy_source"',
    '      sudo ln -sf "$novnc_proxy_source" /usr/local/bin/novnc_proxy',
    "    fi",
    "    return 0",
    "  done",
    "}",
    "install_root_file() {",
    '  file_path="$1"',
    '  file_mode="$2"',
    '  file_content="$3"',
    '  file_dir="$(dirname "$file_path")"',
    '  if [ "$(id -u)" = "0" ]; then',
    '    mkdir -p "$file_dir"',
    '    printf "%s" "$file_content" | base64 -d > "$file_path"',
    '    chmod "$file_mode" "$file_path"',
    "  elif command -v sudo >/dev/null 2>&1; then",
    '    sudo mkdir -p "$file_dir"',
    '    printf "%s" "$file_content" | base64 -d | sudo tee "$file_path" >/dev/null',
    '    sudo chmod "$file_mode" "$file_path"',
    "  fi",
    "}",
    "install_user_file() {",
    '  file_path="$1"',
    '  file_mode="$2"',
    '  file_content="$3"',
    '  file_dir="$(dirname "$file_path")"',
    '  mkdir -p "$file_dir"',
    '  printf "%s" "$file_content" | base64 -d > "$file_path"',
    '  chmod "$file_mode" "$file_path"',
    "}",
    "install_browser_launcher() {",
    '  browser_bin=""',
    "  for browser_candidate in chromium chromium-browser google-chrome google-chrome-stable; do",
    '    if command -v "$browser_candidate" >/dev/null 2>&1; then',
    '      browser_bin="$(command -v "$browser_candidate")"',
    "      break",
    "    fi",
    "  done",
    '  [ -n "$browser_bin" ] || return 0',
    `  install_root_file /usr/local/bin/cloudcode-browser 755 ${shellQuote(browserLauncher)}`,
    `  install_root_file /usr/local/share/applications/cloudcode-browser.desktop 644 ${shellQuote(browserDesktopEntry)}`,
    `  install_user_file "\${HOME:-/root}/.local/share/xfce4/helpers/cloudcode-browser.desktop" 644 ${shellQuote(browserXfceHelper)}`,
    '  helpers_rc="${HOME:-/root}/.config/xfce4/helpers.rc"',
    '  mkdir -p "$(dirname "$helpers_rc")"',
    '  if [ -f "$helpers_rc" ]; then',
    '    grep -v "^WebBrowser=" "$helpers_rc" > "$helpers_rc.tmp" || true',
    "  else",
    '    : > "$helpers_rc.tmp"',
    "  fi",
    '  printf "%s\\n" "WebBrowser=cloudcode-browser" >> "$helpers_rc.tmp"',
    '  mv "$helpers_rc.tmp" "$helpers_rc"',
    "  if command -v update-alternatives >/dev/null 2>&1; then",
    '    if [ "$(id -u)" = "0" ]; then',
    "      update-alternatives --install /usr/bin/x-www-browser x-www-browser /usr/local/bin/cloudcode-browser 200 >/dev/null 2>&1 || true",
    "      update-alternatives --install /usr/bin/gnome-www-browser gnome-www-browser /usr/local/bin/cloudcode-browser 200 >/dev/null 2>&1 || true",
    "    elif command -v sudo >/dev/null 2>&1; then",
    "      sudo update-alternatives --install /usr/bin/x-www-browser x-www-browser /usr/local/bin/cloudcode-browser 200 >/dev/null 2>&1 || true",
    "      sudo update-alternatives --install /usr/bin/gnome-www-browser gnome-www-browser /usr/local/bin/cloudcode-browser 200 >/dev/null 2>&1 || true",
    "    fi",
    "  fi",
    "}",
    "install_novnc_proxy",
    "install_browser_launcher",
    `missing="$(missing_commands ${commands})"`,
    '[ -z "$missing" ] && exit 0',
    "if ! command -v apt-get >/dev/null 2>&1; then",
    '  printf "Missing Daytona desktop dependencies and apt-get is unavailable: %s\\n" "$missing" >&2',
    "  exit 1",
    "fi",
    'prefix=""',
    'if [ "$(id -u)" != "0" ]; then',
    "  if ! command -v sudo >/dev/null 2>&1; then",
    '    printf "Missing Daytona desktop dependencies and sudo is unavailable: %s\\n" "$missing" >&2',
    "    exit 1",
    "  fi",
    '  prefix="sudo"',
    "fi",
    "$prefix env DEBIAN_FRONTEND=noninteractive apt-get update -qq",
    `$prefix env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ${packages}`,
    "install_novnc_proxy",
    "install_browser_launcher",
    `missing="$(missing_commands ${commands})"`,
    'if [ -n "$missing" ]; then',
    '  printf "Daytona desktop dependencies are still missing after install: %s\\n" "$missing" >&2',
    "  exit 1",
    "fi",
  ].join("\n")
}

export async function ensureDaytonaDesktopDependencies(
  sandbox: Sandbox,
  signal?: AbortSignal
) {
  const result = await runDaytonaCommand(sandbox, desktopDependencyCommand(), {
    signal,
    timeoutMs: DESKTOP_DEPENDENCY_TIMEOUT_MS,
  })

  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        "Unable to prepare Daytona desktop dependencies."
    )
  }
}

export async function readDaytonaDesktopStatus(
  sandboxId: string
): Promise<DaytonaDesktopStatus> {
  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  const [previewUrl, status] = await Promise.all([
    safeDesktopPreviewUrl(sandbox),
    readComputerUseStatus(sandbox),
  ])

  return { previewUrl, status }
}

export async function startDaytonaDesktop(sandboxId: string) {
  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  await ensureDaytonaDesktopDependencies(sandbox)
  const start = await sandbox.computerUse.start()
  const [previewUrl, status] = await Promise.all([
    safeDesktopPreviewUrl(sandbox),
    readComputerUseStatus(sandbox),
  ])

  return {
    message: start.message ?? "Desktop started.",
    previewUrl,
    processes: start.status ?? {},
    status,
  }
}

export async function openDaytonaDesktopBrowser(
  sandboxId: string,
  url = DESKTOP_BROWSER_URL
) {
  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  await ensureDaytonaDesktopDependencies(sandbox)
  await sandbox.computerUse.start()

  const target = url.trim() || DESKTOP_BROWSER_URL
  const result = await runDaytonaCommand(
    sandbox,
    [
      "set -e",
      'export DISPLAY="${DISPLAY:-:0}"',
      `browser_command=${shellQuote(DESKTOP_BROWSER_COMMAND)}`,
      '[ -x "$browser_command" ] || { printf "Cloudcode Browser is not installed at %s.\\n" "$browser_command" >&2; exit 1; }',
      "mkdir -p /tmp/cloudcode-browser",
      "browser_log=/tmp/cloudcode-browser/latest.log",
      `nohup "$browser_command" ${shellQuote(target)} > "$browser_log" 2>&1 &`,
      "sleep 2",
      "if command -v wmctrl >/dev/null 2>&1 && wmctrl -l | grep -Eiq 'chromium|chrome'; then exit 0; fi",
      "if pgrep -fa 'chromium|chrome' >/dev/null 2>&1; then exit 0; fi",
      'cat "$browser_log" >&2',
      "exit 1",
    ].join("\n"),
    { timeoutMs: 10_000 }
  )

  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        "Unable to open Daytona desktop browser."
    )
  }

  const [previewUrl, status] = await Promise.all([
    safeDesktopPreviewUrl(sandbox),
    readComputerUseStatus(sandbox),
  ])

  return {
    message: "Browser opened.",
    previewUrl,
    status,
  }
}

export async function stopDaytonaDesktop(sandboxId: string) {
  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  return await sandbox.computerUse.stop()
}

export async function takeDaytonaDesktopScreenshot(sandboxId: string) {
  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  await ensureDaytonaDesktopDependencies(sandbox)
  await sandbox.computerUse.start()
  return await sandbox.computerUse.screenshot.takeCompressed({
    format: "png",
    showCursor: true,
  })
}

export async function listDaytonaDesktopRecordings(sandboxId: string) {
  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  return await sandbox.computerUse.recording.list()
}

export async function startDaytonaDesktopRecording(
  sandboxId: string,
  input: RecordingLabelInput = {}
) {
  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  await ensureDaytonaDesktopDependencies(sandbox)
  await sandbox.computerUse.start()
  return await sandbox.computerUse.recording.start(
    cleanRecordingLabel(input.label)
  )
}

export async function stopDaytonaDesktopRecording(
  sandboxId: string,
  input: RecordingStopInput
) {
  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  return await sandbox.computerUse.recording.stop(input.recordingId)
}

export async function downloadDaytonaDesktopRecording(
  sandboxId: string,
  recordingId: string
) {
  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  const dir = await mkdtemp(join(tmpdir(), "cloudcode-recording-"))
  const filePath = join(dir, `${randomUUID()}.mp4`)

  try {
    const recording = await sandbox.computerUse.recording.get(recordingId)
    await sandbox.computerUse.recording.download(recordingId, filePath)
    return {
      bytes: await readFile(filePath),
      fileName: recording.fileName || `${recordingId}.mp4`,
    }
  } finally {
    await rm(dir, { force: true, recursive: true }).catch(() => undefined)
  }
}

function base64FileCommand(path: string, content: string) {
  const encoded = Buffer.from(content, "utf8").toString("base64")
  return `printf '%s' ${shellQuote(encoded)} | base64 -d > ${shellQuote(path)}`
}

function desktopMcpServerScript() {
  return String.raw`#!/usr/bin/env node
import { execFile, execSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const repoPath = process.env.CLOUDCODE_REPO_PATH || process.cwd();
const stateDir = process.env.CLOUDCODE_DESKTOP_STATE_DIR || join(homedir(), ".cache", "cloudcode-desktop");
const cloudcodeBrowserCommand = process.env.CLOUDCODE_BROWSER_COMMAND || ${JSON.stringify(DESKTOP_BROWSER_COMMAND)};
const activeRecordingPath = join(stateDir, ${JSON.stringify(DESKTOP_AGENT_RECORDING_STATE_FILE)});
const autoRecordedToolNames = new Set([
  "desktop_start",
  "desktop_open_browser",
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

function withRecording(result, recording) {
  if (!recording?.id) return result;
  return {
    ...result,
    structuredContent: {
      ...(result.structuredContent ?? {}),
      recording,
    },
  };
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
  return { ...recording, sandboxId: process.env.CLOUDCODE_DAYTONA_SANDBOX_ID };
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

async function callTool(name, args = {}) {
  const automaticRecording = autoRecordedToolNames.has(name)
    ? await ensureAutomaticRecording(name)
    : undefined;
  const recorded = (result) => withRecording(result, automaticRecording);

  switch (name) {
    case "desktop_start": {
      const display = await ensureDesktop();
      return recorded(text("Desktop ready on " + display + ".", { display }));
    }
    case "desktop_open_browser": {
      const browser = await openBrowser(args);
      return recorded(text("Browser opened on " + browser.display + ".", browser));
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
      const location = recording.filePath || recording.fileName || recording.id;
      return text("Daytona recording " + recording.id + " active at " + location + ".", recording);
    }
    case "desktop_record_stop": {
      const recording = await stopRecording(args);
      const location = recording.filePath || recording.fileName || recording.id;
      return text("Daytona recording " + recording.id + " stopped at " + location + ".", recording);
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
          instructions: "Use these tools for visual desktop work in the Daytona sandbox. Open URLs only with desktop_open_browser, which launches Cloudcode Browser at /usr/local/bin/cloudcode-browser. Desktop actions automatically start a Daytona recording; Cloudcode stops it after the run. Start with desktop_start, inspect with desktop_screenshot, then act with click/type/key tools. Take another screenshot after each meaningful action.",
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
    console.log("Usage: cloudcode-computer <start|open-browser|screenshot|click|type|key|hotkey|scroll|windows|record-start|record-stop>");
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
  }
  const toolName = {
    start: "desktop_start",
    "open-browser": "desktop_open_browser",
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

function desktopAgentInstructions() {
  return [
    "# Cloudcode Daytona Desktop",
    "",
    "A graphical Daytona desktop may be available in this sandbox.",
    "",
    "Use the `cloudcode_desktop` MCP tools for GUI tasks:",
    "- `desktop_start` starts or verifies the desktop.",
    "- `desktop_open_browser` opens Cloudcode Browser at `/usr/local/bin/cloudcode-browser` to a URL.",
    "- `desktop_screenshot` returns an image of the current desktop.",
    "- `desktop_click`, `desktop_type`, `desktop_key`, `desktop_hotkey`, and `desktop_scroll` control the desktop.",
    "- Daytona Computer Use recording starts automatically before desktop actions and Cloudcode stops it after the run.",
    "- `desktop_record_start` returns the active recording, and `desktop_record_stop` stops it early when an intermediate video is needed.",
    "",
    "Do not open `chromium`, `chromium-browser`, `google-chrome`, `google-chrome-stable`, `firefox`, `x-www-browser`, or `xdg-open` directly. For browser work, use `desktop_open_browser`; if a shell fallback is unavoidable, run `/usr/local/bin/cloudcode-browser` directly.",
    "",
    "For visual work, use this loop: start the desktop, take a screenshot, act, take another screenshot, and repeat until the UI state is verified.",
    "",
    "A shell fallback is also available as `cloudcode-computer`, but prefer the MCP tools because screenshots are returned as inspectable images.",
  ].join("\n")
}

export function daytonaDesktopAgentContext() {
  return [
    "Cloudcode may provide a Daytona desktop for GUI/browser work.",
    "When a task needs visual interaction, use the `cloudcode_desktop` MCP tools: start with `desktop_start`, open Cloudcode Browser with `desktop_open_browser` when needed, inspect with `desktop_screenshot`, act with click/type/key/scroll tools, then take another screenshot to verify the state.",
    "Do not launch `chromium`, `chromium-browser`, `google-chrome`, `google-chrome-stable`, `firefox`, `x-www-browser`, or `xdg-open` directly; `desktop_open_browser` uses `/usr/local/bin/cloudcode-browser`.",
    "Daytona Computer Use recording starts automatically before desktop actions and Cloudcode stops it after the run; use `desktop_record_stop` only when an intermediate video artifact is needed before the run ends.",
  ].join("\n")
}

function desktopCodexConfig(
  paths: Pick<DaytonaSandboxPaths, "codexHome" | "repoPath">,
  sandbox: Pick<Sandbox, "id" | "toolboxProxyUrl">,
  toolboxAuthKey: string
) {
  return [
    "[mcp_servers.cloudcode_desktop]",
    `command = ${JSON.stringify(`${paths.codexHome}/desktop/cloudcode-desktop-mcp.mjs`)}`,
    "startup_timeout_sec = 20",
    "",
    "[mcp_servers.cloudcode_desktop.env]",
    `CLOUDCODE_REPO_PATH = ${JSON.stringify(paths.repoPath)}`,
    `CLOUDCODE_DESKTOP_STATE_DIR = ${JSON.stringify(`${paths.codexHome}/desktop/state`)}`,
    `CLOUDCODE_BROWSER_COMMAND = ${JSON.stringify(DESKTOP_BROWSER_COMMAND)}`,
    `CLOUDCODE_DAYTONA_SANDBOX_ID = ${JSON.stringify(sandbox.id)}`,
    `CLOUDCODE_DAYTONA_TOOLBOX_AUTH_KEY = ${JSON.stringify(toolboxAuthKey)}`,
    `CLOUDCODE_DAYTONA_TOOLBOX_BASE_URL = ${JSON.stringify(sandbox.toolboxProxyUrl)}`,
    'CLOUDCODE_DESKTOP_DISPLAY = ":0"',
    "",
  ].join("\n")
}

export async function installDaytonaDesktopTools(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  signal?: AbortSignal
) {
  await ensureDaytonaDesktopDependencies(sandbox, signal)

  const script = desktopMcpServerScript()
  const instructions = desktopAgentInstructions()
  const toolboxPreview = await sandbox.getPreviewLink(1)
  const config = desktopCodexConfig(paths, sandbox, toolboxPreview.token)
  const scriptPath = `${paths.codexHome}/desktop/cloudcode-desktop-mcp.mjs`
  const binPath = `${paths.home}/.local/bin/cloudcode-computer`
  const agentsPath = `${paths.codexHome}/AGENTS.md`
  const configPath = `${paths.codexHome}/config.toml`
  const markerPath = `${paths.codexHome}/desktop/tool-version`

  const result = await runDaytonaCommand(
    sandbox,
    [
      "set -e",
      `mkdir -p ${shellQuote(`${paths.codexHome}/desktop/state`)} ${shellQuote(`${paths.home}/.local/bin`)}`,
      base64FileCommand(scriptPath, script),
      base64FileCommand(agentsPath, instructions),
      base64FileCommand(configPath, config),
      `ln -sf ${shellQuote(scriptPath)} ${shellQuote(binPath)}`,
      `chmod +x ${shellQuote(scriptPath)} ${shellQuote(binPath)}`,
      `printf '%s\\n' ${shellQuote(DESKTOP_TOOL_VERSION)} > ${shellQuote(markerPath)}`,
    ].join("\n"),
    { signal, timeoutMs: 10_000 }
  )

  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        "Unable to install Daytona desktop tools."
    )
  }
}
