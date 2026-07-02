"use client"

import { Loader2, Play, RefreshCw } from "lucide-react"
import { type ComponentPropsWithoutRef, useRef } from "react"

import { useRecordingSource } from "@/components/sandbox/recording-source"
import {
  recordingLabel,
  type RecordingVideoArtifact,
} from "@/components/sandbox/recording-video-utils"
import { cn } from "@/lib/shared/utils"

type RecordingVideoProps = {
  className?: string
  recording: RecordingVideoArtifact
  sandboxId?: string | null
} & Omit<ComponentPropsWithoutRef<"video">, "children" | "className" | "src">

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
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const {
    errorMessage,
    hasRecording,
    loadState,
    markReady,
    materialize,
    notifyLoadStart,
    preparing,
    retryNow,
    scheduleRetry,
    src,
  } = useRecordingSource({ recording, sandboxId })
  const label = recordingLabel(recording)

  if (!src) {
    const checking = loadState === "checking"
    const failed = loadState === "error"
    const busy = checking || preparing
    const disabled = busy || !hasRecording

    return (
      <div
        className="grid aspect-video place-items-center rounded-lg border border-border/60 bg-muted"
        title={failed ? (errorMessage ?? "Recording could not load.") : label}
      >
        <button
          type="button"
          onClick={() => void materialize()}
          disabled={disabled}
          aria-label={failed ? "Retry loading recording" : "Load recording"}
          className="grid size-12 place-items-center rounded-full border border-border/70 bg-background/70 text-foreground/80 shadow-sm backdrop-blur transition-transform duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring/70 enabled:hover:scale-105 enabled:hover:text-foreground enabled:active:scale-95 disabled:cursor-default disabled:text-muted-foreground"
        >
          {busy ? (
            <Loader2 className="size-5 animate-spin" />
          ) : failed ? (
            <RefreshCw className="size-5" />
          ) : (
            <Play className="size-5 translate-x-px fill-current" />
          )}
        </button>
      </div>
    )
  }

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
        ref={videoRef}
        aria-label={videoProps["aria-label"] ?? `Recording video: ${label}`}
        controls
        playsInline
        preload={videoProps.preload ?? "metadata"}
        src={src}
        className={cn("aspect-video w-full bg-muted", className)}
        onCanPlay={(event) => {
          if (markReady()) void videoRef.current?.play().catch(() => undefined)
          videoProps.onCanPlay?.(event)
        }}
        onError={(event) => {
          scheduleRetry()
          videoProps.onError?.(event)
        }}
        onLoadedMetadata={(event) => {
          if (markReady()) void videoRef.current?.play().catch(() => undefined)
          videoProps.onLoadedMetadata?.(event)
        }}
        onLoadStart={(event) => {
          notifyLoadStart()
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
