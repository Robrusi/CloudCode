import {
  parseAutomationAutoEnvironment,
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
import type { Id } from "@/convex/_generated/dataModel"
import type { AutomationTrigger } from "@/convex/lib/integrationTriggers"
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
  autoEnvironment: boolean
  baseBranch?: string
  branchMode: BranchMode
  branchName?: string
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
  trigger: AutomationTrigger
}

function recordField(body: JsonRecord, field: string): JsonRecord | undefined {
  const value = body[field]
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined
}

/** Parses the trigger config out of a request body. Bodies without a trigger
 * object read as the cron kind from the legacy top-level cron/timezone
 * fields, so older clients keep working unchanged. */
function parseAutomationTrigger(body: JsonRecord): AutomationTrigger {
  const raw = recordField(body, "trigger")
  const kind = raw?.kind

  if (!raw || kind === "cron") {
    const cron = raw ? raw.cron : body.cron
    const timezone = raw ? raw.timezone : body.timezone
    return {
      cron: validateAutomationCron(cron),
      kind: "cron",
      timezone: validateAutomationTimezone(timezone),
    }
  }

  const installationId = jsonRawStringField(raw, "installationId")?.trim()
  if (!installationId) throw new Error("trigger.installationId is required.")

  if (kind === "slack") {
    const event = raw.event
    if (event !== "keyword" && event !== "reaction") {
      throw new Error("trigger.event must be keyword or reaction.")
    }
    return {
      channelId: jsonRawStringField(raw, "channelId")?.trim() || undefined,
      channelName: jsonRawStringField(raw, "channelName")?.trim() || undefined,
      emoji: jsonRawStringField(raw, "emoji")?.trim() || undefined,
      event,
      installationId: installationId as Id<"integrationInstallations">,
      keyword: jsonRawStringField(raw, "keyword")?.trim() || undefined,
      kind: "slack",
    }
  }

  if (kind === "linear") {
    const event = raw.event
    if (event !== "labelAdded" && event !== "statusChanged") {
      throw new Error("trigger.event must be labelAdded or statusChanged.")
    }
    return {
      event,
      installationId: installationId as Id<"integrationInstallations">,
      labelId: jsonRawStringField(raw, "labelId")?.trim() || undefined,
      labelName: jsonRawStringField(raw, "labelName")?.trim() || undefined,
      stateId: jsonRawStringField(raw, "stateId")?.trim() || undefined,
      stateName: jsonRawStringField(raw, "stateName")?.trim() || undefined,
      teamId: jsonRawStringField(raw, "teamId")?.trim() || undefined,
      teamName: jsonRawStringField(raw, "teamName")?.trim() || undefined,
      kind: "linear",
    }
  }

  throw new Error("trigger.kind must be cron, slack, or linear.")
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
    autoEnvironment: parseAutomationAutoEnvironment(body.autoEnvironment),
    baseBranch: jsonRawStringField(body, "baseBranch"),
    // Custom branch mode without a name degrades to auto, mirroring the chat
    // composer's behavior.
    branchMode: branchMode === "custom" && !branchName ? "auto" : branchMode,
    branchName: branchMode === "custom" ? branchName || undefined : undefined,
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
    trigger: parseAutomationTrigger(body),
  }
}
