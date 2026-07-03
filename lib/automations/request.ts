import {
  parseAutomationName,
  parseAutomationSandboxRetention,
  parseAutomationTaskPrompt,
  parseAutomationThreadMode,
  type AutomationSandboxRetention,
  type AutomationThreadMode,
} from "@/lib/automations/config"
import {
  validateAutomationCron,
  validateAutomationTimezone,
} from "@/lib/automations/schedule"
import { MODELS, type Model } from "@/lib/chat/options"
import { parseBranchMode, type BranchMode } from "@/lib/codex/branch-names"
import {
  CODEX_REASONING_EFFORT_ERROR,
  CODEX_SPEED_ERROR,
  parseCodexReasoningEffort,
  parseCodexSpeed,
  type CodexSpeed,
  type ReasoningEffort,
} from "@/lib/codex/run-options"
import { jsonRawStringField, type JsonRecord } from "@/lib/http/api-route"

export type AutomationRequestConfig = {
  baseBranch?: string
  branchMode: BranchMode
  branchName?: string
  cron: string
  model: Model
  name: string
  profile?: string
  prompt: string
  reasoningEffort: ReasoningEffort
  repoUrl: string
  sandboxPresetId?: string
  sandboxRetention: AutomationSandboxRetention
  speed: CodexSpeed
  threadMode: AutomationThreadMode
  timezone: string
}

// Shared by the create and update routes so both validate identically.
export function parseAutomationRequestConfig(
  body: JsonRecord
): AutomationRequestConfig {
  const repoUrl =
    typeof body.repoUrl === "string" ? body.repoUrl.trim() : undefined
  if (!repoUrl) throw new Error("repoUrl is required.")

  const model =
    typeof body.model === "string" &&
    (MODELS as readonly string[]).includes(body.model)
      ? (body.model as Model)
      : undefined
  if (!model) throw new Error(`model must be one of ${MODELS.join(", ")}.`)

  const reasoningEffort = parseCodexReasoningEffort(body.reasoningEffort)
  if (!reasoningEffort) throw new Error(CODEX_REASONING_EFFORT_ERROR)

  const speed = parseCodexSpeed(body.speed)
  if (!speed) throw new Error(CODEX_SPEED_ERROR)

  const branchName = jsonRawStringField(body, "branchName")?.trim()
  const branchMode = parseBranchMode(body.branchMode)

  return {
    baseBranch: jsonRawStringField(body, "baseBranch"),
    // Custom branch mode without a name degrades to auto, mirroring the chat
    // composer's behavior.
    branchMode: branchMode === "custom" && !branchName ? "auto" : branchMode,
    branchName: branchMode === "custom" ? branchName || undefined : undefined,
    cron: validateAutomationCron(body.cron),
    model,
    name: parseAutomationName(body.name),
    profile: jsonRawStringField(body, "profile"),
    prompt: parseAutomationTaskPrompt(body.prompt),
    reasoningEffort,
    repoUrl,
    sandboxPresetId: jsonRawStringField(body, "sandboxPresetId"),
    sandboxRetention: parseAutomationSandboxRetention(body.sandboxRetention),
    speed,
    threadMode: parseAutomationThreadMode(body.threadMode),
    timezone: validateAutomationTimezone(body.timezone),
  }
}
