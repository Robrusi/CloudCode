"use client"

import { Show, SignInButton, UserButton } from "@clerk/nextjs"
import {
  File as PierreFile,
  type FileContents,
  type FileOptions,
  type ThemeTypes,
} from "@pierre/diffs/react"
import { useMutation, useQuery } from "convex/react"
import {
  AlertCircle,
  ArrowUp,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderOpen,
  GitBranch,
  LogIn,
  Loader2,
  PanelLeft,
  Pause,
  Plus,
  ScrollText,
  Save,
  SquarePen,
  SquareTerminal,
  Square,
  Terminal,
  Trash2,
  X,
} from "lucide-react"
import { useTheme } from "next-themes"
import {
  type CSSProperties,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { FitAddon } from "@xterm/addon-fit"
import type { Terminal as XTermTerminal } from "@xterm/xterm"

import { GeistPixelSquare } from "geist/font/pixel"

import { Button } from "@/components/ui/button"
import {
  FileBrowser,
  type FileBrowserOpenMode,
} from "@/components/file-browser"
import { FileEditorPanel } from "@/components/file-editor"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useStoreUserEffect } from "@/hooks/use-store-user-effect"
import {
  getDiffStats,
  type DiffFileStat,
  type DiffStats,
} from "@/lib/diff-metadata"
import { cn } from "@/lib/utils"

type Role = "user" | "assistant"

type Message = {
  id: Id<"messages">
  role: Role
  content: string
  pending?: boolean
  error?: boolean
  meta?: {
    branch?: string
    diff?: string
    logs?: RunLog[]
    sandboxSnapshotId?: string
    status?: string
  }
  speed?: Speed
  thinking?: Thinking
}

type RunLogKind =
  | "setup"
  | "command"
  | "reasoning"
  | "stdout"
  | "stderr"
  | "result"

type RunLog = {
  detail?: string
  id: string
  kind: RunLogKind
  message: string
  time: number
}

type CodexRunResult = {
  branchName?: unknown
  codexThreadId?: unknown
  diff?: unknown
  error?: unknown
  lastMessage?: unknown
  sandboxId?: unknown
  sandboxSnapshotId?: unknown
  status?: unknown
  stderr?: unknown
  stdout?: unknown
}

type CachedRunState = {
  branch?: string
  codexThreadId?: string
  diff?: string
  sandboxId?: string
  sandboxSnapshotId?: string
}

type CodexRunStreamEvent =
  | {
      log?: Omit<RunLog, "id" | "time">
      time?: number
      type: "progress"
    }
  | {
      result?: CodexRunResult
      type: "done"
    }
  | {
      error?: string
      type: "error"
    }

type AuthStatus = {
  accountId?: string | null
  authMode?: "chatgpt"
  exists: boolean
  lastRefresh?: string
  profile: string
}

type ChatRecord = {
  codexThreadId?: string
  id: Id<"threads">
  repoUrl: string
  sandboxId?: string
  sandboxSnapshotId?: string
  title: string
  messages: Message[]
  model: Model
  createdAt: number
  updatedAt: number
}

const MODELS = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"] as const
type Model = (typeof MODELS)[number]

const SPEEDS = ["standard", "fast"] as const
type Speed = (typeof SPEEDS)[number]

const THINKINGS = ["none", "low", "medium", "high", "xhigh"] as const
type Thinking = (typeof THINKINGS)[number]

const REPO_KEY = "cloudcode:repoUrl"
const MODEL_KEY = "cloudcode:model"
const HANDOFF_CONTENT_LIMIT = 1_200
const HANDOFF_RECENT_USER_LIMIT = 4
const HANDOFF_DIFF_FILE_LIMIT = 12

function truncateHandoffContent(
  content: string,
  limit = HANDOFF_CONTENT_LIMIT
) {
  const trimmed = content.trim()

  if (trimmed.length <= limit) {
    return trimmed
  }

  return `${trimmed.slice(0, limit)}\n[truncated]`
}

function latestCompletedMessage(messages: Message[], role: Role) {
  return messages
    .toReversed()
    .find((message) => message.role === role && !message.pending)
}

function buildDiffSummary(diff?: string) {
  if (!diff?.trim()) {
    return "No saved diff was available."
  }

  const stats = parseDiffStats(diff)

  if (stats.files.length === 0) {
    return "Saved diff is empty."
  }

  const fileLines = stats.files
    .slice(0, HANDOFF_DIFF_FILE_LIMIT)
    .map((file) => `- ${file.path} (+${file.additions}/-${file.deletions})`)
  const remaining = stats.files.length - fileLines.length

  return [
    `${stats.files.length} file${stats.files.length === 1 ? "" : "s"} changed, +${stats.additions}/-${stats.deletions}.`,
    ...fileLines,
    remaining > 0
      ? `- ${remaining} more file${remaining === 1 ? "" : "s"}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n")
}

function buildResumeHandoff({
  branchName,
  messages,
  previousDiff,
  repoUrl,
  status,
}: {
  branchName?: string
  messages: Message[]
  previousDiff?: string
  repoUrl: string
  status?: string
}) {
  const completedMessages = messages.filter(
    (message) => !message.pending && message.content.trim()
  )

  if (
    completedMessages.length === 0 &&
    !branchName &&
    !previousDiff?.trim() &&
    !status?.trim()
  ) {
    return undefined
  }

  const originalGoal = completedMessages.find(
    (message) => message.role === "user"
  )
  const lastAssistant = latestCompletedMessage(messages, "assistant")
  const recentUserClarifications = completedMessages
    .filter(
      (message) => message.role === "user" && message.id !== originalGoal?.id
    )
    .slice(-HANDOFF_RECENT_USER_LIMIT)

  return [
    "Previous Cloudcode thread handoff:",
    `Original goal:\n${originalGoal ? truncateHandoffContent(originalGoal.content) : "Unknown."}`,
    `Repo:\n${repoUrl}`,
    `Branch:\n${branchName ?? "Unknown."}`,
    `Restored changes:\n${buildDiffSummary(previousDiff)}`,
    status?.trim()
      ? `Last git status:\n${truncateHandoffContent(status, 1_500)}`
      : "",
    lastAssistant
      ? `Last assistant result:\n${truncateHandoffContent(lastAssistant.content)}`
      : "",
    recentUserClarifications.length > 0
      ? [
          "Recent user clarifications:",
          ...recentUserClarifications.map(
            (message) => `- ${truncateHandoffContent(message.content, 600)}`
          ),
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n\n")
}
const SPEED_KEY = "cloudcode:speed"
const THINKING_KEY = "cloudcode:thinking"
const ACTIVE_KEY = "cloudcode:activeChatId"
const TERMINAL_BUFFER_LIMIT = 2_000

type TerminalAssetModules = {
  FitAddon: typeof import("@xterm/addon-fit").FitAddon
  Terminal: typeof import("@xterm/xterm").Terminal
}

type BrowserTerminalStatus = "connecting" | "ready" | "closed"

type BrowserTerminalEvent =
  | { kind: "chunk"; data: string | Uint8Array }
  | { error?: string; kind: "status"; status: BrowserTerminalStatus }

type BrowserTerminalSession = {
  buffered: Array<string | Uint8Array>
  error?: string
  listeners: Set<(event: BrowserTerminalEvent) => void>
  queuedInput: Uint8Array[]
  size: { cols: number; rows: number }
  socket: WebSocket | null
  status: BrowserTerminalStatus
  url?: string
  urlPromise?: Promise<string>
}

let terminalAssetPromise: Promise<TerminalAssetModules> | null = null
const browserTerminalSessions = new Map<string, BrowserTerminalSession>()
const terminalUrlCache = new Map<string, string>()
const terminalUrlPromises = new Map<string, Promise<string>>()

function preloadTerminalAssets() {
  terminalAssetPromise ??= Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
  ]).then(([xterm, fit]) => ({
    FitAddon: fit.FitAddon,
    Terminal: xterm.Terminal,
  }))
  return terminalAssetPromise
}

function getTerminalUrl(sandboxId: string) {
  const cached = terminalUrlCache.get(sandboxId)
  if (cached) return Promise.resolve(cached)

  const existing = terminalUrlPromises.get(sandboxId)
  if (existing) return existing

  const promise = fetch(
    `/api/sandbox/terminal/url?sandboxId=${encodeURIComponent(sandboxId)}`,
    { cache: "no-store" }
  )
    .then(async (res) => {
      const data = (await res.json()) as { error?: string; url?: string }
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "Failed to start terminal.")
      }
      terminalUrlCache.set(sandboxId, data.url)
      return data.url
    })
    .finally(() => {
      terminalUrlPromises.delete(sandboxId)
    })

  terminalUrlPromises.set(sandboxId, promise)
  return promise
}

function createBrowserTerminalSession(): BrowserTerminalSession {
  return {
    buffered: [],
    listeners: new Set(),
    queuedInput: [],
    size: { cols: 100, rows: 24 },
    socket: null,
    status: "connecting",
  }
}

function emitBrowserTerminalEvent(
  session: BrowserTerminalSession,
  event: BrowserTerminalEvent
) {
  for (const listener of session.listeners) listener(event)
}

function setBrowserTerminalStatus(
  session: BrowserTerminalSession,
  status: BrowserTerminalStatus,
  error?: string
) {
  session.status = status
  session.error = error
  emitBrowserTerminalEvent(session, { error, kind: "status", status })
}

function bufferBrowserTerminalChunk(
  session: BrowserTerminalSession,
  data: string | Uint8Array
) {
  session.buffered.push(data)
  if (session.buffered.length > TERMINAL_BUFFER_LIMIT) {
    session.buffered.splice(0, session.buffered.length - TERMINAL_BUFFER_LIMIT)
  }
  emitBrowserTerminalEvent(session, { data, kind: "chunk" })
}

function ensureBrowserTerminalSession(sandboxId: string) {
  let session = browserTerminalSessions.get(sandboxId)
  if (!session) {
    session = createBrowserTerminalSession()
    browserTerminalSessions.set(sandboxId, session)
  }

  if (
    session.socket?.readyState === WebSocket.OPEN ||
    session.socket?.readyState === WebSocket.CONNECTING
  ) {
    return session
  }
  if (session.status === "connecting" && session.urlPromise) {
    return session
  }

  session.socket = null
  session.status = "connecting"
  session.error = undefined

  session.urlPromise = getTerminalUrl(sandboxId)
    .then((url) => {
      session.url = url
      const socket = new WebSocket(url)
      socket.binaryType = "arraybuffer"
      session.socket = socket

      socket.onopen = () => {
        setBrowserTerminalStatus(session, "ready")
        socket.send(JSON.stringify({ type: "resize", ...session.size }))
        for (const input of session.queuedInput) socket.send(input)
        session.queuedInput = []
      }

      socket.onmessage = (event) => {
        if (typeof event.data === "string") {
          bufferBrowserTerminalChunk(session, event.data)
          return
        }
        bufferBrowserTerminalChunk(
          session,
          new Uint8Array(event.data as ArrayBuffer)
        )
      }

      socket.onerror = () => {
        setBrowserTerminalStatus(
          session,
          "closed",
          "Terminal connection failed."
        )
      }

      socket.onclose = () => {
        if (session.socket === socket) session.socket = null
        setBrowserTerminalStatus(session, "closed", session.error)
      }

      return url
    })
    .catch((error) => {
      setBrowserTerminalStatus(
        session,
        "closed",
        error instanceof Error ? error.message : "Failed to open terminal."
      )
      session.urlPromise = undefined
      return ""
    })

  emitBrowserTerminalEvent(session, { kind: "status", status: "connecting" })
  return session
}

function warmBrowserTerminal(sandboxId: string | null | undefined) {
  if (!sandboxId) return
  void preloadTerminalAssets()
  ensureBrowserTerminalSession(sandboxId)
}

function sendBrowserTerminalInput(sandboxId: string, data: Uint8Array) {
  const session = ensureBrowserTerminalSession(sandboxId)
  const socket = session.socket
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(data)
  } else {
    session.queuedInput.push(data)
  }
}

function resizeBrowserTerminal(
  sandboxId: string,
  size: { cols: number; rows: number }
) {
  const session = ensureBrowserTerminalSession(sandboxId)
  session.size = size
  const socket = session.socket
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "resize", ...size }))
  }
}

function closeBrowserTerminalSession(sandboxId: string | null | undefined) {
  if (!sandboxId) return
  const session = browserTerminalSessions.get(sandboxId)
  session?.socket?.close()
  browserTerminalSessions.delete(sandboxId)
  terminalUrlCache.delete(sandboxId)
  terminalUrlPromises.delete(sandboxId)
}

const MODEL_LABEL: Record<Model, string> = {
  "gpt-5.5": "GPT 5.5",
  "gpt-5.4": "GPT 5.4",
  "gpt-5.4-mini": "GPT 5.4-mini",
}

const SPEED_LABEL: Record<Speed, string> = {
  standard: "Standard",
  fast: "Fast",
}

const THINKING_LABEL: Record<Thinking, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
}

function shortModel(m: Model) {
  return m.replace(/^gpt-/, "")
}

function repoLabel(url: string) {
  if (!url) return "Untitled"
  return url
    .replace(/^https?:\/\/(www\.)?github\.com\//, "")
    .replace(/\.git$/, "")
}

async function readJsonError(res: Response) {
  try {
    const data = (await res.json()) as CodexRunResult
    return (
      (typeof data.lastMessage === "string" && data.lastMessage.trim()) ||
      (typeof data.stderr === "string" && data.stderr.trim()) ||
      (typeof data.stdout === "string" && data.stdout.trim()) ||
      (typeof data.error === "string" && data.error.trim()) ||
      `Request failed (${res.status})`
    )
  } catch {
    return `Request failed (${res.status})`
  }
}

async function readCodexRunResponse(
  res: Response,
  onLog: (log: Omit<RunLog, "id" | "time">, time?: number) => void
) {
  const contentType = res.headers.get("content-type") ?? ""

  if (!res.ok) {
    throw new Error(await readJsonError(res))
  }

  if (!contentType.includes("application/x-ndjson") || !res.body) {
    return (await res.json()) as CodexRunResult
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let result: CodexRunResult | null = null

  function consume(line: string) {
    const trimmed = line.trim()
    if (!trimmed) return

    const event = JSON.parse(trimmed) as CodexRunStreamEvent
    if (event.type === "progress" && event.log) {
      onLog(event.log, event.time)
    } else if (event.type === "done") {
      result = event.result ?? {}
    } else if (event.type === "error") {
      throw new Error(event.error ?? "Codex sandbox run failed.")
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ""
    for (const line of lines) consume(line)
  }

  buffer += decoder.decode()
  if (buffer) consume(buffer)
  if (!result) throw new Error("Codex run ended without a result.")

  return result
}

export function Chat() {
  return (
    <>
      <Show when="signed-out">
        <SignedOutScreen />
      </Show>
      <Show when="signed-in">
        <ChatInner />
      </Show>
    </>
  )
}

function ChatInner() {
  const { isLoading: userLoading } = useStoreUserEffect()
  const rawChats = useQuery(api.chats.list)
  const chats = useMemo(() => (rawChats ?? []) as ChatRecord[], [rawChats])
  const createThread = useMutation(api.chats.createThread)
  const appendRunMessages = useMutation(api.chats.appendRunMessages)
  const completeAssistantMessage = useMutation(
    api.chats.completeAssistantMessage
  )
  const saveRunState = useMutation(api.chats.saveRunState)
  const clearSandbox = useMutation(api.chats.clearSandbox)
  const deleteThreadMutation = useMutation(api.chats.deleteThread)
  const updateThread = useMutation(api.chats.updateThread)
  const [activeId, setActiveId] = useState<Id<"threads"> | null>(() =>
    typeof window === "undefined"
      ? null
      : (localStorage.getItem(ACTIVE_KEY) as Id<"threads"> | null)
  )
  const [input, setInput] = useState("")
  const [draftRepo, setDraftRepo] = useState(() =>
    typeof window === "undefined" ? "" : (localStorage.getItem(REPO_KEY) ?? "")
  )
  const [draftModel, setDraftModel] = useState<Model>(() => {
    if (typeof window === "undefined") return "gpt-5.5"
    const stored = localStorage.getItem(MODEL_KEY)
    return stored && (MODELS as readonly string[]).includes(stored)
      ? (stored as Model)
      : "gpt-5.5"
  })
  const [draftSpeed, setDraftSpeed] = useState<Speed>(() => {
    if (typeof window === "undefined") return "standard"
    const stored = localStorage.getItem(SPEED_KEY)
    return stored && (SPEEDS as readonly string[]).includes(stored)
      ? (stored as Speed)
      : "standard"
  })
  const [draftThinking, setDraftThinking] = useState<Thinking>(() => {
    if (typeof window === "undefined") return "medium"
    const stored = localStorage.getItem(THINKING_KEY)
    return stored && (THINKINGS as readonly string[]).includes(stored)
      ? (stored as Thinking)
      : "medium"
  })
  const [editingRepo, setEditingRepo] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [speedOpen, setSpeedOpen] = useState(false)
  const [thinkingOpen, setThinkingOpen] = useState(false)
  const [filesOpen, setFilesOpen] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(320)
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null)
  const [activeFileMode, setActiveFileMode] =
    useState<FileBrowserOpenMode>("file")
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const [runLogs, setRunLogs] = useState<Record<string, RunLog[]>>({})
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
  const [authError, setAuthError] = useState("")
  const abortRef = useRef<AbortController | null>(null)
  const threadRunStateRef = useRef<Record<string, CachedRunState>>({})
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)

  const active = useMemo(
    () => chats.find((c) => c.id === activeId) ?? null,
    [chats, activeId]
  )
  const activeSandboxId = active?.sandboxId ?? null
  const activeSandboxSnapshotId = active?.sandboxSnapshotId ?? null
  const terminalVisible = terminalOpen && Boolean(activeSandboxId)

  const repoUrl = active ? active.repoUrl : draftRepo
  const model = active ? active.model : draftModel
  const speed = draftSpeed
  const thinking = draftThinking
  const messages = active?.messages ?? []
  const empty = messages.length === 0
  const activeDiff = useMemo(
    () =>
      active
        ? (active.messages.toReversed().find((m) => m.meta?.diff)?.meta?.diff ??
          null)
        : null,
    [active]
  )

  useEffect(() => {
    if (userLoading) return

    async function refreshAuth() {
      try {
        const res = await fetch("/api/codex-auth", { cache: "no-store" })
        const data = await res.json()

        if (!res.ok) {
          throw new Error(data?.error ?? "Unable to read auth status.")
        }

        setAuthStatus(data)
        setAuthError("")
      } catch (err) {
        setAuthStatus(null)
        setAuthError(
          err instanceof Error ? err.message : "Unable to read auth status."
        )
      }
    }

    void refreshAuth()
    window.addEventListener("focus", refreshAuth)
    return () => window.removeEventListener("focus", refreshAuth)
  }, [userLoading])

  useEffect(() => {
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId)
    else localStorage.removeItem(ACTIVE_KEY)
  }, [activeId])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = Math.min(el.scrollHeight, 200) + "px"
  }, [input])

  useEffect(() => {
    const el = threadRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }, [messages.length, activeId, runLogs])

  useEffect(() => {
    warmBrowserTerminal(activeSandboxId)
  }, [activeSandboxId])

  function appendRunLog(
    messageId: Id<"messages">,
    log: Omit<RunLog, "id" | "time">,
    time?: number
  ) {
    setRunLogs((current) => {
      const key = messageId as string
      const nextLog = {
        ...log,
        id: `${time ?? Date.now()}-${Math.random().toString(36).slice(2)}`,
        time: time ?? Date.now(),
      }
      const logs = [...(current[key] ?? []), nextLog].slice(-500)
      return { ...current, [key]: logs }
    })
  }

  function persistRepo(value: string) {
    if (active) {
      void updateThread({ repoUrl: value, threadId: active.id })
    } else {
      setDraftRepo(value)
    }
    if (value) localStorage.setItem(REPO_KEY, value)
    else localStorage.removeItem(REPO_KEY)
  }

  function persistModel(next: Model) {
    if (active) {
      void updateThread({ model: next, threadId: active.id })
    } else {
      setDraftModel(next)
    }
    localStorage.setItem(MODEL_KEY, next)
  }

  function persistSpeed(next: Speed) {
    setDraftSpeed(next)
    localStorage.setItem(SPEED_KEY, next)
  }

  function persistThinking(next: Thinking) {
    setDraftThinking(next)
    localStorage.setItem(THINKING_KEY, next)
  }

  function startNewChat() {
    setActiveId(null)
    setInput("")
    setEditingRepo(false)
    setActiveFilePath(null)
    setTerminalOpen(false)
  }

  function selectChat(id: Id<"threads">) {
    setActiveId(id)
    setInput("")
    setEditingRepo(false)
    setActiveFilePath(null)
    setTerminalOpen(false)
  }

  function deleteChat(id: Id<"threads">) {
    void deleteThreadMutation({ threadId: id })
    if (activeId === id) setActiveId(null)
  }

  async function send(prompt: string) {
    const trimmed = prompt.trim()
    if (!trimmed || busy || userLoading) return
    if (!repoUrl.trim()) {
      setEditingRepo(true)
      return
    }
    if (!authStatus?.exists) {
      window.location.href = "/api/codex-auth/login"
      return
    }

    let chatId = activeId
    let assistantMessageId: Id<"messages"> | null = null

    setInput("")
    setBusy(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      if (!chatId) {
        const created = await createThread({
          model: draftModel,
          prompt: trimmed,
          repoUrl: repoUrl.trim(),
          speed: draftSpeed,
          thinking: draftThinking,
          title: trimmed.split("\n")[0].slice(0, 60),
        })
        chatId = created.threadId
        assistantMessageId = created.assistantMessageId
        setActiveId(chatId)
      } else {
        const appended = await appendRunMessages({
          prompt: trimmed,
          speed,
          thinking,
          threadId: chatId,
        })
        assistantMessageId = appended.assistantMessageId
      }

      if (!chatId || !assistantMessageId) {
        throw new Error("Unable to create a thread for this run.")
      }

      const previousAssistant = active?.messages
        .toReversed()
        .find(
          (m) =>
            m.role === "assistant" &&
            (m.meta?.branch || m.meta?.diff || m.meta?.sandboxSnapshotId)
        )
      const cachedRunState = threadRunStateRef.current[chatId as string]
      const branchName =
        cachedRunState?.branch ?? previousAssistant?.meta?.branch
      const previousDiff = cachedRunState?.diff ?? previousAssistant?.meta?.diff
      const previousSandboxSnapshotId =
        cachedRunState?.sandboxSnapshotId ??
        active?.sandboxSnapshotId ??
        previousAssistant?.meta?.sandboxSnapshotId
      const resumeContext = buildResumeHandoff({
        branchName,
        messages: active?.messages ?? [],
        previousDiff,
        repoUrl: repoUrl.trim(),
        status: previousAssistant?.meta?.status,
      })

      const res = await fetch("/api/codex-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          branchName,
          codexThreadId: cachedRunState?.codexThreadId ?? active?.codexThreadId,
          previousDiff,
          previousSandboxSnapshotId,
          prompt: trimmed,
          reasoningEffort: thinking,
          repoUrl: repoUrl.trim(),
          resumeContext,
          sandboxId: cachedRunState?.sandboxId ?? active?.sandboxId,
          speed,
          model,
        }),
        signal: controller.signal,
      })
      const runMessageId = assistantMessageId
      const data = await readCodexRunResponse(res, (log, time) =>
        appendRunLog(runMessageId, log, time)
      )
      const content =
        (typeof data.lastMessage === "string" && data.lastMessage.trim()) ||
        (typeof data.stdout === "string" && data.stdout.trim()) ||
        (typeof data.stderr === "string" && data.stderr.trim()) ||
        "(no output)"
      const nextRunState: CachedRunState = {
        ...(typeof data.branchName === "string"
          ? { branch: data.branchName }
          : {}),
        ...(typeof data.codexThreadId === "string"
          ? {
              codexThreadId: data.codexThreadId,
            }
          : {}),
        ...(typeof data.diff === "string" ? { diff: data.diff } : {}),
        ...(typeof data.sandboxId === "string"
          ? { sandboxId: data.sandboxId }
          : {}),
        ...(typeof data.sandboxSnapshotId === "string"
          ? { sandboxSnapshotId: data.sandboxSnapshotId }
          : {}),
      }
      threadRunStateRef.current[chatId as string] = {
        ...threadRunStateRef.current[chatId as string],
        ...nextRunState,
      }
      await completeAssistantMessage({
        content,
        messageId: assistantMessageId,
        meta: {
          branch: nextRunState.branch,
          diff: nextRunState.diff,
          sandboxSnapshotId: nextRunState.sandboxSnapshotId,
          status: typeof data.status === "string" ? data.status : undefined,
        },
        sandboxId: nextRunState.sandboxId,
        sandboxSnapshotId: nextRunState.sandboxSnapshotId,
        threadId: chatId,
      })
      if (
        nextRunState.codexThreadId ||
        nextRunState.sandboxId ||
        nextRunState.sandboxSnapshotId
      ) {
        try {
          await saveRunState({
            codexThreadId: nextRunState.codexThreadId,
            sandboxId: nextRunState.sandboxId,
            sandboxSnapshotId: nextRunState.sandboxSnapshotId,
            threadId: chatId,
          })
        } catch (error) {
          console.warn("Unable to save Codex run state.", error)
        }
      }
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError"
      const msg = aborted
        ? "_Stopped._"
        : err instanceof Error
          ? err.message
          : "Request failed."
      if (chatId && assistantMessageId) {
        await completeAssistantMessage({
          content: msg,
          error: !aborted,
          messageId: assistantMessageId,
          threadId: chatId,
        })
      }
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  async function killActiveSandbox() {
    if (!active) return
    const sandboxId =
      threadRunStateRef.current[active.id as string]?.sandboxId ??
      active.sandboxId
    if (!sandboxId) return
    setTerminalOpen(false)
    closeBrowserTerminalSession(sandboxId)

    let sandboxSnapshotId: string | undefined
    try {
      const response = await fetch("/api/sandbox/kill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId }),
      })
      const data = (await response.json().catch(() => undefined)) as
        | { sandboxSnapshotId?: unknown }
        | undefined
      if (typeof data?.sandboxSnapshotId === "string") {
        sandboxSnapshotId = data.sandboxSnapshotId
      }
    } catch (error) {
      console.warn("Failed to kill sandbox.", error)
    }

    threadRunStateRef.current[active.id as string] = {
      ...threadRunStateRef.current[active.id as string],
      sandboxId: undefined,
      ...(sandboxSnapshotId ? { sandboxSnapshotId } : {}),
    }

    try {
      if (sandboxSnapshotId) {
        await saveRunState({
          sandboxSnapshotId,
          threadId: active.id,
        })
      }
      await clearSandbox({ threadId: active.id })
    } catch (error) {
      console.warn("Failed to clear sandbox state.", error)
    }
  }

  async function saveActiveSandbox() {
    if (!active) return
    const sandboxId =
      threadRunStateRef.current[active.id as string]?.sandboxId ??
      active.sandboxId
    if (!sandboxId) return

    const response = await fetch("/api/sandbox/snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sandboxId }),
    })
    const data = (await response.json().catch(() => undefined)) as
      | { error?: unknown; sandboxSnapshotId?: unknown }
      | undefined

    if (!response.ok || typeof data?.sandboxSnapshotId !== "string") {
      throw new Error(
        typeof data?.error === "string"
          ? data.error
          : "Failed to save sandbox."
      )
    }

    threadRunStateRef.current[active.id as string] = {
      ...threadRunStateRef.current[active.id as string],
      sandboxSnapshotId: data.sandboxSnapshotId,
    }

    await saveRunState({
      sandboxSnapshotId: data.sandboxSnapshotId,
      threadId: active.id,
    })
  }

  async function pauseActiveSandbox() {
    if (!active) return
    const sandboxId =
      threadRunStateRef.current[active.id as string]?.sandboxId ??
      active.sandboxId
    if (!sandboxId) return
    setTerminalOpen(false)
    closeBrowserTerminalSession(sandboxId)

    const response = await fetch("/api/sandbox/pause", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sandboxId }),
    })
    const data = (await response.json().catch(() => undefined)) as
      | { error?: unknown; sandboxSnapshotId?: unknown }
      | undefined

    if (!response.ok) {
      throw new Error(
        typeof data?.error === "string"
          ? data.error
          : "Failed to pause sandbox."
      )
    }

    if (typeof data?.sandboxSnapshotId === "string") {
      threadRunStateRef.current[active.id as string] = {
        ...threadRunStateRef.current[active.id as string],
        sandboxSnapshotId: data.sandboxSnapshotId,
      }
      await saveRunState({
        sandboxSnapshotId: data.sandboxSnapshotId,
        threadId: active.id,
      })
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    send(input)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  return (
    <div className="fixed inset-0 flex min-w-0 overflow-hidden bg-background text-foreground">
      {sidebarOpen ? (
        <Sidebar
          authError={authError}
          authStatus={authStatus}
          chats={chats}
          activeId={activeId}
          onNewChat={startNewChat}
          onSelect={selectChat}
          onDelete={deleteChat}
        />
      ) : null}

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          title={active?.title ?? null}
          repoUrl={repoUrl}
          isNew={!active}
          sandboxId={activeSandboxId}
          sandboxSnapshotId={activeSandboxSnapshotId}
          onKillSandbox={killActiveSandbox}
          onPauseSandbox={pauseActiveSandbox}
          onSaveSandbox={saveActiveSandbox}
          filesOpen={filesOpen}
          onToggleFiles={() => setFilesOpen((v) => !v)}
          terminalOpen={terminalVisible}
          onToggleTerminal={() => setTerminalOpen((v) => !v)}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
        />
        {activeFilePath ? (
          <FileEditorPanel
            sandboxId={activeSandboxId}
            sandboxSnapshotId={activeSandboxSnapshotId}
            activePath={activeFilePath}
            diff={activeDiff ?? undefined}
            mode={activeFileMode}
            onClose={() => setActiveFilePath(null)}
            placement="main"
          />
        ) : (
          <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col px-6 pt-16 pb-40">
              {empty ? (
                <div className="flex flex-1 flex-col items-center justify-center text-center">
                  <h1 className="text-3xl font-medium tracking-tight text-foreground/90">
                    What should we build?
                  </h1>
                  <p className="mt-3 text-sm text-muted-foreground">
                    Describe a change. It runs in a sandbox against your repo.
                  </p>
                </div>
              ) : (
                <div className="space-y-8">
                  {messages.map((m) => (
                    <MessageBlock
                      key={m.id}
                      message={m}
                      logs={runLogs[m.id as string] ?? []}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <SandboxTerminalPanel
          open={terminalVisible}
          sandboxId={activeSandboxId}
          onClose={() => setTerminalOpen(false)}
          height={terminalHeight}
          onHeightChange={setTerminalHeight}
        />

        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 flex justify-center px-4 pb-6",
            activeFilePath && "hidden"
          )}
          style={{ bottom: terminalVisible ? terminalHeight : 0 }}
        >
          <form
            onSubmit={onSubmit}
            className="pointer-events-auto w-full max-w-2xl rounded-3xl border border-border/70 bg-background/80 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] backdrop-blur-xl transition-colors focus-within:border-border"
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setInput(e.target.value)
              }
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={
                empty ? "Ask anything…" : "Ask for follow-up changes"
              }
              className="block w-full resize-none bg-transparent px-5 pt-4 pb-1 text-[15px] leading-6 outline-none placeholder:text-muted-foreground/70"
            />

            <div className="flex items-center gap-1.5 px-2.5 pt-1 pb-2.5">
              <IconButton aria-label="Attach" disabled>
                <Plus className="size-[18px]" />
              </IconButton>

              <RepoChip
                value={repoUrl}
                editing={editingRepo}
                setEditing={setEditingRepo}
                onChange={persistRepo}
                locked={Boolean(active)}
              />

              <div className="ml-auto flex items-center gap-1.5">
                <Pill
                  header="Model"
                  value={model}
                  options={MODELS}
                  formatTrigger={shortModel}
                  formatOption={(m) => MODEL_LABEL[m]}
                  open={modelOpen}
                  setOpen={setModelOpen}
                  onSelect={persistModel}
                />
                <Pill
                  header="Thinking"
                  value={thinking}
                  options={THINKINGS}
                  formatTrigger={(t) => THINKING_LABEL[t]}
                  formatOption={(t) => THINKING_LABEL[t]}
                  open={thinkingOpen}
                  setOpen={setThinkingOpen}
                  onSelect={persistThinking}
                  triggerClassName="text-muted-foreground"
                />
                <Pill
                  header="Speed"
                  value={speed}
                  options={SPEEDS}
                  formatTrigger={(s) => SPEED_LABEL[s]}
                  formatOption={(s) => SPEED_LABEL[s]}
                  open={speedOpen}
                  setOpen={setSpeedOpen}
                  onSelect={persistSpeed}
                  triggerClassName="text-muted-foreground"
                />

                {busy ? (
                  <button
                    type="button"
                    onClick={() => abortRef.current?.abort()}
                    className="grid size-8 place-items-center rounded-full bg-foreground text-background transition-opacity hover:opacity-80"
                    aria-label="Stop"
                  >
                    <Square className="size-3.5 fill-current" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!input.trim()}
                    className="grid size-8 place-items-center rounded-full bg-foreground text-background transition-opacity hover:opacity-80 disabled:opacity-30"
                    aria-label="Send"
                  >
                    <ArrowUp className="size-4" strokeWidth={2.4} />
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>
      </div>

      <FileBrowser
        open={filesOpen && Boolean(activeSandboxId || activeSandboxSnapshotId)}
        sandboxId={activeSandboxId}
        sandboxSnapshotId={activeSandboxSnapshotId}
        diff={activeDiff ?? undefined}
        activePath={activeFilePath}
        onClose={() => setFilesOpen(false)}
        onOpenFile={(p, mode) => {
          setActiveFilePath(p)
          setActiveFileMode(mode)
        }}
      />
    </div>
  )
}

function SignedOutScreen() {
  return (
    <div className="fixed inset-0 flex overflow-hidden bg-background px-6 text-foreground">
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-3xl font-medium tracking-tight text-foreground/90">
            Cloudcode
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Sign in to keep threads and Codex auth attached to your profile.
          </p>
          <SignInButton mode="modal">
            <button className="mt-6 inline-flex h-10 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-85">
              Sign in
            </button>
          </SignInButton>
        </div>
      </div>
    </div>
  )
}

function TopBar({
  title,
  repoUrl,
  isNew,
  sandboxId,
  sandboxSnapshotId,
  onKillSandbox,
  onPauseSandbox,
  onSaveSandbox,
  filesOpen,
  onToggleFiles,
  terminalOpen,
  onToggleTerminal,
  sidebarOpen,
  onToggleSidebar,
}: {
  title: string | null
  repoUrl: string
  isNew: boolean
  sandboxId: string | null
  sandboxSnapshotId: string | null
  onKillSandbox: () => void | Promise<void>
  onPauseSandbox: () => void | Promise<void>
  onSaveSandbox: () => void | Promise<void>
  filesOpen: boolean
  onToggleFiles: () => void
  terminalOpen: boolean
  onToggleTerminal: () => void
  sidebarOpen: boolean
  onToggleSidebar: () => void
}) {
  const displayTitle = title?.trim() || (isNew ? "New chat" : "Untitled")
  const repo = repoUrl ? repoLabel(repoUrl) : ""

  return (
    <header className="flex h-[3.25rem] shrink-0 items-center gap-2.5 border-b border-border/60 bg-background/80 pr-4 pl-2 backdrop-blur-xl">
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <PanelLeft className="size-3.5" />
      </button>
      <span className="min-w-0 truncate text-sm font-medium text-foreground/85">
        {displayTitle}
      </span>
      {repo ? (
        <>
          <span className="text-muted-foreground/40" aria-hidden>
            /
          </span>
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Folder className="size-4 shrink-0" />
            <span className="truncate">{repo}</span>
          </div>
        </>
      ) : null}
      <div className="ml-auto flex items-center gap-6">
        {sandboxId ? (
          <SandboxStatus
            sandboxId={sandboxId}
            onKill={onKillSandbox}
            onPause={onPauseSandbox}
            onSave={onSaveSandbox}
            hideActions={filesOpen}
          />
        ) : null}
        <button
          type="button"
          onClick={onToggleTerminal}
          onPointerEnter={() => warmBrowserTerminal(sandboxId)}
          aria-label={
            terminalOpen ? "Hide sandbox terminal" : "Show sandbox terminal"
          }
          title={
            terminalOpen ? "Hide sandbox terminal" : "Show sandbox terminal"
          }
          disabled={!sandboxId}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          <SquareTerminal className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onToggleFiles}
          aria-label={filesOpen ? "Hide sandbox files" : "Show sandbox files"}
          title={filesOpen ? "Hide sandbox files" : "Show sandbox files"}
          disabled={!sandboxId && !sandboxSnapshotId}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          {filesOpen ? (
            <FolderOpen className="size-3.5" />
          ) : (
            <Folder className="size-3.5" />
          )}
        </button>
      </div>
    </header>
  )
}

const TERMINAL_MIN_HEIGHT = 140
const TERMINAL_MAX_HEIGHT_RATIO = 0.85

const TERMINAL_THEMES = {
  dark: {
    background: "#09090b",
    cursor: "#fafafa",
    cursorAccent: "#09090b",
    foreground: "#e4e4e7",
    selectionBackground: "#27272a",
  },
  light: {
    background: "#fafafa",
    cursor: "#18181b",
    cursorAccent: "#fafafa",
    foreground: "#27272a",
    selectionBackground: "#e4e4e7",
  },
} as const

function SandboxTerminalPanel({
  height,
  onClose,
  onHeightChange,
  open,
  sandboxId,
}: {
  height: number
  onClose: () => void
  onHeightChange: (next: number) => void
  open: boolean
  sandboxId: string | null
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTermTerminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [status, setStatus] = useState<"connecting" | "ready" | "closed">(
    "connecting"
  )
  const [error, setError] = useState("")
  const [resizing, setResizing] = useState(false)
  const { resolvedTheme } = useTheme()
  const themeKey: "light" | "dark" =
    resolvedTheme === "light" ? "light" : "dark"

  useEffect(() => {
    if (!open || !sandboxId) return

    const activeSandboxId = sandboxId
    let cancelled = false
    let resizeObserver: ResizeObserver | undefined
    let inputDisposable: { dispose: () => void } | undefined
    let unsubscribe: (() => void) | undefined
    let resizeTimer: number | undefined
    let directMode = false
    let localLine = ""
    let localCursor = 0
    let inputHistory: string[] = []
    let historyIndex: number | null = null
    let suppressRemoteEcho = ""
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()

    function writeTerminalChunk(data: string | Uint8Array) {
      terminalRef.current?.write(data)
    }

    function stripSuppressedEcho(data: string | Uint8Array) {
      if (!suppressRemoteEcho) return data

      const text = typeof data === "string" ? data : decoder.decode(data)
      let next = text

      while (suppressRemoteEcho && next) {
        if (next.startsWith(suppressRemoteEcho)) {
          next = next.slice(suppressRemoteEcho.length)
          suppressRemoteEcho = ""
          break
        }
        if (suppressRemoteEcho.startsWith(next)) {
          suppressRemoteEcho = suppressRemoteEcho.slice(next.length)
          return ""
        }
        if (next[0] !== suppressRemoteEcho[0]) {
          suppressRemoteEcho = ""
          break
        }
        next = next.slice(1)
        suppressRemoteEcho = suppressRemoteEcho.slice(1)
      }

      return next
    }

    function updateTerminalMode(data: string | Uint8Array) {
      const text = typeof data === "string" ? data : decoder.decode(data)
      if (text.includes("\x1b[?1049h")) directMode = true
      if (text.includes("\x1b[?1049l")) directMode = false
    }

    function sendResize() {
      const terminal = terminalRef.current
      const fit = fitRef.current
      if (!terminal || !fit) return
      try {
        fit.fit()
      } catch {
        return
      }
      resizeBrowserTerminal(activeSandboxId, {
        cols: terminal.cols,
        rows: terminal.rows,
      })
    }

    function scheduleResize() {
      if (resizeTimer) window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(sendResize, 30)
    }

    function localChars() {
      return Array.from(localLine)
    }

    function setLocalLine(next: string, cursor = Array.from(next).length) {
      const oldCursor = localCursor
      localLine = next
      localCursor = Math.max(0, Math.min(cursor, Array.from(next).length))

      let repaint = "\x1b[?25l"
      if (oldCursor > 0) repaint += `\x1b[${oldCursor}D`
      repaint += `\x1b[0K${localLine}`
      const distanceFromEnd = Array.from(localLine).length - localCursor
      if (distanceFromEnd > 0) {
        repaint += `\x1b[${distanceFromEnd}D`
      }
      terminalRef.current?.write(`${repaint}\x1b[?25h`)
    }

    function insertLocalText(text: string) {
      if (!text) return
      const chars = localChars()
      const next = [
        ...chars.slice(0, localCursor),
        ...Array.from(text),
        ...chars.slice(localCursor),
      ].join("")
      setLocalLine(next, localCursor + Array.from(text).length)
    }

    function moveLocalCursor(delta: number) {
      const next = Math.max(0, Math.min(localCursor + delta, localChars().length))
      const distance = next - localCursor
      if (distance > 0) terminalRef.current?.write(`\x1b[${distance}C`)
      if (distance < 0) terminalRef.current?.write(`\x1b[${Math.abs(distance)}D`)
      localCursor = next
    }

    function replaceFromHistory(direction: -1 | 1) {
      if (inputHistory.length === 0) return
      const nextIndex =
        historyIndex === null
          ? direction < 0
            ? inputHistory.length - 1
            : null
          : historyIndex + direction

      if (nextIndex === null || nextIndex >= inputHistory.length) {
        historyIndex = null
        setLocalLine("")
        return
      }
      if (nextIndex < 0) return

      historyIndex = nextIndex
      setLocalLine(inputHistory[nextIndex])
    }

    function handleEscapeSequence(sequence: string) {
      const final = sequence.at(-1)
      if (final === "D") {
        moveLocalCursor(-1)
        return true
      }
      if (final === "C") {
        moveLocalCursor(1)
        return true
      }
      if (final === "A") {
        replaceFromHistory(-1)
        return true
      }
      if (final === "B") {
        replaceFromHistory(1)
        return true
      }
      if (final === "H") {
        moveLocalCursor(-localCursor)
        return true
      }
      if (final === "F") {
        moveLocalCursor(localChars().length - localCursor)
        return true
      }
      if (sequence === "\x1b[3~" && localCursor < localChars().length) {
        const chars = localChars()
        chars.splice(localCursor, 1)
        setLocalLine(chars.join(""), localCursor)
        return true
      }
      return false
    }

    function sendInput(data: string) {
      if (directMode) {
        sendBrowserTerminalInput(activeSandboxId, encoder.encode(data))
        return
      }

      const input = data.replace(/\x1b\[200~([\s\S]*?)\x1b\[201~/g, "$1")
      let offset = 0
      while (offset < input.length) {
        if (input[offset] === "\x1b") {
          const sequence =
            input.slice(offset).match(/^\x1b(?:O[A-DHF]|\[[0-9;]*[~A-DHF])/)
              ?.[0] ?? "\x1b"
          handleEscapeSequence(sequence)
          offset += sequence.length
          continue
        }

        const char = Array.from(input.slice(offset))[0]
        offset += char.length

        if (char === "\r" || char === "\n") {
          terminalRef.current?.write("\r\n")
          suppressRemoteEcho += `${localLine}\r\n`
          const command = localLine.trim()
          if (command && inputHistory[inputHistory.length - 1] !== localLine) {
            inputHistory = [...inputHistory.slice(-99), localLine]
          }
          historyIndex = null
          sendBrowserTerminalInput(
            activeSandboxId,
            encoder.encode(`${localLine}\r`)
          )
          localLine = ""
          localCursor = 0
          continue
        }

        if (char === "\u007f" || char === "\b") {
          if (!localLine || localCursor === 0) continue
          const chars = localChars()
          chars.splice(localCursor - 1, 1)
          setLocalLine(chars.join(""), localCursor - 1)
          continue
        }

        if (char === "\x03") {
          terminalRef.current?.write("^C\r\n")
          suppressRemoteEcho += "^C\r\n"
          localLine = ""
          localCursor = 0
          historyIndex = null
          sendBrowserTerminalInput(activeSandboxId, encoder.encode(char))
          continue
        }

        if (/[\u0000-\u001f\u007f]/.test(char)) {
          if (!localLine) {
            sendBrowserTerminalInput(activeSandboxId, encoder.encode(char))
          }
          continue
        }

        historyIndex = null
        insertLocalText(char)
      }
    }

    async function boot() {
      const session = ensureBrowserTerminalSession(activeSandboxId)
      const { FitAddon: BrowserFitAddon, Terminal: BrowserTerminal } =
        await preloadTerminalAssets()
      if (cancelled || !containerRef.current) return

      setStatus(session.status)
      setError(session.error ?? "")

      const terminal = new BrowserTerminal({
        allowProposedApi: false,
        cursorBlink: true,
        cursorStyle: "bar",
        fontFamily:
          'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Monaco, Consolas, monospace',
        fontSize: 13,
        letterSpacing: 0,
        lineHeight: 1.35,
        rightClickSelectsWord: true,
        scrollback: 10000,
        theme: TERMINAL_THEMES[themeKey],
      })
      const fit = new BrowserFitAddon()
      terminal.loadAddon(fit)
      terminal.open(containerRef.current)

      // Two ticks: open paints the canvas, then we measure once layout settles.
      requestAnimationFrame(() => {
        try {
          fit.fit()
        } catch {
          // ignore
        }
      })

      terminalRef.current = terminal
      fitRef.current = fit
      terminal.focus()

      for (const chunk of session.buffered) writeTerminalChunk(chunk)
      unsubscribe = () => session.listeners.delete(handleTerminalEvent)
      session.listeners.add(handleTerminalEvent)

      function handleTerminalEvent(event: BrowserTerminalEvent) {
        if (cancelled) return
        if (event.kind === "chunk") {
          updateTerminalMode(event.data)
          const output = stripSuppressedEcho(event.data)
          if (output) writeTerminalChunk(output)
          return
        }
        setStatus(event.status)
        setError(event.error ?? "")
      }

      inputDisposable = terminal.onData(sendInput)
      resizeObserver = new ResizeObserver(scheduleResize)
      resizeObserver.observe(containerRef.current)
      sendResize()
    }

    boot().catch((err) => {
      if (cancelled) return
      setStatus("closed")
      setError(err instanceof Error ? err.message : "Failed to open terminal.")
    })

    return () => {
      cancelled = true
      if (resizeTimer) window.clearTimeout(resizeTimer)
      resizeObserver?.disconnect()
      inputDisposable?.dispose()
      unsubscribe?.()
      terminalRef.current?.dispose()
      terminalRef.current = null
      fitRef.current = null
    }
    // themeKey intentionally excluded — theme changes are applied to the
    // live terminal in the effect below without re-initialising.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sandboxId])

  // Reactively update the live terminal's theme when the app theme changes.
  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    terminal.options.theme = TERMINAL_THEMES[themeKey]
  }, [themeKey])

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    const startY = event.clientY
    const startHeight = height
    setResizing(true)

    function handleMove(moveEvent: PointerEvent) {
      const max = Math.max(
        TERMINAL_MIN_HEIGHT,
        Math.floor(window.innerHeight * TERMINAL_MAX_HEIGHT_RATIO)
      )
      const next = Math.min(
        max,
        Math.max(TERMINAL_MIN_HEIGHT, startHeight + (startY - moveEvent.clientY))
      )
      onHeightChange(next)
    }

    function handleUp() {
      setResizing(false)
      window.removeEventListener("pointermove", handleMove)
      window.removeEventListener("pointerup", handleUp)
      window.removeEventListener("pointercancel", handleUp)
    }

    window.addEventListener("pointermove", handleMove)
    window.addEventListener("pointerup", handleUp)
    window.addEventListener("pointercancel", handleUp)
  }

  if (!open) return null

  const dotColor =
    status === "ready"
      ? "bg-emerald-400"
      : status === "connecting"
        ? "bg-amber-400 animate-pulse"
        : "bg-zinc-500"

  return (
    <section
      className="flex shrink-0 flex-col border-t border-border/60 bg-zinc-50 text-zinc-700 dark:bg-[#09090b] dark:text-zinc-200"
      style={{ height }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal"
        onPointerDown={startResize}
        className={cn(
          "group relative -mt-px h-1.5 shrink-0 cursor-row-resize select-none",
          "before:absolute before:inset-x-0 before:-top-1 before:h-3 before:content-['']",
          "after:absolute after:inset-x-0 after:top-1/2 after:h-px after:-translate-y-1/2 after:bg-border/60 after:transition-colors",
          "hover:after:bg-foreground/40",
          resizing && "after:bg-foreground/60"
        )}
      />
      <div className="flex h-8 shrink-0 items-center gap-2 px-3 text-[11px] tracking-wide text-muted-foreground">
        <span
          className={`size-1.5 rounded-full ${dotColor}`}
          aria-hidden="true"
        />
        <span>terminal</span>
        {error ? (
          <span className="truncate text-rose-500 dark:text-rose-400/80">
            — {error}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close terminal"
          title="Close terminal"
          className="ml-auto inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div
        ref={containerRef}
        onClick={() => terminalRef.current?.focus()}
        className="min-h-0 flex-1 cursor-text px-3 pb-2"
      />
    </section>
  )
}

type SandboxInfo = {
  startedAt: number
  endAt: number
  state: "running" | "paused"
}

function formatCountdown(ms: number) {
  if (ms <= 0) return "0s"
  const totalSeconds = Math.floor(ms / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`
  return `${s}s`
}

function formatElapsed(ms: number) {
  if (ms < 60_000) {
    const s = Math.floor(ms / 1000)
    return `${s} ${s === 1 ? "second" : "seconds"}`
  }
  if (ms < 3600_000) {
    const m = Math.floor(ms / 60_000)
    return `${m} ${m === 1 ? "minute" : "minutes"}`
  }
  const totalMinutes = Math.floor(ms / 60_000)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (m === 0) return `${h} ${h === 1 ? "hour" : "hours"}`
  return `${h}h ${m}m`
}

function SandboxStatus({
  sandboxId,
  onKill,
  onPause,
  onSave,
  hideActions = false,
}: {
  sandboxId: string
  onKill: () => void | Promise<void>
  onPause: () => void | Promise<void>
  onSave: () => void | Promise<void>
  hideActions?: boolean
}) {
  const [info, setInfo] = useState<SandboxInfo | null>(null)
  const [missing, setMissing] = useState(false)
  const [killing, setKilling] = useState(false)
  const [pausing, setPausing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch(
          `/api/sandbox/info?sandboxId=${encodeURIComponent(sandboxId)}`,
          { cache: "no-store" }
        )
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setMissing(true)
          setInfo(null)
          return
        }
        setMissing(false)
        setInfo({
          startedAt: data.startedAt,
          endAt: data.endAt,
          state: data.state === "paused" ? "paused" : "running",
        })
      } catch {
        if (!cancelled) setMissing(true)
      }
    }

    const firstLoad = window.setTimeout(() => {
      setInfo(null)
      setMissing(false)
      void load()
    }, 0)
    const id = window.setInterval(load, 15_000)
    return () => {
      cancelled = true
      window.clearTimeout(firstLoad)
      window.clearInterval(id)
    }
  }, [sandboxId])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  async function handleKill() {
    if (killing || pausing || saving) return
    setKilling(true)
    try {
      await onKill()
    } finally {
      setKilling(false)
    }
  }

  async function handlePause() {
    if (killing || pausing || saving || info?.state === "paused") return
    setPausing(true)
    try {
      await onPause()
      setInfo((current) =>
        current
          ? {
              ...current,
              state: "paused",
              endAt: Date.now(),
            }
          : current
      )
    } finally {
      setPausing(false)
    }
  }

  async function handleSave() {
    if (saving || killing || pausing) return
    setSaving(true)
    setSaved(false)
    try {
      await onSave()
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  if (missing) {
    return (
      <span className="text-xs text-muted-foreground">Sandbox not running</span>
    )
  }

  const elapsed = info
    ? Math.max(
        0,
        (info.state === "paused" ? info.endAt : now) - info.startedAt
      )
    : 0
  const remaining = info ? Math.max(0, info.endAt - now) : 0

  const timeoutLabel = info?.state === "paused" ? "Paused" : "Idle timeout"
  const timeoutValue =
    info?.state === "paused"
      ? "Sleeping"
      : info
        ? formatCountdown(remaining)
        : "—"
  const tooltip = info
    ? `Sandbox ${sandboxId}\nState ${info.state}\nStarted ${new Date(info.startedAt).toLocaleString()}\nIdles out ${new Date(info.endAt).toLocaleString()}`
    : `Sandbox ${sandboxId}`

  return (
    <div className="flex items-center gap-6">
      <Stat
        label={timeoutLabel}
        value={timeoutValue}
        title={tooltip}
      />
      {info?.state === "paused" ? null : (
        <Stat
          label="Running for"
          value={info ? formatElapsed(elapsed) : "—"}
          title={tooltip}
        />
      )}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || killing || pausing}
        aria-label="Save sandbox"
        title="Save sandbox"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
      >
        {saving ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : saved ? (
          <Check className="size-3.5" />
        ) : (
          <Save className="size-3.5" />
        )}
        {hideActions ? null : (
          <span>{saving ? "Saving" : saved ? "Saved" : "Save sandbox"}</span>
        )}
      </button>
      <button
        type="button"
        onClick={handlePause}
        disabled={pausing || saving || killing || info?.state === "paused"}
        aria-label="Pause sandbox"
        title="Pause sandbox"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
      >
        {pausing ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Pause className="size-3.5" />
        )}
        {hideActions ? null : (
          <span>{pausing ? "Pausing" : "Pause sandbox"}</span>
        )}
      </button>
      <button
        type="button"
        onClick={handleKill}
        disabled={killing || saving || pausing}
        aria-label="Kill sandbox"
        title="Kill sandbox"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
      >
        {killing ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Trash2 className="size-3.5" />
        )}
        {hideActions ? null : (
          <span>{killing ? "Killing" : "Kill sandbox"}</span>
        )}
      </button>
    </div>
  )
}

function Stat({
  label,
  value,
  title,
}: {
  label: string
  value: string
  title?: string
}) {
  return (
    <div className="flex flex-col gap-0.5 leading-none" title={title}>
      <span className="text-[9px] font-medium tracking-wider text-muted-foreground uppercase">
        {label}
      </span>
      <span className="text-[13px] text-foreground tabular-nums">{value}</span>
    </div>
  )
}

function Sidebar({
  authError,
  authStatus,
  chats,
  activeId,
  onNewChat,
  onSelect,
  onDelete,
}: {
  authError: string
  authStatus: AuthStatus | null
  chats: ChatRecord[]
  activeId: Id<"threads"> | null
  onNewChat: () => void
  onSelect: (id: Id<"threads">) => void
  onDelete: (id: Id<"threads">) => void
}) {
  const groups = useMemo(() => {
    const map = new Map<string, ChatRecord[]>()
    for (const c of chats) {
      const key = c.repoUrl || ""
      const arr = map.get(key) ?? []
      arr.push(c)
      map.set(key, arr)
    }
    return Array.from(map.entries())
      .map(([repo, items]) => ({
        repo,
        items: items.sort((a, b) => b.updatedAt - a.updatedAt),
        latest: Math.max(...items.map((i) => i.updatedAt)),
      }))
      .sort((a, b) => b.latest - a.latest)
  }, [chats])

  return (
    <aside className="flex h-full min-h-0 w-64 shrink-0 flex-col overflow-hidden border-r border-border/60 bg-sidebar text-sidebar-foreground">
      <div className="px-[1.125rem] pt-6 pb-5">
        <span
          className={cn(
            GeistPixelSquare.className,
            "text-4xl tracking-tight text-foreground"
          )}
        >
          CloudCode
        </span>
      </div>
      <div className="px-2 pt-2">
        <button
          type="button"
          onClick={onNewChat}
          className="flex w-full items-center gap-2 rounded-xl px-[0.625rem] py-2 text-sm text-foreground/80 transition-colors hover:bg-muted"
        >
          <SquarePen className="size-3.5 shrink-0" />
          <span>New chat</span>
        </button>
      </div>

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {groups.length === 0 ? (
          <div className="px-3 pt-4 text-xs text-muted-foreground/80">
            No chats yet
          </div>
        ) : (
          <div className="space-y-1">
            {groups.map((g) => (
              <FolderGroup
                key={g.repo || "untitled"}
                label={repoLabel(g.repo)}
                items={g.items}
                activeId={activeId}
                onSelect={onSelect}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border/60 p-3">
        <div className="mb-2 flex items-center justify-between px-2.5">
          <span className="text-xs text-muted-foreground">Signed in</span>
          <UserButton />
        </div>
        <a
          href="/api/codex-auth/login"
          className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm text-foreground/80 transition-colors hover:bg-muted"
        >
          {authStatus?.exists ? (
            <CheckCircle2 className="size-4 text-emerald-600" />
          ) : authError ? (
            <AlertCircle className="size-4 text-destructive" />
          ) : (
            <LogIn className="size-4" />
          )}
          <span className="truncate">
            {authStatus?.exists ? "ChatGPT connected" : "Sign in with ChatGPT"}
          </span>
        </a>
        {authError ? (
          <div className="mt-1 px-2.5 text-[11px] leading-4 text-destructive">
            {authError}
          </div>
        ) : null}
      </div>
    </aside>
  )
}

function FolderGroup({
  label,
  items,
  activeId,
  onSelect,
  onDelete,
}: {
  label: string
  items: ChatRecord[]
  activeId: Id<"threads"> | null
  onSelect: (id: Id<"threads">) => void
  onDelete: (id: Id<"threads">) => void
}) {
  const [open, setOpen] = useState(true)

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <Folder className="size-3.5 shrink-0" />
        <span className="flex-1 truncate text-left">{label}</span>
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            open && "rotate-90"
          )}
        />
      </button>
      {open && (
        <div>
          {items.map((c) => (
            <SidebarItem
              key={c.id}
              chat={c}
              active={c.id === activeId}
              onSelect={() => onSelect(c.id)}
              onDelete={() => onDelete(c.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SidebarItem({
  chat,
  active,
  onSelect,
  onDelete,
}: {
  chat: ChatRecord
  active: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  return (
    <div
      className={cn(
        "group/item flex items-center rounded-lg pr-1 transition-colors",
        active ? "bg-muted" : "hover:bg-muted/60"
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 truncate px-2.5 py-1.5 text-left text-sm text-foreground/85"
      >
        {chat.title || "Untitled"}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        className="hidden size-6 shrink-0 place-items-center rounded-md text-muted-foreground group-hover/item:grid hover:bg-background hover:text-foreground"
        aria-label="Delete chat"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M3 3L9 9M9 3L3 9"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  )
}

function IconButton({
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent",
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

function RepoChip({
  value,
  editing,
  setEditing,
  onChange,
  locked,
}: {
  value: string
  editing: boolean
  setEditing: (v: boolean) => void
  onChange: (v: string) => void
  locked?: boolean
}) {
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function commit() {
    onChange(draft.trim())
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex h-8 items-center gap-1.5 rounded-full border border-border/80 bg-background pr-1 pl-2.5 text-xs">
        <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              commit()
            }
            if (e.key === "Escape") {
              setDraft(value)
              setEditing(false)
            }
          }}
          placeholder="https://github.com/owner/repo.git"
          className="w-64 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
          spellCheck={false}
        />
      </div>
    )
  }

  const label = value ? repoLabel(value) : "Connect repo"

  return (
    <button
      type="button"
      onClick={() => {
        if (!locked) {
          setDraft(value)
          setEditing(true)
        }
      }}
      disabled={locked}
      className={cn(
        "flex h-8 max-w-[14rem] items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors",
        value
          ? "text-foreground/80 hover:bg-muted disabled:hover:bg-transparent"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <GitBranch className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )
}

function Pill<T extends string>({
  header,
  value,
  options,
  formatTrigger,
  formatOption,
  open,
  setOpen,
  onSelect,
  triggerClassName,
}: {
  header: string
  value: T
  options: readonly T[]
  formatTrigger: (v: T) => string
  formatOption: (v: T) => string
  open: boolean
  setOpen: (v: boolean) => void
  onSelect: (v: T) => void
  triggerClassName?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open, setOpen])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex h-8 items-center gap-1 rounded-full px-2.5 text-xs text-foreground transition-colors hover:bg-muted",
          triggerClassName
        )}
      >
        {formatTrigger(value)}
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          className="opacity-60"
        >
          <path
            d="M3 4.5L6 7.5L9 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? (
        <div className="absolute right-0 bottom-10 min-w-44 overflow-hidden rounded-2xl border border-black/[0.06] bg-popover p-1.5 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.18)] dark:border-white/10">
          <div className="px-3 pt-1.5 pb-1 text-xs text-muted-foreground">
            {header}
          </div>
          {options.map((opt) => {
            const selected = opt === value
            return (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onSelect(opt)
                  setOpen(false)
                }}
                className="flex w-full items-center justify-between gap-6 rounded-xl px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
              >
                <span>{formatOption(opt)}</span>
                {selected ? (
                  <Check className="size-4 shrink-0" strokeWidth={2.25} />
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function parseDiffStats(diff: string): DiffStats {
  return getDiffStats(diff)
}

type TreeNode =
  | { kind: "dir"; name: string; path: string; children: TreeNode[] }
  | { kind: "file"; name: string; path: string; stat: DiffFileStat }

function buildFileTree(files: DiffFileStat[]): TreeNode[] {
  const roots: TreeNode[] = []

  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean)
    let level = roots
    let acc = ""

    segments.forEach((segment, idx) => {
      const isFile = idx === segments.length - 1
      acc = acc ? `${acc}/${segment}` : segment

      if (isFile) {
        level.push({ kind: "file", name: segment, path: acc, stat: file })
        return
      }

      let dir = level.find(
        (n): n is Extract<TreeNode, { kind: "dir" }> =>
          n.kind === "dir" && n.name === segment
      )
      if (!dir) {
        dir = { kind: "dir", name: segment, path: acc, children: [] }
        level.push(dir)
      }
      level = dir.children
    })
  }

  // Sort: directories first, then files; alphabetical within each
  const sortLevel = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    nodes.forEach((n) => {
      if (n.kind === "dir") sortLevel(n.children)
    })
  }
  sortLevel(roots)

  return roots
}

function aggregateNode(node: TreeNode): {
  additions: number
  deletions: number
} {
  if (node.kind === "file") {
    return { additions: node.stat.additions, deletions: node.stat.deletions }
  }
  return node.children.reduce(
    (acc, child) => {
      const sum = aggregateNode(child)
      return {
        additions: acc.additions + sum.additions,
        deletions: acc.deletions + sum.deletions,
      }
    },
    { additions: 0, deletions: 0 }
  )
}

function collectDirPaths(nodes: TreeNode[], acc: string[] = []): string[] {
  for (const node of nodes) {
    if (node.kind === "dir") {
      acc.push(node.path)
      collectDirPaths(node.children, acc)
    }
  }
  return acc
}

const FILE_BADGE_STYLES: Record<string, { label: string; className: string }> =
  {
    ts: { label: "TS", className: "text-sky-600 dark:text-sky-400" },
    tsx: { label: "TSX", className: "text-sky-600 dark:text-sky-400" },
    js: { label: "JS", className: "text-amber-600 dark:text-amber-400" },
    jsx: { label: "JSX", className: "text-amber-600 dark:text-amber-400" },
    json: { label: "JSON", className: "text-amber-600 dark:text-amber-400" },
    md: { label: "MD", className: "text-muted-foreground" },
    css: { label: "CSS", className: "text-violet-600 dark:text-violet-400" },
    html: { label: "HTML", className: "text-orange-600 dark:text-orange-400" },
    py: { label: "PY", className: "text-emerald-600 dark:text-emerald-400" },
    go: { label: "GO", className: "text-cyan-600 dark:text-cyan-400" },
    rs: { label: "RS", className: "text-orange-700 dark:text-orange-400" },
    sh: { label: "SH", className: "text-muted-foreground" },
    yml: { label: "YML", className: "text-rose-600 dark:text-rose-400" },
    yaml: { label: "YML", className: "text-rose-600 dark:text-rose-400" },
    sql: { label: "SQL", className: "text-pink-600 dark:text-pink-400" },
  }

function FileBadge({ name }: { name: string }) {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : ""
  const style = FILE_BADGE_STYLES[ext]
  if (!style) {
    return (
      <FileIcon
        className="size-3.5 shrink-0 text-muted-foreground"
        strokeWidth={2}
      />
    )
  }
  return (
    <span
      className={cn(
        "inline-flex h-3.5 min-w-[1.75rem] shrink-0 items-center justify-center font-mono text-[10px] font-semibold tracking-tight",
        style.className
      )}
      aria-hidden
    >
      {style.label}
    </span>
  )
}

function DiffStatBadge({
  additions,
  deletions,
  className,
}: {
  additions: number
  deletions: number
  className?: string
}) {
  return (
    <span
      className={cn("shrink-0 font-mono text-[11px] tabular-nums", className)}
    >
      <span className="text-emerald-600 dark:text-emerald-400">
        +{additions}
      </span>
      <span className="text-muted-foreground/60"> / </span>
      <span className="text-destructive">−{deletions}</span>
    </span>
  )
}

function FileTreeRows({
  nodes,
  depth,
  expanded,
  onToggle,
}: {
  nodes: TreeNode[]
  depth: number
  expanded: Set<string>
  onToggle: (path: string) => void
}) {
  return (
    <>
      {nodes.map((node) => {
        const sum = aggregateNode(node)
        const indentStyle = { paddingLeft: `${depth * 16 + 8}px` }

        if (node.kind === "dir") {
          const isOpen = expanded.has(node.path)
          return (
            <div key={`dir:${node.path}`}>
              <button
                type="button"
                onClick={() => onToggle(node.path)}
                className="flex w-full items-center gap-2 rounded-md py-1 pr-2 text-left transition-colors hover:bg-muted/60"
                style={indentStyle}
                aria-expanded={isOpen}
              >
                {isOpen ? (
                  <ChevronDown
                    className="size-3.5 shrink-0 text-muted-foreground"
                    strokeWidth={2}
                  />
                ) : (
                  <ChevronRight
                    className="size-3.5 shrink-0 text-muted-foreground"
                    strokeWidth={2}
                  />
                )}
                <Folder
                  className="size-3.5 shrink-0 text-muted-foreground"
                  strokeWidth={2}
                />
                <span className="flex-1 truncate font-mono text-[12px] text-foreground">
                  {node.name}
                </span>
                <DiffStatBadge
                  additions={sum.additions}
                  deletions={sum.deletions}
                />
              </button>
              {isOpen ? (
                <FileTreeRows
                  nodes={node.children}
                  depth={depth + 1}
                  expanded={expanded}
                  onToggle={onToggle}
                />
              ) : null}
            </div>
          )
        }

        return (
          <div
            key={`file:${node.path}`}
            className="flex items-center gap-2 rounded-md py-1 pr-2"
            style={indentStyle}
          >
            <span className="size-3.5 shrink-0" />
            <FileBadge name={node.name} />
            <span className="flex-1 truncate font-mono text-[12px] text-foreground">
              {node.name}
            </span>
            <DiffStatBadge
              additions={node.stat.additions}
              deletions={node.stat.deletions}
            />
          </div>
        )
      })}
    </>
  )
}

function ChangedFiles({ diff }: { diff: string }) {
  const stats = useMemo(() => parseDiffStats(diff), [diff])
  const tree = useMemo(() => buildFileTree(stats.files), [stats.files])
  const allDirPaths = useMemo(() => collectDirPaths(tree), [tree])
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(allDirPaths)
  )

  if (stats.files.length === 0) return null

  const allCollapsed = expanded.size === 0
  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  const toggleAll = () => {
    setExpanded(allCollapsed ? new Set(allDirPaths) : new Set())
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
          <span>Changed files ({stats.files.length})</span>
          <span className="text-muted-foreground/60">·</span>
          <DiffStatBadge
            additions={stats.additions}
            deletions={stats.deletions}
            className="text-[11px]"
          />
        </div>
        {allDirPaths.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={toggleAll}
            className="rounded-xl"
          >
            {allCollapsed ? "Expand all" : "Collapse all"}
          </Button>
        ) : null}
      </div>
      <div className="py-1.5">
        <FileTreeRows
          nodes={tree}
          depth={0}
          expanded={expanded}
          onToggle={toggle}
        />
      </div>
    </div>
  )
}

function MessageBlock({ logs, message }: { logs: RunLog[]; message: Message }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-3xl bg-muted px-4 py-2.5 text-[15px] leading-6 break-words whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {message.pending || logs.length > 0 ? (
        <RunLogs logs={logs} pending={Boolean(message.pending)} />
      ) : null}
      {!message.pending ? (
        <Markdown
          text={message.content}
          className={cn(
            "text-[15px] leading-7",
            message.error && "text-destructive"
          )}
        />
      ) : null}
      {!message.pending && message.meta?.diff ? (
        <ChangedFiles diff={message.meta.diff} />
      ) : null}
      {message.meta?.branch ? (
        <div className="font-mono text-[11px] text-muted-foreground">
          ↳ {message.meta.branch}
        </div>
      ) : null}
    </div>
  )
}

function RunLogs({ logs, pending }: { logs: RunLog[]; pending: boolean }) {
  const [open, setOpen] = useState(false)
  const visible = logs
  const current = logs.at(-1)
  const expanded = pending || open

  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <button
        type="button"
        onClick={() => {
          if (!pending) setOpen((currentOpen) => !currentOpen)
        }}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 text-left",
          !pending && "cursor-pointer hover:text-foreground"
        )}
        aria-expanded={expanded}
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            expanded && "rotate-90"
          )}
        />
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
        <span className="truncate">
          {pending
            ? (current?.message ?? "Starting Codex run")
            : (current?.message ?? "Codex run completed")}
        </span>
      </button>

      {expanded && visible.length > 0 ? (
        <div className="space-y-1 border-l border-border/70 pl-3">
          {visible.map((log) => (
            <RunLogRow key={log.id} log={log} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function RunLogRow({ log }: { log: RunLog }) {
  const Icon =
    log.kind === "reasoning"
      ? Brain
      : log.kind === "command"
        ? Terminal
        : ScrollText

  return (
    <div
      className={cn(
        "flex min-w-0 items-start gap-2 font-mono text-[11px] leading-5",
        log.kind === "stderr" && "text-destructive"
      )}
    >
      <Icon className="mt-1 size-3 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="break-words">{log.message}</div>
        {log.detail ? (
          <div className="truncate text-muted-foreground/70">{log.detail}</div>
        ) : null}
      </div>
    </div>
  )
}

function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks: Array<{ kind: "code" | "text"; lang?: string; body: string }> =
    []
  const fence = /```([^\n`]*)\n([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = fence.exec(text)) !== null) {
    if (m.index > last)
      blocks.push({ kind: "text", body: text.slice(last, m.index) })
    blocks.push({ kind: "code", lang: parseCodeLanguage(m[1]), body: m[2] })
    last = m.index + m[0].length
  }
  if (last < text.length) blocks.push({ kind: "text", body: text.slice(last) })

  return (
    <div className={cn("space-y-4", className)}>
      {blocks.map((b, i) =>
        b.kind === "code" ? (
          <CodeBlock key={i} body={b.body} lang={b.lang} />
        ) : (
          <InlineProse key={i} text={b.body} />
        )
      )}
    </div>
  )
}

const CODE_LANGUAGE_LABELS: Record<string, string> = {
  bash: "Bash",
  css: "CSS",
  diff: "Diff",
  html: "HTML",
  javascript: "JavaScript",
  js: "JavaScript",
  json: "JSON",
  jsx: "JSX",
  markdown: "Markdown",
  md: "Markdown",
  plaintext: "Plain text",
  python: "Python",
  py: "Python",
  sh: "Shell",
  shell: "Shell",
  ts: "TypeScript",
  tsx: "TSX",
  typescript: "TypeScript",
  yaml: "YAML",
  yml: "YAML",
}

const PIERRE_CODE_THEMES = {
  dark: "pierre-dark",
  light: "pierre-light",
} as const

const PIERRE_FILE_STYLE = {
  "--diffs-font-family": "var(--font-mono)",
  "--diffs-font-size": "13px",
  "--diffs-gap-block": "12px",
  "--diffs-line-height": "24px",
} as CSSProperties

const PIERRE_LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  md: "markdown",
  plaintext: "text",
  py: "python",
  sh: "bash",
  shell: "bash",
  text: "text",
  ts: "typescript",
  yml: "yaml",
}

function CodeBlock({ body, lang }: { body: string; lang?: string }) {
  const code = body.replace(/\n$/, "")
  const language = lang ?? "plaintext"
  const { resolvedTheme } = useTheme()
  const themeType: ThemeTypes = resolvedTheme === "dark" ? "dark" : "light"
  const file = useMemo<FileContents>(
    () => ({
      cacheKey: `${language}:${code}`,
      contents: code,
      lang: getPierreLanguage(language),
      name: `snippet.${language}`,
    }),
    [code, language]
  )
  const options = useMemo<FileOptions<undefined>>(
    () => ({
      disableFileHeader: true,
      disableLineNumbers: true,
      overflow: "wrap",
      theme: PIERRE_CODE_THEMES,
      themeType,
    }),
    [themeType]
  )

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background">
      <div className="flex h-8 items-center border-b border-border bg-muted/70 px-3 font-mono text-[11px] font-medium text-muted-foreground uppercase">
        {formatCodeLanguage(language)}
      </div>
      <PierreFile
        file={file}
        options={options}
        disableWorkerPool
        style={PIERRE_FILE_STYLE}
      />
    </div>
  )
}

function parseCodeLanguage(info: string) {
  const lang = info.trim().split(/\s+/)[0]?.replace(/^\./, "").toLowerCase()
  return lang || undefined
}

function formatCodeLanguage(lang: string) {
  return CODE_LANGUAGE_LABELS[lang] ?? lang
}

function getPierreLanguage(lang: string) {
  return PIERRE_LANGUAGE_ALIASES[lang] ?? lang
}

function InlineProse({ text }: { text: string }) {
  const lines = text.split("\n")
  const out: React.ReactNode[] = []
  let buf: string[] = []
  let listBuf: string[] = []

  function flushPara() {
    if (!buf.length) return
    const body = buf.join("\n").trim()
    buf = []
    if (!body) return
    out.push(
      <p key={out.length} className="whitespace-pre-wrap">
        {renderInline(body)}
      </p>
    )
  }
  function flushList() {
    if (!listBuf.length) return
    const items = listBuf
    listBuf = []
    out.push(
      <ul key={out.length} className="list-disc space-y-1.5 pl-5">
        {items.map((it, i) => (
          <li key={i}>{renderInline(it)}</li>
        ))}
      </ul>
    )
  }

  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    const bullet = /^[-*]\s+(.*)$/.exec(line)
    if (heading) {
      flushPara()
      flushList()
      const level = heading[1].length
      const content = heading[2]
      const cls =
        level === 1
          ? "text-xl font-semibold"
          : level === 2
            ? "text-lg font-semibold"
            : "text-base font-semibold"
      out.push(
        <div key={out.length} className={cls}>
          {renderInline(content)}
        </div>
      )
    } else if (bullet) {
      flushPara()
      listBuf.push(bullet[1])
    } else if (line.trim() === "") {
      flushPara()
      flushList()
    } else {
      flushList()
      buf.push(line)
    }
  }
  flushPara()
  flushList()

  return <>{out}</>
}

function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  const re =
    /(\[([^\]]+)\]\(([^)\s]+)\)|\bhttps?:\/\/[^\s<>()]+[^\s<>().,!?;:]|\*\*([^*]+)\*\*|`([^`]+)`)/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[2] !== undefined && m[3] !== undefined) {
      const href = normalizeLinkHref(m[3])
      parts.push(
        href ? (
          <MarkdownLink key={key++} href={href}>
            {renderInline(m[2])}
          </MarkdownLink>
        ) : (
          m[0]
        )
      )
    } else if (m[0].startsWith("http")) {
      const href = normalizeLinkHref(m[0])
      parts.push(
        href ? (
          <MarkdownLink key={key++} href={href}>
            {m[0]}
          </MarkdownLink>
        ) : (
          m[0]
        )
      )
    } else if (m[4] !== undefined) {
      parts.push(
        <strong key={key++} className="font-semibold">
          {m[4]}
        </strong>
      )
    } else if (m[5] !== undefined) {
      parts.push(
        <code
          key={key++}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
        >
          {m[5]}
        </code>
      )
    }
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

function MarkdownLink({
  children,
  href,
}: {
  children: React.ReactNode
  href: string
}) {
  const external = /^https?:\/\//i.test(href)

  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
    >
      {children}
    </a>
  )
}

function normalizeLinkHref(href: string) {
  const trimmed = href.trim()
  if (/^(https?:\/\/|mailto:|\/|#)/i.test(trimmed)) return trimmed
  return undefined
}
