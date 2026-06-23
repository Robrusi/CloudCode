import { createHash } from "node:crypto"

import type { Sandbox } from "@daytona/sdk"

import {
  daytonaTerminalPath,
  getDaytonaSandbox,
  getStartedDaytonaSandbox,
  refreshDaytonaSandboxData,
  runDaytonaCommand,
  shellQuote,
  type DaytonaSandboxPaths,
  withDaytonaOperationTimeout,
} from "@/lib/daytona/sandbox"
import { cleanRecordingLabel } from "@/lib/daytona/desktop-recordings"
import {
  DESKTOP_BROWSER_COMMAND,
  ensureDaytonaDesktopDependencies,
} from "@/lib/daytona/desktop-dependencies"
import { desktopMcpServerScript } from "@/lib/daytona/desktop-mcp-script"
export {
  getCachedDaytonaDesktopRecordingFile,
  getDaytonaDesktopRecordingFile,
  isDaytonaDesktopSandboxRunning,
  listDaytonaDesktopRecordings,
  stopDaytonaDesktopAgentRecording,
  stopDaytonaDesktopRecording,
  type DaytonaDesktopRecordingArtifact,
  type DaytonaDesktopRecordingFile,
} from "@/lib/daytona/desktop-recordings"

const DAYTONA_DESKTOP_PORT = 6080
const DESKTOP_PREVIEW_TTL_SECONDS = 60 * 60
const DESKTOP_TOOL_VERSION = "10"
const DESKTOP_BROWSER_URL = "about:blank"
const DESKTOP_READ_TIMEOUT_MS = 8_000
const DESKTOP_PREVIEW_TIMEOUT_MS = 8_000
const DESKTOP_COMPUTER_USE_TIMEOUT_MS = 15_000

type DaytonaDesktopToolExtras = {
  config?: string
  instructions?: string
}

export type DaytonaDesktopStatus = {
  previewUrl: string | null
  status: string
}

type RecordingLabelInput = {
  label?: string
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
    const signed = await withDaytonaOperationTimeout(
      sandbox.getSignedPreviewUrl(
        DAYTONA_DESKTOP_PORT,
        DESKTOP_PREVIEW_TTL_SECONDS
      ),
      {
        label: "Daytona desktop preview URL",
        timeoutMs: DESKTOP_PREVIEW_TIMEOUT_MS,
      }
    )
    return buildDesktopPreviewUrl(signed.url)
  } catch {
    return null
  }
}

async function readComputerUseStatus(sandbox: Sandbox) {
  try {
    const status = await withDaytonaOperationTimeout(
      sandbox.computerUse.getStatus(),
      {
        label: "Daytona desktop status",
        timeoutMs: DESKTOP_COMPUTER_USE_TIMEOUT_MS,
      }
    )
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
    value.includes("partial") ||
    value.includes("running") ||
    value.includes("start") ||
    value.includes("up")
  )
}

const LOCAL_DESKTOP_STATUS_MARKER = "__cloudcode_desktop_status__"

type LocalDesktopStatus = {
  error?: string
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

function localDesktopStatusFromError(error: unknown): LocalDesktopStatus {
  return {
    error: errorMessage(error),
    missing: ["xvfb", "xfce4", "x11vnc", "novnc"],
    processes: {},
    running: false,
  }
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

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
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

export async function readDaytonaDesktopStatus(
  sandboxId: string
): Promise<DaytonaDesktopStatus> {
  const sandbox = await getDaytonaSandbox(sandboxId, {
    timeoutMs: DESKTOP_READ_TIMEOUT_MS,
  })
  await refreshDaytonaSandboxData(sandbox, {
    timeoutMs: DESKTOP_READ_TIMEOUT_MS,
  }).catch(() => undefined)

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

  const localStatus = await readLocalDesktopStatus(sandbox).catch(
    localDesktopStatusFromError
  )
  return {
    previewUrl: localStatus.running
      ? await safeDesktopPreviewUrl(sandbox)
      : null,
    status: localStatus.running
      ? "running (fallback)"
      : (localStatus.error ?? status),
  }
}

export async function startDaytonaDesktop(sandboxId: string) {
  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  await ensureDaytonaDesktopDependencies(sandbox)
  let start: Awaited<ReturnType<typeof sandbox.computerUse.start>> | undefined
  let fallbackStatus: LocalDesktopStatus | undefined

  try {
    start = await withDaytonaOperationTimeout(sandbox.computerUse.start(), {
      label: "Daytona desktop start",
      timeoutMs: DESKTOP_COMPUTER_USE_TIMEOUT_MS,
    })
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
  await withDaytonaOperationTimeout(sandbox.computerUse.start(), {
    label: "Daytona desktop start",
    timeoutMs: DESKTOP_COMPUTER_USE_TIMEOUT_MS,
  }).catch((error) => startDesktopServicesFallback(sandbox, error))

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
  const stopResult = await withDaytonaOperationTimeout(
    sandbox.computerUse.stop(),
    {
      label: "Daytona desktop stop",
      timeoutMs: DESKTOP_COMPUTER_USE_TIMEOUT_MS,
    }
  ).catch((error) => ({
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
  await withDaytonaOperationTimeout(sandbox.computerUse.start(), {
    label: "Daytona desktop start",
    timeoutMs: DESKTOP_COMPUTER_USE_TIMEOUT_MS,
  }).catch((error) => startDesktopServicesFallback(sandbox, error))
  return await sandbox.computerUse.screenshot.takeCompressed({
    format: "png",
    showCursor: true,
  })
}

export async function startDaytonaDesktopRecording(
  sandboxId: string,
  input: RecordingLabelInput = {}
) {
  const sandbox = await getStartedDaytonaSandbox(sandboxId)
  await ensureDaytonaDesktopDependencies(sandbox)
  await withDaytonaOperationTimeout(sandbox.computerUse.start(), {
    label: "Daytona desktop start",
    timeoutMs: DESKTOP_COMPUTER_USE_TIMEOUT_MS,
  }).catch((error) => startDesktopServicesFallback(sandbox, error))
  return await sandbox.computerUse.recording.start(
    cleanRecordingLabel(input.label)
  )
}

function base64FileCommand(path: string, content: string) {
  const encoded = Buffer.from(content, "utf8").toString("base64")
  return `printf '%s' ${shellQuote(encoded)} | base64 -d > ${shellQuote(path)}`
}

export function daytonaDesktopToolVersion() {
  return DESKTOP_TOOL_VERSION
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
    "When the desktop is available, prioritize visual UI testing in the desktop over headless checks: verify UI changes by driving Cloudcode Browser on the desktop and inspecting screenshots, not with headless browsers, headless Playwright or Puppeteer runs, curl HTML dumps, or DOM-only assertions. Fall back to headless tools only when the desktop cannot be started.",
    "After making UI-facing changes, decide whether visual verification is needed. Use the Daytona desktop when the change affects layout, styling, visible components, browser behavior, forms, navigation, or user interactions. Skip desktop verification only when the change is clearly non-visual or cannot affect rendered UI.",
    "When UI verification is needed, assume the dev server is already running, open the relevant local URL with `desktop_open_browser`, and exercise the changed workflow end-to-end the way a user would: click, type, and navigate through it, then confirm with screenshots that the expected outcome actually occurred.",
    "Confirming the app starts, the page loads, or no errors appear is not verification. Verify the specific behavior the change was meant to produce — the new element is visible, the interaction has the intended effect, the fixed bug no longer reproduces — and treat the change as unverified if the screenshots do not show it.",
    "",
    "## UI Verification Guardrails",
    "",
    "For UI verification, never use shortcuts that bypass the user interface, including `javascript:` URLs, direct DOM mutation, localStorage edits, console commands, injected scripts, or headless assertions, unless the user explicitly asks for that. Verify UI behavior only by interacting with visible controls in the browser the way a user would: click, type, scroll, navigate, then inspect the resulting screenshot. If the screenshot is unavailable or unreadable, treat the behavior as unverified and say so.",
    "",
    "When opening a local URL for visual verification, confirm the browser actually loaded the app page before reporting success. A successful `desktop_open_browser` call is not verification. If the page shows a browser error, blank page, stale tab, or unreadable screenshot, do not claim verification; fix the loading issue or report it.",
    "",
    "If desktop verification requires starting a dev server, watcher, or other long-running process, run it with `desktop_open_terminal` so it stays visible in the graphical desktop. Use ordinary shell commands only for finite setup and checks.",
    "",
    "A shell fallback is also available as `cloudcode-computer`, including `cloudcode-computer terminal '<command>'`, but prefer the MCP tools because screenshots are returned as inspectable images.",
  ].join("\n")
}

export function daytonaDesktopAgentContext() {
  return [
    "Cloudcode may provide a Daytona desktop for GUI/browser work.",
    "When a task needs visual interaction, use the `cloudcode_desktop` MCP tools: start with `desktop_start`, open Cloudcode Browser with `desktop_open_browser` when needed, inspect with `desktop_screenshot`, act with click/type/key/scroll tools, then take another screenshot to verify the state.",
    "When the desktop is available, prioritize visual UI testing in the desktop over headless checks: drive Cloudcode Browser and inspect screenshots instead of headless browsers, headless Playwright or Puppeteer runs, curl HTML dumps, or DOM-only assertions. Fall back to headless tools only when the desktop cannot be started.",
    "After UI-facing code changes, decide whether browser verification is needed. Use the Daytona desktop for layout, styling, visible component, browser behavior, form, navigation, and interaction changes; skip it only when the edit is clearly non-visual or cannot affect rendered UI.",
    "When UI verification is needed, assume the dev server is already running, open the relevant local URL with `desktop_open_browser`, and exercise the changed workflow end-to-end the way a user would; confirm with screenshots that the expected outcome actually occurred before reporting back.",
    "Confirming the app starts, the page loads, or no errors appear is not verification. Verify the specific behavior the change was meant to produce — the new element is visible, the interaction has the intended effect, the fixed bug no longer reproduces — and treat the change as unverified if the screenshots do not show it.",
    "For UI verification, never use shortcuts that bypass the user interface, including `javascript:` URLs, direct DOM mutation, localStorage edits, console commands, injected scripts, or headless assertions, unless the user explicitly asks for that. Verify UI behavior only by interacting with visible controls in the browser the way a user would: click, type, scroll, navigate, then inspect the resulting screenshot. If the screenshot is unavailable or unreadable, treat the behavior as unverified and say so.",
    "When opening a local URL for visual verification, confirm the browser actually loaded the app page before reporting success. A successful `desktop_open_browser` call is not verification. If the page shows a browser error, blank page, stale tab, or unreadable screenshot, do not claim verification; fix the loading issue or report it.",
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

function desktopToolFingerprint({
  agentsPath,
  binPath,
  config,
  configPath,
  instructions,
  script,
  scriptPath,
}: {
  agentsPath: string
  binPath: string
  config: string
  configPath: string
  instructions: string
  script: string
  scriptPath: string
}) {
  return sha256(
    [
      DESKTOP_TOOL_VERSION,
      scriptPath,
      binPath,
      agentsPath,
      configPath,
      script,
      instructions,
      config,
    ].join("\0")
  )
}

export async function installDaytonaDesktopTools(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  signal?: AbortSignal,
  extras: DaytonaDesktopToolExtras = {}
) {
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
  const fingerprint = desktopToolFingerprint({
    agentsPath,
    binPath,
    config,
    configPath,
    instructions,
    script,
    scriptPath,
  })

  const marker = await runDaytonaCommand(
    sandbox,
    [
      "set -e",
      `fingerprint=${shellQuote(fingerprint)}`,
      `test -x ${shellQuote(scriptPath)}`,
      `test -L ${shellQuote(binPath)}`,
      `test -s ${shellQuote(agentsPath)}`,
      `test -s ${shellQuote(configPath)}`,
      `grep -qxF -- "$fingerprint" ${shellQuote(markerPath)}`,
    ].join("\n"),
    { signal, timeoutMs: 10_000 }
  ).catch(() => undefined)
  if (marker?.exitCode === 0) return

  await ensureDaytonaDesktopDependencies(sandbox, signal)

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
      `printf '%s\\n' ${shellQuote(fingerprint)} > ${shellQuote(markerPath)}`,
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
