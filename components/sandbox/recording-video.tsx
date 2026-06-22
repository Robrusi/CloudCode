"use client"

import { Loader2, Play, RefreshCw } from "lucide-react"
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
import { fetchJson, requestJson } from "@/lib/http/client-json"
import { cn } from "@/lib/shared/utils"

type RecordingVideoProps = {
  className?: string
  recording: RecordingVideoArtifact
  sandboxId?: string | null
} & Omit<ComponentPropsWithoutRef<"video">, "children" | "className" | "src">

type VideoLoadState =
  | "checking"
  | "error"
  | "idle"
  | "loading"
  | "materializing"
  | "ready"
  | "retrying"

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
  const resolvedSandboxId = sandboxId ?? recording.sandboxId ?? null
  const [attempt, setAttempt] = useState(0)
  const [loadState, setLoadState] = useState<VideoLoadState>(() =>
    recording.id && resolvedSandboxId ? "checking" : "idle"
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [sourceEnabled, setSourceEnabled] = useState(false)
  const [pendingAutoLoad, setPendingAutoLoad] = useState(false)
  const playAfterReadyRef = useRef(false)
  const retryTimeoutRef = useRef<number | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const src = useMemo(
    () =>
      sourceEnabled
        ? recordingRequestUrl(recording, { attempt, sandboxId })
        : null,
    [attempt, recording, sandboxId, sourceEnabled]
  )
  const label = recordingLabel(recording)

  const clearRetryTimer = useCallback(() => {
    if (retryTimeoutRef.current === null) return
    window.clearTimeout(retryTimeoutRef.current)
    retryTimeoutRef.current = null
  }, [])

  useEffect(() => clearRetryTimer, [clearRetryTimer])

  useEffect(() => {
    if (!recording.id || !resolvedSandboxId) {
      setLoadState("idle")
      setSourceEnabled(false)
      return
    }

    const controller = new AbortController()
    playAfterReadyRef.current = false
    setErrorMessage(null)
    setSourceEnabled(false)
    setPendingAutoLoad(false)
    setLoadState("checking")

    void fetchJson<{
      cached?: boolean
      running?: boolean
    }>(
      `/api/sandbox/desktop/recordings?${new URLSearchParams({
        recordingId: recording.id,
        sandboxId: resolvedSandboxId,
        status: "1",
      })}`,
      { signal: controller.signal },
      { fallbackError: "Unable to check recording cache." }
    )
      .then((result) => {
        if (controller.signal.aborted) return
        if (result.cached) {
          setSourceEnabled(true)
          setLoadState("loading")
        } else {
          setLoadState("idle")
          // When the sandbox is already running, download and play the
          // recording automatically instead of waiting for a manual "Load
          // recording" click — loading cannot start a stopped sandbox here. A
          // separate effect performs the one-shot materialize so it sees the
          // latest callback identity.
          if (result.running) setPendingAutoLoad(true)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadState("idle")
      })

    return () => controller.abort()
  }, [recording.id, resolvedSandboxId])

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

  const materializeAndLoad = useCallback(
    async (autoplay = true) => {
      if (
        !recording.id ||
        !resolvedSandboxId ||
        loadState === "materializing"
      ) {
        return
      }

      clearRetryTimer()
      setErrorMessage(null)
      setSourceEnabled(false)
      setLoadState("materializing")

      try {
        await requestJson(
          "/api/sandbox/desktop/recordings",
          "POST",
          {
            action: "materialize",
            recordingId: recording.id,
            sandboxId: resolvedSandboxId,
          },
          { fallbackError: "Unable to load recording." }
        )
        playAfterReadyRef.current = autoplay
        setAttempt((value) => value + 1)
        setSourceEnabled(true)
        setLoadState("loading")
      } catch (error) {
        playAfterReadyRef.current = false
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to load recording."
        )
        setLoadState("error")
      }
    },
    [clearRetryTimer, loadState, recording.id, resolvedSandboxId]
  )

  // One-shot background materialize for a not-yet-cached recording whose
  // sandbox is already running. The `pendingAutoLoad` flag is cleared before
  // dispatching so a flaky download settles into the error state instead of
  // re-triggering a loop.
  useEffect(() => {
    if (!pendingAutoLoad || loadState !== "idle") return
    setPendingAutoLoad(false)
    void materializeAndLoad(false)
  }, [loadState, materializeAndLoad, pendingAutoLoad])

  const markReady = useCallback(() => {
    clearRetryTimer()
    setLoadState("ready")
    if (playAfterReadyRef.current) {
      playAfterReadyRef.current = false
      void videoRef.current?.play().catch(() => undefined)
    }
  }, [clearRetryTimer])

  const retryNow = useCallback(() => {
    void materializeAndLoad()
  }, [materializeAndLoad])

  if (!src) {
    const checking = loadState === "checking"
    const preparing = loadState === "materializing" || pendingAutoLoad
    const failed = loadState === "error"
    const busy = checking || preparing
    const disabled = busy || !recording.id || !resolvedSandboxId

    return (
      <div
        className="grid aspect-video place-items-center rounded-lg border border-border/60 bg-muted"
        title={failed ? (errorMessage ?? "Recording could not load.") : label}
      >
        <button
          type="button"
          onClick={() => void materializeAndLoad()}
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
