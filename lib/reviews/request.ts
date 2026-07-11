import {
  MODELS,
  assertModelSupportsThinking,
  parseModel,
  type Model,
} from "@/lib/chat/options"
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
  parseReviewAuthorFilterMode,
  parseReviewAuthorFilters,
  parseReviewAutoEnvironment,
  parseReviewAutofix,
  parseReviewName,
  parseReviewOnPush,
  parseReviewPrompt,
  parseReviewReadyForReview,
  type ReviewAuthorFilterMode,
} from "@/lib/reviews/config"

export type ReviewRequestConfig = {
  authorFilterMode?: ReviewAuthorFilterMode
  authorFilters: string[]
  autoEnvironment: boolean
  autofix: boolean
  model: Model
  name: string
  profile?: string
  prompt?: string
  reasoningEffort: ReasoningEffort
  repoUrl: string
  reviewOnPush: boolean
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

  const model = parseModel(body.model)
  if (!model) throw new Error(`model must be one of ${MODELS.join(", ")}.`)

  const reasoningEffort = parseCodexReasoningEffort(body.reasoningEffort)
  if (!reasoningEffort) throw new Error(CODEX_REASONING_EFFORT_ERROR)
  assertModelSupportsThinking(model, reasoningEffort)

  const speed = parseCodexSpeed(body.speed)
  if (!speed) throw new Error(CODEX_SPEED_ERROR)

  return {
    authorFilterMode: parseReviewAuthorFilterMode(body.authorFilterMode),
    authorFilters: parseReviewAuthorFilters(body.authorFilters),
    autoEnvironment: parseReviewAutoEnvironment(body.autoEnvironment),
    autofix: parseReviewAutofix(body.autofix),
    model,
    name: parseReviewName(body.name),
    profile: jsonRawStringField(body, "profile"),
    prompt: parseReviewPrompt(body.prompt),
    reasoningEffort,
    repoUrl,
    reviewOnPush: parseReviewOnPush(body.reviewOnPush),
    reviewReadyForReview: parseReviewReadyForReview(body.reviewReadyForReview),
    sandboxPresetId: jsonRawStringField(body, "sandboxPresetId"),
    speed,
  }
}
