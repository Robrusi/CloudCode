export type DesktopStatus = {
  previewUrl: string | null
  status: string
}

export type DesktopRecording = {
  durationSeconds?: number
  endTime?: string
  fileName: string
  filePath: string
  id: string
  sizeBytes?: number
  startTime: string
  status: string
}

export type RecordingsResponse = {
  recordings: DesktopRecording[]
}

type DesktopPanelView = "desktop" | "recordings"

export type BusyKind = "refresh" | "start" | "stop"

type DesktopPanelState = {
  busy: BusyKind | null
  connectRequested: boolean
  error: string | null
  recordings: DesktopRecording[]
  status: DesktopStatus | null
  view: DesktopPanelView
}

type DesktopPanelAction =
  | { type: "connect" }
  | { type: "disconnect" }
  | { type: "load-recordings"; recordings: DesktopRecording[] }
  | { type: "load-status"; status: DesktopStatus }
  | { type: "refresh-error"; error: string }
  | { type: "refresh-finish" }
  | { type: "refresh-start" }
  | { type: "refresh-success" }
  | { type: "set-view"; view: DesktopPanelView }
  | { type: "start-error"; error: string }
  | { type: "start-start" }
  | { type: "start-success"; status: DesktopStatus }
  | { type: "stop-error"; error: string }
  | { type: "stop-start" }
  | { type: "stop-success"; status: DesktopStatus }

export const initialDesktopPanelState: DesktopPanelState = {
  busy: null,
  connectRequested: false,
  error: null,
  recordings: [],
  status: null,
  view: "desktop",
}

export const RECORDINGS_POLL_MS = 8000

export function desktopPanelReducer(
  state: DesktopPanelState,
  action: DesktopPanelAction
): DesktopPanelState {
  switch (action.type) {
    case "connect":
      return state.busy ? state : { ...state, connectRequested: true }
    case "disconnect":
      return { ...state, connectRequested: false }
    case "load-recordings":
      return { ...state, recordings: action.recordings }
    case "load-status":
      return {
        ...state,
        connectRequested: action.status.previewUrl
          ? state.connectRequested
          : false,
        status: action.status,
      }
    case "refresh-error":
      return { ...state, error: action.error }
    case "refresh-finish":
      return {
        ...state,
        busy: state.busy === "refresh" ? null : state.busy,
      }
    case "refresh-start":
      return { ...state, busy: state.busy ?? "refresh" }
    case "refresh-success":
      return { ...state, error: null }
    case "set-view":
      return { ...state, view: action.view }
    case "start-error":
      return { ...state, busy: null, error: action.error }
    case "start-start":
      return { ...state, busy: "start", error: null }
    case "start-success":
      return {
        ...state,
        busy: null,
        connectRequested: Boolean(action.status.previewUrl),
        error: null,
        status: action.status,
      }
    case "stop-error":
      return { ...state, busy: null, error: action.error }
    case "stop-start":
      return { ...state, busy: "stop", connectRequested: false, error: null }
    case "stop-success":
      return {
        ...state,
        busy: null,
        connectRequested: false,
        error: null,
        status: action.status,
      }
  }
}

export function isActiveRecording(recording: DesktopRecording) {
  const status = recording.status.toLowerCase()
  return status === "active" || status === "recording" || status === "running"
}

function formatBytes(bytes?: number) {
  if (!bytes || bytes < 1) return ""
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDuration(seconds?: number) {
  if (!seconds || seconds < 1) return ""
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`
}

export function recordingTitle(recording: DesktopRecording) {
  return (recording.fileName || recording.id).replace(/\.mp4$/i, "")
}

export function formatRecordingMeta(recording: DesktopRecording) {
  return [
    formatDuration(recording.durationSeconds),
    formatBytes(recording.sizeBytes),
  ]
    .filter(Boolean)
    .join(" · ")
}

export function desktopWebSocketUrl(previewUrl: string) {
  try {
    const url = new URL(previewUrl)
    url.protocol = url.protocol === "http:" ? "ws:" : "wss:"
    url.pathname = "/websockify"
    for (const param of ["autoconnect", "path", "reconnect", "resize"]) {
      url.searchParams.delete(param)
    }
    url.hash = ""
    return url.toString()
  } catch {
    return null
  }
}
