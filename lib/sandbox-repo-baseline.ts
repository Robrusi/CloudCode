import type { Sandbox } from "@daytona/sdk"

import {
  readDaytonaTextFile,
  runDaytonaCommand,
  shellQuote,
  writeDaytonaTextFile,
  type DaytonaSandboxPaths,
} from "@/lib/daytona-sandbox"

const AUTO_ENVIRONMENT_REPO_BASELINE_DIR = "auto-environment-repo-baseline"

function baselinePath(paths: DaytonaSandboxPaths) {
  return `${paths.codexHome}/${AUTO_ENVIRONMENT_REPO_BASELINE_DIR}`
}

function safePathFilter() {
  return [
    'case "$file" in',
    '  ""|/*|../*|*/../*|.git|.git/*) continue ;;',
    "esac",
  ].join("\n")
}

export async function saveAutoEnvironmentRepoBaseline(
  sandbox: Sandbox,
  paths: DaytonaSandboxPaths,
  signal?: AbortSignal
) {
  const baseline = baselinePath(paths)
  const result = await runDaytonaCommand(
    sandbox,
    [
      "set -eo pipefail",
      `cd ${shellQuote(paths.repoPath)}`,
      `baseline=${shellQuote(baseline)}`,
      'files_dir="$baseline/files"',
      'rm -rf "$baseline"',
      'mkdir -p "$files_dir"',
      'git ls-files -o --exclude-standard -z > "$baseline/files.z"',
      "if [ -f cloudcode.yaml ] && ! git ls-files --error-unmatch -- cloudcode.yaml >/dev/null 2>&1; then",
      '  printf "cloudcode.yaml\\0" >> "$baseline/files.z"',
      "fi",
      'if [ -s "$baseline/files.z" ]; then',
      '  while IFS= read -r -d "" file; do',
      safePathFilter()
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n"),
      '    [ -e "$file" ] || continue',
      '    mkdir -p "$files_dir/$(dirname "$file")"',
      '    cp -a -- "$file" "$files_dir/$file"',
      '  done < "$baseline/files.z"',
      "fi",
    ].join("\n"),
    { signal, timeoutMs: 60_000 }
  )

  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        "Unable to save auto environment repo baseline."
    )
  }
}

export async function restoreAutoEnvironmentRepoBaseline({
  cloudcodeYaml,
  paths,
  sandbox,
  signal,
}: {
  cloudcodeYaml?: string
  paths: DaytonaSandboxPaths
  sandbox: Sandbox
  signal?: AbortSignal
}) {
  const baseline = baselinePath(paths)
  const result = await runDaytonaCommand(
    sandbox,
    [
      "set -eo pipefail",
      `cd ${shellQuote(paths.repoPath)}`,
      `baseline=${shellQuote(baseline)}`,
      'files_dir="$baseline/files"',
      "if git rev-parse --verify HEAD >/dev/null 2>&1; then",
      "  git reset --hard HEAD",
      "fi",
      "git clean -fd",
      'if [ -d "$baseline" ]; then',
      '  if [ -d "$files_dir" ]; then',
      '    cp -a "$files_dir"/. .',
      "  fi",
      '  printf "baseline=1\\n"',
      "else",
      '  printf "baseline=0\\n"',
      "fi",
      '[ -f cloudcode.yaml ] && printf "cloudcode_yaml=1\\n" || printf "cloudcode_yaml=0\\n"',
    ].join("\n"),
    { signal, timeoutMs: 60_000 }
  )

  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        "Unable to restore auto environment repo baseline."
    )
  }

  const hasCloudcodeYaml = /^cloudcode_yaml=1$/m.test(result.stdout)
  if (hasCloudcodeYaml || !cloudcodeYaml?.trim()) return

  const currentCloudcodeYaml = await readDaytonaTextFile(
    sandbox,
    `${paths.repoPath}/cloudcode.yaml`
  ).catch(() => "")
  if (currentCloudcodeYaml.trim()) return

  await writeDaytonaTextFile(
    sandbox,
    `${paths.repoPath}/cloudcode.yaml`,
    cloudcodeYaml
  )
}
