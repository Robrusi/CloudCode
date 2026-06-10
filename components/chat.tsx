"use client"

import { Show, SignInButton, useUser } from "@clerk/nextjs"
import { useMutation, useQuery } from "convex/react"
import {
  ArrowUp,
  Check,
  ChevronDown,
  CornerDownRight,
  Folder,
  FolderOpen,
  GitBranch,
  ImagePlus,
  KeyRound,
  Loader2,
  Monitor,
  PanelLeft,
  PanelRight,
  Pencil,
  SquareTerminal,
  Square,
  StickyNote,
  Trash2,
  X,
} from "lucide-react"
import dynamic from "next/dynamic"
import { createPortal } from "react-dom"
import {
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
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
import NextImage from "next/image"

import { closeBrowserTerminalSession } from "@/components/sandbox-terminal-session"
import type { SettingsSectionId } from "@/components/settings-sections"
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
import { ConfirmDialog } from "@/components/confirm-dialog"
import { MessageBlock } from "@/components/chat-message"
import { NotesEditor } from "@/components/notes-editor"
import { OnboardingChecklist } from "@/components/onboarding-checklist"
import { Button } from "@/components/ui/button"
import { IconButton as UiIconButton } from "@/components/ui/icon-button"
import { MenuItem } from "@/components/ui/menu"
import { menuPanelClass } from "@/components/ui/menu-styles"
import type { FileBrowserOpenMode } from "@/components/file-browser"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useImageUpload } from "@/hooks/use-image-upload"
import { MOBILE_MEDIA_QUERY, useIsMobile } from "@/hooks/use-is-mobile"
import { useStoreUserEffect } from "@/hooks/use-store-user-effect"
import {
  CHAT_IMAGE_ATTACHMENT_MIME_TYPES,
  isChatImageAttachmentMimeType,
  MAX_CHAT_IMAGE_ATTACHMENT_BYTES,
  MAX_CHAT_IMAGE_ATTACHMENTS,
  sanitizeImageAttachmentName,
  type ChatImageAttachment,
} from "@/lib/chat-attachments"
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
import type { CodexAuthOverview } from "@/lib/codex-auth-types"
import { cn } from "@/lib/utils"

const FileBrowser = dynamic(
  () => import("@/components/file-browser").then((mod) => mod.FileBrowser),
  { ssr: false }
)

const loadSandboxTerminalPanel = () =>
  import("@/components/sandbox-terminal").then(
    (mod) => mod.SandboxTerminalPanel
  )

const SandboxTerminalPanel = dynamic(loadSandboxTerminalPanel, { ssr: false })

const GithubPanel = dynamic(
  () => import("@/components/github-panel").then((mod) => mod.GithubPanel),
  { ssr: false }
)

const SandboxDesktopPanel = dynamic(
  () =>
    import("@/components/sandbox-desktop").then(
      (mod) => mod.SandboxDesktopPanel
    ),
  { ssr: false }
)

const SshPanel = dynamic(
  () => import("@/components/ssh-panel").then((mod) => mod.SshPanel),
  { ssr: false }
)

const FileEditorPanel = dynamic(
  () => import("@/components/file-editor").then((mod) => mod.FileEditorPanel),
  { ssr: false }
)

const ChatContextPanel = dynamic(
  () =>
    import("@/components/chat-context-panel").then(
      (mod) => mod.ChatContextPanel
    ),
  { ssr: false }
)

type Role = "user" | "assistant"

type Message = {
  attachments?: ChatImageAttachment[]
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
type SandboxActionResult =
  | { ok: true }
  | { message: string; ok: false; status?: number }

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

type AuthStatus = CodexAuthOverview

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
  notes?: string
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

type DraftImageAttachment = {
  error?: string
  id: string
  kind: "image"
  mimeType: string
  name: string
  objectUrl?: string
  size: number
  status: "ready" | "uploading" | "failed"
  url?: string
}

type QueuedMessage = {
  attachments: ChatImageAttachment[]
  id: string
  text: string
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
const MAX_PREFETCHED_CHANGED_TEXT_FILES = 12
const TEXT_FILE_PREFETCH_CONCURRENCY = 2
const TEXT_FILE_PREFETCH_DELAY_MS = 300
const EMPTY_MESSAGES: Message[] = []
const EMPTY_QUEUED_MESSAGES: QueuedMessage[] = []
const STREAM_TOOL_MARKER_REGEX = /<codex-tool>[\s\S]*?<\/codex-tool>/g
const CHAT_IMAGE_ATTACHMENT_ACCEPT = CHAT_IMAGE_ATTACHMENT_MIME_TYPES.join(",")
const IMAGE_ONLY_PROMPT = "Please inspect the attached image(s)."

function createQueuedMessageId() {
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

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
  const uploadImage = useImageUpload()
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
  const autoSandboxPreset = useMemo(
    () => sandboxPresets.find((preset) => preset.mode === "auto") ?? null,
    [sandboxPresets]
  )
  const viewer = useQuery(api.users.viewer)
  const dismissOnboardingMutation = useMutation(api.users.dismissOnboarding)
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
  const setThreadNotes = useMutation(api.chats.setThreadNotes)
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
  const [resumeBillingNotice, setResumeBillingNotice] = useState<string | null>(
    null
  )
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
  const draftSandboxPresetLoaded = rawPresets !== undefined
  const draftSandboxPresetValid =
    !draftSandboxPresetId ||
    !draftSandboxPresetLoaded ||
    sandboxPresets.some((preset) => preset.id === draftSandboxPresetId)
  const effectiveDraftSandboxPresetId =
    draftSandboxPresetId && draftSandboxPresetValid
      ? draftSandboxPresetId
      : (autoSandboxPreset?.id ?? "")
  const [editingRepo, setEditingRepo] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [presetOpen, setPresetOpen] = useState(false)
  const [thinkingOpen, setThinkingOpen] = useState(false)
  const [filesOpen, setFilesOpen] = useState(false)
  const [githubOpen, setGithubOpen] = useState(false)
  const [desktopOpen, setDesktopOpen] = useState(false)
  const [sshOpen, setSshOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(() =>
    typeof window === "undefined"
      ? false
      : localStorage.getItem(TERMINAL_OPEN_KEY) === "true"
  )
  const [terminalDockMounted, setTerminalDockMounted] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(380)
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null)
  const [activeFileMode, setActiveFileMode] =
    useState<FileBrowserOpenMode>("file")
  const [activeFileDiff, setActiveFileDiff] = useState<string | null>(null)
  const [allDiffsOpen, setAllDiffsOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [diffStyle, setDiffStyle] = useState<"unified" | "split">("unified")
  const [draftAttachments, setDraftAttachments] = useState<
    DraftImageAttachment[]
  >([])
  const [attachmentError, setAttachmentError] = useState("")
  const [attachmentDragActive, setAttachmentDragActive] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window === "undefined"
      ? true
      : !window.matchMedia(MOBILE_MEDIA_QUERY).matches
  )
  const isMobile = useIsMobile()
  const [view, setView] = useState<"chat" | "settings">(() =>
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("view") === "settings"
      ? "settings"
      : "chat"
  )
  const [settingsSection, setSettingsSection] =
    useState<SettingsSectionId>("connections")
  const [runningRunKeys, setRunningRunKeys] = useState<Record<string, true>>({})
  // Messages the user composed while a run was active, keyed by thread id. They
  // flush automatically (FIFO) once the thread's run settles. Held client-side
  // because flushing reuses the full composer send path and its local context.
  const [queuedMessages, setQueuedMessages] = useState<
    Record<string, QueuedMessage[]>
  >({})
  const autoSendingQueueRef = useRef<Set<string>>(new Set())
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
  const cancelRequestedThreadIds = useMemo(() => new Set<string>(), [])
  const queueingRunKeys = useMemo(() => new Set<string>(), [])
  const runningRunKeysSet = useMemo(() => new Set<string>(), [])
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const draftAttachmentObjectUrlsRef = useRef<Set<string>>(new Set())
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

  const cancelPendingThreadScrollRestoreFrame = useCallback(() => {
    if (pendingThreadScrollRestoreFrameRef.current === null) return
    cancelAnimationFrame(pendingThreadScrollRestoreFrameRef.current)
    pendingThreadScrollRestoreFrameRef.current = null
  }, [])

  const captureThreadScrollForPanel = useCallback(() => {
    const el = threadRef.current
    if (!el) return

    cancelPendingThreadScrollRestoreFrame()

    pendingThreadScrollRestoreRef.current = {
      atBottom: isThreadAtBottom(el),
      runKey: activeRunKey,
      scrollTop: el.scrollTop,
    }
  }, [activeRunKey, cancelPendingThreadScrollRestoreFrame, isThreadAtBottom])

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

      cancelPendingThreadScrollRestoreFrame()

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
    [activeRunKey, cancelPendingThreadScrollRestoreFrame]
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
  const readyDraftAttachments = useMemo<ChatImageAttachment[]>(
    () =>
      draftAttachments.flatMap((attachment) =>
        attachment.status === "ready" && attachment.url
          ? [
              {
                id: attachment.id,
                kind: "image",
                mimeType: attachment.mimeType,
                name: attachment.name,
                size: attachment.size,
                url: attachment.url,
              },
            ]
          : []
      ),
    [draftAttachments]
  )
  const uploadingAttachmentCount = draftAttachments.filter(
    (attachment) => attachment.status === "uploading"
  ).length
  const failedAttachmentCount = draftAttachments.filter(
    (attachment) => attachment.status === "failed"
  ).length
  const canStopActiveRun = Boolean(active && activeRunPending)
  const terminalVisible =
    terminalOpen && (Boolean(activeSandboxId) || activeRunPending)
  const threadBottomInset =
    THREAD_BOTTOM_CLEARANCE +
    (terminalVisible
      ? Math.max(composerHeight, DEFAULT_COMPOSER_HEIGHT) + terminalHeight
      : 0)

  useEffect(() => {
    if (terminalVisible) setTerminalDockMounted(true)
  }, [terminalVisible])

  const repoUrl = active ? active.repoUrl : draftRepo
  const baseBranch = active ? (active.baseBranch ?? "") : draftBaseBranch
  const model = active ? active.model : draftModel
  const effectiveDraftBranchMode: BranchMode =
    draftBranchMode === "custom" && !draftBranchName.trim()
      ? "auto"
      : draftBranchMode
  const sandboxPresetId = active
    ? active.sandboxPresetId
    : effectiveDraftSandboxPresetId
  const speed = draftSpeed
  const thinking = draftThinking
  const codexConnected = Boolean(
    authStatus && (authStatus.exists || authStatus.accounts.length > 0)
  )
  const githubUserReady = Boolean(githubStatus?.app?.user.connected)
  const githubAppReady = (githubStatus?.app?.installations.length ?? 0) > 0
  const githubConnected = Boolean(githubStatus?.connected)
  // Statuses must be loaded before deciding anything onboarding-related so
  // fully set up users never see the checklist flash while requests resolve.
  const onboardingStatusReady = authStatus !== null && githubStatus !== null
  const onboardingComplete = codexConnected && githubConnected
  const showOnboarding = Boolean(
    viewer &&
    !viewer.onboardingDismissedAt &&
    onboardingStatusReady &&
    !onboardingComplete
  )
  const empty = messages.length === 0
  const threadScrollable = !isMobile || !empty || showOnboarding
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
      if (paths.length === MAX_PREFETCHED_CHANGED_TEXT_FILES) break
    }
    return paths
  }, [activeDiff])
  const editorDiff = activeFileDiff ?? activeDiff
  const changeStats = useMemo(
    () => getDiffStats(activeDiff ?? undefined),
    [activeDiff]
  )
  const activeBranch = useMemo(
    () =>
      active
        ? (active.messages.toReversed().find((m) => m.meta?.branch)?.meta
            ?.branch ?? null)
        : null,
    [active]
  )
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
      setNotesOpen(false)
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
      setNotesOpen(false)
    },
    [captureThreadScrollForPanel]
  )

  const openAllDiffs = useCallback(() => {
    captureThreadScrollForPanel()
    setActiveFilePath(null)
    setActiveFileDiff(null)
    setAllDiffsOpen(true)
    setNotesOpen(false)
  }, [captureThreadScrollForPanel])

  const openNotesFullscreen = useCallback(() => {
    captureThreadScrollForPanel()
    setActiveFilePath(null)
    setActiveFileDiff(null)
    setAllDiffsOpen(false)
    setNotesOpen(true)
    setContextOpen(false)
  }, [captureThreadScrollForPanel])

  const saveThreadNotes = useCallback(
    (value: string) => {
      if (!activeId) return
      void setThreadNotes({ notes: value, threadId: activeId }).catch((error) =>
        console.warn("Unable to save notes.", error)
      )
    },
    [activeId, setThreadNotes]
  )

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

  const refreshCodexAuth = useCallback(async () => {
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
  }, [])
  const refreshGitHubAuthRef = useRef(refreshGitHubAuth)
  const refreshCodexAuthRef = useRef(refreshCodexAuth)

  useEffect(() => {
    refreshGitHubAuthRef.current = refreshGitHubAuth
    refreshCodexAuthRef.current = refreshCodexAuth
  }, [refreshCodexAuth, refreshGitHubAuth])

  useEffect(() => {
    if (userLoading) return

    function refreshConnections() {
      void Promise.all([
        refreshCodexAuthRef.current(),
        refreshGitHubAuthRef.current(),
      ])
    }

    refreshConnections()
    window.addEventListener("focus", refreshConnections)
    return () => window.removeEventListener("focus", refreshConnections)
  }, [userLoading])

  useEffect(() => {
    if (userLoading) return
    void ensureDefaultPresets().catch((error) => {
      console.warn("Unable to ensure default presets.", error)
    })
  }, [ensureDefaultPresets, userLoading])

  const dismissOnboarding = useCallback(() => {
    void dismissOnboardingMutation().catch((error) => {
      console.warn("Unable to dismiss onboarding.", error)
    })
  }, [dismissOnboardingMutation])

  // Once every setup step is verifiably complete, retire onboarding for good
  // so it never resurfaces after a disconnect or on another device.
  useEffect(() => {
    if (!viewer || viewer.onboardingDismissedAt) return
    if (!onboardingStatusReady || !onboardingComplete) return
    dismissOnboarding()
  }, [dismissOnboarding, onboardingComplete, onboardingStatusReady, viewer])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (autoPresetDefaultedRef.current) return
    if (localStorage.getItem(PRESET_KEY) !== null || draftSandboxPresetId) {
      autoPresetDefaultedRef.current = true
      return
    }

    if (!autoSandboxPreset) return
    autoPresetDefaultedRef.current = true
    setDraftSandboxPresetId(autoSandboxPreset.id)
    localStorage.setItem(PRESET_KEY, autoSandboxPreset.id)
  }, [autoSandboxPreset, draftSandboxPresetId])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!draftSandboxPresetId || !draftSandboxPresetLoaded) return
    if (draftSandboxPresetValid) return
    if (!autoSandboxPreset) return

    setDraftSandboxPresetId(autoSandboxPreset.id)
    localStorage.setItem(PRESET_KEY, autoSandboxPreset.id)
  }, [
    autoSandboxPreset,
    draftSandboxPresetId,
    draftSandboxPresetLoaded,
    draftSandboxPresetValid,
  ])

  useEffect(
    () => () => {
      for (const url of draftAttachmentObjectUrlsRef.current) {
        URL.revokeObjectURL(url)
      }
      draftAttachmentObjectUrlsRef.current.clear()
    },
    []
  )

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
        queueingRunKeys.has(key) ||
        key === liveThreadKey ||
        Boolean(chat.pending) ||
        chat.messages.some((message) => message.pending)

      if (!stillRunning && nextKeys[key]) {
        delete nextKeys[key]
        cancelRequestedThreadIds.delete(key)
        queueingRunKeys.delete(key)
        runningRunKeysSet.delete(key)
        changed = true
      }
    }

    if (changed) setRunningRunKeys(nextKeys)
  }, [
    cancelRequestedThreadIds,
    chats,
    queueingRunKeys,
    runningRunKeys,
    runningRunKeysSet,
    visibleLiveRun?.threadId,
  ])

  // Flush the next queued message for the open thread once its run settles. One
  // message goes out at a time; each send marks the thread active again, which
  // re-arms this effect for the remaining items (FIFO). The ref guards against
  // re-entry during the async gap before the run is marked active.
  useEffect(() => {
    if (!activeId) return
    const threadKey = activeId as string
    const queue = queuedMessages[threadKey]
    if (!queue || queue.length === 0) return
    if (activeRunPending || queueingRunKeys.has(threadKey)) return
    if (autoSendingQueueRef.current.has(threadKey)) return
    const next = queue[0]
    autoSendingQueueRef.current.add(threadKey)
    setQueuedMessages((current) => {
      const list = current[threadKey]
      if (!list) return current
      const rest = list.slice(1)
      if (rest.length === 0) {
        const updated = { ...current }
        delete updated[threadKey]
        return updated
      }
      return { ...current, [threadKey]: rest }
    })
    void sendRef
      .current(next.text, {
        attachments: next.attachments,
        fromQueue: true,
      })
      .finally(() => {
        autoSendingQueueRef.current.delete(threadKey)
      })
  }, [activeId, activeRunPending, queueingRunKeys, queuedMessages])

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

    const timeout = window.setTimeout(() => {
      for (
        let i = 0;
        i < Math.min(TEXT_FILE_PREFETCH_CONCURRENCY, queue.length);
        i += 1
      ) {
        void worker()
      }
    }, TEXT_FILE_PREFETCH_DELAY_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [
    activeChangedTextPaths,
    activeDiffKey,
    activeFileCacheScope,
    activeSandboxId,
  ])

  useLayoutEffect(() => {
    if (isMobile && empty) return
    cancelPendingThreadScrollRestoreFrame()
    pendingThreadScrollRestoreRef.current = null
    setActiveFileDiff(null)
    settleThreadAtBottom()
  }, [
    activeId,
    cancelPendingThreadScrollRestoreFrame,
    empty,
    isMobile,
    settleThreadAtBottom,
  ])

  useEffect(
    () => cancelPendingThreadScrollRestoreFrame,
    [cancelPendingThreadScrollRestoreFrame]
  )

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
    runningRunKeysSet.add(runKey)
    setRunningRunKeys((current) => ({ ...current, [runKey]: true }))
  }

  function showOptimisticRun(
    runKey: string,
    prompt: string,
    attachments: ChatImageAttachment[],
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
            ...(attachments.length ? { attachments } : {}),
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

    if (queueingRunKeys.has(previousKey)) {
      queueingRunKeys.delete(previousKey)
      queueingRunKeys.add(nextKey)
    }
    runningRunKeysSet.delete(previousKey)
    runningRunKeysSet.add(nextKey)
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
    queueingRunKeys.delete(runKey)
    runningRunKeysSet.delete(runKey)
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

  function clearDraftAttachments() {
    for (const attachment of draftAttachments) {
      if (attachment.objectUrl) {
        URL.revokeObjectURL(attachment.objectUrl)
        draftAttachmentObjectUrlsRef.current.delete(attachment.objectUrl)
      }
    }
    setDraftAttachments([])
    setAttachmentError("")
    setAttachmentDragActive(false)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function removeDraftAttachment(id: string) {
    setDraftAttachments((current) => {
      const removed = current.find((attachment) => attachment.id === id)
      if (removed?.objectUrl) {
        URL.revokeObjectURL(removed.objectUrl)
        draftAttachmentObjectUrlsRef.current.delete(removed.objectUrl)
      }
      return current.filter((attachment) => attachment.id !== id)
    })
    setAttachmentError("")
  }

  function addImageFiles(files: File[]) {
    if (files.length === 0) return

    setAttachmentError("")
    const openSlots = MAX_CHAT_IMAGE_ATTACHMENTS - draftAttachments.length
    if (openSlots <= 0) {
      setAttachmentError(
        `You can attach up to ${MAX_CHAT_IMAGE_ATTACHMENTS} images.`
      )
      return
    }

    const accepted: File[] = []
    for (const file of files) {
      if (accepted.length >= openSlots) break
      if (!isChatImageAttachmentMimeType(file.type)) {
        setAttachmentError(
          "Only PNG, JPEG, GIF, and WebP images are supported."
        )
        continue
      }
      if (file.size > MAX_CHAT_IMAGE_ATTACHMENT_BYTES) {
        setAttachmentError("Each image must be 10 MB or smaller.")
        continue
      }
      accepted.push(file)
    }

    if (files.length > openSlots) {
      setAttachmentError(
        `Only ${openSlots} more image${openSlots === 1 ? "" : "s"} can be attached.`
      )
    }
    if (accepted.length === 0) return

    const pending = accepted.map((file) => {
      const objectUrl = URL.createObjectURL(file)
      draftAttachmentObjectUrlsRef.current.add(objectUrl)
      return {
        id: crypto.randomUUID(),
        kind: "image" as const,
        mimeType: file.type,
        name: sanitizeImageAttachmentName(file.name),
        objectUrl,
        size: file.size,
        status: "uploading" as const,
      }
    })

    setDraftAttachments((current) => [...current, ...pending])

    pending.forEach((attachment, index) => {
      const file = accepted[index]
      uploadImage(file)
        .then((url) => {
          setDraftAttachments((current) =>
            current.map((candidate) => {
              if (candidate.id !== attachment.id) return candidate
              if (candidate.objectUrl) {
                URL.revokeObjectURL(candidate.objectUrl)
                draftAttachmentObjectUrlsRef.current.delete(candidate.objectUrl)
              }
              return {
                ...candidate,
                objectUrl: undefined,
                status: "ready",
                url,
              }
            })
          )
        })
        .catch((error) => {
          setDraftAttachments((current) =>
            current.map((candidate) => {
              if (candidate.id !== attachment.id) return candidate
              return {
                ...candidate,
                error:
                  error instanceof Error ? error.message : "Upload failed.",
                status: "failed",
              }
            })
          )
        })
    })
  }

  function onAttachClick() {
    fileInputRef.current?.click()
  }

  function onAttachmentInputChange(event: ChangeEvent<HTMLInputElement>) {
    addImageFiles(Array.from(event.target.files ?? []))
    event.target.value = ""
  }

  function startNewChat() {
    promptFocusedRef.current = false
    setActiveId(null)
    setInput("")
    clearDraftAttachments()
    setEditingRepo(false)
    setActiveFilePath(null)
    setFilesOpen(false)
    setGithubOpen(false)
    setDesktopOpen(false)
    setSshOpen(false)
    setContextOpen(false)
    setNotesOpen(false)
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
    clearDraftAttachments()
    setEditingRepo(false)
    setActiveFilePath(null)
    setFilesOpen(false)
    setGithubOpen(false)
    setDesktopOpen(false)
    setSshOpen(false)
    setContextOpen(false)
    setNotesOpen(false)
    setTerminalOpen(false)
    setView("chat")
    if (isMobile) setSidebarOpen(false)
  }

  function showSettings(section?: SettingsSectionId) {
    promptFocusedRef.current = false
    if (section) setSettingsSection(section)
    setView("settings")
    clearDraftAttachments()
    setActiveFilePath(null)
    setFilesOpen(false)
    setGithubOpen(false)
    setDesktopOpen(false)
    setSshOpen(false)
    setContextOpen(false)
    setNotesOpen(false)
    setTerminalOpen(false)
    if (isMobile) setSidebarOpen(false)
  }

  function exitSettings() {
    setView("chat")
  }

  function selectSettingsSection(section: SettingsSectionId) {
    setSettingsSection(section)
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
      clearQueuedMessages(id as string)
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
          setGithubOpen(false)
          setDesktopOpen(false)
          setSshOpen(false)
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

  async function send(
    prompt: string,
    options?: { attachments?: ChatImageAttachment[]; fromQueue?: boolean }
  ) {
    const trimmed = prompt.trim()
    const fromQueue = options?.fromQueue ?? false
    const attachments = options?.attachments ?? readyDraftAttachments
    const runPrompt = trimmed || IMAGE_ONLY_PROMPT
    const initialRunKey = activeId ? (activeId as string) : DRAFT_RUN_KEY
    if ((!trimmed && attachments.length === 0) || userLoading) {
      return
    }
    // A run is already in flight for the open thread: queue the message and let
    // it flush once the run settles instead of silently dropping it.
    if (!fromQueue && activeId && activeRunPending) {
      if (uploadingAttachmentCount > 0) {
        setAttachmentError("Wait for image uploads to finish before sending.")
        return
      }
      if (failedAttachmentCount > 0) {
        setAttachmentError("Remove failed image uploads before sending.")
        return
      }
      enqueueMessage(activeId as string, trimmed, attachments)
      setInput("")
      setDraftAttachments([])
      setAttachmentError("")
      return
    }
    if (
      runningRunKeysSet.has(initialRunKey) ||
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
    if (uploadingAttachmentCount > 0) {
      setAttachmentError("Wait for image uploads to finish before sending.")
      return
    }
    if (failedAttachmentCount > 0) {
      setAttachmentError("Remove failed image uploads before sending.")
      return
    }
    const codexProfile = authStatus.activeProfile || authStatus.profile

    let chatId = active?.id ?? null
    let assistantMessageId: Id<"messages"> | null = null
    let runKey = initialRunKey
    let queued = false

    // When flushing the queue the composer holds whatever the user is typing
    // next, so only clear it for a direct send.
    if (!fromQueue) {
      setInput("")
      setDraftAttachments([])
      setAttachmentError("")
    }

    queueingRunKeys.add(runKey)
    markRunActive(runKey)
    showOptimisticRun(
      runKey,
      trimmed,
      attachments,
      active?.messages.length ?? 0,
      draftSpeed,
      draftThinking
    )

    try {
      const runSandboxPresetId =
        active?.sandboxPresetId ?? effectiveDraftSandboxPresetId
      if (!chatId) {
        const trimmedBaseBranch = draftBaseBranch.trim()
        const created = await createThread({
          attachments: attachments.length ? attachments : undefined,
          baseBranch: trimmedBaseBranch || undefined,
          branchMode: effectiveDraftBranchMode,
          model: draftModel,
          prompt: trimmed,
          repoUrl: repoUrl.trim(),
          sandboxPresetId: runSandboxPresetId || undefined,
          speed: draftSpeed,
          thinking: draftThinking,
          title:
            trimmed.split("\n")[0].slice(0, 60) ||
            attachments[0]?.name ||
            "Image request",
        })
        chatId = created.threadId
        assistantMessageId = created.assistantMessageId
        runKey = transferRunKey(runKey, chatId as string)
        setActiveId(chatId)
      } else {
        const appended = await appendRunMessages({
          attachments: attachments.length ? attachments : undefined,
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
          profile: codexProfile,
          imageAttachments: attachments.length ? attachments : undefined,
          prompt: runPrompt,
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
      if (cancelRequestedThreadIds.has(chatId as string)) {
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
      queueingRunKeys.delete(runKey)
      if (!queued) {
        cancelRequestedThreadIds.delete(runKey)
        clearRunKey(runKey)
      }
    }
  }

  // Keep the latest `send` reachable from the queue-flush effect without
  // listing the freshly-recreated function as an effect dependency.
  const sendRef = useRef(send)
  sendRef.current = send

  async function cancelCodexRun(threadId: Id<"threads">) {
    const key = threadId as string
    cancelRequestedThreadIds.add(key)
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

  function enqueueMessage(
    threadKey: string,
    text: string,
    attachments: ChatImageAttachment[]
  ) {
    setQueuedMessages((current) => {
      const list = current[threadKey] ?? []
      return {
        ...current,
        [threadKey]: [
          ...list,
          { attachments, id: createQueuedMessageId(), text },
        ],
      }
    })
  }

  function removeQueuedMessage(threadKey: string, id: string) {
    setQueuedMessages((current) => {
      const list = current[threadKey]
      if (!list) return current
      const rest = list.filter((message) => message.id !== id)
      if (rest.length === list.length) return current
      if (rest.length === 0) {
        const next = { ...current }
        delete next[threadKey]
        return next
      }
      return { ...current, [threadKey]: rest }
    })
  }

  function clearQueuedMessages(threadKey: string) {
    setQueuedMessages((current) => {
      if (!current[threadKey]) return current
      const next = { ...current }
      delete next[threadKey]
      return next
    })
  }

  // Pull a queued message back into the composer so the user can revise it.
  function editQueuedMessage(threadKey: string, id: string) {
    const target = queuedMessages[threadKey]?.find(
      (message) => message.id === id
    )
    if (!target) return
    removeQueuedMessage(threadKey, id)
    setInput(target.text)
    if (target.attachments.length) {
      setDraftAttachments((current) => [
        ...current,
        ...target.attachments.map((attachment) => ({
          ...attachment,
          status: "ready" as const,
        })),
      ])
    }
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  // Interrupt the active run and send this message next. Moving it to the front
  // of the queue means the auto-flush effect picks it up first once the run
  // settles from the cancellation.
  function steerQueuedMessage(threadKey: string, id: string) {
    setQueuedMessages((current) => {
      const list = current[threadKey]
      if (!list) return current
      const target = list.find((message) => message.id === id)
      if (!target) return current
      return {
        ...current,
        [threadKey]: [target, ...list.filter((message) => message.id !== id)],
      }
    })
    if (active && (active.id as string) === threadKey && activeRunPending) {
      void cancelCodexRun(active.id)
    }
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
  ): Promise<SandboxActionResult> {
    if (!active || !activeSandboxId || sandboxAction) {
      return { message: `Unable to ${action} sandbox.`, ok: false }
    }

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
      const data = (await res.json().catch(() => null)) as {
        error?: unknown
        sandboxId?: unknown
        state?: unknown
      } | null
      if (!res.ok) {
        const message =
          typeof data === "object" &&
          data &&
          "error" in data &&
          typeof data.error === "string"
            ? data.error
            : `Failed to ${action} sandbox.`
        console.warn(`Failed to ${action} sandbox.`, message)
        return {
          message,
          ok: false,
          status: res.status,
        }
      }

      await persistSandboxState(
        threadId,
        typeof data?.sandboxId === "string" ? data.sandboxId : sandboxId,
        normalizeSandboxActionState(data?.state, fallbackState)
      )
      return { ok: true }
    } catch (error) {
      console.warn(`Failed to ${action} sandbox.`, error)
      return {
        message:
          error instanceof Error
            ? error.message
            : `Failed to ${action} sandbox.`,
        ok: false,
      }
    } finally {
      setSandboxAction(null)
    }
  }

  function pauseActiveSandbox() {
    setDesktopOpen(false)
    setSshOpen(false)
    void runSandboxAction("pause", "/api/sandbox/pause", "stopped")
  }

  function resumeActiveSandbox() {
    void (async () => {
      const result = await runSandboxAction(
        "resume",
        "/api/sandbox/resume",
        "running"
      )
      if (!result.ok && result.status === 402) {
        setResumeBillingNotice(
          "You need available billing credits to resume this Daytona sandbox."
        )
      }
    })()
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
    setDesktopOpen(false)
    setSshOpen(false)

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
        setGithubOpen(false)
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
    setDesktopOpen(false)
    setSshOpen(false)

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

  function onComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith("image/")
    )
    if (files.length === 0) return
    event.preventDefault()
    addImageFiles(files)
  }

  function onComposerDragOver(event: DragEvent<HTMLFormElement>) {
    if (
      !Array.from(event.dataTransfer.items).some((item) => item.kind === "file")
    ) {
      return
    }
    event.preventDefault()
    setAttachmentDragActive(true)
  }

  function onComposerDragLeave(event: DragEvent<HTMLFormElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setAttachmentDragActive(false)
  }

  function onComposerDrop(event: DragEvent<HTMLFormElement>) {
    const files = Array.from(event.dataTransfer.files).filter((file) =>
      file.type.startsWith("image/")
    )
    if (files.length === 0) return
    event.preventDefault()
    setAttachmentDragActive(false)
    addImageFiles(files)
  }

  const preloadTerminalPanel = useCallback(() => {
    void loadSandboxTerminalPanel()
  }, [])

  const toggleTerminal = useCallback(() => {
    void loadSandboxTerminalPanel()
    setTerminalOpen((value) => !value)
  }, [])

  const activeQueuedMessages = activeId
    ? (queuedMessages[activeId as string] ?? EMPTY_QUEUED_MESSAGES)
    : EMPTY_QUEUED_MESSAGES
  const composerBlock =
    view === "settings" || activeFilePath || notesOpen ? null : (
      <div className="pointer-events-auto w-full max-w-3xl rounded-3xl">
        {activeQueuedMessages.length > 0 && activeId ? (
          <div className="mb-2 flex flex-col gap-1.5">
            {activeQueuedMessages.map((queued) => {
              const label =
                queued.text.trim() ||
                (queued.attachments.length
                  ? `${queued.attachments.length} image${
                      queued.attachments.length > 1 ? "s" : ""
                    }`
                  : "Queued message")
              return (
                <div
                  key={queued.id}
                  className="flex items-center gap-1.5 rounded-2xl border border-field/70 bg-background px-3 py-1.5"
                >
                  <CornerDownRight className="size-4 shrink-0 text-muted-foreground/70" />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {label}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      steerQueuedMessage(activeId as string, queued.id)
                    }
                    title="Interrupt the running task and send this now"
                    className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <CornerDownRight className="size-3.5" />
                    Steer
                  </button>
                  <IconButton
                    onClick={() =>
                      editQueuedMessage(activeId as string, queued.id)
                    }
                    aria-label="Edit queued message"
                    title="Edit"
                  >
                    <Pencil className="size-4" />
                  </IconButton>
                  <IconButton
                    onClick={() =>
                      removeQueuedMessage(activeId as string, queued.id)
                    }
                    aria-label="Delete queued message"
                    title="Delete"
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              )
            })}
          </div>
        ) : null}
        <form
          onSubmit={onSubmit}
          onDragOver={onComposerDragOver}
          onDragLeave={onComposerDragLeave}
          onDrop={onComposerDrop}
          className={cn(
            "relative z-[1] w-full rounded-3xl border border-field/70 bg-background transition-colors focus-within:border-border",
            attachmentDragActive && "border-border bg-muted/35"
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            aria-label="Attach images"
            accept={CHAT_IMAGE_ATTACHMENT_ACCEPT}
            multiple
            className="sr-only"
            onChange={onAttachmentInputChange}
          />
          {draftAttachments.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto px-3 pt-3 pb-1 md:px-4">
              {draftAttachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-border/70 bg-muted"
                  title={attachment.name}
                >
                  {attachment.objectUrl || attachment.url ? (
                    <NextImage
                      src={(attachment.objectUrl ?? attachment.url)!}
                      alt={attachment.name}
                      fill
                      unoptimized
                      sizes="64px"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center">
                      <ImagePlus className="size-5 text-muted-foreground" />
                    </div>
                  )}
                  {attachment.status === "uploading" ? (
                    <div className="absolute inset-0 grid place-items-center bg-background/65">
                      <Loader2 className="size-4 animate-spin" />
                    </div>
                  ) : null}
                  {attachment.status === "failed" ? (
                    <div className="text-destructive-foreground absolute inset-0 grid place-items-center bg-destructive/85 px-1 text-center text-[10px] leading-3">
                      Failed
                    </div>
                  ) : null}
                  <button
                    type="button"
                    aria-label={`Remove ${attachment.name}`}
                    title="Remove image"
                    onClick={() => removeDraftAttachment(attachment.id)}
                    className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-background/90 text-foreground opacity-100 shadow-sm md:opacity-0 md:transition-opacity md:group-hover:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {attachmentError ? (
            <div className="px-4 pt-2 text-xs text-destructive">
              {attachmentError}
            </div>
          ) : null}
          <textarea
            ref={textareaRef}
            value={input}
            aria-label="Message"
            autoComplete="off"
            name="message"
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
              setInput(e.target.value)
            }
            onPaste={onComposerPaste}
            onKeyDown={onKeyDown}
            onFocus={onTextareaFocus}
            onBlur={onTextareaBlur}
            rows={1}
            placeholder={empty ? "Ask anything…" : "Ask for follow-up changes"}
            enterKeyHint={isMobile ? "enter" : "send"}
            className="block min-h-16 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base leading-6 outline-none placeholder:text-muted-foreground/70 md:min-h-20 md:px-5 md:pt-4 md:text-[15px]"
          />

          <div className="flex items-center gap-1.5 px-2.5 pt-1 pb-2.5">
            <IconButton
              type="button"
              aria-label="Attach images"
              title="Attach images"
              onClick={onAttachClick}
              disabled={draftAttachments.length >= MAX_CHAT_IMAGE_ATTACHMENTS}
              className="grid"
            >
              <ImagePlus className="size-[18px]" />
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
                  className="size-9 rounded-full md:size-8"
                >
                  <Square className="size-3.5 fill-current" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon-sm"
                  disabled={
                    (!input.trim() && readyDraftAttachments.length === 0) ||
                    uploadingAttachmentCount > 0
                  }
                  aria-label="Send"
                  className="size-9 rounded-full md:size-8"
                >
                  <ArrowUp className="size-4" strokeWidth={2.4} />
                </Button>
              )}
            </div>
          </div>
        </form>

        {active ? null : (
          <div className="-mt-3 flex flex-col items-stretch gap-1 rounded-b-3xl border border-t-0 border-field/60 bg-muted/40 px-2.5 pt-5 pb-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-1 sm:gap-y-0.5 sm:px-3 sm:pb-2">
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
          onShowSettings={() => showSettings()}
          onExitSettings={exitSettings}
          settingsSection={settingsSection}
          onSelectSettingsSection={selectSettingsSection}
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

      {resumeBillingNotice ? (
        <ConfirmDialog
          title="No credits remaining"
          description={resumeBillingNotice}
          cancelLabel="Close"
          confirmLabel="Open settings"
          confirmWhite
          onCancel={() => setResumeBillingNotice(null)}
          onConfirm={() => {
            setResumeBillingNotice(null)
            showSettings("billing")
          }}
        />
      ) : null}

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          identity={{
            isNew: view !== "settings" && !active,
            repoUrl: view === "settings" ? "" : repoUrl,
            title: view === "settings" ? "Settings" : (active?.title ?? null),
          }}
          sandbox={{
            action: sandboxAction,
            id: view === "settings" ? null : activeSandboxId,
            onDelete: requestDeleteActiveSandbox,
            onMissing: handleSandboxMissing,
            onPause: pauseActiveSandbox,
            onResume: resumeActiveSandbox,
            onStateChange: handleSandboxStateChange,
            pending: view !== "settings" && activeRunPending,
            showControls:
              view !== "settings" &&
              (Boolean(active) || activeRunPending || Boolean(activeSandboxId)),
            state: activeSandboxState,
          }}
          tools={{
            context: {
              canOpen: view !== "settings" && Boolean(active),
              onToggle: () =>
                setContextOpen((v) => {
                  if (!v) {
                    setFilesOpen(false)
                    setGithubOpen(false)
                    setDesktopOpen(false)
                    setSshOpen(false)
                  }
                  return !v
                }),
              open: contextOpen,
            },
            desktop: {
              canOpen: view !== "settings" && Boolean(activeSandboxId),
              onToggle: () =>
                setDesktopOpen((v) => {
                  if (!v) {
                    setFilesOpen(false)
                    setGithubOpen(false)
                    setSshOpen(false)
                    setContextOpen(false)
                  }
                  return !v
                }),
              open: desktopOpen,
            },
            files: {
              canOpen: view !== "settings" && Boolean(activeFileCacheScope),
              onToggle: () =>
                setFilesOpen((v) => {
                  if (!v) {
                    setGithubOpen(false)
                    setDesktopOpen(false)
                    setSshOpen(false)
                    setContextOpen(false)
                  }
                  return !v
                }),
              open: filesOpen,
            },
            github: {
              canOpen: view !== "settings" && Boolean(activeSandboxId),
              onToggle: () =>
                setGithubOpen((v) => {
                  if (!v) {
                    setFilesOpen(false)
                    setDesktopOpen(false)
                    setSshOpen(false)
                    setContextOpen(false)
                  }
                  return !v
                }),
              open: githubOpen,
            },
            ssh: {
              canOpen: view !== "settings" && Boolean(activeSandboxId),
              onToggle: () =>
                setSshOpen((v) => {
                  if (!v) {
                    setFilesOpen(false)
                    setGithubOpen(false)
                    setDesktopOpen(false)
                    setContextOpen(false)
                  }
                  return !v
                }),
              open: sshOpen,
            },
            terminal: {
              onPreload: preloadTerminalPanel,
              onToggle: toggleTerminal,
              open: terminalVisible,
            },
          }}
          sidebar={{
            onToggle: () => setSidebarOpen((v) => !v),
            open: sidebarOpen,
          }}
        />
        {view === "settings" ? (
          <SettingsScreen
            section={settingsSection}
            authStatus={authStatus}
            authError={authError}
            githubStatus={githubStatus}
            githubAuthError={githubAuthError}
            onCodexAuthChanged={refreshCodexAuth}
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
            ) : notesOpen ? (
              <NotesPanel
                notes={active?.notes ?? ""}
                notesThreadId={activeId as string | null}
                onSave={saveThreadNotes}
                onClose={() => setNotesOpen(false)}
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
                        {showOnboarding
                          ? userFirstName
                            ? `Let’s set you up, ${userFirstName}`
                            : "Let’s set you up"
                          : emptyPromptTitle}
                      </h1>
                      {showOnboarding ? (
                        <div className="mt-10 flex w-full justify-center md:mt-8">
                          <OnboardingChecklist
                            codexConnected={codexConnected}
                            githubAppReady={githubAppReady}
                            githubConnected={githubConnected}
                            githubUserReady={githubUserReady}
                            onDismiss={dismissOnboarding}
                          />
                        </div>
                      ) : (
                        <div
                          ref={composerRef}
                          className="mt-10 flex w-full justify-center md:mt-8"
                        >
                          {composerBlock}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mx-auto w-full max-w-2xl space-y-6 md:space-y-8">
                      {messages.map((m) => (
                        <MessageBlock
                          key={m.id}
                          message={m}
                          repoName={activeRepoName}
                          sandboxId={activeSandboxId}
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

            {terminalDockMounted ? (
              <SandboxTerminalPanel
                open={terminalVisible}
                sandboxId={activeSandboxId}
                onClose={() => setTerminalOpen(false)}
                height={terminalHeight}
                onHeightChange={setTerminalHeight}
              />
            ) : null}

            {composerBlock && !empty ? (
              terminalVisible ? (
                <div
                  ref={composerRef}
                  className={cn(
                    "pointer-events-none absolute inset-x-0 z-10 flex justify-center bg-background px-3 pt-3 pb-4 md:px-4 md:pb-6",
                    (activeFilePath || allDiffsOpen || notesOpen) && "hidden"
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
          setNotesOpen(false)
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
          setNotesOpen(false)
          if (isMobile) setGithubOpen(false)
        }}
      />
      <SandboxDesktopPanel
        key={`desktop:${activeSandboxId ?? "no-sandbox"}`}
        open={desktopOpen && Boolean(activeSandboxId)}
        sandboxId={activeSandboxId}
        onClose={() => setDesktopOpen(false)}
      />
      <SshPanel
        key={`ssh:${activeSandboxId ?? "no-sandbox"}`}
        open={sshOpen && Boolean(activeSandboxId)}
        sandboxId={activeSandboxId}
        onClose={() => setSshOpen(false)}
      />
      <ChatContextPanel
        open={contextOpen && Boolean(active)}
        environment={{
          additions: changeStats.additions,
          baseBranch,
          branch: activeBranch,
          changedFileCount: changeStats.files.length,
          deletions: changeStats.deletions,
          repoName: activeRepoName,
        }}
        notes={active?.notes ?? ""}
        notesThreadId={activeId as string | null}
        onClose={() => setContextOpen(false)}
        onSaveNotes={saveThreadNotes}
        onOpenChanges={openAllDiffs}
        onOpenNotesFullscreen={openNotesFullscreen}
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
        <UiIconButton
          onClick={onClose}
          aria-label="Close diffs"
          className="-mr-[7px]"
        >
          <X />
        </UiIconButton>
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

function NotesPanel({
  notes,
  notesThreadId,
  onSave,
  onClose,
}: {
  notes: string
  notesThreadId: string | null
  onSave: (value: string) => void
  onClose: () => void
}) {
  const toolbarTrailing = useMemo(
    () => (
      <UiIconButton onClick={onClose} aria-label="Close notes">
        <X />
      </UiIconButton>
    ),
    [onClose]
  )

  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <NotesEditor
        bare
        toolbarPlacement="top"
        toolbarClassName="h-[3.25rem] shrink-0 gap-0.5 bg-background/80 px-2.5 backdrop-blur-xl"
        toolbarTrailing={toolbarTrailing}
        notes={notes}
        notesThreadId={notesThreadId}
        onSave={onSave}
        contentClassName="min-h-0 flex-1 px-4 py-4"
      />
    </section>
  )
}

function SignedOutScreen() {
  return (
    <div className="fixed inset-x-0 top-0 flex h-[100dvh] overflow-hidden bg-background px-6 text-foreground">
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="w-full max-w-sm text-center">
          <h1
            className={cn(
              "text-3xl tracking-tight text-foreground/90",
              GeistPixelSquare.className
            )}
          >
            Cloudcode
          </h1>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            A cloud workspace for Codex. Connect a repository, describe a
            change, and review the branches it ships from an isolated sandbox.
          </p>
          <SignInButton mode="modal">
            <Button type="button" size="lg" className="mt-6">
              Sign in
            </Button>
          </SignInButton>
          <p className="mt-4 text-xs leading-5 text-muted-foreground/80">
            Signing in keeps threads and Codex auth attached to your profile.
          </p>
        </div>
      </div>
    </div>
  )
}

type TopBarIdentity = {
  title: string | null
  repoUrl: string
  isNew: boolean
}

type TopBarSandbox = {
  action: SandboxAction | null
  id: string | null
  onDelete: () => void
  onMissing: (sandboxId: string) => void
  onPause: () => void
  onResume: () => void
  onStateChange: (state: SandboxState, sandboxId: string) => void
  pending: boolean
  showControls: boolean
  state?: SandboxState
}

type TopBarToolControl = {
  canOpen: boolean
  onToggle: () => void
  open: boolean
}

type TopBarTools = {
  context: TopBarToolControl
  desktop: TopBarToolControl
  files: TopBarToolControl
  github: TopBarToolControl
  ssh: TopBarToolControl
  terminal: {
    onPreload: () => void
    onToggle: () => void
    open: boolean
  }
}

function TopBar({
  identity,
  sandbox,
  sidebar,
  tools,
}: {
  identity: TopBarIdentity
  sandbox: TopBarSandbox
  sidebar: {
    onToggle: () => void
    open: boolean
  }
  tools: TopBarTools
}) {
  const { isNew, repoUrl, title } = identity
  const {
    action: sandboxAction,
    id: sandboxId,
    onDelete: onDeleteSandbox,
    onMissing: onSandboxMissing,
    onPause: onPauseSandbox,
    onResume: onResumeSandbox,
    onStateChange: onSandboxStateChange,
    pending: sandboxPending,
    showControls: showSandboxControls,
    state: sandboxState,
  } = sandbox
  const { context, desktop, files, github, ssh, terminal } = tools
  const { onToggle: onToggleSidebar, open: sidebarOpen } = sidebar

  const filesOpen = files.open
  const canOpenFiles = files.canOpen
  const onToggleFiles = files.onToggle
  const githubOpen = github.open
  const canOpenGithub = github.canOpen
  const onToggleGithub = github.onToggle
  const desktopOpen = desktop.open
  const canOpenDesktop = desktop.canOpen
  const onToggleDesktop = desktop.onToggle
  const sshOpen = ssh.open
  const canOpenSsh = ssh.canOpen
  const onToggleSsh = ssh.onToggle
  const contextOpen = context.open
  const canOpenContext = context.canOpen
  const onToggleContext = context.onToggle
  const terminalOpen = terminal.open
  const onPreloadTerminal = terminal.onPreload
  const onToggleTerminal = terminal.onToggle

  const fullTitle = title?.trim() || (isNew ? "New chat" : "Untitled")
  const displayTitle = limitThreadDisplayTitle(fullTitle)
  const repo = repoUrl ? repoLabel(repoUrl) : ""
  const showSandboxSection =
    showSandboxControls || Boolean(sandboxId || sandboxPending)
  const showToolsSection =
    showSandboxSection || Boolean(sandboxId || canOpenFiles) || canOpenContext

  return (
    <header className="flex h-[calc(3.25rem+env(safe-area-inset-top))] shrink-0 items-center gap-2.5 border-b border-border/60 bg-background/80 pt-[env(safe-area-inset-top)] pr-3 pl-2 backdrop-blur-xl">
      <UiIconButton
        onClick={onToggleSidebar}
        aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        className="size-9 md:size-7"
      >
        <PanelLeft className="size-3.5" />
      </UiIconButton>
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
          <div className="flex items-center gap-0.5">
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
              onClick={onToggleContext}
              active={contextOpen}
              disabled={!canOpenContext}
              label={contextOpen ? "Hide context panel" : "Show context panel"}
            >
              <StickyNote className="size-3.5" />
            </TopBarIconButton>
            <TopBarToolsMenu
              sandboxId={sandboxId}
              sandboxPending={sandboxPending}
              terminalOpen={terminalOpen}
              onPreloadTerminal={onPreloadTerminal}
              onToggleTerminal={onToggleTerminal}
              githubOpen={githubOpen}
              canOpenGithub={canOpenGithub}
              onToggleGithub={onToggleGithub}
              desktopOpen={desktopOpen}
              canOpenDesktop={canOpenDesktop}
              onToggleDesktop={onToggleDesktop}
              sshOpen={sshOpen}
              canOpenSsh={canOpenSsh}
              onToggleSsh={onToggleSsh}
            />
          </div>
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
  onPreloadTerminal,
  onToggleTerminal,
  githubOpen,
  canOpenGithub,
  onToggleGithub,
  desktopOpen,
  canOpenDesktop,
  onToggleDesktop,
  sshOpen,
  canOpenSsh,
  onToggleSsh,
}: {
  className?: string
  sandboxId: string | null
  sandboxPending: boolean
  terminalOpen: boolean
  onPreloadTerminal: () => void
  onToggleTerminal: () => void
  githubOpen: boolean
  canOpenGithub: boolean
  onToggleGithub: () => void
  desktopOpen: boolean
  canOpenDesktop: boolean
  onToggleDesktop: () => void
  sshOpen: boolean
  canOpenSsh: boolean
  onToggleSsh: () => void
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

  const anyOpen = terminalOpen || githubOpen || desktopOpen || sshOpen
  const items = [
    {
      key: "terminal",
      label: terminalOpen ? "Hide terminals" : "Terminals",
      icon: <SquareTerminal className="size-4" />,
      active: terminalOpen,
      disabled: !sandboxId && !sandboxPending,
      onSelect: () => {
        onPreloadTerminal()
        onToggleTerminal()
      },
    },
    {
      key: "desktop",
      label: desktopOpen ? "Hide desktop" : "Desktop",
      icon: <Monitor className="size-4" />,
      active: desktopOpen,
      disabled: !canOpenDesktop,
      onSelect: onToggleDesktop,
    },
    {
      key: "ssh",
      label: sshOpen ? "Hide SSH" : "SSH",
      icon: <KeyRound className="size-4" />,
      active: sshOpen,
      disabled: !canOpenSsh,
      onSelect: onToggleSsh,
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
      <UiIconButton
        ref={triggerRef}
        onClick={() => {
          if (open) {
            setMenuPos(null)
            return
          }
          openMenu()
        }}
        onFocus={onPreloadTerminal}
        onPointerEnter={onPreloadTerminal}
        aria-label="Sandbox tools"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-pressed={open || anyOpen}
        size="lg"
        className="md:size-7"
      >
        <PanelRight className="size-[18px] md:size-3.5" />
      </UiIconButton>
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
                className={cn("fixed z-[61] min-w-44", menuPanelClass)}
              >
                {items.map((item) => (
                  <MenuItem
                    key={item.key}
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => {
                      item.onSelect()
                      setMenuPos(null)
                    }}
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
                  </MenuItem>
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
    <UiIconButton
      ref={ref}
      onClick={onClick}
      onFocus={onFocus}
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      className="size-9 md:size-7"
    >
      {children}
    </UiIconButton>
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
  const { info, loading, missing, refresh } = useSandboxInfo({
    onMissing: onSandboxMissing,
    onStateChange: onSandboxStateChange,
    sandboxId,
  })
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(
    null
  )
  const open = menuPos !== null
  const triggerRef = useRef<HTMLButtonElement>(null)
  const busy = sandboxAction !== null || loading

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
  } else if (loading) {
    display = "checking"
  } else if (info) {
    display = info.state
  } else if (sandboxState === "deleted") {
    display = "deleted"
  } else if (!sandboxId && !sandboxPending) {
    display = "idle"
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
                className={cn("fixed z-[61] min-w-44", menuPanelClass)}
              >
                <MenuItem
                  role="menuitem"
                  disabled={busy}
                  onClick={() =>
                    handle(() => {
                      void refresh()
                    })
                  }
                >
                  Check sandbox state
                </MenuItem>
                <MenuItem
                  role="menuitem"
                  disabled={busy}
                  onClick={() =>
                    handle(stopped ? onResumeSandbox : onPauseSandbox)
                  }
                >
                  {stopped ? "Resume sandbox" : "Pause sandbox"}
                </MenuItem>
                <MenuItem
                  role="menuitem"
                  destructive
                  disabled={busy}
                  onClick={() => handle(onDeleteSandbox)}
                >
                  Delete sandbox
                </MenuItem>
              </div>
            </>,
            document.body
          )
        : null}
    </>
  )
}
