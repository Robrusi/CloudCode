import type { StoredCodexRunLog } from "@/lib/codex/run-log"
import type { ChatImageAttachment } from "@/lib/chat/attachments"
import type { BranchMode, Model, Speed, Thinking } from "@/lib/chat/options"
import type { Id } from "@/convex/_generated/dataModel"
import type { SandboxState } from "@/components/chat/sandbox-types"

export type Role = "user" | "assistant"

export type Message = {
  attachments?: ChatImageAttachment[]
  id: Id<"messages">
  role: Role
  content: string
  createdAt?: number
  pending?: boolean
  error?: boolean
  meta?: {
    branch?: string
    diff?: string
    logs?: StoredCodexRunLog[]
    status?: string
  }
  speed?: Speed
  thinking?: Thinking
}

export type CachedRunState = {
  branch?: string
  codexThreadId?: string
  diff?: string
  sandboxId?: string
  sandboxState?: SandboxState
}

export type ChatRecord = {
  automationId?: Id<"automations">
  baseBranch?: string
  branchMode?: BranchMode
  codexThreadId?: string
  id: Id<"threads">
  lastUserMessageAt?: number
  notes?: string
  repoUrl: string
  sandboxPresetId?: Id<"sandboxPresets">
  sandboxPresetName?: string
  sandboxId?: string
  sandboxState?: SandboxState
  title: string
  messages: Message[]
  model: Model
  pending?: boolean
  createdAt: number
  updatedAt: number
}

export type LiveRunRecord = {
  assistantMessageId: Id<"messages">
  branch?: string
  codexThreadId?: string
  content: string
  error?: string
  lastStreamId?: string
  logs: StoredCodexRunLog[]
  pending: boolean
  runId: Id<"codexRuns">
  sandboxId?: string
  sandboxState?: SandboxState
  status: string
  threadId: Id<"threads">
  triggerRunId?: string
  updatedAt: number
}

export type OptimisticRun = {
  baseMessageCount: number
  messages: Message[]
}

export type DraftImageAttachment = {
  error?: string
  id: string
  kind: "image"
  mimeType: string
  name: string
  objectUrl?: string
  size: number
  status: "ready" | "uploading" | "failed"
  url?: string
}

export type QueuedMessage = {
  attachments: ChatImageAttachment[]
  id: string
  text: string
}
