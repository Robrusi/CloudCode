"use client"

import {
  ChevronLeft,
  CircleCheck,
  CircleDot,
  CircleX,
  FlaskConical,
  Loader2,
  Settings2,
} from "lucide-react"
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import {
  UiTestPlayer,
  type PlayerSegment,
} from "@/components/sandbox/ui-test-player"
import {
  activeStepId,
  activeTestId,
  buildUiTestTimeline,
  formatClock,
  uiTestDisplayName,
  type DaytonaUiTestRun,
  type TimelineEntry,
  type UiTestStatus,
} from "@/components/sandbox/ui-tests-model"
import { IconButton } from "@/components/ui/icon-button"
import { cn } from "@/lib/shared/utils"

// Below this offset the first test simply absorbs the leading gap; above it
// the runner startup gets its own neutral segment so the bar still maps
// linearly onto the full recording.
const STARTUP_SEGMENT_MIN_MS = 1500

function buildSegments(
  entries: TimelineEntry[],
  durationMs: number
): PlayerSegment[] {
  const tests = entries.filter(
    (entry): entry is Extract<TimelineEntry, { kind: "test" }> =>
      entry.kind === "test"
  )
  const lastAt = Math.max(
    durationMs,
    ...tests.flatMap((test) => [test.atMs, ...test.steps.map((s) => s.atMs)]),
    0
  )
  const segments: PlayerSegment[] = tests.map((test, index) => ({
    endMs: tests[index + 1]?.atMs ?? Math.max(lastAt, test.atMs + 1000),
    id: test.id,
    startMs: test.atMs,
    status: test.status,
    title: test.title,
  }))
  if (segments.length === 0) return segments

  // The recording starts before the browser does; without accounting for that
  // lead-in, every segment is shifted relative to the video timeline.
  if (segments[0].startMs > STARTUP_SEGMENT_MIN_MS) {
    segments.unshift({
      endMs: segments[0].startMs,
      id: "startup",
      startMs: 0,
      status: "running",
      title: "Starting browser",
    })
  } else {
    segments[0] = { ...segments[0], startMs: 0 }
  }
  return segments
}

export function UiTestReport({
  onBack,
  run,
  sandboxId,
}: {
  onBack: () => void
  run: DaytonaUiTestRun
  sandboxId: string | null
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const activeStepRef = useRef<HTMLButtonElement | null>(null)
  const [currentMs, setCurrentMs] = useState(0)
  const [durationMs, setDurationMs] = useState(run.durationMs ?? 0)
  const [playing, setPlaying] = useState(false)

  const timeline = useMemo(() => buildUiTestTimeline(run.events), [run.events])
  const segments = useMemo(
    () => buildSegments(timeline.entries, durationMs),
    [durationMs, timeline.entries]
  )
  const currentStepId = useMemo(
    () => activeStepId(timeline.steps, currentMs),
    [currentMs, timeline.steps]
  )
  const currentTestId = useMemo(
    () => activeTestId(timeline.entries, currentMs),
    [currentMs, timeline.entries]
  )
  const activeTestTitle = useMemo(() => {
    const entry = timeline.entries.find((item) => item.id === currentTestId)
    return entry && entry.kind === "test" ? entry.title : null
  }, [currentTestId, timeline.entries])

  const seek = useCallback((ms: number) => {
    const clamped = Math.max(0, ms)
    const video = videoRef.current
    if (video) video.currentTime = clamped / 1000
    setCurrentMs(clamped)
  }, [])

  useEffect(() => {
    if (!currentStepId) return
    activeStepRef.current?.scrollIntoView({ block: "nearest" })
  }, [currentStepId])

  const passed = run.passed ?? 0
  const failed = run.failed ?? 0
  const skipped = run.skipped ?? 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border/60 px-2.5 py-2.5">
        <IconButton
          aria-label="Back to tests"
          title="Back to tests"
          onClick={onBack}
        >
          <ChevronLeft className="size-4" />
        </IconButton>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {uiTestDisplayName(run.testPath ?? "Tests")}
          </p>
          <div className="mt-0.5 flex items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1.5 text-success">
              <span className="size-1.5 rounded-full bg-success" />
              {passed} passed
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5",
                failed ? "text-destructive" : "text-muted-foreground"
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  failed ? "bg-destructive" : "bg-muted-foreground/50"
                )}
              />
              {failed} failed
            </span>
            {skipped ? (
              <span className="text-muted-foreground">{skipped} skipped</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-3 p-3">
          <UiTestPlayer
            activeTestTitle={activeTestTitle}
            currentMs={currentMs}
            durationMs={durationMs}
            onCurrentMs={setCurrentMs}
            onDurationMs={setDurationMs}
            onPlayingChange={setPlaying}
            onSeek={seek}
            playing={playing}
            recording={run.recording}
            sandboxId={sandboxId}
            segments={segments}
            videoRef={videoRef}
          />

          {timeline.entries.length ? (
            <ol className="space-y-3 pt-1">
              {timeline.entries.map((entry) =>
                entry.kind === "annotation" ? (
                  <AnnotationRow key={entry.id} entry={entry} onSeek={seek} />
                ) : (
                  <TestRow
                    key={entry.id}
                    activeStepId={currentStepId}
                    activeStepRef={activeStepRef}
                    entry={entry}
                    onSeek={seek}
                  />
                )
              )}
            </ol>
          ) : (
            <p className="px-1 py-6 text-center text-xs text-muted-foreground">
              No step details were recorded for this run.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function Timestamp({ atMs }: { atMs: number }) {
  return (
    <time className="w-9 shrink-0 pt-0.5 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
      {formatClock(atMs)}
    </time>
  )
}

function AnnotationRow({
  entry,
  onSeek,
}: {
  entry: Extract<TimelineEntry, { kind: "annotation" }>
  onSeek: (ms: number) => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSeek(entry.atMs)}
        className="flex w-full items-start gap-2.5 text-left"
      >
        <Timestamp atMs={entry.atMs} />
        <Settings2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 text-sm text-muted-foreground">
          {entry.title}
        </span>
      </button>
    </li>
  )
}

function TestRow({
  activeStepId: activeId,
  activeStepRef,
  entry,
  onSeek,
}: {
  activeStepId: string | null
  activeStepRef: RefObject<HTMLButtonElement | null>
  entry: Extract<TimelineEntry, { kind: "test" }>
  onSeek: (ms: number) => void
}) {
  return (
    <li>
      <div className="flex items-start gap-2.5">
        <Timestamp atMs={entry.atMs} />
        <FlaskConical className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-foreground">{entry.title}</p>
          {entry.steps.length ? (
            <ul className="space-y-0.5">
              {entry.steps.map((step) => {
                const active = step.id === activeId
                return (
                  <li key={step.id}>
                    <button
                      type="button"
                      ref={active ? activeStepRef : undefined}
                      onClick={() => onSeek(step.atMs)}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-md px-2 py-1 text-left transition-colors",
                        active ? "bg-muted" : "hover:bg-muted/50"
                      )}
                    >
                      <StepIcon status={step.status} />
                      <span
                        className={cn(
                          "min-w-0 flex-1 text-xs",
                          active ? "text-foreground" : "text-muted-foreground"
                        )}
                      >
                        {step.title}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      </div>
    </li>
  )
}

function StepIcon({ status }: { status: UiTestStatus }) {
  const className = "mt-0.5 size-3.5 shrink-0"
  if (status === "failed")
    return <CircleX className={cn(className, "text-destructive")} />
  if (status === "running")
    return (
      <Loader2
        className={cn(className, "animate-spin text-muted-foreground")}
      />
    )
  if (status === "skipped")
    return <CircleDot className={cn(className, "text-muted-foreground/60")} />
  return <CircleCheck className={cn(className, "text-success")} />
}
