"use client"

import { FlaskConical, Loader2, Play, RefreshCw } from "lucide-react"
import { useCallback, useEffect, useReducer } from "react"

import { UiTestRunSteps } from "@/components/sandbox/ui-test-report"
import {
  formatRelativeTime,
  hasPendingRun,
  initialUiTestsPanelState,
  latestRunForTest,
  uiTestDisplayName,
  uiTestsPanelReducer,
  UI_TESTS_POLL_MS,
  type DaytonaUiTestFile,
  type DaytonaUiTestRun,
  type DaytonaUiTestRunSummary,
  type UiTestsResponse,
} from "@/components/sandbox/ui-tests-model"
import { Button } from "@/components/ui/button"
import { SandboxDesktopIconButton } from "@/components/sandbox/desktop-controls"
import { cardSurfaceClass } from "@/components/ui/surface"
import { fetchJson, postJson } from "@/lib/http/client-json"
import { cn } from "@/lib/shared/utils"

export function SandboxUiTestsView({
  active,
  sandboxId,
  onCloseReport,
  onOpenReport,
  openRun,
}: {
  active: boolean
  sandboxId: string | null
  onCloseReport: () => void
  onOpenReport: (run: DaytonaUiTestRun) => void
  openRun: DaytonaUiTestRun | null
}) {
  const [state, dispatch] = useReducer(
    uiTestsPanelReducer,
    initialUiTestsPanelState
  )

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!sandboxId) return
      dispatch({ type: "load-start" })
      try {
        const data = await fetchJson<UiTestsResponse>(
          `/api/sandbox/ui-tests?${new URLSearchParams({ sandboxId })}`,
          { signal },
          { fallbackError: "Unable to load UI tests." }
        )
        dispatch({ data, type: "load-success" })
      } catch (error) {
        if (signal?.aborted) return
        dispatch({
          error:
            error instanceof Error ? error.message : "Unable to load UI tests.",
          type: "load-error",
        })
      }
    },
    [sandboxId]
  )

  useEffect(() => {
    if (!active || !sandboxId) return
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [active, load, sandboxId])

  // While a run is in flight (locally or from an agent), poll the summaries so
  // the row status and recording catch up even if the triggering POST drops.
  const pending = Boolean(state.busyRunPath) || hasPendingRun(state.runs)
  useEffect(() => {
    if (!active || !sandboxId || !pending) return
    const interval = window.setInterval(() => {
      void load().catch(() => undefined)
    }, UI_TESTS_POLL_MS)
    return () => window.clearInterval(interval)
  }, [active, load, pending, sandboxId])

  const openReport = useCallback(
    async (run: DaytonaUiTestRunSummary) => {
      if (!sandboxId) return
      dispatch({ runId: run.runId, type: "open-start" })
      try {
        const result = await fetchJson<DaytonaUiTestRun>(
          `/api/sandbox/ui-tests?${new URLSearchParams({
            runId: run.runId,
            sandboxId,
          })}`,
          {},
          { fallbackError: "Unable to load run." }
        )
        dispatch({ type: "open-settled" })
        onOpenReport(result)
      } catch (error) {
        dispatch({
          error: error instanceof Error ? error.message : "Unable to load run.",
          type: "open-error",
        })
      }
    },
    [onOpenReport, sandboxId]
  )

  const runTest = useCallback(
    async (testPath: string) => {
      if (!sandboxId) return
      dispatch({ testPath, type: "run-start" })
      try {
        const result = await postJson<DaytonaUiTestRun>(
          "/api/sandbox/ui-tests",
          { action: "run", sandboxId, testPath },
          {},
          { fallbackError: "Unable to run UI test." }
        )
        await load()
        onOpenReport(result)
      } catch (error) {
        dispatch({
          error:
            error instanceof Error ? error.message : "Unable to run UI test.",
          type: "run-error",
        })
      } finally {
        dispatch({ type: "run-settled" })
      }
    },
    [load, onOpenReport, sandboxId]
  )

  // While a run's video is open in the main area, the panel shows what it
  // did: the step checklist, synced to the video.
  if (openRun) {
    return <UiTestRunSteps onBack={onCloseReport} run={openRun} />
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <p className="truncate text-xs text-muted-foreground">
          {state.tests.length
            ? `${state.tests.length} test file${state.tests.length === 1 ? "" : "s"}`
            : "Deterministic UI tests"}
        </p>
        <SandboxDesktopIconButton
          label="Refresh tests"
          disabled={!sandboxId || state.loading}
          onClick={() => void load()}
        >
          {state.loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
        </SandboxDesktopIconButton>
      </div>

      {state.error ? (
        <div className="border-y border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {state.error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-3 pt-1">
        <UiTestsBody
          busyRunPath={state.busyRunPath}
          loaded={state.loaded}
          loading={state.loading}
          onOpen={openReport}
          onRun={runTest}
          openingRunId={state.openingRunId}
          running={state.running}
          runs={state.runs}
          sandboxId={sandboxId}
          tests={state.tests}
        />
      </div>
    </div>
  )
}

function UiTestsBody({
  busyRunPath,
  loaded,
  loading,
  onOpen,
  onRun,
  openingRunId,
  running,
  runs,
  sandboxId,
  tests,
}: {
  busyRunPath: string | null
  loaded: boolean
  loading: boolean
  onOpen: (run: DaytonaUiTestRunSummary) => void
  onRun: (testPath: string) => void
  openingRunId: string | null
  running: boolean
  runs: DaytonaUiTestRunSummary[]
  sandboxId: string | null
  tests: DaytonaUiTestFile[]
}) {
  if (!sandboxId) {
    return (
      <EmptyState title="No sandbox" body="Open a session to run UI tests." />
    )
  }
  if (!loaded && loading) {
    return (
      <div className="grid h-40 place-items-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }
  if (loaded && !running) {
    return (
      <EmptyState
        title="Sandbox is not running"
        body="Start the desktop from the Desktop tab to discover and run UI tests."
      />
    )
  }
  if (!tests.length) {
    return (
      <EmptyState
        title="No UI tests yet"
        body="Write deterministic tests under .cloudcode/tests and they will appear here."
      />
    )
  }

  return (
    <div className="space-y-2">
      {tests.map((test) => {
        const run = latestRunForTest(runs, test.path)
        return (
          <TestRow
            key={test.path}
            busy={busyRunPath === test.path}
            onOpen={onOpen}
            onRun={onRun}
            opening={Boolean(run && openingRunId === run.runId)}
            run={run}
            test={test}
          />
        )
      })}
    </div>
  )
}

function TestRow({
  busy,
  onOpen,
  onRun,
  opening,
  run,
  test,
}: {
  busy: boolean
  onOpen: (run: DaytonaUiTestRunSummary) => void
  onRun: (testPath: string) => void
  opening: boolean
  run: DaytonaUiTestRunSummary | undefined
  test: DaytonaUiTestFile
}) {
  const pending = busy || run?.status === "running"
  const hasResult = Boolean(run && run.status !== "running")
  const title = uiTestDisplayName(test.path)

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2.5",
        cardSurfaceClass,
        "bg-background/40"
      )}
    >
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-md",
          run?.status === "passed" && "bg-success/10 text-success",
          run?.status === "failed" && "bg-destructive/10 text-destructive",
          (!run || run.status === "running") &&
            "bg-sidebar-accent/60 text-muted-foreground"
        )}
      >
        <FlaskConical className="size-4" />
      </span>

      <button
        type="button"
        onClick={() => run && hasResult && onOpen(run)}
        disabled={!hasResult || opening}
        className="min-w-0 flex-1 text-left disabled:cursor-default"
      >
        <p className="flex items-center gap-1.5 truncate text-sm text-foreground/85">
          {title}
          {opening ? (
            <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
          ) : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          <RunStatusLine pending={pending} run={run} />
        </p>
      </button>

      <Button
        size="sm"
        variant={hasResult ? "outline" : "default"}
        onClick={() => onRun(test.path)}
        disabled={pending}
      >
        {pending ? (
          <>
            <Loader2 className="animate-spin" />
            Running
          </>
        ) : hasResult ? (
          <>
            <RefreshCw />
            Re-run
          </>
        ) : (
          <>
            <Play />
            Run
          </>
        )}
      </Button>
    </div>
  )
}

function RunStatusLine({
  pending,
  run,
}: {
  pending: boolean
  run: DaytonaUiTestRunSummary | undefined
}) {
  if (pending) return <span className="text-muted-foreground">Running…</span>
  if (!run) return <span>Not run yet</span>
  const passed = run.stepsPassed ?? run.passed ?? 0
  const failed = run.stepsFailed ?? run.failed ?? 0
  const counts =
    run.status === "passed"
      ? `${passed} passed`
      : `${passed} passed · ${failed} failed`
  const when = formatRelativeTime(run.updatedAt)
  return (
    <span
      className={cn(
        run.status === "failed" ? "text-destructive" : "text-muted-foreground"
      )}
    >
      {counts}
      {when ? ` · ${when}` : ""}
    </span>
  )
}

function EmptyState({ body, title }: { body: string; title: string }) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-1 px-6 text-center">
      <p className="text-sm font-medium text-foreground/85">{title}</p>
      <p className="max-w-[16rem] text-xs text-muted-foreground">{body}</p>
    </div>
  )
}
