export type RecordingVideoArtifact = {
  fileName?: string
  filePath?: string
  id: string
  sandboxId?: string
  status?: string
}

type RecordingUrlOptions = {
  attempt?: number
  inline?: boolean
  sandboxId?: string | null
}

export function recordingLabel(recording: RecordingVideoArtifact) {
  return (
    recording.fileName || recording.filePath?.split("/").pop() || recording.id
  )
}

export function recordingRequestUrl(
  recording: Pick<RecordingVideoArtifact, "id" | "sandboxId">,
  options: RecordingUrlOptions = {}
) {
  const sandboxId = (options.sandboxId ?? recording.sandboxId)?.trim()
  if (!sandboxId || !recording.id) return null

  return `/api/sandbox/desktop/recordings?${new URLSearchParams({
    download: "1",
    ...(options.attempt ? { retry: String(options.attempt) } : {}),
    ...(options.inline === false ? {} : { inline: "1" }),
    recordingId: recording.id,
    sandboxId,
  })}`
}
