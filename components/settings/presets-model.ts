import type { DotenvParseResult, ParsedEnvVar } from "@/lib/env/dotenv-parse"
import type { SandboxPresetRecord } from "@/lib/sandbox/preset-types"

export function presetRepoLabel(repoUrl: string) {
  return repoUrl.replace(/^https?:\/\//, "")
}

export function sandboxPresetSubtitle(preset: SandboxPresetRecord) {
  const readyEnvironments =
    preset.environments?.filter((environment) => environment.status === "ready")
      .length ?? 0

  return (
    [
      preset.mode === "auto" ? "Auto environment" : "",
      preset.mode === "auto" && readyEnvironments
        ? `${readyEnvironments} ready`
        : "",
      preset.pathInstallScript ? "PATH tools" : "",
      preset.installScript ? "repo install" : "",
      preset.secrets.length
        ? `${preset.secrets.length} secret${preset.secrets.length === 1 ? "" : "s"}`
        : "",
    ]
      .filter(Boolean)
      .join(" · ") || "Cloudcode default environment"
  )
}

export function dotenvImportSummary({
  importText,
  importVars,
  parsedImport,
}: {
  importText: string
  importVars: ParsedEnvVar[]
  parsedImport: DotenvParseResult
}) {
  if (importVars.length > 0) {
    return `${importVars.length} variable${
      importVars.length === 1 ? "" : "s"
    } detected${
      parsedImport.errors.length
        ? ` · ${parsedImport.errors.length} line${
            parsedImport.errors.length === 1 ? "" : "s"
          } skipped`
        : ""
    }`
  }

  return importText.trim()
    ? "No valid variables found."
    : "Paste KEY=value lines from a .env file."
}
