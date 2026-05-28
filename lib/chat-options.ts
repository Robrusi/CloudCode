import type { BranchMode } from "./codex-branch-names"

export type { BranchMode }

export const MODELS = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"] as const
export type Model = (typeof MODELS)[number]

export const BRANCH_MODES = ["auto", "custom", "base"] as const

export const BRANCH_MODE_LABEL: Record<BranchMode, string> = {
  auto: "New branch",
  custom: "Custom name",
  base: "Continue on base",
}

export const SPEEDS = ["standard", "fast"] as const
export type Speed = (typeof SPEEDS)[number]

export const THINKINGS = ["none", "low", "medium", "high", "xhigh"] as const
export type Thinking = (typeof THINKINGS)[number]

export const MODEL_LABEL: Record<Model, string> = {
  "gpt-5.5": "GPT 5.5",
  "gpt-5.4": "GPT 5.4",
  "gpt-5.4-mini": "GPT 5.4-mini",
}

export const SPEED_LABEL: Record<Speed, string> = {
  standard: "Standard",
  fast: "Fast",
}

export const THINKING_LABEL: Record<Thinking, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
}
