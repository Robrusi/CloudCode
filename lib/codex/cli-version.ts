const DEFAULT_CODEX_CLI_VERSION = "0.136.0"

export function desiredCodexCliVersion() {
  return (
    process.env.CLOUDCODE_CODEX_CLI_VERSION?.trim() || DEFAULT_CODEX_CLI_VERSION
  )
}

export function codexCliPackageName(version = desiredCodexCliVersion()) {
  return version === "latest"
    ? "@openai/codex@latest"
    : `@openai/codex@${version}`
}

export function codexCliVersionOutput(version = desiredCodexCliVersion()) {
  return `codex-cli ${version}`
}
