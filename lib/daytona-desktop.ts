import { createHash, randomUUID } from "node:crypto"
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Sandbox } from "@daytona/sdk"

import {
  daytonaTerminalPath,
  getDaytonaSandbox,
  getStartedDaytonaSandbox,
  runDaytonaCommand,
  shellQuote,
  type DaytonaSandboxPaths,
} from "./daytona-sandbox"

const DAYTONA_DESKTOP_PORT = 6080
const DESKTOP_PREVIEW_TTL_SECONDS = 60 * 60
const DESKTOP_TOOL_VERSION = "7"
const DESKTOP_DEPENDENCY_TIMEOUT_MS = 10 * 60 * 1000
const DESKTOP_BROWSER_URL = "about:blank"
const DESKTOP_BROWSER_COMMAND = "/usr/local/bin/cloudcode-browser"
const DESKTOP_AGENT_RECORDING_STATE_FILE = "active-recording.json"
const DESKTOP_AGENT_COMPLETED_RECORDING_STATE_FILE = "completed-recording.json"
const DESKTOP_RECORDING_CACHE_DIR = join(tmpdir(), "cloudcode-recordings")
const DESKTOP_RECORDING_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const DESKTOP_RECORDING_CACHE_PRUNE_MS = 10 * 60 * 1000
const DESKTOP_RECORDING_CACHE_MAX_FILES = 64

type DaytonaDesktopToolExtras = {
  config?: string
  instructions?: string
}
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
  "wmctrl",
  "x11-utils",
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
  "wmctrl",
  "xfce4-terminal",
  "xdpyinfo",
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

export type DaytonaDesktopRecordingFile = {
  fileName: string
  filePath: string
  sizeBytes: number
}

type DesktopRecordingCacheMetadata = {
  fileName?: string
}

const desktopRecordingDownloads = new Map<
  string,
  Promise<DaytonaDesktopRecordingFile>
>()
let lastDesktopRecordingCachePrune = 0

function cleanRecordingLabel(value?: string) {
  const normalized = value?.trim()
  if (!normalized) return undefined
  return normalized.replace(/[^\w .:-]+/g, "-").slice(0, 80)
}

function desktopAgentRecordingStatePath(paths: DaytonaSandboxPaths) {
  return `${paths.codexHome}/desktop/state/${DESKTOP_AGENT_RECORDING_STATE_FILE}`
}

function desktopAgentCompletedRecordingStatePath(paths: DaytonaSandboxPaths) {
  return `${paths.codexHome}/desktop/state/${DESKTOP_AGENT_COMPLETED_RECORDING_STATE_FILE}`
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

function desktopRecordingCacheKey(sandboxId: string, recordingId: string) {
  const sandboxHash = createHash("sha256")
    .update(sandboxId)
    .digest("hex")
    .slice(0, 16)
  const safeRecordingId =
    recordingId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) ||
    createHash("sha256").update(recordingId).digest("hex")
  return `${sandboxHash}-${safeRecordingId}`
}

function desktopRecordingCachePath(sandboxId: string, recordingId: string) {
  return join(
    DESKTOP_RECORDING_CACHE_DIR,
    `${desktopRecordingCacheKey(sandboxId, recordingId)}.mp4`
  )
}

function desktopRecordingCacheMetadataPath(filePath: string) {
  return `${filePath}.json`
}

async function readDesktopRecordingCacheMetadata(
  filePath: string
): Promise<DesktopRecordingCacheMetadata> {
  try {
    const raw = await readFile(
      desktopRecordingCacheMetadataPath(filePath),
      "utf8"
    )
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {}
    }
    const fileName = (parsed as DesktopRecordingCacheMetadata).fileName
    return typeof fileName === "string" && fileName.trim()
      ? { fileName: fileName.trim() }
      : {}
  } catch {
    return {}
  }
}

async function writeDesktopRecordingCacheMetadata(
  filePath: string,
  metadata: DesktopRecordingCacheMetadata
) {
  await writeFile(
    desktopRecordingCacheMetadataPath(filePath),
    JSON.stringify(metadata),
    "utf8"
  ).catch(() => undefined)
}

async function cachedDesktopRecordingFile(
  filePath: string,
  fallbackFileName: string
): Promise<DaytonaDesktopRecordingFile | undefined> {
  try {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile() || fileStat.size < 1) return undefined
    const metadata = await readDesktopRecordingCacheMetadata(filePath)
    return {
      fileName: metadata.fileName || fallbackFileName,
      filePath,
      sizeBytes: fileStat.size,
    }
  } catch {
    return undefined
  }
}

async function removeCachedDesktopRecording(filePath: string) {
  await Promise.all([
    rm(filePath, { force: true }).catch(() => undefined),
    rm(desktopRecordingCacheMetadataPath(filePath), { force: true }).catch(
      () => undefined
    ),
  ])
}

async function pruneDesktopRecordingCache() {
  const now = Date.now()
  if (now - lastDesktopRecordingCachePrune < DESKTOP_RECORDING_CACHE_PRUNE_MS) {
    return
  }
  lastDesktopRecordingCachePrune = now

  const entries = await readdir(DESKTOP_RECORDING_CACHE_DIR, {
    withFileTypes: true,
  }).catch(() => [])
  const files = (
    await Promise.all(
      entries.flatMap((entry) => {
        if (!entry.isFile() || !entry.name.endsWith(".mp4")) return []
        const filePath = join(DESKTOP_RECORDING_CACHE_DIR, entry.name)
        return stat(filePath)
          .then((fileStat) => ({
            filePath,
            mtimeMs: fileStat.mtimeMs,
          }))
          .catch(() => null)
      })
    )
  ).filter((file): file is { filePath: string; mtimeMs: number } =>
    Boolean(file)
  )

  const expired = files.filter(
    (file) => now - file.mtimeMs > DESKTOP_RECORDING_CACHE_TTL_MS
  )
  const newestFirst = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs)
  const overflow = newestFirst.slice(DESKTOP_RECORDING_CACHE_MAX_FILES)
  const removals = new Set(
    [...expired, ...overflow].map((file) => file.filePath)
  )

  await Promise.all([...removals].map(removeCachedDesktopRecording))
}

async function clearDesktopAgentRecordingState(
  sandbox: Sandbox,
  statePath: string,
  signal?: AbortSignal
) {
  await runDaytonaCommand(sandbox, `rm -f ${shellQuote(statePath)}`, {
    signal,
    timeoutMs: 10_000,
  }).catch(() => undefined)
}

async function readDesktopAgentRecordingState(
  sandbox: Sandbox,
  statePath: string,
  signal?: AbortSignal
) {
  const result = await runDaytonaCommand(
    sandbox,
    `[ -s ${shellQuote(statePath)} ] && cat ${shellQuote(statePath)} || true`,
    { signal, timeoutMs: 10_000 }
  )

  if (result.exitCode !== 0 || !result.stdout.trim()) {
    return undefined
  }

  try {
    return recordingArtifact(JSON.parse(result.stdout), sandbox.id)
  } catch {
    return undefined
  }
}

export async function stopDaytonaDesktopAgentRecording(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  signal?: AbortSignal
) {
  const activeStatePath = desktopAgentRecordingStatePath(paths)
  const completedStatePath = desktopAgentCompletedRecordingStatePath(paths)
  const active = await readDesktopAgentRecordingState(
    sandbox,
    activeStatePath,
    signal
  )

  if (!active?.id) {
    const completed = await readDesktopAgentRecordingState(
      sandbox,
      completedStatePath,
      signal
    )
    await clearDesktopAgentRecordingState(sandbox, activeStatePath, signal)
    await clearDesktopAgentRecordingState(sandbox, completedStatePath, signal)
    return completed
  }

  const stopped = await sandbox.computerUse.recording.stop(active.id)
  await clearDesktopAgentRecordingState(sandbox, activeStatePath, signal)
  await clearDesktopAgentRecordingState(sandbox, completedStatePath, signal)
  return (
    recordingArtifact(stopped, sandbox.id, active.id) ?? {
      ...active,
      sandboxId: sandbox.id,
      status: "completed",
    }
  )
}

// The Daytona preview proxy serves the noVNC web client at the desktop port.
// Pointing an iframe at the bare URL only shows the noVNC "Connect" landing
// page, so target the client directly and auto-connect to the x11vnc session.
function buildDesktopPreviewUrl(previewUrl: string) {
  try {
    const url = new URL(previewUrl)
    url.pathname = "/vnc.html"
    url.searchParams.set("autoconnect", "true")
    url.searchParams.set("reconnect", "true")
    url.searchParams.set("resize", "scale")
    url.searchParams.set("path", "websockify")
    return url.toString()
  } catch {
    return previewUrl
  }
}

async function safeDesktopPreviewUrl(sandbox: Sandbox) {
  try {
    const signed = await sandbox.getSignedPreviewUrl(
      DAYTONA_DESKTOP_PORT,
      DESKTOP_PREVIEW_TTL_SECONDS
    )
    return buildDesktopPreviewUrl(signed.url)
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

function computerUseStatusLooksActive(status: string) {
  const value = status.toLowerCase().trim()
  if (!value || value === "unknown") return false
  if (
    value.includes("error") ||
    value.includes("fail") ||
    value.includes("inactive") ||
    value.includes("not started") ||
    value.includes("stop") ||
    value.includes("unable")
  ) {
    return false
  }
  return (
    value.includes("active") ||
    value.includes("running") ||
    value.includes("start") ||
    value.includes("up")
  )
}

const LOCAL_DESKTOP_STATUS_MARKER = "__cloudcode_desktop_status__"

type LocalDesktopStatus = {
  missing: string[]
  processes: Record<string, string>
  running: boolean
}

function desktopServiceStatusCommand() {
  return [
    'display="${CLOUDCODE_DESKTOP_DISPLAY:-:0}"',
    'display_works() { command -v xdpyinfo >/dev/null 2>&1 && xdpyinfo -display "$display" >/dev/null 2>&1; }',
    "port_listening() {",
    '  port="$1"',
    "  if command -v netstat >/dev/null 2>&1; then",
    "    netstat -ltn 2>/dev/null | awk '{print $4}' | grep -Eq \"[:.]${port}$\"",
    "    return $?",
    "  fi",
    "  if command -v ss >/dev/null 2>&1; then",
    "    ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq \"[:.]${port}$\"",
    "    return $?",
    "  fi",
    "  return 1",
    "}",
    "xfce_running() { pgrep -f '[x]fce4-session|[x]fwm4|[x]fdesktop|[x]fsettingsd|[x]fce4-panel' >/dev/null 2>&1; }",
    "xvfb=stopped",
    "xfce4=stopped",
    "x11vnc=stopped",
    "novnc=stopped",
    "display_works && xvfb=running",
    "xfce_running && xfce4=running",
    "port_listening 5900 && x11vnc=running",
    "port_listening 6080 && novnc=running",
    `printf '${LOCAL_DESKTOP_STATUS_MARKER} xvfb=%s xfce4=%s x11vnc=%s novnc=%s\\n' "$xvfb" "$xfce4" "$x11vnc" "$novnc"`,
  ].join("\n")
}

function parseLocalDesktopStatus(output: string): LocalDesktopStatus {
  const line = output
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(LOCAL_DESKTOP_STATUS_MARKER))
  const processes: Record<string, string> = {}

  if (line) {
    for (const part of line
      .slice(LOCAL_DESKTOP_STATUS_MARKER.length)
      .split(/\s+/)) {
      const [key, value] = part.split("=")
      if (key && value) processes[key] = value
    }
  }

  const required = ["xvfb", "xfce4", "x11vnc", "novnc"]
  const missing = required.filter((key) => processes[key] !== "running")
  return {
    missing,
    processes,
    running: missing.length === 0,
  }
}

async function readLocalDesktopStatus(sandbox: Sandbox) {
  const result = await runDaytonaCommand(
    sandbox,
    desktopServiceStatusCommand(),
    {
      timeoutMs: 10_000,
    }
  )

  return parseLocalDesktopStatus(`${result.stdout}\n${result.stderr}`)
}

function startDesktopServicesCommand() {
  const statusCommand = desktopServiceStatusCommand()

  return [
    "set +e",
    'display="${CLOUDCODE_DESKTOP_DISPLAY:-:0}"',
    'log_dir="${CLOUDCODE_DESKTOP_LOG_DIR:-${HOME:-/tmp}/.cache/cloudcode-desktop/logs}"',
    'mkdir -p "$log_dir"',
    'display_works() { command -v xdpyinfo >/dev/null 2>&1 && xdpyinfo -display "$display" >/dev/null 2>&1; }',
    "port_listening() {",
    '  port="$1"',
    "  if command -v netstat >/dev/null 2>&1; then",
    "    netstat -ltn 2>/dev/null | awk '{print $4}' | grep -Eq \"[:.]${port}$\"",
    "    return $?",
    "  fi",
    "  if command -v ss >/dev/null 2>&1; then",
    "    ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq \"[:.]${port}$\"",
    "    return $?",
    "  fi",
    "  return 1",
    "}",
    "wait_for_display() {",
    "  i=0",
    '  while [ "$i" -lt 40 ]; do',
    "    display_works && return 0",
    "    i=$((i + 1))",
    "    sleep 0.25",
    "  done",
    "  return 1",
    "}",
    "wait_for_port() {",
    '  port="$1"',
    "  i=0",
    '  while [ "$i" -lt 40 ]; do',
    '    port_listening "$port" && return 0',
    "    i=$((i + 1))",
    "    sleep 0.25",
    "  done",
    "  return 1",
    "}",
    "if ! display_works; then",
    '  pkill -f "[X]vfb $display" >/dev/null 2>&1 || true',
    '  nohup Xvfb "$display" -screen 0 1440x900x24 -ac > "$log_dir/xvfb.log" 2>&1 &',
    "  wait_for_display || true",
    "fi",
    'export DISPLAY="$display"',
    "if command -v startxfce4 >/dev/null 2>&1 && ! pgrep -f '[x]fce4-session|[x]fwm4|[x]fdesktop|[x]fsettingsd|[x]fce4-panel' >/dev/null 2>&1; then",
    '  nohup startxfce4 > "$log_dir/xfce4.log" 2>&1 &',
    "  sleep 2",
    "fi",
    "if command -v x11vnc >/dev/null 2>&1 && ! port_listening 5900; then",
    "  pkill -f '[x]11vnc .*5900' >/dev/null 2>&1 || true",
    '  nohup x11vnc -display "$display" -forever -shared -nopw -rfbport 5900 -localhost > "$log_dir/x11vnc.log" 2>&1 &',
    "  wait_for_port 5900 || true",
    "fi",
    "if command -v websockify >/dev/null 2>&1 && ! port_listening 6080; then",
    "  pkill -f '[w]ebsockify.*6080|[n]ovnc_proxy.*6080' >/dev/null 2>&1 || true",
    '  nohup websockify --web=/usr/share/novnc/ 6080 localhost:5900 > "$log_dir/novnc.log" 2>&1 &',
    "  wait_for_port 6080 || true",
    "fi",
    statusCommand,
    "missing=''",
    "for service in xvfb xfce4 x11vnc novnc; do",
    '  eval "value=\\${$service}"',
    '  [ "$value" = running ] || missing="$missing $service"',
    "done",
    'if [ -n "$missing" ]; then',
    "  printf 'failed to start:%s\\n' \"$missing\" >&2",
    '  for log in "$log_dir/xvfb.log" "$log_dir/xfce4.log" "$log_dir/x11vnc.log" "$log_dir/novnc.log"; do',
    '    [ -s "$log" ] || continue',
    "    printf '\\n==> %s <==\\n' \"$log\" >&2",
    '    tail -40 "$log" >&2',
    "  done",
    "  exit 1",
    "fi",
  ].join("\n")
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function startDesktopServicesFallback(
  sandbox: Sandbox,
  startError: unknown
) {
  const result = await runDaytonaCommand(
    sandbox,
    startDesktopServicesCommand(),
    {
      timeoutMs: 30_000,
    }
  )
  const localStatus = parseLocalDesktopStatus(
    `${result.stdout}\n${result.stderr}`
  )

  if (result.exitCode === 0 && localStatus.running) {
    return localStatus
  }

  const fallbackOutput = [result.stderr, result.stdout]
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-80)
    .join("\n")
  throw new Error(
    [
      `Daytona computer use failed: ${errorMessage(startError)}`,
      fallbackOutput
        ? `Local desktop fallback also failed:\n${fallbackOutput}`
        : "Local desktop fallback also failed.",
    ].join("\n")
  )
}

async function stopLocalDesktopServices(sandbox: Sandbox) {
  const result = await runDaytonaCommand(
    sandbox,
    [
      "set +e",
      'display="${CLOUDCODE_DESKTOP_DISPLAY:-:0}"',
      "terminate_exact() {",
      '  signal="$1"',
      "  shift",
      '  for name in "$@"; do',
      '    pkill "-$signal" -x "$name" >/dev/null 2>&1 || true',
      "  done",
      "}",
      "terminate_pattern() {",
      '  signal="$1"',
      '  pattern="$2"',
      '  pkill "-$signal" -f "$pattern" >/dev/null 2>&1 || true',
      "}",
      "stop_desktop_processes() {",
      '  signal="$1"',
      '  terminate_exact "$signal" websockify novnc_proxy x11vnc Xvfb startxfce4 xfce4-session xfwm4 xfdesktop xfsettingsd xfce4-panel xfconfd',
      '  terminate_pattern "$signal" "[w]ebsockify.*6080|[n]ovnc_proxy.*6080"',
      '  terminate_pattern "$signal" "[x]11vnc .*5900"',
      '  terminate_pattern "$signal" "[s]tartxfce4|[x]fce4-session|[x]fwm4|[x]fdesktop|[x]fsettingsd|[x]fce4-panel|[x]fconfd"',
      '  terminate_pattern "$signal" "[X]vfb $display"',
      "}",
      "stop_desktop_processes TERM",
      "sleep 1",
      "stop_desktop_processes KILL",
      "sleep 0.5",
      desktopServiceStatusCommand(),
    ].join("\n"),
    { timeoutMs: 10_000 }
  )

  return parseLocalDesktopStatus(`${result.stdout}\n${result.stderr}`)
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
  const sandbox = await getDaytonaSandbox(sandboxId)
  await sandbox.refreshData().catch(() => undefined)

  if (sandbox.state !== "started") {
    return {
      previewUrl: null,
      status: sandbox.state || "unknown",
    }
  }

  const status = await readComputerUseStatus(sandbox)
  if (computerUseStatusLooksActive(status)) {
    return {
      previewUrl: await safeDesktopPreviewUrl(sandbox),
      status,
    }
  }

  const localStatus = await readLocalDesktopStatus(sandbox)
  return {
    previewUrl: localStatus.running
      ? await safeDesktopPreviewUrl(sandbox)
      : null,
    status: localStatus.running ? "running (fallback)" : status,
  }
}

export async function startDaytonaDesktop(sandboxId: string) {
  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  await ensureDaytonaDesktopDependencies(sandbox)
  let start: Awaited<ReturnType<typeof sandbox.computerUse.start>> | undefined
  let fallbackStatus: LocalDesktopStatus | undefined

  try {
    start = await sandbox.computerUse.start()
  } catch (error) {
    fallbackStatus = await startDesktopServicesFallback(sandbox, error)
  }

  const [previewUrl, status] = await Promise.all([
    safeDesktopPreviewUrl(sandbox),
    readComputerUseStatus(sandbox),
  ])
  const usingFallback =
    Boolean(fallbackStatus?.running) && !computerUseStatusLooksActive(status)

  return {
    message: usingFallback
      ? "Desktop started with local fallback."
      : (start?.message ?? "Desktop started."),
    previewUrl,
    processes: start?.status ?? fallbackStatus?.processes ?? {},
    status: usingFallback ? "running (fallback)" : status,
  }
}

export async function openDaytonaDesktopBrowser(
  sandboxId: string,
  url = DESKTOP_BROWSER_URL
) {
  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  await ensureDaytonaDesktopDependencies(sandbox)
  await sandbox.computerUse
    .start()
    .catch((error) => startDesktopServicesFallback(sandbox, error))

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

  const [preview, status] = await Promise.all([
    safeDesktopPreviewUrl(sandbox),
    readComputerUseStatus(sandbox),
  ])

  return {
    message: "Browser opened.",
    previewUrl: preview,
    status,
  }
}

export async function stopDaytonaDesktop(sandboxId: string) {
  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  const stopResult = await sandbox.computerUse.stop().catch((error) => ({
    message: errorMessage(error),
  }))
  const localStatus = await stopLocalDesktopServices(sandbox)
  const stillRunning = Object.entries(localStatus.processes)
    .filter(([, status]) => status === "running")
    .map(([service]) => service)

  if (stillRunning.length) {
    throw new Error(
      `Desktop stop did not terminate ${stillRunning.join(", ")}.`
    )
  }

  return {
    message: stopResult.message ?? "Desktop stopped.",
    previewUrl: null,
    processes: localStatus.processes,
    status: "stopped",
  }
}

export async function takeDaytonaDesktopScreenshot(sandboxId: string) {
  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  await ensureDaytonaDesktopDependencies(sandbox)
  await sandbox.computerUse
    .start()
    .catch((error) => startDesktopServicesFallback(sandbox, error))
  return await sandbox.computerUse.screenshot.takeCompressed({
    format: "png",
    showCursor: true,
  })
}

export async function listDaytonaDesktopRecordings(sandboxId: string) {
  const sandbox = await getDaytonaSandbox(sandboxId)
  await sandbox.refreshData().catch(() => undefined)
  if (sandbox.state !== "started") return { recordings: [] }
  return await sandbox.computerUse.recording.list()
}

export async function startDaytonaDesktopRecording(
  sandboxId: string,
  input: RecordingLabelInput = {}
) {
  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  await ensureDaytonaDesktopDependencies(sandbox)
  await sandbox.computerUse
    .start()
    .catch((error) => startDesktopServicesFallback(sandbox, error))
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

async function downloadDaytonaDesktopRecordingToCache(
  sandboxId: string,
  recordingId: string
): Promise<DaytonaDesktopRecordingFile> {
  await mkdir(DESKTOP_RECORDING_CACHE_DIR, { recursive: true })
  await pruneDesktopRecordingCache()

  const cachePath = desktopRecordingCachePath(sandboxId, recordingId)
  const fallbackFileName = `${recordingId}.mp4`
  const cached = await cachedDesktopRecordingFile(cachePath, fallbackFileName)
  if (cached) return cached

  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  const recording = await sandbox.computerUse.recording.get(recordingId)
  const fileName = recording.fileName || fallbackFileName
  const tmpPath = join(
    DESKTOP_RECORDING_CACHE_DIR,
    `${desktopRecordingCacheKey(sandboxId, recordingId)}.${randomUUID()}.tmp`
  )

  try {
    await sandbox.computerUse.recording.download(recordingId, tmpPath)
    const fileStat = await stat(tmpPath)
    if (!fileStat.isFile() || fileStat.size < 1) {
      throw new Error("Daytona desktop recording download was empty.")
    }
    await rename(tmpPath, cachePath)
    await writeDesktopRecordingCacheMetadata(cachePath, { fileName })
    return {
      fileName,
      filePath: cachePath,
      sizeBytes: fileStat.size,
    }
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function getDaytonaDesktopRecordingFile(
  sandboxId: string,
  recordingId: string
) {
  const cacheKey = desktopRecordingCacheKey(sandboxId, recordingId)
  const pending = desktopRecordingDownloads.get(cacheKey)
  if (pending) return await pending

  const download = downloadDaytonaDesktopRecordingToCache(
    sandboxId,
    recordingId
  ).finally(() => {
    desktopRecordingDownloads.delete(cacheKey)
  })
  desktopRecordingDownloads.set(cacheKey, download)
  return await download
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
    MISE_TRUSTED_CONFIG_PATHS: repoPath,
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
      "export MISE_TRUSTED_CONFIG_PATHS=" + shellQuote(repoPath),
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
          instructions: "Use these tools for visual desktop work in the Daytona sandbox. Open URLs only with desktop_open_browser, which launches Cloudcode Browser at /usr/local/bin/cloudcode-browser. Use desktop_open_terminal for long-running dev servers, watchers, and other processes needed during desktop testing. Desktop actions automatically start a Daytona recording; Cloudcode stops it after the run. Start with desktop_start, inspect with desktop_screenshot, then act with click/type/key tools. Take another screenshot after each meaningful action.",
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

function desktopAgentInstructions() {
  return [
    "# Cloudcode Daytona Desktop",
    "",
    "A graphical Daytona desktop may be available in this sandbox.",
    "",
    "Use the `cloudcode_desktop` MCP tools for GUI tasks:",
    "- `desktop_start` starts or verifies the desktop.",
    "- `desktop_open_browser` opens Cloudcode Browser at `/usr/local/bin/cloudcode-browser` to a URL.",
    "- `desktop_open_terminal` opens a visible desktop terminal, optionally running a shell command from the repository.",
    "- `desktop_screenshot` returns an image of the current desktop.",
    "- `desktop_click`, `desktop_type`, `desktop_key`, `desktop_hotkey`, and `desktop_scroll` control the desktop.",
    "- Daytona Computer Use recording starts automatically before desktop actions and Cloudcode stops it after the run.",
    "- `desktop_record_start` returns the active recording, and `desktop_record_stop` stops it early when an intermediate video is needed.",
    "",
    "Do not open `chromium`, `chromium-browser`, `google-chrome`, `google-chrome-stable`, `firefox`, `x-www-browser`, or `xdg-open` directly. For browser work, use `desktop_open_browser`; if a shell fallback is unavoidable, run `/usr/local/bin/cloudcode-browser` directly.",
    "",
    "For visual work, use this loop: start the desktop, take a screenshot, act, take another screenshot, and repeat until the UI state is verified.",
    "After making UI-facing changes, decide whether visual verification is needed. Use the Daytona desktop when the change affects layout, styling, visible components, browser behavior, forms, navigation, or user interactions. Skip desktop verification only when the change is clearly non-visual or cannot affect rendered UI.",
    "When UI verification is needed, assume the dev server is already running, open the relevant local URL with `desktop_open_browser`, inspect with screenshots, interact with the changed workflow when useful, and verify the final state before reporting back.",
    "If desktop verification requires starting a dev server, watcher, or other long-running process, run it with `desktop_open_terminal` so it stays visible in the graphical desktop. Use ordinary shell commands only for finite setup and checks.",
    "",
    "A shell fallback is also available as `cloudcode-computer`, including `cloudcode-computer terminal '<command>'`, but prefer the MCP tools because screenshots are returned as inspectable images.",
  ].join("\n")
}

export function daytonaDesktopAgentContext() {
  return [
    "Cloudcode may provide a Daytona desktop for GUI/browser work.",
    "When a task needs visual interaction, use the `cloudcode_desktop` MCP tools: start with `desktop_start`, open Cloudcode Browser with `desktop_open_browser` when needed, inspect with `desktop_screenshot`, act with click/type/key/scroll tools, then take another screenshot to verify the state.",
    "After UI-facing code changes, decide whether browser verification is needed. Use the Daytona desktop for layout, styling, visible component, browser behavior, form, navigation, and interaction changes; skip it only when the edit is clearly non-visual or cannot affect rendered UI.",
    "When UI verification is needed, assume the dev server is already running, open the relevant local URL with `desktop_open_browser`, interact with the changed workflow when useful, and verify with screenshots before reporting back.",
    "If desktop verification requires starting a dev server, watcher, or another long-running process, use `desktop_open_terminal` so it runs in the visible desktop terminal. Keep ordinary shell commands for finite setup and checks.",
    "Do not launch `chromium`, `chromium-browser`, `google-chrome`, `google-chrome-stable`, `firefox`, `x-www-browser`, or `xdg-open` directly; `desktop_open_browser` uses `/usr/local/bin/cloudcode-browser`.",
    "Daytona Computer Use recording starts automatically before desktop actions and Cloudcode stops it after the run; use `desktop_record_stop` only when an intermediate video artifact is needed before the run ends.",
  ].join("\n")
}

function desktopCodexConfig(
  paths: Pick<DaytonaSandboxPaths, "codexHome" | "home" | "repoPath">,
  sandbox: Pick<Sandbox, "id" | "toolboxProxyUrl">,
  toolboxAuthKey: string
) {
  return [
    "[mcp_servers.cloudcode_desktop]",
    `command = ${JSON.stringify(`${paths.codexHome}/desktop/cloudcode-desktop-mcp.mjs`)}`,
    "startup_timeout_sec = 20",
    "",
    "[mcp_servers.cloudcode_desktop.env]",
    `CODEX_HOME = ${JSON.stringify(paths.codexHome)}`,
    `CLOUDCODE_REPO_PATH = ${JSON.stringify(paths.repoPath)}`,
    `CLOUDCODE_DESKTOP_STATE_DIR = ${JSON.stringify(`${paths.codexHome}/desktop/state`)}`,
    `CLOUDCODE_BROWSER_COMMAND = ${JSON.stringify(DESKTOP_BROWSER_COMMAND)}`,
    `CLOUDCODE_TERMINAL_HOME = ${JSON.stringify(paths.home)}`,
    `CLOUDCODE_TERMINAL_PATH = ${JSON.stringify(daytonaTerminalPath(paths.home))}`,
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
  signal?: AbortSignal,
  extras: DaytonaDesktopToolExtras = {}
) {
  await ensureDaytonaDesktopDependencies(sandbox, signal)

  const script = desktopMcpServerScript()
  const instructions = [desktopAgentInstructions(), extras.instructions]
    .filter(Boolean)
    .join("\n\n")
  const toolboxPreview = await sandbox.getPreviewLink(1)
  const config = [
    desktopCodexConfig(paths, sandbox, toolboxPreview.token),
    extras.config,
  ]
    .filter(Boolean)
    .join("\n")
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
