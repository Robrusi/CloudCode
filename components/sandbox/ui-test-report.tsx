"use client"

import {
  ChevronLeft,
  CircleCheck,
  CircleDot,
  CircleX,
  FlaskConical,
  Loader2,
  Settings2,
  X,
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
  publishUiTestTime,
  requestUiTestSeek,
  subscribeUiTestSeek,
  useUiTestPlaybackTime,
} from "@/components/sandbox/ui-test-playback"
import {
  UiTestPlayer,
  type PlayerSegment,
} from "@/components/sandbox/ui-test-player"
import {
  activeStepId,
  activeTestId,
  buildUiTestTimeline,
  formatClock,
  timelineStepCounts,
  uiTestDisplayName,
  type DaytonaUiTestRun,
  type TimelineEntry,
  type UiTestStatus,
  type UiTestTimeline,
} from "@/components/sandbox/ui-tests-model"
import { IconButton } from "@/components/ui/icon-button"
import { cn } from "@/lib/shared/utils"

// Below this offset the first part simply absorbs the leading gap; above it
// the runner startup gets its own neutral segment so the bar still maps
// linearly onto the full recording.
const STARTUP_SEGMENT_MIN_MS = 1500

/**
 * One progress-bar segment per annotated part of the run: every step and
 * annotation in the timeline owns the stretch of video from its start until
 * the next part begins, colored by the step outcome it belongs to.
 */
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
    ...tests.flatMap((test) => [
      test.atMs,
      ...test.items.map((item) => item.atMs),
    ]),
    0
  )
  const segments: PlayerSegment[] = []
  tests.forEach((test, index) => {
    const testEnd = tests[index + 1]?.atMs ?? Math.max(lastAt, test.atMs + 1000)
    if (!test.items.length) {
      segments.push({
        endMs: testEnd,
        id: test.id,
        startMs: test.atMs,
        status: test.status,
        title: test.title,
      })
      return
    }
    let stepStatus: UiTestStatus = test.status
    test.items.forEach((item, itemIndex) => {
      if (item.kind === "step") stepStatus = item.status
      const startMs = itemIndex === 0 ? test.atMs : item.atMs
      segments.push({
        endMs: Math.max(
          test.items[itemIndex + 1]?.atMs ?? testEnd,
          startMs + 1
        ),
        id: item.id,
        startMs,
        status: item.kind === "step" ? item.status : stepStatus,
        title: item.title,
      })
    })
  })
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

// Count steps, not tests: "what worked and what did not". Fall back to the
// stored counts (steps when the runner recorded them, tests otherwise) for
// runs without step details.
function runStepCounts(run: DaytonaUiTestRun, timeline: UiTestTimeline) {
  const stepCounts = timelineStepCounts(timeline)
  return {
    failed: stepCounts?.failed ?? run.stepsFailed ?? run.failed ?? 0,
    passed: stepCounts?.passed ?? run.stepsPassed ?? run.passed ?? 0,
    skipped: run.skipped ?? 0,
  }
}

function RunCounts({
  failed,
  passed,
  skipped,
}: {
  failed: number
  passed: number
  skipped: number
}) {
  return (
    <div className="flex items-center gap-3 text-xs">
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
  )
}

/**
 * The recording placed in the main content area, where the chat normally is:
 * only the video with its controls and the annotated progress bar. The step
 * checklist stays in the side panel and syncs through the playback store.
 */
export function UiTestReportMainPanel({
  onClose,
  run,
  sandboxId,
}: {
  onClose: () => void
  run: DaytonaUiTestRun
  sandboxId: string | null
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [currentMs, setCurrentMs] = useState(0)
  const [durationMs, setDurationMs] = useState(run.durationMs ?? 0)
  const [playing, setPlaying] = useState(false)

  const timeline = useMemo(() => buildUiTestTimeline(run.events), [run.events])
  const segments = useMemo(
    () => buildSegments(timeline.entries, durationMs),
    [durationMs, timeline.entries]
  )
  const counts = useMemo(() => runStepCounts(run, timeline), [run, timeline])
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

  // Side-panel checklist sync: accept its seek requests and feed it the
  // playhead for the active-step highlight.
  useEffect(() => subscribeUiTestSeek(seek), [seek])
  useEffect(() => {
    publishUiTestTime(currentMs)
  }, [currentMs])
  useEffect(() => () => publishUiTestTime(0), [])

  const aspect =
    run.desktop?.width && run.desktop?.height
      ? run.desktop.width / run.desktop.height
      : 16 / 9

  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex h-[3.25rem] shrink-0 items-center gap-3 border-b border-border/60 bg-background/80 px-4 backdrop-blur-xl">
        <p className="min-w-0 flex-1 truncate text-[13px] text-foreground">
          {uiTestDisplayName(run.testPath ?? "Tests")}
        </p>
        <RunCounts {...counts} />
        <IconButton
          onClick={onClose}
          aria-label="Close test recording"
          className="-mr-[7px]"
        >
          <X />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        {/* The player flexes into whatever height is available, so the video
            always fits without scrolling; the width cap keeps the controls
            from stretching wider than the recording can use. */}
        <div
          className="mx-auto flex h-full w-full flex-col px-4 py-4 md:px-6"
          style={{
            maxWidth: `max(24rem, calc((100dvh - 13rem) * ${aspect}))`,
          }}
        >
          <UiTestPlayer
            activeTestTitle={activeTestTitle}
            aspect={aspect}
            currentMs={currentMs}
            durationMs={durationMs}
            fill
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
        </div>
      </div>
    </section>
  )
}

/**
 * The "what it did" checklist for the side panel: tests with their steps and
 * annotations, highlighted by and seeking the main-area video.
 */
export function UiTestRunSteps({
  onBack,
  run,
}: {
  onBack: () => void
  run: DaytonaUiTestRun
}) {
  const activeStepRef = useRef<HTMLButtonElement | null>(null)
  const currentMs = useUiTestPlaybackTime()

  const timeline = useMemo(() => buildUiTestTimeline(run.events), [run.events])
  const counts = useMemo(() => runStepCounts(run, timeline), [run, timeline])
  const currentStepId = useMemo(
    () => activeStepId(timeline.steps, currentMs),
    [currentMs, timeline.steps]
  )

  useEffect(() => {
    if (!currentStepId) return
    activeStepRef.current?.scrollIntoView({ block: "nearest" })
  }, [currentStepId])

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
          <div className="mt-0.5">
            <RunCounts {...counts} />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="p-3">
          {timeline.entries.length ? (
            <ol className="space-y-3 pt-1">
              {timeline.entries.map((entry) =>
                entry.kind === "annotation" ? (
                  <AnnotationRow
                    key={entry.id}
                    entry={entry}
                    onSeek={requestUiTestSeek}
                  />
                ) : (
                  <TestRow
                    key={entry.id}
                    activeStepId={currentStepId}
                    activeStepRef={activeStepRef}
                    entry={entry}
                    onSeek={requestUiTestSeek}
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
          {entry.items.length ? (
            <ul className="space-y-0.5">
              {entry.items.map((item) => {
                if (item.kind === "annotation") {
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => onSeek(item.atMs)}
                        className="flex w-full items-start gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted/50"
                      >
                        <Settings2 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70" />
                        <span className="min-w-0 flex-1 text-xs text-muted-foreground/80">
                          {item.title}
                        </span>
                      </button>
                    </li>
                  )
                }
                const active = item.id === activeId
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      ref={active ? activeStepRef : undefined}
                      onClick={() => onSeek(item.atMs)}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-md px-2 py-1 text-left transition-colors",
                        active ? "bg-muted" : "hover:bg-muted/50"
                      )}
                    >
                      <StepIcon status={item.status} />
                      <span
                        className={cn(
                          "min-w-0 flex-1 text-xs",
                          active ? "text-foreground" : "text-muted-foreground"
                        )}
                      >
                        {item.title}
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
