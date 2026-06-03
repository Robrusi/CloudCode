"use client"

import { Loader2, RefreshCw } from "lucide-react"
import {
  type ComponentPropsWithoutRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { cn } from "@/lib/utils"

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

type VideoLoadState = "error" | "loading" | "ready" | "retrying"

const RECORDING_VIDEO_RETRY_DELAYS_MS = [1500, 3000, 6000, 10_000] as const

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

export function RecordingVideo({
  className,
  recording,
  sandboxId,
  ...videoProps
}: {
  className?: string
  recording: RecordingVideoArtifact
  sandboxId?: string | null
} & Omit<ComponentPropsWithoutRef<"video">, "children" | "className" | "src">) {
  const [attempt, setAttempt] = useState(0)
  const [loadState, setLoadState] = useState<VideoLoadState>("loading")
  const retryTimeoutRef = useRef<number | null>(null)
  const resolvedSandboxId = sandboxId ?? recording.sandboxId ?? null
  const sourceKey = `${resolvedSandboxId ?? ""}:${recording.id}`
  const src = useMemo(
    () => recordingRequestUrl(recording, { attempt, sandboxId }),
    [attempt, recording, sandboxId]
  )
  const label = recordingLabel(recording)

  const clearRetryTimer = useCallback(() => {
    if (retryTimeoutRef.current === null) return
    window.clearTimeout(retryTimeoutRef.current)
    retryTimeoutRef.current = null
  }, [])

  useEffect(() => {
    clearRetryTimer()
    setAttempt(0)
    setLoadState("loading")
  }, [clearRetryTimer, sourceKey])

  useEffect(() => clearRetryTimer, [clearRetryTimer])

  const markReady = useCallback(() => {
    clearRetryTimer()
    setLoadState("ready")
  }, [clearRetryTimer])

  const retryNow = useCallback(() => {
    clearRetryTimer()
    setLoadState("loading")
    setAttempt((value) => value + 1)
  }, [clearRetryTimer])

  const scheduleRetry = useCallback(() => {
    clearRetryTimer()
    const delay = RECORDING_VIDEO_RETRY_DELAYS_MS[attempt]
    if (delay === undefined) {
      setLoadState("error")
      return
    }

    setLoadState("retrying")
    retryTimeoutRef.current = window.setTimeout(() => {
      retryTimeoutRef.current = null
      setLoadState("loading")
      setAttempt((value) => value + 1)
    }, delay)
  }, [attempt, clearRetryTimer])

  if (!src) return null

  const loading = loadState === "loading" || loadState === "retrying"
  const statusText =
    loadState === "error"
      ? "Video could not load."
      : loadState === "retrying"
        ? "Retrying video..."
        : "Preparing video..."

  return (
    <div className="relative overflow-hidden rounded-lg border border-border/60 bg-muted">
      <video
        {...videoProps}
        aria-label={videoProps["aria-label"] ?? `Recording video: ${label}`}
        controls
        playsInline
        preload={videoProps.preload ?? "metadata"}
        src={src}
        className={cn("aspect-video w-full bg-muted", className)}
        onCanPlay={(event) => {
          markReady()
          videoProps.onCanPlay?.(event)
        }}
        onError={(event) => {
          scheduleRetry()
          videoProps.onError?.(event)
        }}
        onLoadedMetadata={(event) => {
          markReady()
          videoProps.onLoadedMetadata?.(event)
        }}
        onLoadStart={(event) => {
          if (loadState !== "ready") setLoadState("loading")
          videoProps.onLoadStart?.(event)
        }}
      >
        <track kind="captions" label="No captions" />
      </video>
      {loadState !== "ready" ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-muted/60 px-4 text-center backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <button
                type="button"
                onClick={retryNow}
                className="pointer-events-auto grid size-7 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                aria-label="Retry video"
                title="Retry video"
              >
                <RefreshCw className="size-3.5" />
              </button>
            )}
            <span>{statusText}</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
