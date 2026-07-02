import type {
  DaytonaUiTestEvent,
  DaytonaUiTestFile,
  DaytonaUiTestRunSummary,
} from "@/lib/daytona/ui-tests"

export type {
  DaytonaUiTestEvent,
  DaytonaUiTestFile,
  DaytonaUiTestRecording,
  DaytonaUiTestRun,
  DaytonaUiTestRunSummary,
} from "@/lib/daytona/ui-tests"

export const UI_TESTS_POLL_MS = 4000

export type UiTestStatus = "passed" | "failed" | "running" | "skipped"

export type UiTestsResponse = {
  running: boolean
  runs: DaytonaUiTestRunSummary[]
  testDir: string | null
  tests: DaytonaUiTestFile[]
}

export type TimelineStep = {
  atMs: number
  error?: string
  id: string
  status: UiTestStatus
  title: string
}

export type TimelineTestItem =
  | ({ kind: "step" } & TimelineStep)
  | { atMs: number; id: string; kind: "annotation"; title: string }

export type TimelineEntry =
  | {
      atMs: number
      id: string
      kind: "test"
      status: UiTestStatus
      items: TimelineTestItem[]
      title: string
    }
  | {
      atMs: number
      id: string
      kind: "annotation"
      title: string
    }

export type UiTestTimeline = {
  entries: TimelineEntry[]
  steps: TimelineStep[]
}

function normalizeStatus(status: unknown): UiTestStatus {
  if (status === "passed") return "passed"
  if (status === "skipped") return "skipped"
  if (status === "running") return "running"
  return "failed"
}

function eventOrder(event: DaytonaUiTestEvent, index: number) {
  // Events are appended chronologically; sort defensively by recorded time and
  // fall back to file order so steps stay under their owning test.
  return [event.atMs ?? 0, event.seq ?? index, index] as const
}

/**
 * Fold the flat reporter/overlay event stream into the nested test → step
 * timeline rendered beside the recording. Steps are anchored at their
 * step_begin time so annotations emitted while a step runs interleave
 * chronologically inside their owning test instead of dangling below it.
 */
export function buildUiTestTimeline(
  events: DaytonaUiTestEvent[] | undefined
): UiTestTimeline {
  const ordered = (events ?? [])
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const [aTime, aSeq, aIndex] = eventOrder(a.event, a.index)
      const [bTime, bSeq, bIndex] = eventOrder(b.event, b.index)
      return aTime - bTime || aSeq - bSeq || aIndex - bIndex
    })

  const entries: TimelineEntry[] = []
  const steps: TimelineStep[] = []
  const stepStarts = new Map<string, number[]>()
  let currentTest: Extract<TimelineEntry, { kind: "test" }> | null = null
  let testSeq = 0
  let stepSeq = 0
  let annotationSeq = 0

  const stepKey = (test: string | undefined, title: string) =>
    `${test ?? ""}::${title}`

  for (const { event } of ordered) {
    const atMs = Math.max(0, event.atMs ?? 0)
    const title = (event.title ?? "").trim()
    switch (event.type) {
      case "test_begin": {
        currentTest = {
          atMs,
          id: `test-${testSeq++}`,
          kind: "test",
          status: "running",
          items: [],
          title: title || "Untitled test",
        }
        entries.push(currentTest)
        break
      }
      case "step_begin": {
        if (!title) break
        const key = stepKey(event.test, title)
        const starts = stepStarts.get(key) ?? []
        starts.push(atMs)
        stepStarts.set(key, starts)
        break
      }
      case "step_end": {
        if (!currentTest || !title) break
        const startedAt = stepStarts.get(stepKey(event.test, title))?.shift()
        const step: TimelineStep = {
          atMs: startedAt ?? atMs,
          error: event.error,
          id: `step-${stepSeq++}`,
          status: normalizeStatus(event.status),
          title,
        }
        currentTest.items.push({ kind: "step", ...step })
        steps.push(step)
        break
      }
      case "test_end": {
        if (currentTest) currentTest.status = normalizeStatus(event.status)
        break
      }
      case "annotation": {
        if (!title) break
        const annotation = {
          atMs,
          id: `annotation-${annotationSeq++}`,
          title,
        }
        if (currentTest) {
          currentTest.items.push({ kind: "annotation", ...annotation })
        } else {
          entries.push({ kind: "annotation", ...annotation })
        }
        break
      }
      default:
        break
    }
  }

  for (const entry of entries) {
    if (entry.kind === "test") {
      entry.items.sort((a, b) => a.atMs - b.atMs)
    }
  }
  steps.sort((a, b) => a.atMs - b.atMs)
  return { entries, steps }
}

/**
 * Step-level outcome counts: one entry per step that ran, so the header reads
 * "what worked and what did not" rather than whole-test tallies. A test that
 * failed outside any step (e.g. its final assertion) counts as one failure.
 */
export function timelineStepCounts(
  timeline: UiTestTimeline
): { failed: number; passed: number } | null {
  const tests = timeline.entries.filter(
    (entry): entry is Extract<TimelineEntry, { kind: "test" }> =>
      entry.kind === "test"
  )
  if (!tests.length) return null

  let passed = 0
  let failed = 0
  for (const test of tests) {
    let testHasFailedStep = false
    for (const item of test.items) {
      if (item.kind !== "step") continue
      if (item.status === "passed") {
        passed += 1
      } else if (item.status !== "skipped") {
        failed += 1
        testHasFailedStep = true
      }
    }
    if (test.status === "failed" && !testHasFailedStep) failed += 1
  }
  return { failed, passed }
}

/** The latest step whose start is at or before the playhead, for highlighting. */
export function activeStepId(
  steps: TimelineStep[],
  currentMs: number
): string | null {
  let active: string | null = null
  for (const step of steps) {
    if (step.atMs <= currentMs) active = step.id
    else break
  }
  return active
}

export function activeTestId(
  entries: TimelineEntry[],
  currentMs: number
): string | null {
  let active: string | null = null
  for (const entry of entries) {
    if (entry.kind !== "test") continue
    if (entry.atMs <= currentMs) active = entry.id
  }
  return active
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

export function uiTestDisplayName(path: string): string {
  const base = path.split("/").pop() ?? path
  const stem = base.replace(/\.(?:spec|test)\.(?:c|m)?[jt]sx?$/i, "")
  const words = stem
    .replace(/[-_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
  if (!words) return base
  return words
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

/** Newest run recorded for a specific test file (runs arrive newest-first). */
export function latestRunForTest(
  runs: DaytonaUiTestRunSummary[],
  testPath: string
): DaytonaUiTestRunSummary | undefined {
  return runs.find((run) => run.testPath === testPath)
}

export function hasPendingRun(runs: DaytonaUiTestRunSummary[]): boolean {
  return runs.some((run) => run.status === "running")
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
]

export function formatRelativeTime(
  timestamp: number | null | undefined
): string {
  if (!timestamp) return ""
  const diff = timestamp - Date.now()
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(diff) >= ms) {
      return formatter.format(Math.round(diff / ms), unit)
    }
  }
  return "just now"
}

// ---------------------------------------------------------------------------
// Tests tab state
// ---------------------------------------------------------------------------

export type UiTestsPanelState = {
  busyRunPath: string | null
  error: string | null
  loaded: boolean
  loading: boolean
  openingRunId: string | null
  running: boolean
  runs: DaytonaUiTestRunSummary[]
  testDir: string | null
  tests: DaytonaUiTestFile[]
}

export type UiTestsPanelAction =
  | { type: "load-start" }
  | { type: "load-success"; data: UiTestsResponse }
  | { type: "load-error"; error: string }
  | { type: "run-start"; testPath: string }
  | { type: "run-settled" }
  | { type: "run-error"; error: string }
  | { type: "open-start"; runId: string }
  | { type: "open-settled" }
  | { type: "open-error"; error: string }
  | { type: "clear-error" }

export const initialUiTestsPanelState: UiTestsPanelState = {
  busyRunPath: null,
  error: null,
  loaded: false,
  loading: false,
  openingRunId: null,
  running: false,
  runs: [],
  testDir: null,
  tests: [],
}

export function uiTestsPanelReducer(
  state: UiTestsPanelState,
  action: UiTestsPanelAction
): UiTestsPanelState {
  switch (action.type) {
    case "load-start":
      return { ...state, loading: true }
    case "load-success":
      return {
        ...state,
        error: null,
        loaded: true,
        loading: false,
        running: action.data.running,
        runs: action.data.runs,
        testDir: action.data.testDir,
        tests: action.data.tests,
      }
    case "load-error":
      return { ...state, error: action.error, loaded: true, loading: false }
    case "run-start":
      return { ...state, busyRunPath: action.testPath, error: null }
    case "run-settled":
      return { ...state, busyRunPath: null }
    case "run-error":
      return { ...state, busyRunPath: null, error: action.error }
    case "open-start":
      return { ...state, error: null, openingRunId: action.runId }
    case "open-settled":
      return { ...state, openingRunId: null }
    case "open-error":
      return { ...state, error: action.error, openingRunId: null }
    case "clear-error":
      return { ...state, error: null }
  }
}
