"use client"

import { useCallback, useEffect, useReducer, useState } from "react"

import { ResizableSidePanel } from "@/components/layout/resizable-side-panel"
import {
  initialSshPanelState,
  sshPanelReducer,
  type SshConnection,
} from "@/components/sandbox/ssh-panel-model"
import { SshPanelContent } from "@/components/sandbox/ssh-panel-content"
import { fetchJson, requestJson } from "@/lib/http/client-json"

export function SshPanel({
  open,
  sandboxId,
  onClose,
}: {
  open: boolean
  sandboxId: string | null
  onClose: () => void
}) {
  const [state, dispatch] = useReducer(sshPanelReducer, initialSshPanelState)
  const [now, setNow] = useState(() => Date.now())

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!sandboxId) return
      try {
        const data = await fetchJson<{ connections: SshConnection[] }>(
          `/api/sandbox/ssh?${new URLSearchParams({ sandboxId })}`,
          { signal }
        )
        if (!signal?.aborted) {
          dispatch({ type: "load-success", connections: data.connections })
        }
      } catch (err) {
        if (!signal?.aborted) {
          dispatch({
            type: "load-error",
            error:
              err instanceof Error ? err.message : "Failed to load SSH access.",
          })
        }
      }
    },
    [sandboxId]
  )

  useEffect(() => {
    if (!open || !sandboxId) return
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => controller.abort()
  }, [open, refresh, sandboxId])

  useEffect(() => {
    if (!open || !state.connections?.length) return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [state.connections?.length, open])

  const create = useCallback(async () => {
    if (!sandboxId || state.creating) return
    dispatch({ type: "create-start" })
    try {
      const count = state.connections?.length ?? 0
      await requestJson("/api/sandbox/ssh", "POST", {
        sandboxId,
        expiresInMinutes: Number(state.expires),
        label: `Key ${count + 1}`,
      })
      await refresh()
    } catch (err) {
      dispatch({
        type: "set-error",
        error:
          err instanceof Error ? err.message : "Failed to create SSH access.",
      })
    } finally {
      dispatch({ type: "create-finish" })
    }
  }, [
    refresh,
    sandboxId,
    state.connections?.length,
    state.creating,
    state.expires,
  ])

  const rename = useCallback(
    async (id: string, label: string) => {
      dispatch({ type: "rename-local", id, label })
      try {
        await requestJson("/api/sandbox/ssh", "PATCH", { id, label })
      } catch (err) {
        dispatch({
          type: "set-error",
          error: err instanceof Error ? err.message : "Failed to rename key.",
        })
        void refresh()
      }
    },
    [refresh]
  )

  const remove = useCallback(
    async (id: string) => {
      if (!sandboxId || state.pendingId) return
      dispatch({ type: "remove-start", id })
      try {
        await requestJson("/api/sandbox/ssh", "DELETE", {
          sandboxId,
          id,
        })
        await refresh()
      } catch (err) {
        dispatch({
          type: "set-error",
          error: err instanceof Error ? err.message : "Failed to revoke key.",
        })
      } finally {
        dispatch({ type: "remove-finish" })
      }
    },
    [refresh, sandboxId, state.pendingId]
  )

  if (!open) return null

  const { connections, creating, error, expires, pendingId } = state
  const busy = creating || pendingId !== null

  return (
    <ResizableSidePanel
      open={open}
      title="SSH"
      busy={busy}
      onClose={onClose}
      closeLabel="Close SSH panel"
      resizeLabel="Resize SSH panel"
      storageKey="cloudcode:sshPanelWidth"
      defaultWidth={460}
      minWidth={360}
      maxWidth={760}
      dataAttributes={{ "data-sandbox-ssh": true }}
    >
      {error ? (
        <div className="border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <SshPanelContent
          connections={connections}
          creating={creating}
          deleteDisabled={pendingId !== null}
          disabled={!sandboxId}
          expires={expires}
          now={now}
          pendingId={pendingId}
          onDelete={(id) => void remove(id)}
          onExpiresChange={(nextExpires) =>
            dispatch({ type: "set-expires", expires: nextExpires })
          }
          onGenerate={() => void create()}
          onRename={(id, label) => void rename(id, label)}
        />
      </div>
    </ResizableSidePanel>
  )
}

export default SshPanel
