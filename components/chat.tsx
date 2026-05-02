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
  Folder,
  GitBranch,
  LogIn,
  Loader2,
  Plus,
  ScrollText,
  SquarePen,
  Square,
  Terminal,
} from "lucide-react"
import { useTheme } from "next-themes"
import {
  type CSSProperties,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useStoreUserEffect } from "@/hooks/use-store-user-effect"
import { cn } from "@/lib/utils"

type Role = "user" | "assistant"

type Message = {
  id: Id<"messages">
  role: Role
  content: string
  pending?: boolean
  error?: boolean
  meta?: { branch?: string; status?: string; diff?: string }
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
  status?: unknown
  stderr?: unknown
  stdout?: unknown
}

type CachedRunState = {
  branch?: string
  codexThreadId?: string
  diff?: string
  sandboxId?: string
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
  title: string
  messages: Message[]
  model: Model
  speed?: Speed
  thinking?: Thinking
  createdAt: number
  updatedAt: number
}

const MODELS = ["gpt-5.5", "gpt-5.4"] as const
type Model = (typeof MODELS)[number]

const SPEEDS = ["standard", "fast"] as const
type Speed = (typeof SPEEDS)[number]

const THINKINGS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const
type Thinking = (typeof THINKINGS)[number]

const REPO_KEY = "cloudcode:repoUrl"
const MODEL_KEY = "cloudcode:model"
const SPEED_KEY = "cloudcode:speed"
const THINKING_KEY = "cloudcode:thinking"
const ACTIVE_KEY = "cloudcode:activeChatId"

const MODEL_LABEL: Record<Model, string> = {
  "gpt-5.5": "GPT 5.5",
  "gpt-5.4": "GPT 5.4",
}

const SPEED_LABEL: Record<Speed, string> = {
  standard: "Standard",
  fast: "Fast",
}

const THINKING_LABEL: Record<Thinking, string> = {
  none: "None",
  minimal: "Minimal",
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

  const repoUrl = active ? active.repoUrl : draftRepo
  const model = active ? active.model : draftModel
  const speed = active ? (active.speed ?? "standard") : draftSpeed
  const thinking = active ? (active.thinking ?? "medium") : draftThinking
  const messages = active?.messages ?? []
  const empty = messages.length === 0

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
      const logs = [...(current[key] ?? []), nextLog].slice(-80)
      return { ...current, [key]: logs }
    })
  }

  function clearRunLogs(messageId: Id<"messages">) {
    setRunLogs((current) => {
      const next = { ...current }
      delete next[messageId as string]
      return next
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
    if (active) {
      void updateThread({ speed: next, threadId: active.id })
    } else {
      setDraftSpeed(next)
    }
    localStorage.setItem(SPEED_KEY, next)
  }

  function persistThinking(next: Thinking) {
    if (active) {
      void updateThread({ thinking: next, threadId: active.id })
    } else {
      setDraftThinking(next)
    }
    localStorage.setItem(THINKING_KEY, next)
  }

  function startNewChat() {
    setActiveId(null)
    setInput("")
    setEditingRepo(false)
  }

  function selectChat(id: Id<"threads">) {
    setActiveId(id)
    setInput("")
    setEditingRepo(false)
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
          threadId: chatId,
        })
        assistantMessageId = appended.assistantMessageId
      }

      if (!chatId || !assistantMessageId) {
        throw new Error("Unable to create a thread for this run.")
      }

      const previousAssistant = active?.messages
        .toReversed()
        .find((m) => m.role === "assistant" && m.meta?.branch)
      const cachedRunState = threadRunStateRef.current[chatId as string]

      const res = await fetch("/api/codex-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          branchName: cachedRunState?.branch ?? previousAssistant?.meta?.branch,
          codexThreadId: cachedRunState?.codexThreadId ?? active?.codexThreadId,
          previousDiff: cachedRunState?.diff ?? previousAssistant?.meta?.diff,
          prompt: trimmed,
          reasoningEffort: thinking,
          repoUrl: repoUrl.trim(),
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
          status: typeof data.status === "string" ? data.status : undefined,
        },
        sandboxId: nextRunState.sandboxId,
        threadId: chatId,
      })
      clearRunLogs(runMessageId)
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
      if (assistantMessageId) {
        clearRunLogs(assistantMessageId)
      }
    } finally {
      setBusy(false)
      abortRef.current = null
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
    <div className="flex h-svh bg-background text-foreground">
      <Sidebar
        authError={authError}
        authStatus={authStatus}
        chats={chats}
        activeId={activeId}
        onNewChat={startNewChat}
        onSelect={selectChat}
        onDelete={deleteChat}
      />

      <div className="relative flex flex-1 flex-col">
        <TopBar
          title={active?.title ?? null}
          repoUrl={repoUrl}
          isNew={!active}
        />
        <div ref={threadRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full max-w-2xl flex-col px-6 pt-16 pb-40">
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

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 pb-6">
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
    </div>
  )
}

function SignedOutScreen() {
  return (
    <div className="flex h-svh items-center justify-center bg-background px-6 text-foreground">
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
  )
}

function TopBar({
  title,
  repoUrl,
  isNew,
}: {
  title: string | null
  repoUrl: string
  isNew: boolean
}) {
  const displayTitle = title?.trim() || (isNew ? "New chat" : "Untitled")
  const repo = repoUrl ? repoLabel(repoUrl) : ""

  return (
    <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border/60 bg-background/80 px-4 backdrop-blur-xl">
      <span className="min-w-0 truncate text-sm font-medium text-foreground/85">
        {displayTitle}
      </span>
      {repo ? (
        <>
          <span className="text-muted-foreground/40" aria-hidden>
            /
          </span>
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Folder className="size-3.5 shrink-0" />
            <span className="truncate">{repo}</span>
          </div>
        </>
      ) : null}
    </header>
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
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border/60 bg-sidebar text-sidebar-foreground">
      <div className="px-3 pt-4">
        <button
          type="button"
          onClick={onNewChat}
          className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-sm text-foreground/80 transition-colors hover:bg-muted"
        >
          <SquarePen className="size-4" />
          <span>New chat</span>
        </button>
      </div>

      <div className="mt-2 flex-1 overflow-y-auto px-2 pb-4">
        {groups.length === 0 ? (
          <div className="px-3 pt-4 text-xs text-muted-foreground/80">
            No chats yet
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <div key={g.repo || "untitled"}>
                <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground">
                  <Folder className="size-3.5 shrink-0" />
                  <span className="truncate">{repoLabel(g.repo)}</span>
                </div>
                <div>
                  {g.items.map((c) => (
                    <SidebarItem
                      key={c.id}
                      chat={c}
                      active={c.id === activeId}
                      onSelect={() => onSelect(c.id)}
                      onDelete={() => onDelete(c.id)}
                    />
                  ))}
                </div>
              </div>
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
      {message.pending ? (
        <PendingRunLogs logs={logs} />
      ) : (
        <Markdown
          text={message.content}
          className={cn(
            "text-[15px] leading-7",
            message.error && "text-destructive"
          )}
        />
      )}
      {message.meta?.branch ? (
        <div className="font-mono text-[11px] text-muted-foreground">
          ↳ {message.meta.branch}
        </div>
      ) : null}
    </div>
  )
}

function PendingRunLogs({ logs }: { logs: RunLog[] }) {
  const visible = logs.slice(-8)
  const current = logs.at(-1)

  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <div className="flex items-center gap-2">
        <Loader2 className="size-3.5 animate-spin" />
        <span className="truncate">
          {current?.message ?? "Starting Codex run"}
        </span>
      </div>

      {visible.length > 0 ? (
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
      overflow: "scroll",
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
