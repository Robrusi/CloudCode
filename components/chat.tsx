"use client"

import { Show, SignInButton, useUser } from "@clerk/nextjs"
import { useMutation, useQuery } from "convex/react"
import {
  ArrowUp,
  Check,
  ChevronDown,
  Folder,
  FolderOpen,
  GitBranch,
  Loader2,
  PanelLeft,
  PanelRight,
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
  BranchTargetChip,
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
import { MOBILE_MEDIA_QUERY, useIsMobile } from "@/hooks/use-is-mobile"
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
  type BranchMode,
  type Model,
  type Speed,
  type Thinking,
} from "@/lib/chat-options"
import { cn } from "@/lib/utils"

const FileBrowser = dynamic(
  () => import("@/components/file-browser").then((mod) => mod.FileBrowser),
  { ssr: false }
)

const GithubPanel = dynamic(
  () => import("@/components/github-panel").then((mod) => mod.GithubPanel),
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

type GitHubAuthStatus = {
  app?: {
    accounts?: Array<{
      accountType: "Organization" | "User"
      avatarUrl?: string
      description?: string
      htmlUrl?: string
      id: string
      installationId?: string
      installed: boolean
      login: string
      repositorySelection?: string
    }>
    configured: boolean
    installationConfigured?: boolean
    installations: Array<{
      accountLogin: string
      accountType?: string
      installationId: string
      repositorySelection?: string
    }>
    organizationError?: string
    organizations?: Array<{
      avatarUrl?: string
      description?: string
      id: string
      login: string
    }>
    user:
      | { connected: false }
      | {
          connected: true
          email?: string
          githubUserId: string
          login: string
          name?: string
        }
    userAuthConfigured?: boolean
  }
  connected: boolean
  mode?: "app" | "none"
  username?: string | null
}

type ChatRecord = {
  baseBranch?: string
  branchMode?: BranchMode
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

type ThreadScrollSnapshot = {
  atBottom: boolean
  runKey: string
  scrollTop: number
}

const REPO_KEY = "cloudcode:repoUrl"
const BASE_BRANCH_KEY = "cloudcode:baseBranch"
const BRANCH_MODE_KEY = "cloudcode:branchMode"
const BRANCH_NAME_KEY = "cloudcode:branchName"
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
const TERMINAL_OPEN_KEY = "cloudcode:terminalOpen"
const DRAFT_RUN_KEY = "__draft__"
const DEFAULT_COMPOSER_HEIGHT = 144
const THREAD_BOTTOM_CLEARANCE = 32
const DISPLAY_THREAD_TITLE_MAX_CHARS = 48
const EMPTY_MESSAGES: Message[] = []
const STREAM_TOOL_MARKER_REGEX = /<codex-tool>[\s\S]*?<\/codex-tool>/g

function repoLabel(url: string) {
  if (!url) return "Untitled"
  return url
    .replace(/^https?:\/\/(www\.)?github\.com\//, "")
    .replace(/\.git$/, "")
}

function limitThreadDisplayTitle(title: string) {
  const chars = Array.from(title)
  if (chars.length <= DISPLAY_THREAD_TITLE_MAX_CHARS) return title
  return `${chars.slice(0, DISPLAY_THREAD_TITLE_MAX_CHARS - 3).join("")}...`
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
  const activeRunKey = activeId ? (activeId as string) : DRAFT_RUN_KEY
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
  const [draftBranchMode, setDraftBranchMode] = useState<BranchMode>(() => {
    if (typeof window === "undefined") return "auto"
    const stored = localStorage.getItem(BRANCH_MODE_KEY)
    return stored === "custom" || stored === "base" ? stored : "auto"
  })
  const [draftBranchName, setDraftBranchName] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (localStorage.getItem(BRANCH_NAME_KEY) ?? "")
  )
  const [branchTargetOpen, setBranchTargetOpen] = useState(false)
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
  const [githubOpen, setGithubOpen] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(() =>
    typeof window === "undefined"
      ? false
      : localStorage.getItem(TERMINAL_OPEN_KEY) === "true"
  )
  const [terminalHeight, setTerminalHeight] = useState(380)
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null)
  const [activeFileMode, setActiveFileMode] =
    useState<FileBrowserOpenMode>("file")
  const [activeFileDiff, setActiveFileDiff] = useState<string | null>(null)
  const [allDiffsOpen, setAllDiffsOpen] = useState(false)
  const [diffStyle, setDiffStyle] = useState<"unified" | "split">("unified")
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window === "undefined"
      ? true
      : !window.matchMedia(MOBILE_MEDIA_QUERY).matches
  )
  const isMobile = useIsMobile()
  const [view, setView] = useState<"chat" | "settings">("chat")
  const [runningRunKeys, setRunningRunKeys] = useState<Record<string, true>>({})
  const [liveRunStates, setLiveRunStates] = useState<
    Record<string, CachedRunState>
  >({})
  const [revealedLiveRunContent, setRevealedLiveRunContent] = useState<
    Record<string, string>
  >({})
  const [optimisticRuns, setOptimisticRuns] = useState<
    Record<string, OptimisticRun>
  >({})
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
  const [authError, setAuthError] = useState("")
  const [githubStatus, setGithubStatus] = useState<GitHubAuthStatus | null>(
    null
  )
  const [githubAuthError, setGithubAuthError] = useState("")
  const cancelRequestedThreadIdsRef = useRef<Set<string>>(new Set())
  const queueingRunKeysRef = useRef<Set<string>>(new Set())
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
  const lastLiveRunRef = useRef<LiveRunRecord | null>(null)
  const autoPresetDefaultedRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const threadRef = useRef<HTMLDivElement | null>(null)
  const isAtBottomRef = useRef(true)
  const promptFocusedRef = useRef(false)
  const pendingThreadScrollRestoreRef = useRef<ThreadScrollSnapshot | null>(
    null
  )
  const pendingThreadScrollRestoreFrameRef = useRef<number | null>(null)
  const [composerHeight, setComposerHeight] = useState(DEFAULT_COMPOSER_HEIGHT)

  const isThreadAtBottom = useCallback((el: HTMLDivElement) => {
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }, [])

  const scrollThreadToBottom = useCallback(() => {
    const el = threadRef.current
    if (!el) return
    el.style.scrollBehavior = "auto"
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
    isAtBottomRef.current = true
  }, [])

  const settleThreadAtBottom = useCallback(() => {
    if (isMobile && promptFocusedRef.current) return

    isAtBottomRef.current = true
    scrollThreadToBottom()

    requestAnimationFrame(() => {
      if (isMobile && promptFocusedRef.current) return
      scrollThreadToBottom()
      requestAnimationFrame(() => {
        if (isMobile && promptFocusedRef.current) return
        scrollThreadToBottom()
      })
    })
  }, [isMobile, scrollThreadToBottom])

  const captureThreadScrollForPanel = useCallback(() => {
    const el = threadRef.current
    if (!el) return

    if (pendingThreadScrollRestoreFrameRef.current !== null) {
      cancelAnimationFrame(pendingThreadScrollRestoreFrameRef.current)
      pendingThreadScrollRestoreFrameRef.current = null
    }

    pendingThreadScrollRestoreRef.current = {
      atBottom: isThreadAtBottom(el),
      runKey: activeRunKey,
      scrollTop: el.scrollTop,
    }
  }, [activeRunKey, isThreadAtBottom])

  const restoreThreadScrollForPanel = useCallback(
    (el: HTMLDivElement) => {
      const snapshot = pendingThreadScrollRestoreRef.current
      if (!snapshot || snapshot.runKey !== activeRunKey) return false

      const applyScroll = () => {
        el.style.scrollBehavior = "auto"
        el.scrollTop = snapshot.atBottom
          ? Math.max(0, el.scrollHeight - el.clientHeight)
          : Math.min(
              snapshot.scrollTop,
              Math.max(0, el.scrollHeight - el.clientHeight)
            )
        isAtBottomRef.current = snapshot.atBottom
      }

      if (pendingThreadScrollRestoreFrameRef.current !== null) {
        cancelAnimationFrame(pendingThreadScrollRestoreFrameRef.current)
      }

      applyScroll()
      pendingThreadScrollRestoreFrameRef.current = requestAnimationFrame(() => {
        applyScroll()
        pendingThreadScrollRestoreFrameRef.current = requestAnimationFrame(
          () => {
            applyScroll()
            if (pendingThreadScrollRestoreRef.current === snapshot) {
              pendingThreadScrollRestoreRef.current = null
            }
            pendingThreadScrollRestoreFrameRef.current = null
          }
        )
      })

      return true
    },
    [activeRunKey]
  )

  function onThreadScroll(event: ReactUIEvent<HTMLDivElement>) {
    const el = event.currentTarget
    isAtBottomRef.current = isThreadAtBottom(el)
  }

  const setThreadElement = useCallback(
    (el: HTMLDivElement | null) => {
      threadRef.current = el
      if (el) {
        if (!restoreThreadScrollForPanel(el)) {
          settleThreadAtBottom()
        }
      }
    },
    [restoreThreadScrollForPanel, settleThreadAtBottom]
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
  const clearLiveRevealTimers = useCallback(() => {
    for (const state of Object.values(liveRevealRef.current)) {
      if (state.timer) clearTimeout(state.timer)
    }
  }, [])

  const active = useMemo(
    () => chats.find((c) => c.id === activeId) ?? null,
    [chats, activeId]
  )
  const visibleLiveRun = (() => {
    if (liveRun) {
      lastLiveRunRef.current = liveRun
      return liveRun
    }

    const cachedLiveRun = lastLiveRunRef.current
    if (!active || !cachedLiveRun || active.id !== cachedLiveRun.threadId) {
      return null
    }

    const liveMessage = active.messages.find(
      (message) => message.id === cachedLiveRun.assistantMessageId
    )

    if (liveMessage && !liveMessage.pending && liveMessage.content.trim()) {
      lastLiveRunRef.current = null
      return null
    }

    return cachedLiveRun
  })()

  useEffect(() => {
    if (
      new URLSearchParams(window.location.search).get("view") === "settings"
    ) {
      setView("settings")
    }
  }, [])

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

    clearLiveRevealTimers()
    liveRevealRef.current = {}
    setRevealedLiveRunContent({})
  }, [clearLiveRevealTimers, visibleLiveRun])
  useEffect(() => clearLiveRevealTimers, [clearLiveRevealTimers])
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
          lastUserMessageAt: chat.lastUserMessageAt ?? chat.createdAt,
        }
      }),
    [chats, liveActiveRunState, liveRunStates, runningRunKeys, visibleLiveRun]
  )
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
  const terminalVisible =
    terminalOpen && (Boolean(activeSandboxId) || activeRunPending)
  const threadBottomInset =
    THREAD_BOTTOM_CLEARANCE +
    (terminalVisible
      ? Math.max(composerHeight, DEFAULT_COMPOSER_HEIGHT) + terminalHeight
      : 0)

  const repoUrl = active ? active.repoUrl : draftRepo
  const baseBranch = active ? (active.baseBranch ?? "") : draftBaseBranch
  const model = active ? active.model : draftModel
  const effectiveDraftBranchMode: BranchMode =
    draftBranchMode === "custom" && !draftBranchName.trim()
      ? "auto"
      : draftBranchMode
  const sandboxPresetId = active ? active.sandboxPresetId : draftSandboxPresetId
  const speed = draftSpeed
  const thinking = draftThinking
  const empty = messages.length === 0
  const threadScrollable = !isMobile || !empty
  const threadContentVersion = messages
    .map((message) =>
      [
        message.id,
        message.content.length,
        message.pending ? 1 : 0,
        message.error ? 1 : 0,
        message.meta?.logs?.length ?? 0,
        message.meta?.status ?? "",
      ].join(":")
    )
    .join("|")
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
  const activeChangedTextPaths = useMemo(() => {
    const paths: string[] = []
    for (const file of getDiffStats(activeDiff ?? undefined).files) {
      if (file.type === "deleted" || !canPrefetchAsText(file.path)) continue
      paths.push(file.path)
      if (paths.length === 30) break
    }
    return paths
  }, [activeDiff])
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
  const emptyPromptTitle = userFirstName
    ? `What are we building, ${userFirstName}?`
    : "What are we building?"

  const openFile = useCallback(
    (path: string) => {
      captureThreadScrollForPanel()
      setActiveFilePath(path)
      setActiveFileMode("file")
      setActiveFileDiff(null)
      setAllDiffsOpen(false)
    },
    [captureThreadScrollForPanel]
  )

  const openFileDiff = useCallback(
    (path: string, diff: string) => {
      captureThreadScrollForPanel()
      setActiveFilePath(path)
      setActiveFileMode("diff")
      setActiveFileDiff(diff)
      setAllDiffsOpen(false)
    },
    [captureThreadScrollForPanel]
  )

  const openAllDiffs = useCallback(() => {
    captureThreadScrollForPanel()
    setActiveFilePath(null)
    setActiveFileDiff(null)
    setAllDiffsOpen(true)
  }, [captureThreadScrollForPanel])

  const refreshGitHubAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/github/auth", { cache: "no-store" })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data?.error ?? "Unable to read GitHub auth status.")
      }

      setGithubStatus(data)
      setGithubAuthError("")
    } catch (err) {
      setGithubStatus(null)
      setGithubAuthError(
        err instanceof Error
          ? err.message
          : "Unable to read GitHub auth status."
      )
    }
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

    function refreshConnections() {
      void Promise.all([refreshAuth(), refreshGitHubAuth()])
    }

    refreshConnections()
    window.addEventListener("focus", refreshConnections)
    return () => window.removeEventListener("focus", refreshConnections)
  }, [refreshGitHubAuth, userLoading])

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
    if (terminalOpen) localStorage.setItem(TERMINAL_OPEN_KEY, "true")
    else localStorage.removeItem(TERMINAL_OPEN_KEY)
  }, [terminalOpen])

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
        queueingRunKeysRef.current.has(key) ||
        key === liveThreadKey ||
        Boolean(chat.pending) ||
        chat.messages.some((message) => message.pending)

      if (!stillRunning && nextKeys[key]) {
        delete nextKeys[key]
        cancelRequestedThreadIdsRef.current.delete(key)
        queueingRunKeysRef.current.delete(key)
        runningRunKeysRef.current.delete(key)
        changed = true
      }
    }

    if (changed) setRunningRunKeys(nextKeys)
  }, [chats, runningRunKeys, visibleLiveRun?.threadId])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    const minHeight = isMobile ? 64 : 80
    const maxHeight = isMobile ? 144 : 200
    el.style.height = "0px"
    el.style.height =
      Math.min(Math.max(el.scrollHeight, minHeight), maxHeight) + "px"
  }, [input, isMobile])

  useEffect(() => {
    const el = composerRef.current
    if (!el || !terminalVisible) return

    const updateComposerHeight = () => {
      setComposerHeight(Math.ceil(el.getBoundingClientRect().height))
    }

    updateComposerHeight()
    const observer = new ResizeObserver(updateComposerHeight)
    observer.observe(el)

    return () => observer.disconnect()
  }, [activeFilePath, empty, terminalVisible])

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
    if (isMobile && empty) return
    if (pendingThreadScrollRestoreFrameRef.current !== null) {
      cancelAnimationFrame(pendingThreadScrollRestoreFrameRef.current)
      pendingThreadScrollRestoreFrameRef.current = null
    }
    pendingThreadScrollRestoreRef.current = null
    setActiveFileDiff(null)
    settleThreadAtBottom()
  }, [activeId, empty, isMobile, settleThreadAtBottom])

  useEffect(() => {
    return () => {
      if (pendingThreadScrollRestoreFrameRef.current !== null) {
        cancelAnimationFrame(pendingThreadScrollRestoreFrameRef.current)
      }
    }
  }, [])

  useLayoutEffect(() => {
    if (isMobile && promptFocusedRef.current) return
    if (!isAtBottomRef.current) return
    settleThreadAtBottom()
  }, [isMobile, threadBottomInset, settleThreadAtBottom])

  useLayoutEffect(() => {
    if (isMobile && promptFocusedRef.current) return
    if (!isAtBottomRef.current) return
    scrollThreadToBottom()
  }, [isMobile, scrollThreadToBottom, threadContentVersion])

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

    if (queueingRunKeysRef.current.has(previousKey)) {
      queueingRunKeysRef.current.delete(previousKey)
      queueingRunKeysRef.current.add(nextKey)
    }
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
    queueingRunKeysRef.current.delete(runKey)
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

  function persistDraftBranchMode(value: BranchMode) {
    setDraftBranchMode(value)
    if (value === "auto") localStorage.removeItem(BRANCH_MODE_KEY)
    else localStorage.setItem(BRANCH_MODE_KEY, value)
  }

  function persistDraftBranchName(value: string) {
    setDraftBranchName(value)
    if (value) localStorage.setItem(BRANCH_NAME_KEY, value)
    else localStorage.removeItem(BRANCH_NAME_KEY)
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
    promptFocusedRef.current = false
    setActiveId(null)
    setInput("")
    setEditingRepo(false)
    setActiveFilePath(null)
    setFilesOpen(false)
    setTerminalOpen(false)
    setView("chat")
    if (isMobile) setSidebarOpen(false)
  }

  function startNewChatInRepo(repoUrl: string) {
    persistDraftRepo(repoUrl)
    startNewChat()
  }

  function selectChat(id: Id<"threads">) {
    promptFocusedRef.current = false
    setActiveId(id)
    setInput("")
    setEditingRepo(false)
    setActiveFilePath(null)
    setFilesOpen(false)
    setTerminalOpen(false)
    setView("chat")
    if (isMobile) setSidebarOpen(false)
  }

  function showSettings() {
    promptFocusedRef.current = false
    setView("settings")
    setActiveFilePath(null)
    setFilesOpen(false)
    setTerminalOpen(false)
    if (isMobile) setSidebarOpen(false)
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

    queueingRunKeysRef.current.add(runKey)
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
          branchMode: effectiveDraftBranchMode,
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
      const continuationBranch =
        cachedRunState?.branch ?? previousAssistant?.meta?.branch
      // Branch strategy is fixed per chat: existing chats reuse the stored mode
      // (legacy chats predate it, so default to "auto"); new chats use the
      // composer's choice. The branch name only seeds the very first run.
      const runBranchMode: BranchMode = active
        ? (active.branchMode ?? "auto")
        : effectiveDraftBranchMode
      const branchName =
        continuationBranch ??
        (runBranchMode === "custom"
          ? draftBranchName.trim() || undefined
          : undefined)
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
          branchMode: runBranchMode,
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
      if (cancelRequestedThreadIdsRef.current.has(chatId as string)) {
        await cancelCodexRun(chatId)
      }
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
      queueingRunKeysRef.current.delete(runKey)
      if (!queued) {
        cancelRequestedThreadIdsRef.current.delete(runKey)
        clearRunKey(runKey)
      }
    }
  }

  async function cancelCodexRun(threadId: Id<"threads">) {
    const key = threadId as string
    cancelRequestedThreadIdsRef.current.add(key)
    markRunActive(key)

    const res = await fetch("/api/codex-run/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId }),
    }).catch((error) => {
      console.warn("Unable to cancel Codex run.", error)
      return null
    })

    if (!res?.ok) return

    const data = (await res.json().catch(() => null)) as {
      canceled?: boolean
    } | null
    if (data?.canceled === false) {
      return
    }
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

  function handleSandboxMissing(sandboxId: string) {
    if (!active) return

    const key = active.id as string
    const currentSandboxId =
      threadRunStateRef.current[key]?.sandboxId ?? active.sandboxId
    if (currentSandboxId !== sandboxId) return

    mergeThreadRunState(active.id, {
      sandboxId,
      sandboxState: "deleted",
    })

    if (activeRunPending) return

    void saveRunState({
      sandboxId,
      sandboxState: "deleted",
      threadId: active.id,
    }).catch((error) => {
      console.warn("Unable to save missing sandbox state.", error)
    })
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    send(input)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // On touch keyboards Enter should add a newline; sending is done via the
    // button. On desktop, Enter sends and Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey && !isMobile) {
      e.preventDefault()
      send(input)
    }
  }

  function onTextareaFocus() {
    promptFocusedRef.current = true
  }

  function onTextareaBlur() {
    promptFocusedRef.current = false
  }

  const composerBlock =
    view === "settings" || activeFilePath ? null : (
      <div className="pointer-events-auto w-full max-w-3xl rounded-3xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_28px_-14px_rgba(0,0,0,0.18)]">
        <form
          onSubmit={onSubmit}
          className="relative z-[1] w-full rounded-3xl border border-border/70 bg-background transition-colors focus-within:border-border"
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
            onFocus={onTextareaFocus}
            onBlur={onTextareaBlur}
            rows={1}
            placeholder={empty ? "Ask anything…" : "Ask for follow-up changes"}
            enterKeyHint={isMobile ? "enter" : "send"}
            className="block min-h-16 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base leading-6 outline-none placeholder:text-muted-foreground/70 md:min-h-20 md:px-5 md:pt-4 md:text-[15px]"
          />

          <div className="flex items-center gap-1.5 px-2.5 pt-1 pb-2.5">
            <IconButton aria-label="Attach" disabled className="hidden sm:grid">
              <Plus className="size-[18px]" />
            </IconButton>

            <div className="ml-auto flex min-w-0 flex-nowrap items-center justify-end gap-1.5 overflow-x-auto overscroll-x-contain md:flex-wrap md:overflow-visible">
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
                  className="size-9 md:size-8"
                >
                  <Square className="size-3.5 fill-current" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon-sm"
                  disabled={!input.trim()}
                  aria-label="Send"
                  className="size-9 md:size-8"
                >
                  <ArrowUp className="size-4" strokeWidth={2.4} />
                </Button>
              )}
            </div>
          </div>
        </form>

        {active ? null : (
          <div className="-mt-3 flex flex-col items-stretch gap-1 rounded-b-3xl border border-t-0 border-border/60 bg-muted/40 px-2.5 pt-5 pb-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-1 sm:gap-y-0.5 sm:px-3 sm:pb-2">
            <ComposerSettingRow label="Repository">
              <RepoChip
                value={repoUrl}
                editing={editingRepo}
                setEditing={setEditingRepo}
                onChange={persistRepo}
                locked={false}
              />
            </ComposerSettingRow>
            <span
              aria-hidden
              className="hidden h-3.5 w-px bg-border/70 sm:block"
            />
            <ComposerSettingRow label="Base branch">
              <BranchChip
                value={baseBranch}
                repoUrl={repoUrl}
                onChange={persistBaseBranch}
                locked={false}
              />
            </ComposerSettingRow>
            <ComposerSettingRow label="Branch target">
              <BranchTargetChip
                mode={draftBranchMode}
                branchName={draftBranchName}
                baseBranch={baseBranch}
                open={branchTargetOpen}
                setOpen={setBranchTargetOpen}
                onChangeMode={persistDraftBranchMode}
                onChangeBranchName={persistDraftBranchName}
              />
            </ComposerSettingRow>
            <ComposerSettingRow label="Preset" className="sm:ml-auto">
              <PresetPill
                value={sandboxPresetId ?? ""}
                presets={sandboxPresets}
                open={presetOpen}
                setOpen={setPresetOpen}
                onSelect={persistSandboxPreset}
                locked={false}
              />
            </ComposerSettingRow>
          </div>
        )}
      </div>
    )

  const pendingDeleteTitle = pendingDeleteId
    ? chats.find((c) => c.id === pendingDeleteId)?.title.trim()
    : undefined
  const pendingDeleteDisplayTitle = pendingDeleteTitle
    ? limitThreadDisplayTitle(pendingDeleteTitle)
    : null

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
          onClose={() => setSidebarOpen(false)}
          brandClassName={GeistPixelSquare.className}
        />
      ) : null}

      {pendingDeleteId ? (
        <ConfirmDialog
          title="Delete chat?"
          description={
            pendingDeleteDisplayTitle
              ? `“${pendingDeleteDisplayTitle}” will be permanently deleted. This action cannot be undone.`
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
          onToggleFiles={() =>
            setFilesOpen((v) => {
              if (!v) setGithubOpen(false)
              return !v
            })
          }
          githubOpen={githubOpen}
          canOpenGithub={view !== "settings" && Boolean(activeSandboxId)}
          onToggleGithub={() =>
            setGithubOpen((v) => {
              if (!v) setFilesOpen(false)
              return !v
            })
          }
          terminalOpen={terminalVisible}
          onToggleTerminal={() => setTerminalOpen((v) => !v)}
          onSandboxStateChange={handleSandboxStateChange}
          onSandboxMissing={handleSandboxMissing}
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
            githubStatus={githubStatus}
            githubAuthError={githubAuthError}
            onGitHubAuthChanged={refreshGitHubAuth}
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
                className={cn(
                  "min-h-0 flex-1 overscroll-contain [contain:paint] [overflow-anchor:none]",
                  threadScrollable ? "overflow-y-auto" : "overflow-hidden"
                )}
                style={{ scrollPaddingBottom: threadBottomInset }}
              >
                <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 pt-16 md:px-6">
                  {empty ? (
                    <div className="flex min-h-full flex-col items-center justify-end pb-[calc(clamp(3rem,18dvh,7.5rem)+env(safe-area-inset-bottom))] md:min-h-0 md:justify-start md:pt-[22vh] md:pb-0">
                      <h1 className="text-center text-2xl font-normal tracking-tight text-balance text-foreground/90 md:text-3xl">
                        {emptyPromptTitle}
                      </h1>
                      <div
                        ref={composerRef}
                        className="mt-10 flex w-full justify-center md:mt-8"
                      >
                        {composerBlock}
                      </div>
                    </div>
                  ) : (
                    <div className="mx-auto w-full max-w-2xl space-y-6 md:space-y-8">
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

            {composerBlock && !empty ? (
              terminalVisible ? (
                <div
                  ref={composerRef}
                  className={cn(
                    "pointer-events-none absolute inset-x-0 z-10 flex justify-center bg-background px-3 pt-3 pb-4 md:px-4 md:pb-6",
                    (activeFilePath || allDiffsOpen) && "hidden"
                  )}
                  style={{
                    bottom: terminalVisible
                      ? terminalHeight
                      : "env(safe-area-inset-bottom)",
                  }}
                >
                  {composerBlock}
                </div>
              ) : (
                <div
                  ref={composerRef}
                  className="shrink-0 bg-background px-3 pt-1 pb-[calc(0.625rem+env(safe-area-inset-bottom))] md:px-4 md:pt-3 md:pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
                >
                  <div className="flex justify-center">{composerBlock}</div>
                </div>
              )
            ) : null}
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
          captureThreadScrollForPanel()
          setActiveFilePath(p)
          setActiveFileMode(mode)
          setActiveFileDiff(null)
          setAllDiffsOpen(false)
          if (isMobile) setFilesOpen(false)
        }}
        onOpenAllDiffs={openAllDiffs}
        diffStyle={diffStyle}
        onDiffStyleChange={setDiffStyle}
      />
      <GithubPanel
        open={githubOpen && Boolean(activeSandboxId)}
        sandboxId={activeSandboxId}
        repoUrl={repoUrl}
        baseBranch={baseBranch}
        diff={activeDiff ?? undefined}
        githubConnected={Boolean(githubStatus?.connected)}
        onClose={() => setGithubOpen(false)}
        onOpenFile={(p, mode) => {
          captureThreadScrollForPanel()
          setActiveFilePath(p)
          setActiveFileMode(mode)
          setActiveFileDiff(null)
          setAllDiffsOpen(false)
          if (isMobile) setGithubOpen(false)
        }}
      />
    </div>
  )
}

// New-chat composer settings: on mobile each control becomes a full-width row
// with a leading label (the chips have no room for tooltips on touch); on `sm+`
// the wrapper collapses to just the inline chip so the desktop bar is unchanged.
function ComposerSettingRow({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 sm:w-auto sm:justify-start sm:gap-0",
        className
      )}
    >
      <span className="pl-1.5 text-xs text-muted-foreground sm:hidden">
        {label}
      </span>
      {children}
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
    <div className="fixed inset-x-0 top-0 flex h-[100dvh] overflow-hidden bg-background px-6 text-foreground">
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-3xl font-medium tracking-tight text-foreground/90">
            Cloudcode
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Sign in to keep threads and Codex auth attached to your profile.
          </p>
          <SignInButton mode="modal">
            <button
              type="button"
              className="mt-6 inline-flex h-10 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-85"
            >
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
  githubOpen,
  canOpenGithub,
  onToggleGithub,
  onSandboxStateChange,
  onSandboxMissing,
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
  githubOpen: boolean
  canOpenGithub: boolean
  onToggleGithub: () => void
  onSandboxStateChange: (state: SandboxState, sandboxId: string) => void
  onSandboxMissing: (sandboxId: string) => void
  sandboxAction: SandboxAction | null
  onDeleteSandbox: () => void
  onPauseSandbox: () => void
  onResumeSandbox: () => void
  terminalOpen: boolean
  onToggleTerminal: () => void
  sidebarOpen: boolean
  onToggleSidebar: () => void
}) {
  const fullTitle = title?.trim() || (isNew ? "New chat" : "Untitled")
  const displayTitle = limitThreadDisplayTitle(fullTitle)
  const repo = repoUrl ? repoLabel(repoUrl) : ""
  const showSandboxSection =
    showSandboxControls || Boolean(sandboxId || sandboxPending)
  const showToolsSection =
    showSandboxSection || Boolean(sandboxId || canOpenFiles)

  return (
    <header className="flex h-[calc(3.25rem+env(safe-area-inset-top))] shrink-0 items-center gap-2.5 border-b border-border/60 bg-background/80 pt-[env(safe-area-inset-top)] pr-3 pl-2 backdrop-blur-xl">
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:size-7"
      >
        <PanelLeft className="size-3.5" />
      </button>
      <span
        title={displayTitle === fullTitle ? undefined : fullTitle}
        aria-label={fullTitle}
        className="max-w-[55vw] min-w-0 truncate text-sm font-medium text-foreground/85 md:max-w-[42ch]"
      >
        {displayTitle}
      </span>
      {repo ? (
        <>
          <span
            className="hidden text-muted-foreground/40 sm:inline"
            aria-hidden
          >
            /
          </span>
          <div className="hidden min-w-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex">
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
            onSandboxMissing={onSandboxMissing}
            onPauseSandbox={onPauseSandbox}
            onResumeSandbox={onResumeSandbox}
            onDeleteSandbox={onDeleteSandbox}
          />
        ) : null}

        {showSandboxSection && showToolsSection ? (
          <span aria-hidden className="mx-1 h-5 w-px bg-border/70" />
        ) : null}

        {showToolsSection ? (
          <>
            <div className="hidden items-center gap-0.5 md:flex">
              <TopBarIconButton
                onClick={onToggleTerminal}
                onFocus={() => warmBrowserTerminal(sandboxId)}
                onPointerDown={() => warmBrowserTerminal(sandboxId)}
                onPointerEnter={() => warmBrowserTerminal(sandboxId)}
                active={terminalOpen}
                disabled={!sandboxId && !sandboxPending}
                label={
                  terminalOpen
                    ? "Hide sandbox terminals"
                    : "Show sandbox terminals"
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
              <TopBarIconButton
                onClick={onToggleGithub}
                active={githubOpen}
                disabled={!canOpenGithub}
                label={githubOpen ? "Hide GitHub panel" : "Show GitHub panel"}
              >
                <GitBranch className="size-3.5" />
              </TopBarIconButton>
            </div>
            <TopBarToolsMenu
              className="md:hidden"
              sandboxId={sandboxId}
              sandboxPending={sandboxPending}
              terminalOpen={terminalOpen}
              onToggleTerminal={onToggleTerminal}
              filesOpen={filesOpen}
              canOpenFiles={canOpenFiles}
              onToggleFiles={onToggleFiles}
              githubOpen={githubOpen}
              canOpenGithub={canOpenGithub}
              onToggleGithub={onToggleGithub}
            />
          </>
        ) : null}
      </div>
    </header>
  )
}

function TopBarToolsMenu({
  className,
  sandboxId,
  sandboxPending,
  terminalOpen,
  onToggleTerminal,
  filesOpen,
  canOpenFiles,
  onToggleFiles,
  githubOpen,
  canOpenGithub,
  onToggleGithub,
}: {
  className?: string
  sandboxId: string | null
  sandboxPending: boolean
  terminalOpen: boolean
  onToggleTerminal: () => void
  filesOpen: boolean
  canOpenFiles: boolean
  onToggleFiles: () => void
  githubOpen: boolean
  canOpenGithub: boolean
  onToggleGithub: () => void
}) {
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(
    null
  )
  const open = menuPos !== null
  const triggerRef = useRef<HTMLButtonElement>(null)

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

  const anyOpen = terminalOpen || filesOpen || githubOpen
  const items = [
    {
      key: "terminal",
      label: terminalOpen ? "Hide terminals" : "Terminals",
      icon: <SquareTerminal className="size-4" />,
      active: terminalOpen,
      disabled: !sandboxId && !sandboxPending,
      onSelect: onToggleTerminal,
    },
    {
      key: "files",
      label: filesOpen ? "Hide files" : "Files",
      icon: filesOpen ? (
        <FolderOpen className="size-4" />
      ) : (
        <Folder className="size-4" />
      ),
      active: filesOpen,
      disabled: !canOpenFiles,
      onSelect: onToggleFiles,
    },
    {
      key: "github",
      label: githubOpen ? "Hide GitHub" : "GitHub",
      icon: <GitBranch className="size-4" />,
      active: githubOpen,
      disabled: !canOpenGithub,
      onSelect: onToggleGithub,
    },
  ]

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (open) {
            setMenuPos(null)
            return
          }
          warmBrowserTerminal(sandboxId)
          openMenu()
        }}
        aria-label="Sandbox tools"
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          (open || anyOpen) && "bg-accent text-foreground"
        )}
      >
        <PanelRight className="size-[18px]" />
      </button>
      {open && menuPos && typeof document !== "undefined"
        ? createPortal(
            <>
              <button
                type="button"
                aria-label="Close tools menu"
                className="fixed inset-0 z-[60] cursor-default border-0 bg-transparent p-0"
                onClick={() => setMenuPos(null)}
              />
              <div
                role="menu"
                tabIndex={-1}
                style={{ top: menuPos.top, right: menuPos.right }}
                className="fixed z-[61] min-w-44 overflow-hidden rounded-2xl border border-black/[0.06] bg-popover p-1.5 text-popover-foreground shadow-[0_10px_30px_-12px_rgba(0,0,0,0.18)] dark:border-white/10"
              >
                {items.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => {
                      item.onSelect()
                      setMenuPos(null)
                    }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
                  >
                    <span className="shrink-0 text-muted-foreground">
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {item.label}
                    </span>
                    {item.active ? (
                      <Check className="size-4 shrink-0" strokeWidth={2.25} />
                    ) : null}
                  </button>
                ))}
              </div>
            </>,
            document.body
          )
        : null}
    </div>
  )
}

function TopBarIconButton({
  active,
  children,
  disabled,
  label,
  onClick,
  onFocus,
  onPointerDown,
  onPointerEnter,
  ref,
}: {
  active?: boolean
  children: ReactNode
  disabled?: boolean
  label: string
  onClick: () => void
  onFocus?: () => void
  onPointerDown?: () => void
  onPointerEnter?: () => void
  ref?: React.Ref<HTMLButtonElement>
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      onFocus={onFocus}
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 md:size-7",
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
  onSandboxMissing,
  onPauseSandbox,
  onResumeSandbox,
  onDeleteSandbox,
}: {
  sandboxId: string | null
  sandboxPending: boolean
  sandboxState?: SandboxState
  sandboxAction: SandboxAction | null
  onSandboxStateChange: (state: SandboxState, sandboxId: string) => void
  onSandboxMissing: (sandboxId: string) => void
  onPauseSandbox: () => void
  onResumeSandbox: () => void
  onDeleteSandbox: () => void
}) {
  const { info, loading, missing } = useSandboxInfo({
    onMissing: onSandboxMissing,
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
  if (sandboxPending && missing) {
    display = "starting"
  } else if (missing) {
    display = "deleted"
  } else if (sandboxPending && sandboxId && !info) {
    display = "running"
  } else if (sandboxPending && !sandboxId) {
    display = "starting"
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
      className="fixed inset-0 z-50 m-0 flex h-dvh max-h-none w-screen max-w-none items-center justify-center border-0 bg-black/40 p-4 backdrop-blur-sm"
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
            className="rounded-xl border border-border/70 px-3 py-2 text-sm text-foreground/80 transition-colors hover:bg-muted"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              "rounded-xl px-3 py-2 text-sm transition-colors",
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
