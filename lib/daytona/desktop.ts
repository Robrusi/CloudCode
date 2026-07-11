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
import {
  uiTestsCloudcodeTestIndex,
  uiTestsCloudcodeTestPackageJson,
  uiTestsCloudcodeTestTypes,
  uiTestsMcpServerScript,
  uiTestsReporterScript,
  uiTestsServerEnv,
  uiTestsToolContentFingerprint,
} from "@/lib/daytona/ui-tests-mcp-script"
export {
  desktopAgentRunStateScript,
  getCachedDaytonaDesktopRecordingFile,
  getDaytonaDesktopRecordingFile,
  isDaytonaDesktopSandboxRunning,
  listDaytonaDesktopRecordings,
  stopDaytonaDesktopAgentRecording,
  stopDaytonaDesktopAgentRecordings,
  stopDaytonaDesktopRecording,
  type DaytonaDesktopRecordingArtifact,
  type DaytonaDesktopRecordingFile,
  writeDaytonaDesktopAgentRunState,
} from "@/lib/daytona/desktop-recordings"

const DAYTONA_DESKTOP_PORT = 6080
const DESKTOP_PREVIEW_TTL_SECONDS = 60 * 60
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

function localDesktopInactiveStatus(
  computerUseStatus: string,
  localStatus: LocalDesktopStatus
) {
  if (localStatus.error) return localStatus.error
  if (!computerUseStatusLooksActive(computerUseStatus)) return computerUseStatus
  if (!localStatus.missing.length) return "stopped"
  return `not running (${localStatus.missing.join(", ")} stopped)`
}

function desktopStatusLabel(
  computerUseStatus: string,
  localStatus: LocalDesktopStatus
) {
  if (!localStatus.running) {
    return localDesktopInactiveStatus(computerUseStatus, localStatus)
  }
  return computerUseStatusLooksActive(computerUseStatus)
    ? computerUseStatus
    : "running (fallback)"
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

  const [status, localStatus] = await Promise.all([
    readComputerUseStatus(sandbox),
    readLocalDesktopStatus(sandbox).catch(localDesktopStatusFromError),
  ])
  return {
    previewUrl: localStatus.running
      ? await safeDesktopPreviewUrl(sandbox)
      : null,
    status: desktopStatusLabel(status, localStatus),
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

  let status = await readComputerUseStatus(sandbox)
  let localStatus =
    fallbackStatus ??
    (await readLocalDesktopStatus(sandbox).catch(localDesktopStatusFromError))

  if (!fallbackStatus && !localStatus.running) {
    fallbackStatus = await startDesktopServicesFallback(
      sandbox,
      new Error(
        `Daytona computer use reported ${status}, but local desktop services were ${localDesktopInactiveStatus(status, localStatus)}.`
      )
    )
    localStatus = fallbackStatus
    status = await readComputerUseStatus(sandbox)
  }

  const usedFallback = Boolean(fallbackStatus?.running)
  const previewUrl = localStatus.running
    ? await safeDesktopPreviewUrl(sandbox)
    : null

  return {
    message: usedFallback
      ? "Desktop started with local fallback."
      : (start?.message ?? "Desktop started."),
    previewUrl,
    processes:
      fallbackStatus?.processes ?? start?.status ?? localStatus.processes,
    status: desktopStatusLabel(status, localStatus),
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

function daytonaDesktopAgentsMd() {
  return [
    "# Cloudcode Daytona Desktop",
    "",
    "## Daytona Desktop Context",
    "",
    "Cloudcode may provide a Daytona desktop for GUI/browser work.",
    "",
    "## Verifying UI Changes (default path)",
    "",
    "After UI-facing code changes, verify the change by driving the app in the desktop browser with the `cloudcode_desktop` `browser_*` tools. They attach Playwright to the headed desktop browser, so every action is a real, trusted input on a visible page — use them the way a real user browses.",
    "Derive the flow to test from the code you just changed, then execute it directly as a sequence of browser actions. For example, to verify a sign-in feature: `browser_open` the sign-in page, `browser_type` the email, `browser_type` the password, `browser_click` the submit button, then confirm from the returned page state that the dashboard is shown.",
    "Every browser action returns the resulting URL, title, and an accessibility snapshot of the page. Verify outcomes from that returned state — you do not need to take a screenshot after each step. Use `browser_wait_for` for async UI instead of re-polling with snapshots.",
    "Use `browser_screenshot` (or `desktop_screenshot` when the whole desktop matters) only when visual appearance is what you are verifying — layout, styling, rendering, images — or when the accessibility snapshot is inconclusive about the outcome.",
    "Exercise the changed workflow end-to-end the way a user would. Confirming the app starts, the page loads, or no errors appear is not verification. Verify the specific behavior the change was meant to produce — the new element is present, the interaction has the intended effect, the fixed bug no longer reproduces — and treat the change as unverified if the page state does not show it.",
    "Never cheat during verification: no `javascript:` URLs, direct DOM mutation, localStorage/sessionStorage edits, console commands, injected scripts, network mocking, or API calls to fake UI state, unless the user explicitly asks for that. Only visible interactions count. If a state can only be reached by cheating, report that instead of faking it.",
    "Confirm the browser actually loaded the app page before reporting success. A browser error, blank page, stale tab, or unreadable snapshot/screenshot means the behavior is unverified; fix the loading issue or report it.",
    "Use the coordinate desktop tools (`desktop_click`, `desktop_type`, `desktop_key`, `desktop_hotkey`, `desktop_scroll` with `desktop_screenshot`) only for work outside the web page: native dialogs, window management, or non-browser applications.",
    "If verification requires starting a dev server, watcher, or another long-running process, use `desktop_open_terminal` so it runs in the visible desktop terminal. Otherwise assume the user's dev server is already running on `http://127.0.0.1:3000`.",
    "Do not launch `chromium`, `chromium-browser`, `google-chrome`, `google-chrome-stable`, `firefox`, `x-www-browser`, or `xdg-open` directly; `browser_open` and `desktop_open_browser` manage Cloudcode Browser at `/usr/local/bin/cloudcode-browser`.",
    "Desktop actions do not record automatically. Use `desktop_record_start` before the first action and `desktop_record_stop` after the final action only when an explicit manual desktop recording is needed.",
    "",
    "Available `cloudcode_desktop` MCP tools:",
    "- `browser_open`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_press`, `browser_scroll`, `browser_back`, `browser_reload`, `browser_wait_for`, and `browser_screenshot` drive the desktop browser like a real user; prefer these for anything inside a web page.",
    "- `desktop_start` starts or verifies the desktop.",
    "- `desktop_open_browser` opens Cloudcode Browser to a URL for the user to look at; it is not a verification step.",
    "- `desktop_open_terminal` opens a visible desktop terminal, optionally running a shell command from the repository.",
    "- `desktop_screenshot` returns an image of the current desktop.",
    "- `desktop_click`, `desktop_type`, `desktop_key`, `desktop_hotkey`, and `desktop_scroll` control the desktop outside the browser page.",
    "- `desktop_record_start` starts an explicit manual desktop recording, and `desktop_record_stop` stops that recording.",
    "",
    "## Cloudcode Deterministic UI Tests (opt-in only)",
    "",
    "The `cloudcode_ui_tests` MCP runs deterministic, recorded Playwright specs from `.cloudcode/tests`. This is strictly opt-in: only write or run these tests when the user explicitly asks for a deterministic, recorded test of a specific flow.",
    "Do not use `ui_tests_run` as the default way to verify a change, and never create `.cloudcode/tests` specs as a side effect of another task.",
    "If a change clearly deserves a deterministic regression test — a critical or regression-prone user flow — finish the task first, then offer to add one and wait for the user to confirm before writing or running anything.",
    "",
    "When the user has asked for deterministic UI tests:",
    "Write tests only under `.cloudcode/tests` in the repository, following this template exactly — it passes the runner's checks on the first try:",
    "```ts",
    'import { expect, test } from "@cloudcode/test"',
    "",
    'test("Waitlist signup", async ({ page, step }) => {',
    '  await step("Open the waitlist page", async () => {',
    '    await page.goto("/waitlist")',
    '    await expect(page.getByRole("heading", { name: "Join the waitlist" })).toBeVisible()',
    "  })",
    '  await step("Submit an email", async () => {',
    '    await page.getByLabel("Email address").fill("person@example.com")',
    '    await page.getByRole("button", { name: "Join the waitlist" }).click()',
    "  })",
    '  await expect(page.getByText("Thanks for joining the waitlist!")).toBeVisible()',
    "})",
    "```",
    "Hard rules the runner enforces — violations fail immediately with an error naming the replacement:",
    "- Navigate with `page.goto()` using relative paths; `baseURL` is preconfigured.",
    "- Find controls with `getByRole`, `getByLabel`, `getByPlaceholder`, or `getByText`; `$`/`$$`/`$eval` and element handles are blocked.",
    "- Assert only with `await expect(locator or page).toBeVisible/toHaveText/toContainText/toHaveValue/toHaveCount/toHaveURL(...)`. These auto-wait and retry, so never add manual `{ timeout }` values, `waitForTimeout`, `waitForLoadState`, `networkidle`, or any `waitFor*` helper.",
    "- Never scrape page text (`innerText`, `textContent`, `allInnerTexts`, `innerHTML`) into variables, and never pass plain strings, numbers, or other non-locator values to `expect(...)`.",
    "- No `page.evaluate`, `setContent`, `dispatchEvent`, DOM mutation, localStorage/sessionStorage, network mocking, or API calls to fake UI state.",
    "Every deterministic UI test must use at least one `step()`, perform at least one page/locator/keyboard action inside a step, and make an `expect(...)` assertion after the last action so the test proves the UI reached the expected state.",
    '`step("label", async () => { ... })` produces the pass/fail checklist and updates the visible video overlay. `annotate("label")` adds a short visible annotation to the desktop recording; steps already narrate the flow, so only annotate details a step title does not cover.',
    "Run deterministic UI tests with the `cloudcode_ui_tests` MCP tools, especially `ui_tests_list` and `ui_tests_run`. The runner launches Playwright headed inside the Daytona desktop, sizes the browser to the actual desktop, records only the test execution window, and drives the app through visible browser actions.",
    "When deterministic UI tests are the requested verification path, do not first rehearse the same flow with the desktop or browser tools. Write or update the `.cloudcode/tests` spec and run it with `ui_tests_run` directly.",
    "Do not create screenshot, trace, or Playwright video artifacts for this flow. The Daytona desktop recording is the proof artifact.",
    "Do not start or restart the app server for UI tests. Assume the user's dev server is already running; pass `baseUrl` to `ui_tests_run` when the app is not on `http://127.0.0.1:3000`.",
    "",
    "A shell fallback is also available as `cloudcode-computer`, including `cloudcode-computer terminal '<command>'`, but prefer the MCP tools because screenshots are returned as inspectable images.",
    "",
    "## GitHub Operations",
    "",
    "Cloudcode preconfigures GitHub HTTPS credentials in this sandbox when the user has connected GitHub.",
    "Use ordinary `git` commands for repository writes: `git status`, `git add`, `git commit`, and `git push`.",
    "Use the `cloudcode_github` MCP server for every GitHub operation other than ordinary `git` repository work and authenticated fetch/push.",
    "Never use the `gh` CLI, call the GitHub REST or GraphQL API directly (including through `curl`, `fetch`, or scripts), or use another GitHub MCP server or integration.",
    "For pull requests, use `cloudcode_github.pull_request_create`. If the Cloudcode MCP is unavailable or does not support a requested operation, do not fall back to another GitHub interface; explain the limitation to the user.",
  ].join("\n")
}

function desktopCodexConfig(
  paths: Pick<DaytonaSandboxPaths, "codexHome" | "home" | "repoPath">,
  sandbox: Pick<Sandbox, "id" | "toolboxProxyUrl">,
  toolboxAuthKey: string
) {
  const desktopStateDir = `${paths.codexHome}/desktop/state`
  return [
    "[mcp_servers.cloudcode_desktop]",
    `command = ${JSON.stringify(`${paths.codexHome}/desktop/cloudcode-desktop-mcp.mjs`)}`,
    "startup_timeout_sec = 20",
    // The first browser_* call may install the pinned Playwright runtime.
    "tool_timeout_sec = 240",
    "",
    "[mcp_servers.cloudcode_desktop.env]",
    `CODEX_HOME = ${JSON.stringify(paths.codexHome)}`,
    `CLOUDCODE_REPO_PATH = ${JSON.stringify(paths.repoPath)}`,
    `CLOUDCODE_DESKTOP_STATE_DIR = ${JSON.stringify(desktopStateDir)}`,
    `CLOUDCODE_BROWSER_COMMAND = ${JSON.stringify(DESKTOP_BROWSER_COMMAND)}`,
    `CLOUDCODE_PLAYWRIGHT_RUNTIME_DIR = ${JSON.stringify(`${paths.codexHome}/ui-tests/runtime`)}`,
    `CLOUDCODE_TERMINAL_HOME = ${JSON.stringify(paths.home)}`,
    `CLOUDCODE_TERMINAL_PATH = ${JSON.stringify(daytonaTerminalPath(paths.home))}`,
    `CLOUDCODE_DAYTONA_SANDBOX_ID = ${JSON.stringify(sandbox.id)}`,
    `CLOUDCODE_DAYTONA_TOOLBOX_AUTH_KEY = ${JSON.stringify(toolboxAuthKey)}`,
    `CLOUDCODE_DAYTONA_TOOLBOX_BASE_URL = ${JSON.stringify(sandbox.toolboxProxyUrl)}`,
    'CLOUDCODE_DESKTOP_DISPLAY = ":0"',
    "",
    "[mcp_servers.cloudcode_ui_tests]",
    `command = ${JSON.stringify(`${paths.codexHome}/ui-tests/cloudcode-ui-tests-mcp.mjs`)}`,
    "startup_timeout_sec = 20",
    "tool_timeout_sec = 900",
    "",
    "[mcp_servers.cloudcode_ui_tests.env]",
    `CODEX_HOME = ${JSON.stringify(paths.codexHome)}`,
    ...Object.entries(
      uiTestsServerEnv({
        paths,
        sandboxId: sandbox.id,
        toolboxAuthKey,
        toolboxBaseUrl: sandbox.toolboxProxyUrl,
      })
    ).map(([key, value]) => `${key} = ${JSON.stringify(value)}`),
    "",
  ].join("\n")
}

export function daytonaDesktopToolContentFingerprint() {
  return sha256(
    [
      desktopMcpServerScript(),
      uiTestsToolContentFingerprint(),
      daytonaDesktopAgentsMd(),
      desktopCodexConfig(
        {
          codexHome: "$CODEX_HOME",
          home: "$HOME",
          repoPath: "$REPO_PATH",
        },
        {
          id: "$DAYTONA_SANDBOX_ID",
          toolboxProxyUrl: "$DAYTONA_TOOLBOX_BASE_URL",
        },
        "$DAYTONA_TOOLBOX_AUTH_KEY"
      ),
    ].join("\0")
  )
}

function desktopToolFingerprint({
  agentsMd,
  agentsPath,
  binPath,
  config,
  configPath,
  script,
  scriptPath,
}: {
  agentsMd: string
  agentsPath: string
  binPath: string
  config: string
  configPath: string
  script: string
  scriptPath: string
}) {
  return sha256(
    [
      scriptPath,
      binPath,
      agentsPath,
      configPath,
      script,
      agentsMd,
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
  const uiTestsScript = uiTestsMcpServerScript()
  const uiTestsPackageJson = uiTestsCloudcodeTestPackageJson()
  const uiTestsPackageIndex = uiTestsCloudcodeTestIndex()
  const uiTestsPackageTypes = uiTestsCloudcodeTestTypes()
  const uiTestsReporter = uiTestsReporterScript()
  const agentsMd = [daytonaDesktopAgentsMd(), extras.instructions]
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
  const uiTestsScriptPath = `${paths.codexHome}/ui-tests/cloudcode-ui-tests-mcp.mjs`
  const uiTestsBinPath = `${paths.home}/.local/bin/cloudcode-ui-tests`
  const uiTestsPackageDir = `${paths.codexHome}/ui-tests/cloudcode-test`
  const uiTestsPackageJsonPath = `${uiTestsPackageDir}/package.json`
  const uiTestsPackageIndexPath = `${uiTestsPackageDir}/index.cjs`
  const uiTestsPackageTypesPath = `${uiTestsPackageDir}/index.d.ts`
  const uiTestsReporterPath = `${paths.codexHome}/ui-tests/cloudcode-ui-tests-reporter.cjs`
  const binPath = `${paths.home}/.local/bin/cloudcode-computer`
  const agentsMdPath = `${paths.codexHome}/AGENTS.md`
  const configPath = `${paths.codexHome}/config.toml`
  const markerPath = `${paths.codexHome}/desktop/tool-version`
  const fingerprint = desktopToolFingerprint({
    agentsMd,
    agentsPath: agentsMdPath,
    binPath: [binPath, uiTestsBinPath].join("\0"),
    config,
    configPath,
    script: [
      script,
      uiTestsScript,
      uiTestsPackageJson,
      uiTestsPackageIndex,
      uiTestsPackageTypes,
      uiTestsReporter,
    ].join("\0"),
    scriptPath: [
      scriptPath,
      uiTestsScriptPath,
      uiTestsPackageJsonPath,
      uiTestsPackageIndexPath,
      uiTestsPackageTypesPath,
      uiTestsReporterPath,
    ].join("\0"),
  })

  const marker = await runDaytonaCommand(
    sandbox,
    [
      "set -e",
      `fingerprint=${shellQuote(fingerprint)}`,
      `test -x ${shellQuote(scriptPath)}`,
      `test -x ${shellQuote(uiTestsScriptPath)}`,
      `test -L ${shellQuote(binPath)}`,
      `test -L ${shellQuote(uiTestsBinPath)}`,
      `test -s ${shellQuote(uiTestsPackageJsonPath)}`,
      `test -s ${shellQuote(uiTestsPackageIndexPath)}`,
      `test -s ${shellQuote(uiTestsPackageTypesPath)}`,
      `test -s ${shellQuote(uiTestsReporterPath)}`,
      `test -s ${shellQuote(agentsMdPath)}`,
      `test -s ${shellQuote(configPath)}`,
      `grep -qxF -- "$fingerprint" ${shellQuote(markerPath)}`,
    ].join("\n"),
    { signal, timeoutMs: 10_000 }
  ).catch(() => undefined)
  if (marker?.exitCode === 0) return

  await ensureDaytonaDesktopDependencies(sandbox, signal)

  // The generated scripts are far larger than Linux's per-argument limit
  // (MAX_ARG_STRLEN, ~128KB), so upload them through the filesystem API and
  // keep the shell commands down to mkdir/symlink/marker plumbing.
  const prepare = await runDaytonaCommand(
    sandbox,
    `mkdir -p ${shellQuote(`${paths.codexHome}/desktop/state`)} ${shellQuote(`${paths.codexHome}/ui-tests`)} ${shellQuote(uiTestsPackageDir)} ${shellQuote(`${paths.home}/.local/bin`)}`,
    { signal, timeoutMs: 10_000 }
  )
  if (prepare.exitCode !== 0) {
    throw new Error(
      prepare.stderr.trim() ||
        prepare.stdout.trim() ||
        "Unable to prepare Daytona desktop tool directories."
    )
  }

  await sandbox.fs.uploadFiles(
    [
      { content: script, path: scriptPath },
      { content: uiTestsScript, path: uiTestsScriptPath },
      { content: uiTestsPackageJson, path: uiTestsPackageJsonPath },
      { content: uiTestsPackageIndex, path: uiTestsPackageIndexPath },
      { content: uiTestsPackageTypes, path: uiTestsPackageTypesPath },
      { content: uiTestsReporter, path: uiTestsReporterPath },
      { content: agentsMd, path: agentsMdPath },
      { content: config, path: configPath },
    ].map(({ content, path }) => ({
      destination: path,
      source: Buffer.from(content, "utf8"),
    }))
  )

  const result = await runDaytonaCommand(
    sandbox,
    [
      "set -e",
      `ln -sf ${shellQuote(scriptPath)} ${shellQuote(binPath)}`,
      `ln -sf ${shellQuote(uiTestsScriptPath)} ${shellQuote(uiTestsBinPath)}`,
      `chmod +x ${shellQuote(scriptPath)} ${shellQuote(binPath)} ${shellQuote(uiTestsScriptPath)} ${shellQuote(uiTestsBinPath)}`,
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
