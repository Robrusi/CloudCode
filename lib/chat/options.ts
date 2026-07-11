import type { BranchMode } from "@/lib/codex/branch-names"

export type { BranchMode }

export const MODELS = [
  "gpt-5.5",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.4",
  "gpt-5.4-mini",
] as const
export type Model = (typeof MODELS)[number]

export function parseModel(value: unknown): Model | undefined {
  return typeof value === "string" &&
    (MODELS as readonly string[]).includes(value)
    ? (value as Model)
    : undefined
}

export const BRANCH_MODES = ["auto", "custom", "base"] as const

export const BRANCH_MODE_LABEL: Record<BranchMode, string> = {
  auto: "New branch",
  custom: "Custom name",
  base: "Continue on base",
}

export const SPEEDS = ["standard", "fast"] as const
export type Speed = (typeof SPEEDS)[number]

const BASE_THINKINGS = ["none", "low", "medium", "high", "xhigh"] as const
const MAX_THINKINGS = [...BASE_THINKINGS, "max"] as const
export const THINKINGS = [...MAX_THINKINGS, "ultra"] as const
export type Thinking = (typeof THINKINGS)[number]

export function parseThinking(value: unknown): Thinking | undefined {
  return typeof value === "string" &&
    (THINKINGS as readonly string[]).includes(value)
    ? (value as Thinking)
    : undefined
}

export const MODEL_LABEL: Record<Model, string> = {
  "gpt-5.5": "GPT 5.5",
  "gpt-5.6-sol": "GPT 5.6 Sol",
  "gpt-5.6-terra": "GPT 5.6 Terra",
  "gpt-5.6-luna": "GPT 5.6 Luna",
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
  max: "Max",
  ultra: "Ultra",
}

const MODEL_THINKINGS: Record<Model, readonly Thinking[]> = {
  "gpt-5.5": BASE_THINKINGS,
  "gpt-5.6-sol": THINKINGS,
  "gpt-5.6-terra": THINKINGS,
  "gpt-5.6-luna": MAX_THINKINGS,
  "gpt-5.4": BASE_THINKINGS,
  "gpt-5.4-mini": BASE_THINKINGS,
}

export function thinkingOptionsForModel(model: Model) {
  return MODEL_THINKINGS[model]
}

export function modelSupportsThinking(model: Model, thinking: Thinking) {
  return MODEL_THINKINGS[model].includes(thinking)
}

export function modelThinkingCompatibilityError(
  model: Model,
  thinking: Thinking
) {
  return `${THINKING_LABEL[thinking]} reasoning is not supported by ${MODEL_LABEL[model]}.`
}

/** Keeps the closest supported effort when a user switches model families. */
export function normalizeThinkingForModel(
  model: Model,
  thinking: Thinking
): Thinking {
  if (modelSupportsThinking(model, thinking)) return thinking
  if (thinking === "ultra" && modelSupportsThinking(model, "max")) {
    return "max"
  }
  return "xhigh"
}

export function assertModelSupportsThinking(
  model: Model,
  thinking: Thinking
): void {
  if (modelSupportsThinking(model, thinking)) return
  throw new Error(modelThinkingCompatibilityError(model, thinking))
}
