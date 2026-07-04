import type { ChatImageAttachment } from "@/lib/chat/attachments"
import type { CodexSpeed, ReasoningEffort } from "@/lib/codex/run-options"
import type { CodexRunLog as RunCodexLog } from "@/lib/codex/run-log"
import type { McpServerInput } from "@/lib/daytona/codex-runtime"
import type { DaytonaDesktopRecordingArtifact } from "@/lib/daytona/desktop"
import type { McpDiscoveredServer } from "@/lib/mcp/discovery"
import type { SandboxPresetEnvVar } from "@/lib/sandbox/env"

export type SandboxPresetInput = {
  cloudcodeYaml?: string
  daytonaSnapshot?: string
  installScript?: string
  mode?: "manual" | "auto"
  name: string
  pathInstallScript?: string
  secrets: SandboxPresetEnvVar[]
}

export type RunCodexInSandboxInput = {
  agentInstructions?: string
  authJson: string
  baseBranch?: string
  branchMode?: "auto" | "custom" | "base"
  branchName?: string
  codexThreadId?: string
  convexUrl?: string
  githubToken?: string
  githubUserEmail?: string
  githubUserName?: string
  githubUsername?: string
  imageAttachments?: ChatImageAttachment[]
  mcpServers?: McpServerInput[]
  model?: string
  notesAccessToken?: string
  onAuthRefreshRequest?: (request: {
    previousAccountId?: string
    requestId: string
  }) => Promise<{
    authJson: string
    result: Record<string, unknown>
  }>
  onContentDelta?: (delta: string) => void | Promise<void>
  onLog?: (log: RunCodexLog) => void | Promise<void>
  onMcpServerToolsDiscovered?: (
    servers: McpDiscoveredServer[]
  ) => void | Promise<void>
  previousDiff?: string
  // Review runs check out refs/pull/<n>/head instead of a work branch.
  prNumber?: number
  prompt: string
  reasoningEffort?: ReasoningEffort
  resumeContext?: string
  repoUrl: string
  runId?: string
  sandboxId?: string
  sandboxIdleMinutes?: number
  sandboxPreset?: SandboxPresetInput
  signal?: AbortSignal
  speed?: CodexSpeed
  threadId?: string
  userId?: string
}

export type RunCodexInSandboxResult = {
  branchName: string
  codexThreadId?: string
  desktopRecording?: DaytonaDesktopRecordingArtifact
  desktopRecordings?: DaytonaDesktopRecordingArtifact[]
  diff: string
  exitCode: number
  lastMessage: string
  lastMessageAuthoritative?: boolean
  repoUrl: string
  sandboxId: string
  stderr: string
  status: string
  stdout: string
  updatedAuthJson: string
  recoveredSandbox: boolean
}
