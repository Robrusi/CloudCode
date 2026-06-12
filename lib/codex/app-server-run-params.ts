import type { DaytonaSandboxPaths } from "@/lib/daytona/sandbox"
import type { CodexSpeed, ReasoningEffort } from "@/lib/codex/run-options"

export function appServerThreadParams({
  model,
  paths,
  reasoningEffort,
  speed,
}: {
  model?: string
  paths: DaytonaSandboxPaths
  reasoningEffort?: ReasoningEffort
  speed: CodexSpeed
}) {
  const config = {
    approval_policy: "never",
    sandbox_mode: "danger-full-access",
    ...(reasoningEffort ? { model_reasoning_effort: reasoningEffort } : {}),
    ...(speed === "fast" ? { service_tier: "fast" } : {}),
  }

  return {
    approvalPolicy: "never" as const,
    config,
    cwd: paths.repoPath,
    ephemeral: false,
    ...(model ? { model } : {}),
    sandbox: "danger-full-access" as const,
    serviceName: "cloudcode",
    ...(speed === "fast" ? { serviceTier: "fast" } : {}),
  }
}

export function appServerTurnParams({
  model,
  paths,
  prompt,
  reasoningEffort,
  speed,
  threadId,
}: {
  model?: string
  paths: DaytonaSandboxPaths
  prompt: string
  reasoningEffort?: ReasoningEffort
  speed: CodexSpeed
  threadId: string
}) {
  return {
    approvalPolicy: "never" as const,
    cwd: paths.repoPath,
    input: [{ text: prompt, text_elements: [] as [], type: "text" as const }],
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { effort: reasoningEffort } : {}),
    sandboxPolicy: { type: "dangerFullAccess" as const },
    ...(speed === "fast" ? { serviceTier: "fast" } : {}),
    threadId,
  }
}
