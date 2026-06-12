import type { RecordingVideoArtifact } from "@/components/sandbox/recording-video-utils"

export type RecordingArtifact = RecordingVideoArtifact

export type ToolDetailLog = {
  detail?: string
  id: string
  kind: string
}

export type ParsedLogDetail = {
  changes?: Array<{
    diff?: string
    kind?: string
    path?: string
  }>
  command?: string
  exitCode?: number
  itemId?: string
  kind?: string
  name?: string
  output?: string
  recording?: RecordingArtifact
  renderKey?: string
  status?: string
  text?: string
}
