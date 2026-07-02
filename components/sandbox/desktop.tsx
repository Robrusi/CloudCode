"use client"

import { RefreshCw } from "lucide-react"
import { useCallback, useEffect, useMemo, useReducer } from "react"

import { SandboxDesktopIconButton } from "@/components/sandbox/desktop-controls"
import {
  RECORDINGS_POLL_MS,
  desktopPanelReducer,
  initialDesktopPanelState,
  isActiveRecording,
  type DesktopStatus,
  type RecordingsResponse,
} from "@/components/sandbox/desktop-model"
import { RecordingsView } from "@/components/sandbox/desktop-recordings"
import { DesktopView } from "@/components/sandbox/desktop-view"
import { SandboxUiTestsView } from "@/components/sandbox/ui-tests"
import type { DaytonaUiTestRun } from "@/components/sandbox/ui-tests-model"
import { ResizableSidePanel } from "@/components/layout/resizable-side-panel"
import { SidePanelTabButton } from "@/components/layout/side-panel-tabs"
import { fetchJson, postJson } from "@/lib/http/client-json"

export function SandboxDesktopPanel({
  open,
  openUiTestRun,
  sandboxId,
  onClose,
  onCloseUiTestRun,
  onOpenUiTestRun,
}: {
  open: boolean
  openUiTestRun: DaytonaUiTestRun | null
  sandboxId: string | null
  onClose: () => void
  onCloseUiTestRun: () => void
  onOpenUiTestRun: (run: DaytonaUiTestRun) => void
}) {
  const [state, dispatch] = useReducer(
    desktopPanelReducer,
    initialDesktopPanelState
  )

  const loadStatus = useCallback(
    async (signal?: AbortSignal) => {
      if (!sandboxId) return null
      const params = new URLSearchParams({ sandboxId })
      const next = await fetchJson<DesktopStatus>(
        `/api/sandbox/desktop?${params}`,
        { signal }
      )
      dispatch({ type: "load-status", status: next })
      return next
    },
    [sandboxId]
  )

  const loadRecordings = useCallback(
    async (signal?: AbortSignal) => {
      if (!sandboxId) return []
      const params = new URLSearchParams({ sandboxId })
      const next = await fetchJson<RecordingsResponse>(
        `/api/sandbox/desktop/recordings?${params}`,
        { signal }
      )
      dispatch({ type: "load-recordings", recordings: next.recordings })
      return next.recordings
    },
    [sandboxId]
  )

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!sandboxId) return
      dispatch({ type: "refresh-start" })
      try {
        await Promise.all([loadStatus(signal), loadRecordings(signal)])
        dispatch({ type: "refresh-success" })
      } catch (err) {
        if (!signal?.aborted) {
          dispatch({
            type: "refresh-error",
            error:
              err instanceof Error ? err.message : "Desktop refresh failed.",
          })
        }
      } finally {
        if (!signal?.aborted) {
          dispatch({ type: "refresh-finish" })
        }
      }
    },
    [loadRecordings, loadStatus, sandboxId]
  )

  useEffect(() => {
    if (!open || !sandboxId) return
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => controller.abort()
  }, [open, refresh, sandboxId])

  useEffect(() => {
    if (!open || !sandboxId) return
    const interval = window.setInterval(() => {
      void loadRecordings().catch(() => undefined)
    }, RECORDINGS_POLL_MS)
    return () => window.clearInterval(interval)
  }, [loadRecordings, open, sandboxId])

  const activeRecording = useMemo(
    () => state.recordings.find(isActiveRecording) ?? null,
    [state.recordings]
  )
  const requestConnect = useCallback(() => dispatch({ type: "connect" }), [])
  const disconnect = useCallback(() => dispatch({ type: "disconnect" }), [])
  const handleConnectionLost = useCallback(() => {
    dispatch({ type: "disconnect" })
    void refresh()
  }, [refresh])

  async function startDesktop() {
    if (!sandboxId || state.busy) return
    dispatch({ type: "start-start" })
    try {
      const next = await postJson<DesktopStatus>("/api/sandbox/desktop", {
        action: "start",
        sandboxId,
      })
      dispatch({ type: "start-success", status: next })
    } catch (err) {
      dispatch({
        type: "start-error",
        error: err instanceof Error ? err.message : "Desktop start failed.",
      })
    }
  }

  async function stopDesktop() {
    if (!sandboxId || state.busy) return
    dispatch({ type: "stop-start" })
    try {
      const next = await postJson<DesktopStatus>("/api/sandbox/desktop", {
        action: "stop",
        sandboxId,
      })
      dispatch({ type: "stop-success", status: next })
    } catch (err) {
      dispatch({
        type: "stop-error",
        error: err instanceof Error ? err.message : "Desktop stop failed.",
      })
    }
  }

  if (!open) return null

  const { busy, connectRequested, error, recordings, status, view } = state
  const previewUrl = status?.previewUrl ?? null
  const hasActiveRecording = Boolean(activeRecording)
  const viewerActive = Boolean(previewUrl && connectRequested)

  return (
    <ResizableSidePanel
      open={open}
      title="Computer"
      busy={Boolean(busy)}
      onClose={onClose}
      closeLabel="Close desktop panel"
      resizeLabel="Resize desktop panel"
      storageKey="cloudcode:desktopPanelWidth"
      defaultWidth={520}
      minWidth={360}
      maxWidth={860}
      dataAttributes={{ "data-sandbox-desktop": true }}
      headerActions={
        <SandboxDesktopIconButton
          label="Refresh desktop"
          disabled={!sandboxId || Boolean(busy)}
          onClick={() => void refresh()}
        >
          <RefreshCw className="size-3.5" />
        </SandboxDesktopIconButton>
      }
    >
      <div className="flex h-[3.25rem] shrink-0 items-stretch border-b border-border/60">
        <SidePanelTabButton
          active={view === "desktop"}
          label="Desktop"
          onClick={() => dispatch({ type: "set-view", view: "desktop" })}
        />
        <div aria-hidden className="w-px self-stretch bg-border/60" />
        <SidePanelTabButton
          active={view === "recordings"}
          label="Recordings"
          count={recordings.length}
          onClick={() => dispatch({ type: "set-view", view: "recordings" })}
        />
        <div aria-hidden className="w-px self-stretch bg-border/60" />
        <SidePanelTabButton
          active={view === "tests"}
          label="Tests"
          onClick={() => dispatch({ type: "set-view", view: "tests" })}
        />
      </div>

      {error ? (
        <div className="border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        {view === "desktop" ? (
          <DesktopView
            previewUrl={previewUrl}
            connectRequested={connectRequested}
            hasActiveRecording={hasActiveRecording}
            busy={busy}
            statusKnown={status !== null}
            viewerActive={viewerActive}
            sandboxId={sandboxId}
            onConnect={requestConnect}
            onDisconnect={disconnect}
            onConnectionLost={handleConnectionLost}
            onStart={startDesktop}
            onStop={stopDesktop}
          />
        ) : view === "recordings" ? (
          <RecordingsView recordings={recordings} sandboxId={sandboxId} />
        ) : (
          <SandboxUiTestsView
            active={view === "tests"}
            sandboxId={sandboxId}
            onCloseReport={onCloseUiTestRun}
            onOpenReport={onOpenUiTestRun}
            openRun={openUiTestRun}
          />
        )}
      </div>
    </ResizableSidePanel>
  )
}
