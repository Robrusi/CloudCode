"use client"

import {
  Download,
  Gauge,
  Loader2,
  Pause,
  Play,
  Repeat,
  RefreshCw,
  SkipBack,
  SkipForward,
} from "lucide-react"
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"

import { useRecordingSource } from "@/components/sandbox/recording-source"
import { recordingRequestUrl } from "@/components/sandbox/recording-video-utils"
import {
  formatClock,
  type DaytonaUiTestRecording,
  type UiTestStatus,
} from "@/components/sandbox/ui-tests-model"
import { IconButton } from "@/components/ui/icon-button"
import { cn } from "@/lib/shared/utils"

export type PlayerSegment = {
  endMs: number
  id: string
  startMs: number
  status: UiTestStatus
  title: string
}

const PLAYBACK_RATES = [1, 1.5, 2, 0.5] as const

const SEGMENT_FILL: Record<UiTestStatus, string> = {
  failed: "bg-destructive",
  passed: "bg-success",
  running: "bg-muted-foreground/70",
  skipped: "bg-muted-foreground/50",
}

const SEGMENT_TRACK: Record<UiTestStatus, string> = {
  failed: "bg-destructive/20",
  passed: "bg-success/20",
  running: "bg-muted-foreground/20",
  skipped: "bg-muted-foreground/15",
}

export function UiTestPlayer({
  activeTestTitle,
  currentMs,
  durationMs,
  onCurrentMs,
  onDurationMs,
  onPlayingChange,
  onSeek,
  playing,
  recording,
  sandboxId,
  segments,
  videoRef,
}: {
  activeTestTitle: string | null
  currentMs: number
  durationMs: number
  onCurrentMs: (ms: number) => void
  onDurationMs: (ms: number) => void
  onPlayingChange: (playing: boolean) => void
  onSeek: (ms: number) => void
  playing: boolean
  recording: DaytonaUiTestRecording | undefined
  sandboxId: string | null
  segments: PlayerSegment[]
  videoRef: RefObject<HTMLVideoElement | null>
}) {
  const fallbackRecording = useMemo(() => recording ?? { id: "" }, [recording])
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
  } = useRecordingSource({ recording: fallbackRecording, sandboxId })

  const [rateIndex, setRateIndex] = useState(0)
  const [loop, setLoop] = useState(false)
  const rate = PLAYBACK_RATES[rateIndex]

  useEffect(() => {
    const video = videoRef.current
    if (video) video.playbackRate = rate
  }, [rate, src, videoRef])

  useEffect(() => {
    const video = videoRef.current
    if (video) video.loop = loop
  }, [loop, src, videoRef])

  const effectiveDuration = Math.max(
    durationMs,
    segments.at(-1)?.endMs ?? 0,
    currentMs,
    1
  )

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play().catch(() => undefined)
    else video.pause()
  }, [videoRef])

  const seekToStep = useCallback(
    (direction: 1 | -1) => {
      const starts = segments
        .map((segment) => segment.startMs)
        .sort((a, b) => a - b)
      if (direction === 1) {
        const next = starts.find((ms) => ms > currentMs + 250)
        onSeek(next ?? effectiveDuration)
      } else {
        const prev = [...starts].reverse().find((ms) => ms < currentMs - 750)
        onSeek(prev ?? 0)
      }
    },
    [currentMs, effectiveDuration, onSeek, segments]
  )

  const downloadUrl = recording
    ? recordingRequestUrl(recording, { inline: false, sandboxId })
    : null

  return (
    <div className="space-y-2.5">
      <div className="relative aspect-video overflow-hidden rounded-xl border border-border/60 bg-black">
        {src ? (
          <video
            ref={videoRef}
            playsInline
            preload="metadata"
            src={src}
            aria-label={
              activeTestTitle
                ? `UI test recording: ${activeTestTitle}`
                : "UI test recording"
            }
            className="h-full w-full bg-black"
            onCanPlay={() => {
              if (markReady())
                void videoRef.current?.play().catch(() => undefined)
            }}
            onDurationChange={(event) => {
              const value = event.currentTarget.duration
              if (Number.isFinite(value) && value > 0)
                onDurationMs(value * 1000)
            }}
            onEnded={() => onPlayingChange(false)}
            onError={scheduleRetry}
            onLoadedMetadata={(event) => {
              const value = event.currentTarget.duration
              if (Number.isFinite(value) && value > 0)
                onDurationMs(value * 1000)
              if (markReady())
                void videoRef.current?.play().catch(() => undefined)
            }}
            onLoadStart={notifyLoadStart}
            onPause={() => onPlayingChange(false)}
            onPlay={() => onPlayingChange(true)}
            onTimeUpdate={(event) =>
              onCurrentMs(event.currentTarget.currentTime * 1000)
            }
          >
            <track kind="captions" label="No captions" />
          </video>
        ) : (
          <PlayerPlaceholder
            errorMessage={errorMessage}
            hasRecording={hasRecording}
            loadState={loadState}
            onLoad={() => void materialize()}
            preparing={preparing}
          />
        )}

        {src && loadState !== "ready" ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/50 text-xs text-white/80">
            {loadState === "error" ? (
              <button
                type="button"
                onClick={retryNow}
                className="pointer-events-auto inline-flex items-center gap-1.5 rounded-md border border-white/20 px-2 py-1 text-white/90 transition-colors hover:bg-white/10"
              >
                <RefreshCw className="size-3.5" />
                Retry
              </button>
            ) : (
              <Loader2 className="size-5 animate-spin" />
            )}
          </div>
        ) : null}
      </div>

      <SegmentBar
        currentMs={currentMs}
        durationMs={effectiveDuration}
        onSeek={onSeek}
        segments={segments}
      />

      <div className="flex items-center gap-1">
        <IconButton
          size="sm"
          aria-label="Previous test"
          title="Previous test"
          onClick={() => seekToStep(-1)}
          disabled={!src}
        >
          <SkipBack className="size-3.5" />
        </IconButton>
        <IconButton
          size="sm"
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause" : "Play"}
          onClick={togglePlay}
          disabled={!src}
        >
          {playing ? (
            <Pause className="size-3.5 fill-current" />
          ) : (
            <Play className="size-3.5 translate-x-px fill-current" />
          )}
        </IconButton>
        <IconButton
          size="sm"
          aria-label="Next test"
          title="Next test"
          onClick={() => seekToStep(1)}
          disabled={!src}
        >
          <SkipForward className="size-3.5" />
        </IconButton>

        <span className="ml-1 font-mono text-xs text-muted-foreground tabular-nums">
          {formatClock(currentMs)} / {formatClock(effectiveDuration)}
        </span>

        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={() =>
              setRateIndex((index) => (index + 1) % PLAYBACK_RATES.length)
            }
            disabled={!src}
            aria-label={`Playback speed ${rate}x`}
            title="Playback speed"
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
          >
            <Gauge className="size-3.5" />
            {rate}x
          </button>
          <IconButton
            size="sm"
            aria-pressed={loop}
            aria-label="Loop playback"
            title="Loop playback"
            onClick={() => setLoop((value) => !value)}
            className={cn(loop && "text-foreground")}
          >
            <Repeat className="size-3.5" />
          </IconButton>
          {downloadUrl ? (
            <IconButton
              size="sm"
              render={
                <a
                  href={downloadUrl}
                  aria-label="Download recording"
                  title="Download recording"
                />
              }
            >
              <Download className="size-3.5" />
            </IconButton>
          ) : null}
        </div>
      </div>

      {activeTestTitle ? (
        <p
          className="truncate text-xs text-muted-foreground"
          title={activeTestTitle}
        >
          {activeTestTitle}
        </p>
      ) : null}
    </div>
  )
}

function SegmentBar({
  currentMs,
  durationMs,
  onSeek,
  segments,
}: {
  currentMs: number
  durationMs: number
  onSeek: (ms: number) => void
  segments: PlayerSegment[]
}) {
  if (!segments.length) {
    const progress = Math.min(100, (currentMs / durationMs) * 100)
    return (
      <button
        type="button"
        className="relative block h-1.5 w-full overflow-hidden rounded-full bg-muted"
        aria-label="Seek recording"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          const ratio = (event.clientX - rect.left) / rect.width
          onSeek(ratio * durationMs)
        }}
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-success"
          style={{ width: `${progress}%` }}
        />
      </button>
    )
  }

  return (
    <div className="flex h-1.5 w-full items-stretch gap-1">
      {segments.map((segment) => {
        const span = Math.max(1, segment.endMs - segment.startMs)
        const fill = Math.min(
          100,
          Math.max(0, ((currentMs - segment.startMs) / span) * 100)
        )
        const active = currentMs >= segment.startMs && currentMs < segment.endMs
        return (
          <button
            key={segment.id}
            type="button"
            title={segment.title}
            aria-label={`Seek to ${segment.title}`}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              const ratio = (event.clientX - rect.left) / rect.width
              onSeek(segment.startMs + ratio * span)
            }}
            style={{ flexGrow: span }}
            className={cn(
              "relative h-full overflow-hidden rounded-full transition-shadow",
              SEGMENT_TRACK[segment.status],
              active && "ring-1 ring-foreground/30"
            )}
          >
            <span
              className={cn(
                "absolute inset-y-0 left-0 rounded-full",
                SEGMENT_FILL[segment.status]
              )}
              style={{ width: `${fill}%` }}
            />
          </button>
        )
      })}
    </div>
  )
}

function PlayerPlaceholder({
  errorMessage,
  hasRecording,
  loadState,
  onLoad,
  preparing,
}: {
  errorMessage: string | null
  hasRecording: boolean
  loadState: string
  onLoad: () => void
  preparing: boolean
}) {
  if (!hasRecording) {
    return (
      <div className="grid h-full place-items-center px-6 text-center text-xs text-white/70">
        No recording is available for this run yet.
      </div>
    )
  }

  const checking = loadState === "checking"
  const failed = loadState === "error"
  const busy = checking || preparing

  return (
    <div className="grid h-full place-items-center">
      <button
        type="button"
        onClick={onLoad}
        disabled={busy}
        aria-label={failed ? "Retry loading recording" : "Load recording"}
        title={
          failed
            ? (errorMessage ?? "Recording could not load.")
            : "Load recording"
        }
        className="grid size-12 place-items-center rounded-full border border-white/25 bg-white/10 text-white/90 backdrop-blur transition-transform duration-200 outline-none enabled:hover:scale-105 enabled:active:scale-95 disabled:cursor-default disabled:text-white/50"
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
