"use client"

import { useSyncExternalStore } from "react"

/**
 * Playback sync between the main-area test video and the side-panel step
 * checklist. Only one test recording plays at a time, so a module-level store
 * is enough; time updates flow through useSyncExternalStore so only the
 * checklist re-renders on playhead changes, never the whole app.
 */

let playbackMs = 0
const timeListeners = new Set<() => void>()
const seekListeners = new Set<(ms: number) => void>()

export function publishUiTestTime(ms: number) {
  if (ms === playbackMs) return
  playbackMs = ms
  for (const listener of timeListeners) listener()
}

export function useUiTestPlaybackTime(): number {
  return useSyncExternalStore(
    (listener) => {
      timeListeners.add(listener)
      return () => {
        timeListeners.delete(listener)
      }
    },
    () => playbackMs,
    () => 0
  )
}

/** Ask the mounted player to seek; also moves the highlight immediately. */
export function requestUiTestSeek(ms: number) {
  for (const listener of seekListeners) listener(ms)
  publishUiTestTime(ms)
}

export function subscribeUiTestSeek(listener: (ms: number) => void) {
  seekListeners.add(listener)
  return () => {
    seekListeners.delete(listener)
  }
}
