"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  recordingRequestUrl,
  type RecordingVideoArtifact,
} from "@/components/sandbox/recording-video-utils"
import { fetchJson, requestJson } from "@/lib/http/client-json"

export type RecordingLoadState =
  | "checking"
  | "error"
  | "idle"
  | "loading"
  | "materializing"
  | "ready"
  | "retrying"

const RECORDING_VIDEO_RETRY_DELAYS_MS = [1500, 3000, 6000, 10_000] as const

export type RecordingSource = {
  errorMessage: string | null
  hasRecording: boolean
  loadState: RecordingLoadState
  /** Whether a materialize/download is currently in flight. */
  preparing: boolean
  resolvedSandboxId: string | null
  src: string | null
  /** Resolve the cached recording (and download it if needed); returns when ready to play. */
  materialize: (autoplay?: boolean) => Promise<void>
  /** Mark the video element as playable; returns whether playback was requested. */
  markReady: () => boolean
  notifyLoadStart: () => void
  retryNow: () => void
  /** Schedule a bounded retry after a `<video>` error. */
  scheduleRetry: () => void
}

/**
 * Owns the lifecycle of turning a Daytona desktop recording into a playable
 * `<video>` source: it checks the on-disk cache, auto-downloads when the
 * sandbox is already running, retries transient `<video>` errors with backoff,
 * and exposes the resolved `src`. Both the standalone recording card and the
 * UI-test report player render their own `<video>` around it so they can offer
 * different controls without duplicating the materialize/retry machinery.
 */
export function useRecordingSource({
  recording,
  sandboxId,
}: {
  recording: RecordingVideoArtifact
  sandboxId?: string | null
}): RecordingSource {
  const resolvedSandboxId = sandboxId ?? recording.sandboxId ?? null
  const [attempt, setAttempt] = useState(0)
  const [loadState, setLoadState] = useState<RecordingLoadState>(() =>
    recording.id && resolvedSandboxId ? "checking" : "idle"
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [sourceEnabled, setSourceEnabled] = useState(false)
  const [pendingAutoLoad, setPendingAutoLoad] = useState(false)
  const playAfterReadyRef = useRef(false)
  const retryTimeoutRef = useRef<number | null>(null)
  const src = useMemo(
    () =>
      sourceEnabled
        ? recordingRequestUrl(recording, { attempt, sandboxId })
        : null,
    [attempt, recording, sandboxId, sourceEnabled]
  )

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

  const materialize = useCallback(
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
    void materialize(false)
  }, [loadState, materialize, pendingAutoLoad])

  const markReady = useCallback(() => {
    clearRetryTimer()
    setLoadState("ready")
    const shouldPlay = playAfterReadyRef.current
    playAfterReadyRef.current = false
    return shouldPlay
  }, [clearRetryTimer])

  const notifyLoadStart = useCallback(() => {
    setLoadState((state) => (state === "ready" ? state : "loading"))
  }, [])

  const retryNow = useCallback(() => {
    void materialize()
  }, [materialize])

  return {
    errorMessage,
    hasRecording: Boolean(recording.id && resolvedSandboxId),
    loadState,
    markReady,
    materialize,
    notifyLoadStart,
    preparing: loadState === "materializing" || pendingAutoLoad,
    resolvedSandboxId,
    retryNow,
    scheduleRetry,
    src,
  }
}
