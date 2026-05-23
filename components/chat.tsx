"use client"

import { Show, SignInButton, useUser } from "@clerk/nextjs"
import { useMutation, useQuery } from "convex/react"
import {
  ArrowUp,
  ChevronDown,
  Folder,
  FolderOpen,
  Loader2,
  PanelLeft,
  Plus,
  SquareTerminal,
  Square,
  X,
} from "lucide-react"
import dynamic from "next/dynamic"
import { createPortal } from "react-dom"
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type UIEvent as ReactUIEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { GeistPixelSquare } from "geist/font/pixel"

import { SandboxTerminalPanel } from "@/components/sandbox-terminal"
import {
  closeBrowserTerminalSession,
  warmBrowserTerminal,
} from "@/components/sandbox-terminal-session"
import { SettingsScreen } from "@/components/settings-screen"
import { Sidebar } from "@/components/chat-sidebar"
import {
  SANDBOX_STATE_LABEL,
  formatSandboxAutoStop,
  useSandboxInfo,
  type SandboxInfo,
} from "@/components/sandbox-status"
import {
  BranchChip,
  IconButton,
  Pill,
  PresetPill,
  RepoChip,
  ThinkingSpeedPill,
} from "@/components/chat-controls"
import { DiffList } from "@/components/changed-files"
import { MessageBlock } from "@/components/chat-message"
import { Button } from "@/components/ui/button"
import type { FileBrowserOpenMode } from "@/components/file-browser"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useStoreUserEffect } from "@/hooks/use-store-user-effect"
import { getDiffStats } from "@/lib/diff-metadata"
import type { CodexRunLog } from "@/lib/codex-run-log"
import { buildResumeHandoff } from "@/lib/chat-resume-handoff"
import {
  diffCacheKey,
  fetchSandboxTextFileIntoCache,
} from "@/lib/sandbox-file-cache"
import {
  MODEL_LABEL,
  MODELS,
  SPEED_LABEL,
  SPEEDS,
  THINKING_LABEL,
  THINKINGS,
  type Model,
  type Speed,
  type Thinking,
} from "@/lib/chat-options"
import { cn } from "@/lib/utils"

const FileBrowser = dynamic(
  () => import("@/components/file-browser").then((mod) => mod.FileBrowser),
  { ssr: false }
)

const FileEditorPanel = dynamic(
  () => import("@/components/file-editor").then((mod) => mod.FileEditorPanel),
  { ssr: false }
)

type Role = "user" | "assistant"

type Message = {
  id: Id<"messages">
  role: Role
  content: string
  createdAt?: number
  pending?: boolean
  error?: boolean
  meta?: {
    branch?: string
    diff?: string
    logs?: StoredRunLog[]
    status?: string
  }
  speed?: Speed
  thinking?: Thinking
}

type StoredRunLog = CodexRunLog & {
  detail?: string
  time: number
}

type CachedRunState = {
  branch?: string
  codexThreadId?: string
  diff?: string
  sandboxId?: string
  sandboxState?: SandboxState
}

type SandboxState = "running" | "stopped" | "deleted" | "error"
type SandboxAction = "pause" | "resume" | "delete"

type AuthStatus = {
  accountId?: string | null
  authMode?: "chatgpt"
  exists: boolean
  lastRefresh?: string
  profile: string
}

type ChatRecord = {
  baseBranch?: string
  codexThreadId?: string
  id: Id<"threads">
  lastUserMessageAt?: number
  repoUrl: string
  sandboxPresetId?: Id<"sandboxPresets">
  sandboxPresetName?: string
  sandboxId?: string
  sandboxState?: SandboxState
  title: string
  messages: Message[]
  model: Model
  pending?: boolean
  createdAt: number
  updatedAt: number
}

type LiveRunRecord = {
  assistantMessageId: Id<"messages">
  branch?: string
  codexThreadId?: string
  content: string
  error?: string
  logs: StoredRunLog[]
  pending: boolean
  runId: Id<"codexRuns">
  sandboxId?: string
  sandboxState?: SandboxState
  status: string
  threadId: Id<"threads">
  triggerRunId?: string
  updatedAt: number
}

function cachedStateFromLiveRun(
  liveRun: LiveRunRecord | null | undefined
): CachedRunState | undefined {
  if (!liveRun) return undefined

  return {
    ...(liveRun.branch ? { branch: liveRun.branch } : {}),
    ...(liveRun.codexThreadId ? { codexThreadId: liveRun.codexThreadId } : {}),
    ...(liveRun.sandboxId ? { sandboxId: liveRun.sandboxId } : {}),
    ...(liveRun.sandboxState ? { sandboxState: liveRun.sandboxState } : {}),
  }
}

type SandboxPresetSecretRecord = {
  hasValue: boolean
  id: Id<"sandboxPresetSecrets">
  name: string
  updatedAt: number
}

type SandboxPresetRecord = {
  createdAt: number
  daytonaSnapshot?: string
  environmentSlug?: string
  environments?: Array<{
    activeSandboxId?: string
    builtAt?: number
    environmentSlug: string
    id: Id<"sandboxPresetEnvironments">
    repoUrl: string
    status: "empty" | "building" | "ready" | "failed" | "stale"
    updatedAt: number
  }>
  id: Id<"sandboxPresets">
  installScript?: string
  mode?: "manual" | "auto"
  name: string
  pathInstallScript?: string
  secrets: SandboxPresetSecretRecord[]
  updatedAt: number
}

type OptimisticRun = {
  baseMessageCount: number
  messages: Message[]
}

const REPO_KEY = "cloudcode:repoUrl"
const BASE_BRANCH_KEY = "cloudcode:baseBranch"
const MODEL_KEY = "cloudcode:model"
const PRESET_KEY = "cloudcode:sandboxPresetId"

function hasCachedRunKey<K extends keyof CachedRunState>(
  state: CachedRunState | undefined,
  key: K
) {
  return Boolean(state && Object.prototype.hasOwnProperty.call(state, key))
}

const SPEED_KEY = "cloudcode:speed"
const THINKING_KEY = "cloudcode:thinking"
const ACTIVE_KEY = "cloudcode:activeChatId"
const DRAFT_RUN_KEY = "__draft__"
const DEFAULT_COMPOSER_HEIGHT = 144
const THREAD_BOTTOM_CLEARANCE = 32
const EMPTY_MESSAGES: Message[] = []
const STREAM_TOOL_MARKER_REGEX = /<codex-tool>[\s\S]*?<\/codex-tool>/g

function repoLabel(url: string) {
  if (!url) return "Untitled"
  return url
    .replace(/^https?:\/\/(www\.)?github\.com\//, "")
    .replace(/\.git$/, "")
}

function splitStreamingTokens(delta: string) {
  const tokens: string[] = []
  let last = 0
  let match: RegExpExecArray | null

  STREAM_TOOL_MARKER_REGEX.lastIndex = 0
  while ((match = STREAM_TOOL_MARKER_REGEX.exec(delta)) !== null) {
    if (match.index > last) {
      tokens.push(...splitTextStreamingTokens(delta.slice(last, match.index)))
    }
    tokens.push(match[0])
    last = match.index + match[0].length
  }

  if (last < delta.length) {
    tokens.push(...splitTextStreamingTokens(delta.slice(last)))
  }

  return tokens
}

function splitTextStreamingTokens(delta: string) {
  return delta.match(/\s+|[^\s]+/g) ?? [delta]
}

const PREFETCH_IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
])

function canPrefetchAsText(path: string) {
  const ext = path.split(".").pop()?.toLowerCase()
  return !ext || !PREFETCH_IMAGE_EXTENSIONS.has(ext)
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
  const { user } = useUser()
  const { isLoading: userLoading } = useStoreUserEffect()
  const rawChatSummaries = useQuery(api.chats.list)
  const chatSummaries = useMemo(
    () => (rawChatSummaries ?? []) as ChatRecord[],
    [rawChatSummaries]
  )
  const rawPresets = useQuery(api.sandboxPresets.list)
  const sandboxPresets = useMemo(
    () => (rawPresets ?? []) as SandboxPresetRecord[],
    [rawPresets]
  )
  const createThread = useMutation(api.chats.createThread)
  const ensureDefaultPresets = useMutation(
    api.sandboxPresets.ensureDefaultPresets
  )
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
  const rawActiveChat = useQuery(
    api.chats.get,
    activeId ? { threadId: activeId } : "skip"
  )
  const activeChat = rawActiveChat as ChatRecord | null | undefined
  const rawLiveRun = useQuery(
    api.codexRuns.liveForThread,
    activeId ? { threadId: activeId } : "skip"
  )
  const liveRun = rawLiveRun as LiveRunRecord | null | undefined
  const chats = useMemo(() => {
    if (!activeChat) return chatSummaries
    const seen = new Set<string>()
    const rows = chatSummaries.map((chat) => {
      if (chat.id !== activeChat.id) return chat
      seen.add(chat.id as string)
      return {
        ...chat,
        ...activeChat,
      }
    })
    return seen.has(activeChat.id as string) ? rows : [activeChat, ...rows]
  }, [activeChat, chatSummaries])
  const [pendingDeleteId, setPendingDeleteId] = useState<Id<"threads"> | null>(
    null
  )
  const [pendingSandboxDelete, setPendingSandboxDelete] = useState(false)
  const [sandboxAction, setSandboxAction] = useState<SandboxAction | null>(null)
  const [input, setInput] = useState("")
  const [draftRepo, setDraftRepo] = useState(() =>
    typeof window === "undefined" ? "" : (localStorage.getItem(REPO_KEY) ?? "")
  )
  const [draftBaseBranch, setDraftBaseBranch] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (localStorage.getItem(BASE_BRANCH_KEY) ?? "")
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
  const [draftSandboxPresetId, setDraftSandboxPresetId] = useState<
    Id<"sandboxPresets"> | ""
  >(() =>
    typeof window === "undefined"
      ? ""
      : ((localStorage.getItem(PRESET_KEY) as Id<"sandboxPresets"> | null) ??
        "")
  )
  const [editingRepo, setEditingRepo] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [presetOpen, setPresetOpen] = useState(false)
  const [thinkingOpen, setThinkingOpen] = useState(false)
  const [filesOpen, setFilesOpen] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(380)
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null)
  const [activeFileMode, setActiveFileMode] =
    useState<FileBrowserOpenMode>("file")
  const [activeFileDiff, setActiveFileDiff] = useState<string | null>(null)
  const [allDiffsOpen, setAllDiffsOpen] = useState(false)
  const [diffStyle, setDiffStyle] = useState<"unified" | "split">("unified")
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [view, setView] = useState<"chat" | "settings">("chat")
  const [runningRunKeys, setRunningRunKeys] = useState<Record<string, true>>({})
  const [liveRunStates, setLiveRunStates] = useState<
    Record<string, CachedRunState>
  >({})
  const [lastLiveRun, setLastLiveRun] = useState<LiveRunRecord | null>(null)
  const [revealedLiveRunContent, setRevealedLiveRunContent] = useState<
    Record<string, string>
  >({})
  const [optimisticRuns, setOptimisticRuns] = useState<
    Record<string, OptimisticRun>
  >({})
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
  const [authError, setAuthError] = useState("")
  const runningRunKeysRef = useRef<Set<string>>(new Set())
  const liveRevealRef = useRef<
    Record<
      string,
      {
        queue: string[]
        target: string
        timer?: ReturnType<typeof setTimeout>
        visible: string
      }
    >
  >({})
  const threadRunStateRef = useRef<Record<string, CachedRunState>>({})
  const autoPresetDefaultedRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const threadRef = useRef<HTMLDivElement | null>(null)
  const isAtBottomRef = useRef(true)
  const [composerHeight, setComposerHeight] = useState(DEFAULT_COMPOSER_HEIGHT)

  const scrollThreadToBottom = useCallback(() => {
    const el = threadRef.current
    if (!el) return
    el.style.scrollBehavior = "auto"
    el.scrollTop = el.scrollHeight
    isAtBottomRef.current = true
  }, [])

  const settleThreadAtBottom = useCallback(() => {
    isAtBottomRef.current = true
    scrollThreadToBottom()

    requestAnimationFrame(() => {
      scrollThreadToBottom()
      requestAnimationFrame(scrollThreadToBottom)
    })
  }, [scrollThreadToBottom])

  function onThreadScroll(event: ReactUIEvent<HTMLDivElement>) {
    const el = event.currentTarget
    isAtBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  const setThreadElement = useCallback(
    (el: HTMLDivElement | null) => {
      threadRef.current = el
      if (el) {
        settleThreadAtBottom()
      }
    },
    [settleThreadAtBottom]
  )

  const revealNextLiveToken = useCallback(function revealNextLiveToken(
    key: string
  ) {
    const state = liveRevealRef.current[key]
    if (!state) return

    const token = state.queue.shift()
    if (token === undefined) {
      state.timer = undefined
      return
    }

    state.visible += token
    setRevealedLiveRunContent((current) =>
      current[key] === state.visible
        ? current
        : { ...current, [key]: state.visible }
    )

    const isToolMarker = token.startsWith("<codex-tool>")
    const delay = isToolMarker ? 0 : token.trim() ? 16 : 4
    state.timer = setTimeout(() => revealNextLiveToken(key), delay)
  }, [])

  const scheduleLiveReveal = useCallback(
    (key: string) => {
      const state = liveRevealRef.current[key]
      if (!state || state.timer) return
      state.timer = setTimeout(() => revealNextLiveToken(key), 0)
    },
    [revealNextLiveToken]
  )

  const active = useMemo(
    () => chats.find((c) => c.id === activeId) ?? null,
    [chats, activeId]
  )
  useEffect(() => {
    if (liveRun) setLastLiveRun(liveRun)
  }, [liveRun])
  const visibleLiveRun = useMemo(() => {
    if (liveRun) return liveRun
    if (!active || !lastLiveRun || active.id !== lastLiveRun.threadId) {
      return null
    }

    const liveMessage = active.messages.find(
      (message) => message.id === lastLiveRun.assistantMessageId
    )

    return liveMessage?.pending || !liveMessage?.content.trim()
      ? lastLiveRun
      : null
  }, [active, lastLiveRun, liveRun])
  useEffect(() => {
    if (liveRun || !lastLiveRun || !active) return

    const liveMessage = active.messages.find(
      (message) => message.id === lastLiveRun.assistantMessageId
    )
    if (liveMessage && !liveMessage.pending && liveMessage.content.trim()) {
      setLastLiveRun(null)
    }
  }, [active, lastLiveRun, liveRun])
  useEffect(() => {
    if (!visibleLiveRun) return

    const key = visibleLiveRun.runId as string
    const threadKey = visibleLiveRun.threadId as string
    const target = visibleLiveRun.content
    const current = liveRevealRef.current[key]
    const shouldAnimateInitial = Boolean(runningRunKeys[threadKey])

    if (!current) {
      if (target && !shouldAnimateInitial) {
        liveRevealRef.current[key] = {
          queue: [],
          target,
          visible: target,
        }
        setRevealedLiveRunContent((state) => ({ ...state, [key]: target }))
        return
      }

      liveRevealRef.current[key] = {
        queue: splitStreamingTokens(target),
        target,
        visible: "",
      }
      scheduleLiveReveal(key)
      return
    }

    if (current.target === target) return

    if (!target.startsWith(current.visible)) {
      if (current.timer) clearTimeout(current.timer)
      liveRevealRef.current[key] = {
        queue: [],
        target,
        visible: target,
      }
      setRevealedLiveRunContent((state) => ({ ...state, [key]: target }))
      return
    }

    current.target = target
    current.queue = splitStreamingTokens(target.slice(current.visible.length))
    scheduleLiveReveal(key)
  }, [runningRunKeys, scheduleLiveReveal, visibleLiveRun])
  useEffect(() => {
    if (visibleLiveRun) return

    for (const state of Object.values(liveRevealRef.current)) {
      if (state.timer) clearTimeout(state.timer)
    }
    liveRevealRef.current = {}
    setRevealedLiveRunContent({})
  }, [visibleLiveRun])
  useEffect(() => {
    return () => {
      for (const state of Object.values(liveRevealRef.current)) {
        if (state.timer) clearTimeout(state.timer)
      }
    }
  }, [])
  const liveActiveRunState = useMemo(
    () => cachedStateFromLiveRun(visibleLiveRun),
    [visibleLiveRun]
  )
  const sidebarChats = useMemo(
    () =>
      chats.map((chat) => {
        const isLiveThread = Boolean(
          visibleLiveRun && chat.id === visibleLiveRun.threadId
        )
        return {
          ...chat,
          ...liveRunStates[chat.id as string],
          ...(isLiveThread ? liveActiveRunState : undefined),
          pending:
            isLiveThread ||
            Boolean(runningRunKeys[chat.id as string]) ||
            Boolean(chat.pending) ||
            chat.messages.some((m) => m.pending),
          lastUserMessageAt: chat.lastUserMessageAt || chat.updatedAt,
        }
      }),
    [chats, liveActiveRunState, liveRunStates, runningRunKeys, visibleLiveRun]
  )
  const activeRunKey = activeId ? (activeId as string) : DRAFT_RUN_KEY
  const activeRunState = activeId
    ? {
        ...liveRunStates[activeId as string],
        ...liveActiveRunState,
      }
    : undefined
  const activeSandboxId = hasCachedRunKey(activeRunState, "sandboxId")
    ? (activeRunState?.sandboxId ?? null)
    : (active?.sandboxId ?? null)
  const activeFileCacheScope = activeId
    ? `thread:${activeId as string}`
    : activeSandboxId
      ? `sandbox:${activeSandboxId}`
      : null
  const rawActiveSandboxState =
    activeRunState?.sandboxState ?? active?.sandboxState
  const activeSandboxState =
    activeSandboxId && rawActiveSandboxState === "deleted"
      ? undefined
      : rawActiveSandboxState
  const baseServerMessages = active?.messages ?? EMPTY_MESSAGES
  const serverMessages = useMemo(() => {
    if (!visibleLiveRun) return baseServerMessages
    const liveRunKey = visibleLiveRun.runId as string
    const revealedContent = revealedLiveRunContent[liveRunKey] ?? ""

    return baseServerMessages.map((message) => {
      if (message.id !== visibleLiveRun.assistantMessageId) return message

      const liveMeta = {
        ...message.meta,
        ...(visibleLiveRun.branch ? { branch: visibleLiveRun.branch } : {}),
        ...(visibleLiveRun.logs.length ? { logs: visibleLiveRun.logs } : {}),
        ...(visibleLiveRun.status ? { status: visibleLiveRun.status } : {}),
      }

      return {
        ...message,
        content:
          revealedContent || (visibleLiveRun.content ? "" : message.content),
        error: Boolean(visibleLiveRun.error) || message.error,
        meta: liveMeta,
        pending: true,
      }
    })
  }, [baseServerMessages, revealedLiveRunContent, visibleLiveRun])
  const optimisticRun = optimisticRuns[activeRunKey]
  const optimisticMessages =
    optimisticRun &&
    serverMessages.length <= optimisticRun.baseMessageCount &&
    !serverMessages.some((message) => message.pending)
      ? optimisticRun.messages
      : EMPTY_MESSAGES
  const messages = [...serverMessages, ...optimisticMessages]
  const activeLocalRunPending =
    Boolean(runningRunKeys[activeRunKey]) || Boolean(visibleLiveRun)
  const activeMessagePending =
    Boolean(active?.pending) || messages.some((message) => message.pending)
  const activeRunPending = activeLocalRunPending || activeMessagePending
  const canStopActiveRun = Boolean(active && activeRunPending)
  const terminalVisible = terminalOpen && Boolean(activeSandboxId)
  const threadBottomInset =
    Math.max(composerHeight, DEFAULT_COMPOSER_HEIGHT) +
    THREAD_BOTTOM_CLEARANCE +
    (terminalVisible ? terminalHeight : 0)

  const repoUrl = active ? active.repoUrl : draftRepo
  const baseBranch = active ? (active.baseBranch ?? "") : draftBaseBranch
  const model = active ? active.model : draftModel
  const sandboxPresetId = active ? active.sandboxPresetId : draftSandboxPresetId
  const speed = draftSpeed
  const thinking = draftThinking
  const empty = messages.length === 0
  const activeDiff = useMemo(
    () =>
      active
        ? (active.messages.toReversed().find((m) => m.meta?.diff)?.meta?.diff ??
          null)
        : null,
    [active]
  )
  const activeDiffKey = useMemo(
    () => diffCacheKey(activeDiff ?? undefined),
    [activeDiff]
  )
  const activeChangedTextPaths = useMemo(
    () =>
      getDiffStats(activeDiff ?? undefined)
        .files.filter(
          (file) => file.type !== "deleted" && canPrefetchAsText(file.path)
        )
        .map((file) => file.path)
        .slice(0, 30),
    [activeDiff]
  )
  const editorDiff = activeFileDiff ?? activeDiff
  const activeRepoName = useMemo(() => {
    const label = repoLabel(repoUrl)
    return label.split("/").pop() || null
  }, [repoUrl])
  const userFirstName = useMemo(() => {
    const name =
      user?.firstName ??
      user?.fullName ??
      user?.primaryEmailAddress?.emailAddress?.split("@")[0]
    return name?.trim().split(/\s+/)[0] || null
  }, [user])

  const openFile = useCallback((path: string) => {
    setActiveFilePath(path)
    setActiveFileMode("file")
    setActiveFileDiff(null)
    setAllDiffsOpen(false)
  }, [])

  const openFileDiff = useCallback((path: string, diff: string) => {
    setActiveFilePath(path)
    setActiveFileMode("diff")
    setActiveFileDiff(diff)
    setAllDiffsOpen(false)
  }, [])

  const openAllDiffs = useCallback(() => {
    setActiveFilePath(null)
    setActiveFileDiff(null)
    setAllDiffsOpen(true)
  }, [])

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
    if (userLoading) return
    void ensureDefaultPresets().catch((error) => {
      console.warn("Unable to ensure default presets.", error)
    })
  }, [ensureDefaultPresets, userLoading])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (autoPresetDefaultedRef.current) return
    if (localStorage.getItem(PRESET_KEY) !== null || draftSandboxPresetId) {
      autoPresetDefaultedRef.current = true
      return
    }

    const autoPreset = sandboxPresets.find((preset) => preset.mode === "auto")
    if (!autoPreset) return
    autoPresetDefaultedRef.current = true
    setDraftSandboxPresetId(autoPreset.id)
    localStorage.setItem(PRESET_KEY, autoPreset.id)
  }, [draftSandboxPresetId, sandboxPresets])

  useEffect(() => {
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId)
    else localStorage.removeItem(ACTIVE_KEY)
  }, [activeId])

  useEffect(() => {
    setOptimisticRuns((current) => {
      let changed = false
      const next = { ...current }

      for (const chat of chats) {
        const key = chat.id as string
        const optimistic = next[key]
        if (!optimistic) continue
        if (
          chat.messages.length > optimistic.baseMessageCount ||
          chat.pending ||
          chat.messages.some((message) => message.pending)
        ) {
          delete next[key]
          changed = true
        }
      }

      return changed ? next : current
    })
  }, [chats])

  useEffect(() => {
    const liveThreadKey = visibleLiveRun?.threadId as string | undefined
    let changed = false
    const nextKeys = { ...runningRunKeys }

    for (const chat of chats) {
      const key = chat.id as string
      const stillRunning =
        key === liveThreadKey ||
        Boolean(chat.pending) ||
        chat.messages.some((message) => message.pending)

      if (!stillRunning && nextKeys[key]) {
        delete nextKeys[key]
        runningRunKeysRef.current.delete(key)
        changed = true
      }
    }

    if (changed) setRunningRunKeys(nextKeys)
  }, [chats, runningRunKeys, visibleLiveRun?.threadId])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = Math.min(Math.max(el.scrollHeight, 80), 200) + "px"
  }, [input])

  useEffect(() => {
    const el = composerRef.current
    if (!el) return

    const updateComposerHeight = () => {
      setComposerHeight(Math.ceil(el.getBoundingClientRect().height))
    }

    updateComposerHeight()
    const observer = new ResizeObserver(updateComposerHeight)
    observer.observe(el)

    return () => observer.disconnect()
  }, [activeFilePath])

  useEffect(() => {
    if (
      !activeFileCacheScope ||
      !activeSandboxId ||
      activeChangedTextPaths.length === 0
    ) {
      return
    }

    let cancelled = false
    const queue = [...new Set(activeChangedTextPaths)]

    async function worker(): Promise<void> {
      if (cancelled) return
      const path = queue.shift()
      if (!path) return
      await fetchSandboxTextFileIntoCache({
        diffKey: activeDiffKey,
        path,
        sandboxId: activeSandboxId!,
        scope: activeFileCacheScope!,
      }).catch(() => undefined)
      return worker()
    }

    for (let i = 0; i < Math.min(4, queue.length); i += 1) {
      void worker()
    }

    return () => {
      cancelled = true
    }
  }, [
    activeChangedTextPaths,
    activeDiffKey,
    activeFileCacheScope,
    activeSandboxId,
  ])

  useLayoutEffect(() => {
    setActiveFileDiff(null)
    settleThreadAtBottom()
  }, [activeId, settleThreadAtBottom])

  useLayoutEffect(() => {
    if (!isAtBottomRef.current) return
    settleThreadAtBottom()
  }, [threadBottomInset, settleThreadAtBottom])

  useEffect(() => {
    const el = threadRef.current
    if (!el) return

    const observer = new ResizeObserver(() => {
      if (!isAtBottomRef.current) return
      scrollThreadToBottom()
    })
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)

    return () => observer.disconnect()
  }, [activeId, activeFilePath, scrollThreadToBottom])

  function mergeThreadRunState(threadId: Id<"threads">, patch: CachedRunState) {
    const key = threadId as string
    const next = {
      ...threadRunStateRef.current[key],
      ...patch,
    }
    threadRunStateRef.current[key] = next
    setLiveRunStates((current) => ({
      ...current,
      [key]: {
        ...current[key],
        ...patch,
      },
    }))
    return next
  }

  function removeThreadRunState(threadId: Id<"threads">) {
    const key = threadId as string
    delete threadRunStateRef.current[key]
    setLiveRunStates((current) => {
      const { [key]: _removed, ...next } = current
      void _removed
      return next
    })
  }

  function markRunActive(runKey: string) {
    runningRunKeysRef.current.add(runKey)
    setRunningRunKeys((current) => ({ ...current, [runKey]: true }))
  }

  function showOptimisticRun(
    runKey: string,
    prompt: string,
    baseMessageCount: number,
    runSpeed: Speed,
    runThinking: Thinking
  ) {
    const now = Date.now()
    setOptimisticRuns((current) => ({
      ...current,
      [runKey]: {
        baseMessageCount,
        messages: [
          {
            content: prompt,
            id: `optimistic-${runKey}-${now}-user` as Id<"messages">,
            role: "user",
          },
          {
            content: "",
            id: `optimistic-${runKey}-${now}-assistant` as Id<"messages">,
            pending: true,
            role: "assistant",
            speed: runSpeed,
            thinking: runThinking,
          },
        ],
      },
    }))
  }

  function clearOptimisticRun(runKey: string) {
    setOptimisticRuns((current) => {
      if (!current[runKey]) return current
      const { [runKey]: _removed, ...next } = current
      void _removed
      return next
    })
  }

  function transferRunKey(previousKey: string, nextKey: string) {
    if (previousKey === nextKey) return nextKey

    runningRunKeysRef.current.delete(previousKey)
    runningRunKeysRef.current.add(nextKey)
    setRunningRunKeys((current) => {
      const { [previousKey]: _removed, ...rest } = current
      void _removed
      return { ...rest, [nextKey]: true }
    })
    setOptimisticRuns((current) => {
      const optimistic = current[previousKey]
      if (!optimistic) return current
      const { [previousKey]: _removed, ...rest } = current
      void _removed
      return { ...rest, [nextKey]: optimistic }
    })

    return nextKey
  }

  function clearRunKey(runKey: string) {
    runningRunKeysRef.current.delete(runKey)
    setRunningRunKeys((current) => {
      if (!current[runKey]) return current
      const { [runKey]: _removed, ...next } = current
      void _removed
      return next
    })
  }

  function persistDraftRepo(value: string) {
    setDraftRepo(value)
    if (value) localStorage.setItem(REPO_KEY, value)
    else localStorage.removeItem(REPO_KEY)
  }

  function persistDraftBaseBranch(value: string) {
    setDraftBaseBranch(value)
    if (value) localStorage.setItem(BASE_BRANCH_KEY, value)
    else localStorage.removeItem(BASE_BRANCH_KEY)
  }

  function persistDraftSandboxPreset(next: Id<"sandboxPresets"> | "") {
    setDraftSandboxPresetId(next)
    if (next) localStorage.setItem(PRESET_KEY, next)
    else localStorage.removeItem(PRESET_KEY)
  }

  function persistRepo(value: string) {
    if (active) {
      void updateThread({ repoUrl: value, threadId: active.id })
    } else {
      persistDraftRepo(value)
    }
  }

  function persistBaseBranch(value: string) {
    if (active) return
    persistDraftBaseBranch(value)
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

  function persistSandboxPreset(next: Id<"sandboxPresets"> | "") {
    if (active) return
    persistDraftSandboxPreset(next)
  }

  function startNewChat() {
    setActiveId(null)
    setInput("")
    setEditingRepo(false)
    setActiveFilePath(null)
    setFilesOpen(false)
    setTerminalOpen(false)
    setView("chat")
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  function startNewChatInRepo(repoUrl: string) {
    persistDraftRepo(repoUrl)
    startNewChat()
  }

  function selectChat(id: Id<"threads">) {
    setActiveId(id)
    setInput("")
    setEditingRepo(false)
    setActiveFilePath(null)
    setFilesOpen(false)
    setTerminalOpen(false)
    setView("chat")
  }

  function showSettings() {
    setView("settings")
    setActiveFilePath(null)
    setFilesOpen(false)
    setTerminalOpen(false)
  }

  function deleteChat(id: Id<"threads">) {
    setPendingDeleteId(id)
  }

  function threadSandboxId(id: Id<"threads">) {
    const cachedRunState = threadRunStateRef.current[id as string]
    if (hasCachedRunKey(cachedRunState, "sandboxId")) {
      return cachedRunState?.sandboxId
    }
    return chats.find((chat) => chat.id === id)?.sandboxId
  }

  function confirmDeleteChat() {
    const id = pendingDeleteId
    if (!id) return
    setPendingDeleteId(null)
    void (async () => {
      const sandboxId = threadSandboxId(id)
      await cancelCodexRun(id)
      clearRunKey(id as string)
      if (sandboxId) closeBrowserTerminalSession(sandboxId)

      try {
        if (sandboxId) {
          await fetch("/api/sandbox/kill", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sandboxId }),
          }).catch(() => undefined)
        }
        await deleteThreadMutation({ threadId: id })
        removeThreadRunState(id)
        if (activeId === id) {
          setActiveId(null)
          setActiveFilePath(null)
          setFilesOpen(false)
          setTerminalOpen(false)
        }
      } catch (error) {
        console.warn("Failed to delete thread sandbox resources.", error)
      }
    })()
  }

  function renameChat(id: Id<"threads">, title: string) {
    const trimmed = title.trim()
    if (!trimmed) return
    void updateThread({ threadId: id, title: trimmed })
  }

  async function send(prompt: string) {
    const trimmed = prompt.trim()
    const initialRunKey = activeId ? (activeId as string) : DRAFT_RUN_KEY
    if (
      !trimmed ||
      userLoading ||
      runningRunKeysRef.current.has(initialRunKey) ||
      (active
        ? Boolean(active.pending) ||
          active.messages.some((message) => message.pending)
        : false)
    ) {
      return
    }
    if (!repoUrl.trim()) {
      setEditingRepo(true)
      return
    }
    if (!authStatus?.exists) {
      window.location.href = "/api/codex-auth/login"
      return
    }

    let chatId = active?.id ?? null
    let assistantMessageId: Id<"messages"> | null = null
    let runKey = initialRunKey
    let queued = false

    setInput("")

    markRunActive(runKey)
    showOptimisticRun(
      runKey,
      trimmed,
      active?.messages.length ?? 0,
      draftSpeed,
      draftThinking
    )

    try {
      const runSandboxPresetId = active?.sandboxPresetId ?? draftSandboxPresetId
      if (!chatId) {
        const trimmedBaseBranch = draftBaseBranch.trim()
        const created = await createThread({
          baseBranch: trimmedBaseBranch || undefined,
          model: draftModel,
          prompt: trimmed,
          repoUrl: repoUrl.trim(),
          sandboxPresetId: runSandboxPresetId || undefined,
          speed: draftSpeed,
          thinking: draftThinking,
          title: trimmed.split("\n")[0].slice(0, 60),
        })
        chatId = created.threadId
        assistantMessageId = created.assistantMessageId
        runKey = transferRunKey(runKey, chatId as string)
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
        .find((m) => m.role === "assistant" && (m.meta?.branch || m.meta?.diff))
      const cachedRunState = threadRunStateRef.current[chatId as string]
      const branchName =
        cachedRunState?.branch ?? previousAssistant?.meta?.branch
      const previousDiff = cachedRunState?.diff ?? previousAssistant?.meta?.diff
      const runSandboxId = hasCachedRunKey(cachedRunState, "sandboxId")
        ? cachedRunState?.sandboxId
        : active?.sandboxId
      if (chatId && runSandboxId) {
        mergeThreadRunState(chatId, {
          sandboxId: runSandboxId,
          sandboxState: "running",
        })
      }
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
          baseBranch:
            (active?.baseBranch ?? draftBaseBranch).trim() || undefined,
          branchName,
          codexThreadId: cachedRunState?.codexThreadId ?? active?.codexThreadId,
          assistantMessageId,
          previousDiff,
          prompt: trimmed,
          reasoningEffort: thinking,
          repoUrl: repoUrl.trim(),
          resumeContext,
          sandboxId: runSandboxId,
          sandboxPresetId: runSandboxPresetId || undefined,
          speed,
          threadId: chatId,
          model,
        }),
      })

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? "Unable to queue Codex run.")
      }

      queued = true
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Request failed."
      if (chatId && assistantMessageId) {
        const liveRunState = threadRunStateRef.current[chatId as string]
        await completeAssistantMessage({
          content: msg,
          error: true,
          messageId: assistantMessageId,
          sandboxId: liveRunState?.sandboxId,
          threadId: chatId,
        })
        if (liveRunState?.sandboxId) {
          await saveRunState({
            sandboxId: liveRunState.sandboxId,
            sandboxState: "running",
            threadId: chatId,
          }).catch((error) => {
            console.warn("Unable to save failed run sandbox state.", error)
          })
        }
      } else {
        clearOptimisticRun(runKey)
      }
    } finally {
      if (!queued) clearRunKey(runKey)
    }
  }

  async function cancelCodexRun(threadId: Id<"threads">) {
    clearRunKey(threadId as string)
    await fetch("/api/codex-run/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId }),
    }).catch((error) => {
      console.warn("Unable to cancel Codex run.", error)
    })
  }

  function stopActiveRun() {
    if (!active) return
    void cancelCodexRun(active.id)
    if (activeSandboxId) {
      closeBrowserTerminalSession(activeSandboxId)
      setTerminalOpen(false)
    }
  }

  function normalizeSandboxActionState(
    value: unknown,
    fallback: SandboxState
  ): SandboxState {
    return value === "running" ||
      value === "stopped" ||
      value === "deleted" ||
      value === "error"
      ? value
      : fallback
  }

  async function persistSandboxState(
    threadId: Id<"threads">,
    sandboxId: string,
    sandboxState: SandboxState
  ) {
    mergeThreadRunState(threadId, {
      sandboxId,
      sandboxState,
    })
    await saveRunState({
      sandboxId,
      sandboxState,
      threadId,
    }).catch((error) => {
      console.warn("Unable to save sandbox state.", error)
    })
  }

  async function runSandboxAction(
    action: Exclude<SandboxAction, "delete">,
    endpoint: string,
    fallbackState: SandboxState
  ) {
    if (!active || !activeSandboxId || sandboxAction) return

    const threadId = active.id
    const sandboxId = activeSandboxId
    setSandboxAction(action)
    if (action === "pause") {
      void cancelCodexRun(threadId)
      closeBrowserTerminalSession(sandboxId)
      setTerminalOpen(false)
    }

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId }),
      })
      const data = (await res.json()) as {
        sandboxId?: unknown
        state?: unknown
      }
      if (!res.ok) {
        throw new Error(
          typeof data === "object" &&
            data &&
            "error" in data &&
            typeof data.error === "string"
            ? data.error
            : `Failed to ${action} sandbox.`
        )
      }

      await persistSandboxState(
        threadId,
        typeof data.sandboxId === "string" ? data.sandboxId : sandboxId,
        normalizeSandboxActionState(data.state, fallbackState)
      )
    } catch (error) {
      console.warn(`Failed to ${action} sandbox.`, error)
    } finally {
      setSandboxAction(null)
    }
  }

  function pauseActiveSandbox() {
    void runSandboxAction("pause", "/api/sandbox/pause", "stopped")
  }

  function resumeActiveSandbox() {
    void runSandboxAction("resume", "/api/sandbox/resume", "running")
  }

  function requestDeleteActiveSandbox() {
    if (!activeSandboxId) return
    setPendingSandboxDelete(true)
  }

  function confirmDeleteActiveSandbox() {
    const threadId = active?.id
    const sandboxId = activeSandboxId
    setPendingSandboxDelete(false)
    if (!threadId || !sandboxId || sandboxAction) return

    setSandboxAction("delete")
    void cancelCodexRun(threadId)
    clearRunKey(threadId as string)
    closeBrowserTerminalSession(sandboxId)
    setTerminalOpen(false)

    void (async () => {
      try {
        const res = await fetch("/api/sandbox/kill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sandboxId }),
        })
        if (!res.ok) throw new Error("Failed to delete sandbox.")

        await clearSandbox({ threadId })
        removeThreadRunState(threadId)
        setActiveFilePath(null)
        setFilesOpen(false)
      } catch (error) {
        console.warn("Failed to delete sandbox.", error)
      } finally {
        setSandboxAction(null)
      }
    })()
  }

  function handleSandboxStateChange(state: SandboxState, sandboxId: string) {
    if (!active) return

    const key = active.id as string
    const currentState =
      threadRunStateRef.current[key]?.sandboxState ?? active.sandboxState
    const currentSandboxId =
      threadRunStateRef.current[key]?.sandboxId ?? active.sandboxId
    if (currentState === state && currentSandboxId === sandboxId) return

    mergeThreadRunState(active.id, {
      sandboxId,
      sandboxState: state,
    })
    void saveRunState({
      sandboxId,
      sandboxState: state,
      threadId: active.id,
    }).catch((error) => {
      console.warn("Unable to save confirmed sandbox state.", error)
    })
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

  const composerBlock =
    view === "settings" || activeFilePath ? null : (
      <div className="pointer-events-auto w-full max-w-3xl">
        <form
          onSubmit={onSubmit}
          className="relative z-[1] w-full rounded-3xl border border-border/70 bg-background shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_28px_-14px_rgba(0,0,0,0.18)] transition-colors focus-within:border-border"
        >
          <textarea
            ref={textareaRef}
            value={input}
            aria-label="Message"
            autoComplete="off"
            name="message"
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
              setInput(e.target.value)
            }
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={empty ? "Ask anything…" : "Ask for follow-up changes"}
            className="block min-h-20 w-full resize-none bg-transparent px-5 pt-4 pb-1 text-[15px] leading-6 outline-none placeholder:text-muted-foreground/70"
          />

          <div className="flex items-center gap-1.5 px-2.5 pt-1 pb-2.5">
            <IconButton aria-label="Attach" disabled>
              <Plus className="size-[18px]" />
            </IconButton>

            <div className="ml-auto flex items-center gap-1.5">
              <Pill
                header="Model"
                value={model}
                options={MODELS}
                formatTrigger={(m) => MODEL_LABEL[m]}
                formatOption={(m) => MODEL_LABEL[m]}
                open={modelOpen}
                setOpen={setModelOpen}
                onSelect={persistModel}
              />
              <ThinkingSpeedPill
                thinking={thinking}
                thinkingOptions={THINKINGS}
                formatThinking={(t) => THINKING_LABEL[t]}
                onSelectThinking={persistThinking}
                speed={speed}
                speedOptions={SPEEDS}
                formatSpeed={(s) => SPEED_LABEL[s]}
                onSelectSpeed={persistSpeed}
                open={thinkingOpen}
                setOpen={setThinkingOpen}
              />

              {activeRunPending ? (
                <Button
                  type="button"
                  size="icon-sm"
                  onClick={stopActiveRun}
                  disabled={!canStopActiveRun}
                  aria-label="Stop"
                  title={canStopActiveRun ? "Stop" : "Run finishing elsewhere"}
                >
                  <Square className="size-3.5 fill-current" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon-sm"
                  disabled={!input.trim()}
                  aria-label="Send"
                >
                  <ArrowUp className="size-4" strokeWidth={2.4} />
                </Button>
              )}
            </div>
          </div>
        </form>

        {active ? null : (
          <div className="-mt-3 flex flex-wrap items-center gap-1 rounded-b-3xl border border-t-0 border-border/60 bg-muted/40 px-3 pt-5 pb-2">
            <RepoChip
              value={repoUrl}
              editing={editingRepo}
              setEditing={setEditingRepo}
              onChange={persistRepo}
              locked={false}
            />
            <span aria-hidden className="h-3.5 w-px bg-border/70" />
            <BranchChip
              value={baseBranch}
              onChange={persistBaseBranch}
              locked={false}
            />
            <div className="ml-auto">
              <PresetPill
                value={sandboxPresetId ?? ""}
                presets={sandboxPresets}
                open={presetOpen}
                setOpen={setPresetOpen}
                onSelect={persistSandboxPreset}
                locked={false}
              />
            </div>
          </div>
        )}
      </div>
    )

  return (
    <div className="fixed inset-0 flex min-w-0 overflow-hidden bg-background text-foreground">
      {sidebarOpen ? (
        <Sidebar
          chats={sidebarChats}
          activeId={activeId}
          currentView={view}
          onNewChat={startNewChat}
          onNewChatInRepo={startNewChatInRepo}
          onSelect={selectChat}
          onDelete={deleteChat}
          onRename={renameChat}
          onShowSettings={showSettings}
          brandClassName={GeistPixelSquare.className}
        />
      ) : null}

      {pendingDeleteId ? (
        <ConfirmDialog
          title="Delete chat?"
          description={
            chats.find((c) => c.id === pendingDeleteId)?.title
              ? `“${chats.find((c) => c.id === pendingDeleteId)?.title}” will be permanently deleted. This action cannot be undone.`
              : "This chat will be permanently deleted. This action cannot be undone."
          }
          confirmLabel="Delete"
          destructive
          onCancel={() => setPendingDeleteId(null)}
          onConfirm={confirmDeleteChat}
        />
      ) : null}

      {pendingSandboxDelete ? (
        <ConfirmDialog
          title="Delete sandbox?"
          description="The Daytona sandbox and its filesystem will be permanently deleted. The chat history will stay."
          confirmLabel="Delete sandbox"
          destructive
          onCancel={() => setPendingSandboxDelete(false)}
          onConfirm={confirmDeleteActiveSandbox}
        />
      ) : null}

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          title={view === "settings" ? "Settings" : (active?.title ?? null)}
          repoUrl={view === "settings" ? "" : repoUrl}
          isNew={view !== "settings" && !active}
          sandboxId={view === "settings" ? null : activeSandboxId}
          showSandboxControls={
            view !== "settings" &&
            (Boolean(active) || activeRunPending || Boolean(activeSandboxId))
          }
          sandboxPending={view !== "settings" && activeRunPending}
          sandboxState={activeSandboxState}
          filesOpen={filesOpen}
          canOpenFiles={view !== "settings" && Boolean(activeFileCacheScope)}
          onToggleFiles={() => setFilesOpen((v) => !v)}
          terminalOpen={terminalVisible}
          onToggleTerminal={() => setTerminalOpen((v) => !v)}
          onSandboxStateChange={handleSandboxStateChange}
          sandboxAction={sandboxAction}
          onDeleteSandbox={requestDeleteActiveSandbox}
          onPauseSandbox={pauseActiveSandbox}
          onResumeSandbox={resumeActiveSandbox}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
        />
        {view === "settings" ? (
          <SettingsScreen
            authStatus={authStatus}
            authError={authError}
            sandboxPresets={sandboxPresets}
          />
        ) : (
          <>
            {activeFilePath ? (
              <FileEditorPanel
                sandboxId={activeSandboxId}
                cacheScope={activeFileCacheScope}
                activePath={activeFilePath}
                diff={editorDiff ?? undefined}
                mode={activeFileMode}
                onOpenFile={openFile}
                onModeChange={setActiveFileMode}
                onClose={() => {
                  setActiveFilePath(null)
                  setActiveFileDiff(null)
                }}
                placement="main"
              />
            ) : allDiffsOpen ? (
              <AllDiffsPanel
                diff={activeDiff ?? ""}
                diffStyle={diffStyle}
                onClose={() => setAllDiffsOpen(false)}
              />
            ) : (
              <div
                key={activeRunKey}
                ref={setThreadElement}
                onScroll={onThreadScroll}
                className="min-h-0 flex-1 overflow-y-auto [contain:paint]"
                style={{ scrollPaddingBottom: threadBottomInset }}
              >
                <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 pt-16">
                  {empty ? (
                    <div className="flex flex-col items-center pt-[22vh]">
                      <h1 className="text-center text-3xl font-medium tracking-tight text-foreground/90">
                        {userFirstName
                          ? `What are we building, ${userFirstName}?`
                          : "What are we building?"}
                      </h1>
                      <div
                        ref={composerRef}
                        className="mt-8 flex w-full justify-center"
                      >
                        {composerBlock}
                      </div>
                    </div>
                  ) : (
                    <div className="mx-auto w-full max-w-2xl space-y-8">
                      {messages.map((m) => (
                        <MessageBlock
                          key={m.id}
                          message={m}
                          repoName={activeRepoName}
                          onOpenFile={openFile}
                          onOpenFileDiff={openFileDiff}
                        />
                      ))}
                    </div>
                  )}
                  <div
                    aria-hidden="true"
                    className="shrink-0"
                    style={{ height: empty ? 0 : threadBottomInset }}
                  />
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

            {empty ? null : (
              <div
                ref={composerRef}
                className={cn(
                  "pointer-events-none absolute inset-x-0 z-10 flex justify-center bg-background px-4 pt-3 pb-6",
                  activeFilePath && "hidden"
                )}
                style={{ bottom: terminalVisible ? terminalHeight : 0 }}
              >
                {composerBlock}
              </div>
            )}
          </>
        )}
      </div>

      <FileBrowser
        open={filesOpen && Boolean(activeFileCacheScope)}
        sandboxId={activeSandboxId}
        cacheScope={activeFileCacheScope}
        diff={activeDiff ?? undefined}
        activePath={activeFilePath}
        activeMode={activeFileMode}
        onClose={() => setFilesOpen(false)}
        onOpenFile={(p, mode) => {
          setActiveFilePath(p)
          setActiveFileMode(mode)
          setActiveFileDiff(null)
          setAllDiffsOpen(false)
        }}
        onOpenAllDiffs={openAllDiffs}
        diffStyle={diffStyle}
        onDiffStyleChange={setDiffStyle}
      />
    </div>
  )
}

function AllDiffsPanel({
  diff,
  diffStyle,
  onClose,
}: {
  diff: string
  diffStyle: "unified" | "split"
  onClose: () => void
}) {
  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex h-[3.25rem] shrink-0 items-center gap-2.5 border-b border-border/60 bg-background/80 px-4 backdrop-blur-xl">
        <span className="flex-1 text-[13px] text-muted-foreground">Diffs</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close diffs"
          className="-mr-[7px] inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {diff ? (
          <DiffList diff={diff} diffStyle={diffStyle} />
        ) : (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            No diffs to show.
          </div>
        )}
      </div>
    </section>
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
  showSandboxControls,
  sandboxPending,
  sandboxState,
  filesOpen,
  canOpenFiles,
  onToggleFiles,
  onSandboxStateChange,
  sandboxAction,
  onDeleteSandbox,
  onPauseSandbox,
  onResumeSandbox,
  terminalOpen,
  onToggleTerminal,
  sidebarOpen,
  onToggleSidebar,
}: {
  title: string | null
  repoUrl: string
  isNew: boolean
  sandboxId: string | null
  showSandboxControls: boolean
  sandboxPending: boolean
  sandboxState?: SandboxState
  filesOpen: boolean
  canOpenFiles: boolean
  onToggleFiles: () => void
  onSandboxStateChange: (state: SandboxState, sandboxId: string) => void
  sandboxAction: SandboxAction | null
  onDeleteSandbox: () => void
  onPauseSandbox: () => void
  onResumeSandbox: () => void
  terminalOpen: boolean
  onToggleTerminal: () => void
  sidebarOpen: boolean
  onToggleSidebar: () => void
}) {
  const displayTitle = title?.trim() || (isNew ? "New chat" : "Untitled")
  const repo = repoUrl ? repoLabel(repoUrl) : ""
  const showSandboxSection =
    showSandboxControls || Boolean(sandboxId || sandboxPending)
  const showToolsSection =
    showSandboxSection || Boolean(sandboxId || canOpenFiles)

  return (
    <header className="flex h-[3.25rem] shrink-0 items-center gap-2.5 border-b border-border/60 bg-background/80 pr-3 pl-2 backdrop-blur-xl">
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
      <div className="ml-auto flex items-center gap-1">
        {showSandboxSection ? (
          <SandboxMenu
            key={sandboxId ?? "pending"}
            sandboxId={sandboxId}
            sandboxPending={sandboxPending}
            sandboxState={sandboxState}
            sandboxAction={sandboxAction}
            onSandboxStateChange={onSandboxStateChange}
            onPauseSandbox={onPauseSandbox}
            onResumeSandbox={onResumeSandbox}
            onDeleteSandbox={onDeleteSandbox}
          />
        ) : null}

        {showSandboxSection && showToolsSection ? (
          <span aria-hidden className="mx-1 h-5 w-px bg-border/70" />
        ) : null}

        {showToolsSection ? (
          <div className="flex items-center gap-0.5">
            <TopBarIconButton
              onClick={onToggleTerminal}
              onPointerEnter={() => warmBrowserTerminal(sandboxId)}
              active={terminalOpen}
              disabled={!sandboxId}
              label={
                terminalOpen ? "Hide sandbox terminal" : "Show sandbox terminal"
              }
            >
              <SquareTerminal className="size-3.5" />
            </TopBarIconButton>
            <TopBarIconButton
              onClick={onToggleFiles}
              active={filesOpen}
              disabled={!canOpenFiles}
              label={filesOpen ? "Hide sandbox files" : "Show sandbox files"}
            >
              {filesOpen ? (
                <FolderOpen className="size-3.5" />
              ) : (
                <Folder className="size-3.5" />
              )}
            </TopBarIconButton>
          </div>
        ) : null}
      </div>
    </header>
  )
}

function TopBarIconButton({
  active,
  children,
  disabled,
  label,
  onClick,
  onPointerEnter,
}: {
  active?: boolean
  children: ReactNode
  disabled?: boolean
  label: string
  onClick: () => void
  onPointerEnter?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={onPointerEnter}
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
        active && "bg-accent text-foreground"
      )}
    >
      {children}
    </button>
  )
}

type DisplayState =
  | SandboxInfo["state"]
  | "checking"
  | "idle"
  | "missing"
  | "starting"

function sandboxDisplayLabel(state: DisplayState) {
  if (state === "starting") return "Running"
  if (state === "checking") return "Checking"
  if (state === "idle") return "Idle"
  if (state === "missing") return "Missing"
  return SANDBOX_STATE_LABEL[state]
}

function SandboxMenu({
  sandboxId,
  sandboxPending,
  sandboxState,
  sandboxAction,
  onSandboxStateChange,
  onPauseSandbox,
  onResumeSandbox,
  onDeleteSandbox,
}: {
  sandboxId: string | null
  sandboxPending: boolean
  sandboxState?: SandboxState
  sandboxAction: SandboxAction | null
  onSandboxStateChange: (state: SandboxState, sandboxId: string) => void
  onPauseSandbox: () => void
  onResumeSandbox: () => void
  onDeleteSandbox: () => void
}) {
  const { info, loading, missing } = useSandboxInfo({
    onStateChange: onSandboxStateChange,
    sandboxId,
  })
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(
    null
  )
  const open = menuPos !== null
  const triggerRef = useRef<HTMLButtonElement>(null)
  const busy = sandboxAction !== null

  useEffect(() => {
    if (!open) return
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setMenuPos(null)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open])

  function openMenu() {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setMenuPos({
      top: rect.bottom + 6,
      right: Math.max(8, window.innerWidth - rect.right),
    })
  }

  function closeMenu() {
    setMenuPos(null)
  }

  let display: DisplayState
  if (sandboxPending && sandboxId && !info) {
    display = "running"
  } else if (sandboxPending && !sandboxId) {
    display = "starting"
  } else if (missing) {
    display = "deleted"
  } else if (info) {
    display = info.state
  } else if (sandboxState === "deleted") {
    display = "deleted"
  } else if (!sandboxId && !sandboxPending) {
    display = "idle"
  } else if (loading) {
    display = "checking"
  } else {
    display = "checking"
  }

  const stopped = display === "stopped"
  const canAct =
    Boolean(sandboxId) && display !== "deleted" && display !== "idle"

  const showSpinner = busy || display === "starting" || display === "checking"
  const title =
    [
      sandboxId ? `Daytona sandbox ${sandboxId}` : "",
      info?.rawState ? `State ${info.rawState}` : "",
      info?.lastActivityAt
        ? `Last active ${new Date(info.lastActivityAt).toLocaleString()}`
        : "",
      info ? formatSandboxAutoStop(info.autoStopInterval) : "",
    ]
      .filter(Boolean)
      .join("\n") || "Sandbox"

  function handle(action: () => void) {
    closeMenu()
    action()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? closeMenu() : openMenu())}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!canAct}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs transition-colors hover:bg-muted disabled:opacity-60",
          open && "bg-muted"
        )}
      >
        <span className="font-medium text-foreground/85">Sandbox</span>
        <span aria-hidden className="text-muted-foreground/40">
          ·
        </span>
        <span className="text-muted-foreground">
          {sandboxDisplayLabel(display)}
        </span>
        {showSpinner ? (
          <Loader2 className="ml-0.5 size-3 animate-spin text-muted-foreground" />
        ) : canAct ? (
          <ChevronDown className="ml-0.5 size-3 text-muted-foreground/70" />
        ) : null}
      </button>
      {open && canAct && menuPos && typeof document !== "undefined"
        ? createPortal(
            <>
              <button
                type="button"
                aria-label="Close sandbox menu"
                className="fixed inset-0 z-[60] cursor-default border-0 bg-transparent p-0"
                onClick={closeMenu}
                onContextMenu={(event) => {
                  event.preventDefault()
                  closeMenu()
                }}
              />
              <div
                role="menu"
                tabIndex={-1}
                style={{ top: menuPos.top, right: menuPos.right }}
                className="fixed z-[61] min-w-44 overflow-hidden rounded-2xl border border-black/[0.06] bg-popover p-1.5 text-popover-foreground shadow-[0_10px_30px_-12px_rgba(0,0,0,0.18)] dark:border-white/10"
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() =>
                    handle(stopped ? onResumeSandbox : onPauseSandbox)
                  }
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                >
                  {stopped ? "Resume sandbox" : "Pause sandbox"}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => handle(onDeleteSandbox)}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-sm text-destructive transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                >
                  Delete sandbox
                </button>
              </div>
            </>,
            document.body
          )
        : null}
    </>
  )
}

function ConfirmDialog({
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive,
  onConfirm,
  onCancel,
}: {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onCancel()
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onCancel])

  return (
    <dialog
      open
      className="fixed inset-0 z-50 m-0 flex h-screen max-h-none w-screen max-w-none items-center justify-center border-0 bg-black/40 p-0 backdrop-blur-sm"
      onCancel={(e) => {
        e.preventDefault()
        onCancel()
      }}
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
    >
      <button
        type="button"
        aria-label="Cancel dialog"
        tabIndex={-1}
        className="absolute inset-0 cursor-default border-0 bg-transparent p-0"
        onClick={onCancel}
      />
      <div className="relative z-10 w-full max-w-sm overflow-hidden rounded-2xl border border-black/[0.06] bg-popover p-5 text-popover-foreground shadow-[0_10px_30px_-12px_rgba(0,0,0,0.18)] dark:border-white/10">
        <div className="text-base font-medium text-foreground">{title}</div>
        {description ? (
          <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-border/70 px-3 py-1.5 text-sm text-foreground/80 transition-colors hover:bg-muted"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            className={cn(
              "rounded-xl px-3 py-1.5 text-sm transition-colors",
              destructive
                ? "text-destructive-foreground bg-destructive hover:bg-destructive/90"
                : "bg-foreground text-background hover:bg-foreground/90"
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
