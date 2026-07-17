import { compactLine } from "@/lib/shared/compact-line"
import type { CodexRunLog } from "@/lib/codex/run-log"

function stripAnsi(value: string) {
  let output = ""
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 0x1b && value[index + 1] === "[") {
      index += 2
      while (index < value.length) {
        const code = value.charCodeAt(index)
        if (code >= 0x40 && code <= 0x7e) break
        index += 1
      }
      continue
    }
    output += value[index] ?? ""
  }
  return output
}

function isBundledBubblewrapWarning(value: string) {
  const normalized = value.toLowerCase()
  return (
    normalized.includes("codex could not find bubblewrap on path") &&
    normalized.includes("bundled bubblewrap")
  )
}

// Codex CLI logs this when its models cache file is empty or stale. The CLI
// refetches models and the turn is unaffected, but the ERROR-level line reads
// like a run failure, so keep it out of the user-facing log stream. It stays
// in the raw stderr diagnostics attached to real failures.
function isModelsCacheTtlNoise(value: string) {
  return value.toLowerCase().includes("failed to renew cache ttl")
}

export function codexAppServerStderrLogForLine(
  line: string,
  options: { bundledBubblewrapWarningAlreadyLogged?: boolean } = {}
): CodexRunLog | undefined {
  const clean = stripAnsi(line)
  const trimmed = compactLine(clean)
  if (!trimmed) return undefined

  if (isModelsCacheTtlNoise(clean)) return undefined

  if (isBundledBubblewrapWarning(clean)) {
    if (options.bundledBubblewrapWarningAlreadyLogged) return undefined
    return {
      kind: "setup",
      message: "Codex using bundled bubblewrap sandbox helper",
    }
  }

  return { kind: "stderr", message: trimmed }
}
