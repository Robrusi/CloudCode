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

import {
  recordingLabel,
  recordingRequestUrl,
  type RecordingVideoArtifact,
} from "@/components/sandbox/recording-video-utils"
import { cn } from "@/lib/shared/utils"

type RecordingVideoProps = {
  className?: string
  recording: RecordingVideoArtifact
  sandboxId?: string | null
} & Omit<ComponentPropsWithoutRef<"video">, "children" | "className" | "src">

type VideoLoadState = "error" | "loading" | "ready" | "retrying"

const RECORDING_VIDEO_RETRY_DELAYS_MS = [1500, 3000, 6000, 10_000] as const

export function RecordingVideo({
  recording,
  sandboxId,
  ...props
}: RecordingVideoProps) {
  const resolvedSandboxId = sandboxId ?? recording.sandboxId ?? null
  return (
    <RecordingVideoInner
      key={`${resolvedSandboxId ?? ""}:${recording.id}`}
      recording={recording}
      sandboxId={sandboxId}
      {...props}
    />
  )
}

function RecordingVideoInner({
  className,
  recording,
  sandboxId,
  ...videoProps
}: RecordingVideoProps) {
  const [attempt, setAttempt] = useState(0)
  const [loadState, setLoadState] = useState<VideoLoadState>("loading")
  const retryTimeoutRef = useRef<number | null>(null)
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
