"use client"

import {
  Check,
  ChevronDown,
  GitBranch,
  GitBranchPlus,
  LoaderCircle,
  Package,
} from "lucide-react"
import {
  type ButtonHTMLAttributes,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"

import type { Id } from "@/convex/_generated/dataModel"
import {
  BRANCH_MODE_LABEL,
  BRANCH_MODES,
  type BranchMode,
} from "@/lib/chat-options"
import { canonicalGitHubRepoUrl, parseGitHubRepoUrl } from "@/lib/github-repo"
import { cn } from "@/lib/utils"

const chipTrigger =
  "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50"

const popoverPanel =
  "absolute z-10 min-w-44 overflow-hidden rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lg"

const popoverItem =
  "flex w-full items-center justify-between gap-6 rounded-xl px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted"

type SandboxPresetOption = {
  id: Id<"sandboxPresets">
  name: string
}

type GitHubRepoOption = {
  cloneUrl: string
  fullName: string
  private: boolean
}

function repoLabel(url: string) {
  if (!url) return "Untitled"
  const parsed = parseGitHubRepoUrl(url)
  if (parsed) return `${parsed.owner}/${parsed.repo}`
  return url
    .replace(/^https?:\/\/(www\.)?github\.com\//, "")
    .replace(/\.git$/, "")
}

export function IconButton({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
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

export function RepoChip({
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
  const [draft, setDraft] = useState("")
  const [repoOptions, setRepoOptions] = useState<GitHubRepoOption[]>([])
  const [reposError, setReposError] = useState("")
  const [reposLoading, setReposLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const setFocusedInputRef = useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node
    node?.focus()
  }, [])

  useEffect(() => {
    if (!editing) return

    let cancelled = false

    async function loadRepos() {
      setReposLoading(true)
      setReposError("")
      try {
        const response = await fetch("/api/github/repos", {
          cache: "no-store",
        })
        const data = (await response.json()) as {
          error?: string
          repositories?: GitHubRepoOption[]
        }

        if (!response.ok) {
          throw new Error(data.error ?? "Unable to load repositories.")
        }

        if (!cancelled) {
          setRepoOptions(data.repositories ?? [])
        }
      } catch (error) {
        if (!cancelled) {
          setReposError(
            error instanceof Error
              ? error.message
              : "Unable to load repositories."
          )
          setRepoOptions([])
        }
      } finally {
        if (!cancelled) setReposLoading(false)
      }
    }

    void loadRepos()

    return () => {
      cancelled = true
    }
  }, [editing])

  function commit() {
    const trimmed = draft.trim()
    if (!trimmed) {
      onChange("")
      setEditing(false)
      return
    }
    onChange(canonicalGitHubRepoUrl(trimmed) ?? trimmed)
    setEditing(false)
  }

  if (editing) {
    const needle = draft
      .replace(/^https?:\/\/(www\.)?github\.com\//, "")
      .replace(/\.git$/, "")
      .toLowerCase()
    const visibleRepos = repoOptions
      .filter((repo) => !needle || repo.fullName.toLowerCase().includes(needle))
      .slice(0, 8)

    return (
      <div className="relative">
        <div className="flex h-8 items-center rounded-lg border border-border bg-background pr-1 pl-2.5 text-xs focus-within:ring-3 focus-within:ring-ring/30">
          <GitBranch className="mr-1.5 size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground/70 select-none">
            github.com/
          </span>
          <input
            ref={setFocusedInputRef}
            aria-label="Repository"
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
            placeholder="owner/repo"
            className="w-44 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
            spellCheck={false}
          />
          {reposLoading ? (
            <LoaderCircle className="ml-1.5 size-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : null}
        </div>
        {visibleRepos.length || reposError ? (
          <div
            className={cn(
              popoverPanel,
              "top-10 left-0 w-72 max-w-[calc(100vw-2rem)]"
            )}
          >
            {visibleRepos.map((repo) => (
              <button
                key={repo.cloneUrl}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(repo.cloneUrl)
                  setDraft(repo.cloneUrl)
                  setEditing(false)
                }}
                className={popoverItem}
              >
                <span className="min-w-0 truncate">{repo.fullName}</span>
                {repo.private ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    Private
                  </span>
                ) : null}
              </button>
            ))}
            {reposError ? (
              <div className="px-3 py-2 text-xs leading-4 text-destructive">
                {reposError}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  const label = value ? repoLabel(value) : "Connect repo"

  return (
    <button
      type="button"
      onClick={() => {
        if (!locked) {
          setDraft(value ? repoLabel(value) : "")
          setEditing(true)
        }
      }}
      disabled={locked}
      aria-haspopup="dialog"
      className={cn(
        chipTrigger,
        "max-w-[14rem]",
        value ? "text-foreground/80" : "text-muted-foreground"
      )}
    >
      <GitBranch className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )
}

export function BranchChip({
  value,
  repoUrl,
  onChange,
  locked,
}: {
  value: string
  repoUrl?: string
  onChange: (v: string) => void
  locked?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [branches, setBranches] = useState<string[]>([])
  const [defaultBranch, setDefaultBranch] = useState<string | undefined>()
  const [branchesError, setBranchesError] = useState("")
  const [branchesLoading, setBranchesLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const setFocusedInputRef = useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node
    node?.focus()
  }, [])

  useEffect(() => {
    if (!editing) return
    const repo = repoUrl?.trim()
    if (!repo) return

    let cancelled = false

    async function loadBranches() {
      setBranchesLoading(true)
      setBranchesError("")
      try {
        const response = await fetch(
          `/api/github/branches?repoUrl=${encodeURIComponent(repo!)}`,
          { cache: "no-store" }
        )
        const data = (await response.json()) as {
          error?: string
          branches?: string[]
          defaultBranch?: string
        }
        if (!response.ok) {
          throw new Error(data.error ?? "Unable to load branches.")
        }
        if (!cancelled) {
          setBranches(data.branches ?? [])
          setDefaultBranch(data.defaultBranch)
        }
      } catch (error) {
        if (!cancelled) {
          setBranchesError(
            error instanceof Error ? error.message : "Unable to load branches."
          )
          setBranches([])
        }
      } finally {
        if (!cancelled) setBranchesLoading(false)
      }
    }

    void loadBranches()

    return () => {
      cancelled = true
    }
  }, [editing, repoUrl])

  function commit() {
    onChange(draft.trim())
    setEditing(false)
  }

  if (editing) {
    const needle = draft.trim().toLowerCase()
    const sorted = [...branches].sort((a, b) => {
      if (a === defaultBranch) return -1
      if (b === defaultBranch) return 1
      return a.localeCompare(b)
    })
    const visibleBranches = sorted
      .filter((branch) => !needle || branch.toLowerCase().includes(needle))
      .slice(0, 8)

    return (
      <div className="relative">
        <div className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background pr-1 pl-2.5 text-xs focus-within:ring-3 focus-within:ring-ring/30">
          <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={setFocusedInputRef}
            aria-label="Branch name"
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
            placeholder={defaultBranch ?? "default branch"}
            className="w-32 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
            spellCheck={false}
          />
          {branchesLoading ? (
            <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : null}
        </div>
        {visibleBranches.length || branchesError ? (
          <div
            className={cn(
              popoverPanel,
              "top-10 left-0 w-60 max-w-[calc(100vw-2rem)]"
            )}
          >
            {visibleBranches.map((branch) => (
              <button
                key={branch}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(branch)
                  setDraft(branch)
                  setEditing(false)
                }}
                className={popoverItem}
              >
                <span className="min-w-0 truncate">{branch}</span>
                {branch === defaultBranch ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    default
                  </span>
                ) : null}
              </button>
            ))}
            {branchesError ? (
              <div className="px-3 py-2 text-xs leading-4 text-destructive">
                {branchesError}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  const label = value || "default branch"

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
      aria-haspopup="dialog"
      title={
        locked ? "Base branch is locked once a chat starts" : "Base branch"
      }
      className={cn(
        chipTrigger,
        "max-w-[10rem]",
        value ? "text-foreground/80" : "text-muted-foreground"
      )}
    >
      <GitBranch className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )
}

export function BranchTargetChip({
  baseBranch,
  branchName,
  locked,
  mode,
  onChangeBranchName,
  onChangeMode,
  open,
  setOpen,
}: {
  baseBranch?: string
  branchName: string
  locked?: boolean
  mode: BranchMode
  onChangeBranchName: (name: string) => void
  onChangeMode: (mode: BranchMode) => void
  open: boolean
  setOpen: (value: boolean) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const focusInputRef = useCallback((node: HTMLInputElement | null) => {
    node?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    function onClick(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open, setOpen])

  const baseLabel = baseBranch?.trim() || "default branch"
  const trimmedName = branchName.trim()
  const TriggerIcon = mode === "base" ? GitBranch : GitBranchPlus
  const triggerLabel =
    mode === "custom"
      ? trimmedName || BRANCH_MODE_LABEL.auto
      : BRANCH_MODE_LABEL[mode]

  const descriptions: Record<BranchMode, string> = {
    auto: "Generated name",
    base: `Commit to ${baseLabel}`,
    custom: "Name it yourself",
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          if (!locked) setOpen(!open)
        }}
        disabled={locked}
        aria-haspopup="dialog"
        title={
          locked
            ? "Branch target is locked once a chat starts"
            : "Where this run's work lands"
        }
        className={cn(chipTrigger, "max-w-[12rem] text-foreground/80")}
      >
        <TriggerIcon className="size-3.5 shrink-0" />
        <span className="truncate">{triggerLabel}</span>
        {locked ? null : <ChevronDown className="size-3 opacity-60" />}
      </button>
      {open && !locked ? (
        <div className={cn(popoverPanel, "bottom-10 left-0 w-64")}>
          <div className="px-3 pt-1.5 pb-1 text-xs text-muted-foreground">
            Branch
          </div>
          {BRANCH_MODES.map((option) => {
            const active = option === mode
            return (
              <div key={option}>
                <button
                  type="button"
                  onClick={() => {
                    onChangeMode(option)
                    if (option !== "custom") setOpen(false)
                  }}
                  className={cn(popoverItem, "items-start gap-3 py-2")}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="text-foreground">
                      {BRANCH_MODE_LABEL[option]}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {descriptions[option]}
                    </span>
                  </span>
                  {active ? (
                    <Check
                      className="mt-0.5 size-4 shrink-0"
                      strokeWidth={2.25}
                    />
                  ) : null}
                </button>
                {option === "custom" && mode === "custom" ? (
                  <div className="px-2 pt-0.5 pb-1.5">
                    <div className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs focus-within:ring-3 focus-within:ring-ring/30">
                      <GitBranchPlus className="size-3.5 shrink-0 text-muted-foreground" />
                      <input
                        ref={focusInputRef}
                        aria-label="New branch name"
                        value={branchName}
                        onChange={(event) =>
                          onChangeBranchName(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault()
                            setOpen(false)
                          }
                          if (event.key === "Escape") setOpen(false)
                        }}
                        placeholder="feature/my-branch"
                        spellCheck={false}
                        className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export function PresetPill({
  activeLabel,
  locked,
  onSelect,
  open,
  presets,
  setOpen,
  value,
}: {
  activeLabel?: string
  locked?: boolean
  onSelect: (value: Id<"sandboxPresets"> | "") => void
  open: boolean
  presets: SandboxPresetOption[]
  setOpen: (value: boolean) => void
  value: Id<"sandboxPresets"> | ""
}) {
  const ref = useRef<HTMLDivElement>(null)
  const selected = presets.find((preset) => preset.id === value)
  const label = selected?.name ?? activeLabel ?? "Default"

  useEffect(() => {
    if (!open) return
    function onClick(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open, setOpen])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          if (!locked) setOpen(!open)
        }}
        disabled={locked}
        title={
          locked ? "Preset is chosen when a chat starts" : "Sandbox preset"
        }
        className={cn(chipTrigger, "max-w-[11rem] text-muted-foreground")}
      >
        <Package className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
        {locked ? null : <ChevronDown className="size-3 opacity-60" />}
      </button>
      {open && !locked ? (
        <div className={cn(popoverPanel, "bottom-10 left-0 min-w-52")}>
          <div className="px-3 pt-1.5 pb-1 text-xs text-muted-foreground">
            Preset
          </div>
          <button
            type="button"
            onClick={() => {
              onSelect("")
              setOpen(false)
            }}
            className={popoverItem}
          >
            <span>Default</span>
            {!value ? <Check className="size-4 shrink-0" /> : null}
          </button>
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                onSelect(preset.id)
                setOpen(false)
              }}
              className={popoverItem}
            >
              <span className="min-w-0 truncate">{preset.name}</span>
              {preset.id === value ? (
                <Check className="size-4 shrink-0" strokeWidth={2.25} />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function Pill<T extends string>({
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
        className={cn(chipTrigger, "gap-1 text-foreground", triggerClassName)}
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
        <div className={cn(popoverPanel, "right-0 bottom-10")}>
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
                className={popoverItem}
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

export function ThinkingSpeedPill<
  TThinking extends string,
  TSpeed extends string,
>({
  thinking,
  thinkingOptions,
  formatThinking,
  onSelectThinking,
  speed,
  speedOptions,
  formatSpeed,
  onSelectSpeed,
  open,
  setOpen,
}: {
  thinking: TThinking
  thinkingOptions: readonly TThinking[]
  formatThinking: (v: TThinking) => string
  onSelectThinking: (v: TThinking) => void
  speed: TSpeed
  speedOptions: readonly TSpeed[]
  formatSpeed: (v: TSpeed) => string
  onSelectSpeed: (v: TSpeed) => void
  open: boolean
  setOpen: (v: boolean) => void
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
        className={cn(chipTrigger, "gap-1.5 text-foreground")}
      >
        <span className="text-foreground/80">{formatThinking(thinking)}</span>
        <span aria-hidden className="text-muted-foreground/50">
          ·
        </span>
        <span className="text-muted-foreground">{formatSpeed(speed)}</span>
        <ChevronDown className="size-3 opacity-60" />
      </button>
      {open ? (
        <div className={cn(popoverPanel, "right-0 bottom-10 min-w-52")}>
          <div className="px-2.5 pt-1.5 pb-1 text-left text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase">
            Thinking
          </div>
          {thinkingOptions.map((opt) => {
            const selected = opt === thinking
            return (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onSelectThinking(opt)
                  setOpen(false)
                }}
                className={cn(popoverItem, "pl-5")}
              >
                <span>{formatThinking(opt)}</span>
                {selected ? (
                  <Check className="size-4 shrink-0" strokeWidth={2.25} />
                ) : null}
              </button>
            )
          })}
          <div className="my-1 h-px bg-border/60" />
          <div className="px-2.5 pt-1 pb-1 text-left text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase">
            Speed
          </div>
          {speedOptions.map((opt) => {
            const selected = opt === speed
            return (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onSelectSpeed(opt)
                  setOpen(false)
                }}
                className={cn(popoverItem, "pl-5")}
              >
                <span>{formatSpeed(opt)}</span>
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
