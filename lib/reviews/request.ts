import { MODELS, type Model } from "@/lib/chat/options"
import {
  CODEX_REASONING_EFFORT_ERROR,
  CODEX_SPEED_ERROR,
  parseCodexReasoningEffort,
  parseCodexSpeed,
  type CodexSpeed,
  type ReasoningEffort,
} from "@/lib/codex/run-options"
import { canonicalGitHubRepoUrl } from "@/lib/github/repo"
import { jsonRawStringField, type JsonRecord } from "@/lib/http/api-route"
import {
  parseReviewAutoEnvironment,
  parseReviewName,
  parseReviewPrompt,
  parseReviewReadyForReview,
} from "@/lib/reviews/config"

export type ReviewRequestConfig = {
  autoEnvironment: boolean
  model: Model
  name: string
  profile?: string
  prompt?: string
  reasoningEffort: ReasoningEffort
  repoUrl: string
  reviewReadyForReview: boolean
  sandboxPresetId?: string
  speed: CodexSpeed
}

// Shared by the create and update routes so both validate identically.
export function parseReviewRequestConfig(
  body: JsonRecord
): ReviewRequestConfig {
  const repoUrl =
    typeof body.repoUrl === "string"
      ? canonicalGitHubRepoUrl(body.repoUrl)
      : null
  if (!repoUrl) {
    throw new Error("repoUrl is required and must be a GitHub repository URL.")
  }

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

  return {
    autoEnvironment: parseReviewAutoEnvironment(body.autoEnvironment),
    model,
    name: parseReviewName(body.name),
    profile: jsonRawStringField(body, "profile"),
    prompt: parseReviewPrompt(body.prompt),
    reasoningEffort,
    repoUrl,
    reviewReadyForReview: parseReviewReadyForReview(body.reviewReadyForReview),
    sandboxPresetId: jsonRawStringField(body, "sandboxPresetId"),
    speed,
  }
}
