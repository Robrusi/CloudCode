import type { Doc } from "@/convex/_generated/dataModel"
import type { Model, Speed, Thinking } from "@/lib/chat/options"
import { DEFAULT_REVIEW_PROMPT } from "@/lib/reviews/prompt"

export type ReviewRecord = Doc<"reviews">

export type ReviewRunStatus = NonNullable<ReviewRecord["lastRunStatus"]>

export const REVIEW_STATUS_LABEL: Record<ReviewRunStatus, string> = {
  canceled: "Canceled",
  dispatch_failed: "Failed to start",
  failed: "Failed",
  running: "Running",
  skipped: "Skipped",
  succeeded: "Succeeded",
}

export type ReviewDraft = {
  authorFilterMode: "" | "allow" | "block"
  authorFilters: string[]
  autoEnvironment: boolean
  autofix: boolean
  model: Model
  name: string
  prompt: string
  reasoningEffort: Thinking
  repoUrl: string
  reviewReadyForReview: boolean
  sandboxPresetId: string
  speed: Speed
}

export function emptyReviewDraft(): ReviewDraft {
  return {
    authorFilterMode: "",
    authorFilters: [],
    autoEnvironment: true,
    autofix: false,
    model: "gpt-5.5",
    name: "",
    prompt: DEFAULT_REVIEW_PROMPT,
    reasoningEffort: "medium",
    repoUrl: "",
    reviewReadyForReview: false,
    sandboxPresetId: "",
    speed: "standard",
  }
}

export function reviewDraftFromRecord(review: ReviewRecord): ReviewDraft {
  return {
    authorFilterMode: review.authorFilterMode ?? "",
    authorFilters: review.authorFilters ?? [],
    autoEnvironment: review.autoEnvironment ?? true,
    autofix: review.autofix ?? false,
    model: review.model,
    name: review.name,
    prompt: review.prompt ?? DEFAULT_REVIEW_PROMPT,
    reasoningEffort: review.reasoningEffort,
    repoUrl: review.repoUrl,
    reviewReadyForReview: review.reviewReadyForReview ?? false,
    sandboxPresetId: review.sandboxPresetId ?? "",
    speed: review.speed,
  }
}

export function reviewRequestBody(draft: ReviewDraft) {
  // An unedited (or cleared) prompt is stored as unset so the config keeps
  // tracking the built-in template when it improves.
  const prompt = draft.prompt.trim()
  return {
    authorFilterMode: draft.authorFilterMode || undefined,
    authorFilters: draft.authorFilters,
    autoEnvironment: draft.autoEnvironment,
    autofix: draft.autofix,
    model: draft.model,
    name: draft.name,
    prompt: prompt !== DEFAULT_REVIEW_PROMPT ? prompt || undefined : undefined,
    reasoningEffort: draft.reasoningEffort,
    repoUrl: draft.repoUrl,
    reviewReadyForReview: draft.reviewReadyForReview,
    sandboxPresetId: draft.sandboxPresetId || undefined,
    speed: draft.speed,
  }
}
