"use client"

import { Show, SignInButton } from "@clerk/nextjs"
import { useMutation, useQuery } from "convex/react"
import {
  ArrowUp,
  Folder,
  FolderOpen,
  PanelLeft,
  Plus,
  SquareTerminal,
  Square,
} from "lucide-react"
import dynamic from "next/dynamic"
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type UIEvent as ReactUIEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { GeistPixelSquare } from "geist/font/pixel"

import {
  closeBrowserTerminalSession,
  SandboxTerminalPanel,
  warmBrowserTerminal,
} from "@/components/sandbox-terminal"
import { SettingsScreen } from "@/components/settings-screen"
import { Sidebar } from "@/components/chat-sidebar"
import { NewChatDialog } from "@/components/new-chat-dialog"
import { SandboxStatus } from "@/components/sandbox-status"
import {
  BranchChip,
  IconButton,
  Pill,
  PresetPill,
  RepoChip,
} from "@/components/chat-controls"
import { MessageBlock } from "@/components/chat-message"
import type { FileBrowserOpenMode } from "@/components/file-browser"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useStoreUserEffect } from "@/hooks/use-store-user-effect"
import {
  readCodexRunResponse,
  type CodexRunLog,
} from "@/lib/codex-run-response"
import { buildResumeHandoff } from "@/lib/chat-resume-handoff"
import {
  MODEL_LABEL,
  MODELS,
  SPEED_LABEL,
  SPEEDS,
  THINKING_LABEL,
  THINKINGS,
  shortModel,
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
  pending?: boolean
  error?: boolean
  meta?: {
    branch?: string
    diff?: string
    logs?: RunLog[]
    status?: string
  }
  speed?: Speed
  thinking?: Thinking
}

type RunLog = CodexRunLog & {
  detail?: string
  id: string
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
  repoUrl: string
  sandboxPresetId?: Id<"sandboxPresets">
  sandboxPresetName?: string
  sandboxId?: string
  sandboxState?: SandboxState
  title: string
  messages: Message[]
  model: Model
  createdAt: number
  updatedAt: number
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
  id: Id<"sandboxPresets">
  name: string
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
const EMPTY_LOGS: RunLog[] = []
const EMPTY_MESSAGES: Message[] = []

function repoLabel(url: string) {
  if (!url) return "Untitled"
  return url
    .replace(/^https?:\/\/(www\.)?github\.com\//, "")
    .replace(/\.git$/, "")
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
  const rawPresets = useQuery(api.sandboxPresets.list)
  const sandboxPresets = useMemo(
    () => (rawPresets ?? []) as SandboxPresetRecord[],
    [rawPresets]
  )
  const createThread = useMutation(api.chats.createThread)
  const appendRunMessages = useMutation(api.chats.appendRunMessages)
  const completeAssistantMessage = useMutation(
    api.chats.completeAssistantMessage
  )
  const saveRunState = useMutation(api.chats.saveRunState)
  const deleteThreadMutation = useMutation(api.chats.deleteThread)
  const updateThread = useMutation(api.chats.updateThread)
  const [activeId, setActiveId] = useState<Id<"threads"> | null>(() =>
    typeof window === "undefined"
      ? null
      : (localStorage.getItem(ACTIVE_KEY) as Id<"threads"> | null)
  )
  const [pendingDeleteId, setPendingDeleteId] = useState<Id<"threads"> | null>(
    null
  )
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
  const [newChatOpen, setNewChatOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [presetOpen, setPresetOpen] = useState(false)
  const [speedOpen, setSpeedOpen] = useState(false)
  const [thinkingOpen, setThinkingOpen] = useState(false)
  const [filesOpen, setFilesOpen] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(380)
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null)
  const [activeFileMode, setActiveFileMode] =
    useState<FileBrowserOpenMode>("file")
  const [activeFileDiff, setActiveFileDiff] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [view, setView] = useState<"chat" | "settings">("chat")
  const [runningRunKeys, setRunningRunKeys] = useState<Record<string, true>>({})
  const [runLogs, setRunLogs] = useState<Record<string, RunLog[]>>({})
  const [liveRunStates, setLiveRunStates] = useState<
    Record<string, CachedRunState>
  >({})
  const [optimisticRuns, setOptimisticRuns] = useState<
    Record<string, OptimisticRun>
  >({})
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
  const [authError, setAuthError] = useState("")
  const runControllersRef = useRef<Record<string, AbortController>>({})
  const runningRunKeysRef = useRef<Set<string>>(new Set())
  const threadRunStateRef = useRef<Record<string, CachedRunState>>({})
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const threadRef = useRef<HTMLDivElement | null>(null)
  const isAtBottomRef = useRef(true)
  const [composerHeight, setComposerHeight] = useState(144)

  function scrollThreadToBottom() {
    const el = threadRef.current
    if (!el) return
    el.style.scrollBehavior = "auto"
    el.scrollTop = el.scrollHeight
    isAtBottomRef.current = true
  }

  function onThreadScroll(event: ReactUIEvent<HTMLDivElement>) {
    const el = event.currentTarget
    isAtBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  function setThreadElement(el: HTMLDivElement | null) {
    threadRef.current = el
    if (el) {
      isAtBottomRef.current = true
      scrollThreadToBottom()
    }
  }

  const active = useMemo(
    () => chats.find((c) => c.id === activeId) ?? null,
    [chats, activeId]
  )
  const sidebarChats = useMemo(
    () =>
      chats.map((chat) => ({
        ...chat,
        ...(liveRunStates[chat.id as string] ?? {}),
      })),
    [chats, liveRunStates]
  )
  const activeRunKey = activeId ? (activeId as string) : DRAFT_RUN_KEY
  const activeRunState = activeId ? liveRunStates[activeId as string] : undefined
  const activeSandboxId =
    activeRunState?.sandboxState === "deleted"
      ? null
      : hasCachedRunKey(activeRunState, "sandboxId")
      ? (activeRunState?.sandboxId ?? null)
      : (active?.sandboxId ?? null)
  const serverMessages = active?.messages ?? []
  const optimisticRun = optimisticRuns[activeRunKey]
  const optimisticMessages =
    optimisticRun &&
    serverMessages.length <= optimisticRun.baseMessageCount &&
    !serverMessages.some((message) => message.pending)
      ? optimisticRun.messages
      : EMPTY_MESSAGES
  const messages = [...serverMessages, ...optimisticMessages]
  const activeLocalRunPending = Boolean(runningRunKeys[activeRunKey])
  const activeMessagePending = messages.some((message) => message.pending)
  const activeRunPending = activeLocalRunPending || activeMessagePending
  const canStopActiveRun = Boolean(runControllersRef.current[activeRunKey])
  const terminalVisible = terminalOpen && Boolean(activeSandboxId)

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
  const editorDiff = activeFileDiff ?? activeDiff
  const activeRepoName = useMemo(() => {
    const label = repoLabel(repoUrl)
    return label.split("/").pop() || null
  }, [repoUrl])

  const openFile = useCallback((path: string) => {
    setActiveFilePath(path)
    setActiveFileMode("file")
    setActiveFileDiff(null)
  }, [])

  const openFileDiff = useCallback((path: string, diff: string) => {
    setActiveFilePath(path)
    setActiveFileMode("diff")
    setActiveFileDiff(diff)
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

  useLayoutEffect(() => {
    isAtBottomRef.current = true
    setActiveFileDiff(null)
    scrollThreadToBottom()
  }, [activeId])

  useEffect(() => {
    const el = threadRef.current
    if (!el) return

    const observer = new ResizeObserver(() => {
      if (!isAtBottomRef.current) return
      el.style.scrollBehavior = "auto"
      el.scrollTop = el.scrollHeight
    })
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)

    return () => observer.disconnect()
  }, [activeId, activeFilePath])

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
        ...(current[key] ?? {}),
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

  function markRunActive(runKey: string, controller: AbortController) {
    runControllersRef.current[runKey] = controller
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

    const controller = runControllersRef.current[previousKey]
    if (controller) {
      delete runControllersRef.current[previousKey]
      runControllersRef.current[nextKey] = controller
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
    delete runControllersRef.current[runKey]
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
    setNewChatOpen(true)
  }

  function confirmNewChat({
    repoUrl: nextRepo,
    baseBranch: nextBaseBranch,
    sandboxPresetId: nextPresetId,
  }: {
    repoUrl: string
    baseBranch: string
    sandboxPresetId: Id<"sandboxPresets"> | ""
  }) {
    persistDraftRepo(nextRepo)
    persistDraftBaseBranch(nextBaseBranch)
    persistDraftSandboxPreset(nextPresetId)
    setActiveId(null)
    setInput("")
    setEditingRepo(false)
    setActiveFilePath(null)
    setFilesOpen(false)
    setTerminalOpen(false)
    setView("chat")
    setNewChatOpen(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
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
      runControllersRef.current[id as string]?.abort()
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
      (active ? active.messages.some((message) => message.pending) : false)
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

    setInput("")

    const controller = new AbortController()
    markRunActive(runKey, controller)
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
        .find(
          (m) =>
            m.role === "assistant" &&
            (m.meta?.branch || m.meta?.diff)
        )
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
          previousDiff,
          prompt: trimmed,
          reasoningEffort: thinking,
          repoUrl: repoUrl.trim(),
          resumeContext,
          sandboxId: runSandboxId,
          sandboxPresetId: runSandboxPresetId || undefined,
          speed,
          model,
        }),
        signal: controller.signal,
      })
      const runMessageId = assistantMessageId
      const data = await readCodexRunResponse(res, (log, time) => {
        appendRunLog(runMessageId, log, time)

        if (
          chatId &&
          log.kind === "setup" &&
          log.detail &&
          /sandbox/i.test(log.message)
        ) {
          mergeThreadRunState(chatId, {
            sandboxId: log.detail,
            sandboxState: "running",
          })
          void saveRunState({
            sandboxId: log.detail,
            sandboxState: "running",
            threadId: chatId,
          }).catch((error) => {
            console.warn("Unable to save live sandbox id.", error)
          })
        }
      })
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
          ? { sandboxId: data.sandboxId, sandboxState: "running" }
          : {}),
      }
      mergeThreadRunState(chatId, nextRunState)
      await completeAssistantMessage({
        content,
        messageId: assistantMessageId,
        meta: {
          branch: nextRunState.branch,
          diff: nextRunState.diff,
          status: typeof data.status === "string" ? data.status : undefined,
        },
        sandboxId: nextRunState.sandboxId,
        sandboxState: nextRunState.sandboxState,
        threadId: chatId,
      })
      if (
        nextRunState.codexThreadId ||
        nextRunState.sandboxId
      ) {
        try {
          await saveRunState({
            codexThreadId: nextRunState.codexThreadId,
            sandboxId: nextRunState.sandboxId,
            sandboxState: nextRunState.sandboxState,
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
        const liveRunState = threadRunStateRef.current[chatId as string]
        await completeAssistantMessage({
          content: msg,
          error: !aborted,
          messageId: assistantMessageId,
          sandboxId: liveRunState?.sandboxId,
          threadId: chatId,
        })
        if (aborted && liveRunState?.sandboxId) {
          mergeThreadRunState(chatId, {
            sandboxId: liveRunState.sandboxId,
            sandboxState: "stopped",
          })
          await saveRunState({
            sandboxId: liveRunState.sandboxId,
            sandboxState: "stopped",
            threadId: chatId,
          }).catch((error) => {
            console.warn("Unable to save stopped sandbox state.", error)
          })
        } else if (liveRunState?.sandboxId) {
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
      clearRunKey(runKey)
    }
  }

  function stopActiveRun() {
    const runKey = active ? (active.id as string) : DRAFT_RUN_KEY
    runControllersRef.current[runKey]?.abort()
    if (!active || !activeSandboxId) return
    mergeThreadRunState(active.id, {
      sandboxId: activeSandboxId,
      sandboxState: "stopped",
    })
    closeBrowserTerminalSession(activeSandboxId)
    setTerminalOpen(false)
    void saveRunState({
      sandboxId: activeSandboxId,
      sandboxState: "stopped",
      threadId: active.id,
    }).catch((error) => {
      console.warn("Unable to save stopped sandbox state.", error)
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

  return (
    <div className="fixed inset-0 flex min-w-0 overflow-hidden bg-background text-foreground">
      {sidebarOpen ? (
        <Sidebar
          chats={sidebarChats}
          activeId={activeId}
          currentView={view}
          onNewChat={startNewChat}
          onSelect={selectChat}
          onDelete={deleteChat}
          onRename={renameChat}
          onShowSettings={showSettings}
          brandClassName={GeistPixelSquare.className}
        />
      ) : null}

      {newChatOpen ? (
        <NewChatDialog
          initialRepo={draftRepo}
          initialBaseBranch={draftBaseBranch}
          initialPresetId={draftSandboxPresetId}
          presets={sandboxPresets}
          onCancel={() => setNewChatOpen(false)}
          onConfirm={confirmNewChat}
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

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {view === "settings" ? (
          <SettingsScreen
            authStatus={authStatus}
            authError={authError}
            sandboxPresets={sandboxPresets}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
          />
        ) : (
          <>
            <TopBar
              title={active?.title ?? null}
              repoUrl={repoUrl}
              isNew={!active}
              sandboxId={activeSandboxId}
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
                activePath={activeFilePath}
                diff={editorDiff ?? undefined}
                mode={activeFileMode}
                onClose={() => {
                  setActiveFilePath(null)
                  setActiveFileDiff(null)
                }}
                placement="main"
              />
            ) : (
              <div
                ref={setThreadElement}
                onScroll={onThreadScroll}
                className="min-h-0 flex-1 overflow-y-auto [contain:paint]"
              >
                <div
                  className="mx-auto flex min-h-full w-full max-w-2xl flex-col px-6 pt-16"
                  style={{
                    paddingBottom:
                      composerHeight + (terminalVisible ? terminalHeight : 0),
                  }}
                >
                  {empty ? (
                    <div className="flex flex-1 flex-col items-center justify-center text-center">
                      <h1 className="text-3xl font-medium tracking-tight text-foreground/90">
                        What should we build?
                      </h1>
                      <p className="mt-3 text-sm text-muted-foreground">
                        Describe a change. It runs in a sandbox against your
                        repo.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-8">
                      {messages.map((m) => (
                        <MessageBlock
                          key={m.id}
                          message={m}
                          logs={runLogs[m.id as string] ?? EMPTY_LOGS}
                          repoName={activeRepoName}
                          onOpenFile={openFile}
                          onOpenFileDiff={openFileDiff}
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
              ref={composerRef}
              className={cn(
                "pointer-events-none absolute inset-x-0 z-10 flex justify-center bg-background px-4 pt-3 pb-6",
                activeFilePath && "hidden"
              )}
              style={{ bottom: terminalVisible ? terminalHeight : 0 }}
            >
              <form
                onSubmit={onSubmit}
                className="pointer-events-auto w-full max-w-3xl rounded-3xl border border-border/70 bg-background/80 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] backdrop-blur-xl transition-colors focus-within:border-border"
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
                  className="block min-h-20 w-full resize-none bg-transparent px-5 pt-4 pb-1 text-[15px] leading-6 outline-none placeholder:text-muted-foreground/70"
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
                  <BranchChip
                    value={baseBranch}
                    onChange={persistBaseBranch}
                    locked={Boolean(active)}
                  />
                  <PresetPill
                    value={sandboxPresetId ?? ""}
                    presets={sandboxPresets}
                    open={presetOpen}
                    setOpen={setPresetOpen}
                    onSelect={persistSandboxPreset}
                    locked={Boolean(active)}
                    activeLabel={active?.sandboxPresetName}
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

                    {activeRunPending ? (
                      <button
                        type="button"
                        onClick={stopActiveRun}
                        disabled={!canStopActiveRun}
                        className="grid size-8 place-items-center rounded-full bg-foreground text-background transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Stop"
                        title={
                          canStopActiveRun ? "Stop" : "Run finishing elsewhere"
                        }
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
          </>
        )}
      </div>

      <FileBrowser
        open={filesOpen && Boolean(activeSandboxId)}
        sandboxId={activeSandboxId}
        diff={activeDiff ?? undefined}
        activePath={activeFilePath}
        activeMode={activeFileMode}
        onClose={() => setFilesOpen(false)}
        onOpenFile={(p, mode) => {
          setActiveFilePath(p)
          setActiveFileMode(mode)
          setActiveFileDiff(null)
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
          <SandboxStatus key={sandboxId} sandboxId={sandboxId} />
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
          disabled={!sandboxId}
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
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel()
        if (e.key === "Enter") onConfirm()
      }}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-black/[0.06] bg-popover p-5 text-popover-foreground shadow-[0_10px_30px_-12px_rgba(0,0,0,0.18)] dark:border-white/10"
      >
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
    </div>
  )
}
