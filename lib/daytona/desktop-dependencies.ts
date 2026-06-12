import type { Sandbox } from "@daytona/sdk"

import { runDaytonaCommand, shellQuote } from "@/lib/daytona/sandbox"

export const DESKTOP_BROWSER_COMMAND = "/usr/local/bin/cloudcode-browser"

const DESKTOP_DEPENDENCY_TIMEOUT_MS = 10 * 60 * 1000

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
browser_locale="\${CLOUDCODE_BROWSER_LANG:-en-US}"
browser_accept_languages="\${CLOUDCODE_BROWSER_ACCEPT_LANGUAGES:-en-US,en}"
mkdir -p "$profile"
exec "$browser" \\
  --no-sandbox \\
  --test-type \\
  --disable-dev-shm-usage \\
  --lang="$browser_locale" \\
  --accept-lang="$browser_accept_languages" \\
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
