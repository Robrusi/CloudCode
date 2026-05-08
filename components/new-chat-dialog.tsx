"use client"

import {
  Check,
  ChevronDown,
  GitBranch,
  Loader2,
  Package,
  X,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { Field } from "@/components/chat-controls"
import type { Id } from "@/convex/_generated/dataModel"
import { cn } from "@/lib/utils"

type SandboxPresetOption = {
  id: Id<"sandboxPresets">
  name: string
}

export function NewChatDialog({
  initialRepo,
  initialBaseBranch,
  initialPresetId,
  presets,
  onCancel,
  onConfirm,
}: {
  initialRepo: string
  initialBaseBranch: string
  initialPresetId: Id<"sandboxPresets"> | ""
  presets: SandboxPresetOption[]
  onCancel: () => void
  onConfirm: (input: {
    repoUrl: string
    baseBranch: string
    sandboxPresetId: Id<"sandboxPresets"> | ""
  }) => void
}) {
  const [repo, setRepo] = useState(initialRepo)
  const [branch, setBranch] = useState(initialBaseBranch)
  const [presetId, setPresetId] = useState<Id<"sandboxPresets"> | "">(
    initialPresetId
  )
  const [presetOpen, setPresetOpen] = useState(false)
  const presetRef = useRef<HTMLDivElement>(null)
  const repoRef = useRef<HTMLInputElement>(null)
  const [branches, setBranches] = useState<string[] | null>(null)
  const [defaultBranch, setDefaultBranch] = useState<string | null>(null)
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [branchesError, setBranchesError] = useState<string | null>(null)
  const [branchOpen, setBranchOpen] = useState(false)
  const branchRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const trimmed = repo.trim()
    const controller = new AbortController()
    const handle = window.setTimeout(async () => {
      if (!trimmed) {
        setBranches(null)
        setDefaultBranch(null)
        setBranchesError(null)
        setBranchesLoading(false)
        return
      }
      setBranchesLoading(true)
      setBranchesError(null)
      try {
        const res = await fetch(
          `/api/github/branches?repoUrl=${encodeURIComponent(trimmed)}`,
          { cache: "no-store", signal: controller.signal }
        )
        const data = (await res.json()) as {
          branches?: string[]
          defaultBranch?: string
          error?: string
        }
        if (!res.ok) {
          throw new Error(data.error ?? `Request failed: ${res.status}`)
        }
        setBranches(data.branches ?? [])
        setDefaultBranch(data.defaultBranch ?? null)
      } catch (error) {
        if ((error as Error).name === "AbortError") return
        setBranches([])
        setDefaultBranch(null)
        setBranchesError(
          error instanceof Error ? error.message : "Failed to load branches."
        )
      } finally {
        setBranchesLoading(false)
      }
    }, 350)
    return () => {
      controller.abort()
      window.clearTimeout(handle)
    }
  }, [repo])

  useEffect(() => {
    if (!branchOpen) return
    function onClick(event: MouseEvent) {
      if (!branchRef.current?.contains(event.target as Node)) {
        setBranchOpen(false)
      }
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [branchOpen])

  const filteredBranches = useMemo(() => {
    if (!branches) return []
    const query = branch.trim().toLowerCase()
    if (!query) return branches
    return branches.filter((name) => name.toLowerCase().includes(query))
  }, [branches, branch])

  useEffect(() => {
    repoRef.current?.focus()
    repoRef.current?.select()
  }, [])

  useEffect(() => {
    if (!presetOpen) return
    function onClick(event: MouseEvent) {
      if (!presetRef.current?.contains(event.target as Node)) {
        setPresetOpen(false)
      }
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [presetOpen])

  const selectedPreset = presets.find((p) => p.id === presetId)
  const presetLabel = selectedPreset?.name ?? "Default"
  const canSubmit = repo.trim().length > 0

  function submit() {
    if (!canSubmit) return
    onConfirm({
      repoUrl: repo.trim(),
      baseBranch: branch.trim(),
      sandboxPresetId: presetId,
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel()
      }}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-visible rounded-2xl border border-black/[0.06] bg-popover p-7 text-popover-foreground shadow-[0_10px_30px_-12px_rgba(0,0,0,0.18)] dark:border-white/10"
      >
        <div className="text-base font-medium text-foreground">New chat</div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Pick a repo, base branch, and Daytona preset to start from.
        </p>

        <div className="mt-5 space-y-4">
          <Field label="GitHub repo">
            <div className="flex h-10 items-center gap-2 rounded-xl border border-border/70 bg-background px-3.5 text-sm transition-colors focus-within:border-foreground/40">
              <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                ref={repoRef}
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    submit()
                  }
                }}
                placeholder="https://github.com/owner/repo.git"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
                spellCheck={false}
              />
            </div>
          </Field>

          <Field
            label="Base branch"
            hint={
              branchesError
                ? branchesError
                : defaultBranch && !branch.trim()
                  ? `Default: ${defaultBranch}`
                  : "Search and pick a branch from the repo."
            }
          >
            <div ref={branchRef} className="relative">
              <div
                className={cn(
                  "flex h-10 items-center gap-2 rounded-xl border border-border/70 bg-background px-3.5 text-sm transition-colors",
                  branchOpen
                    ? "border-foreground/40"
                    : "focus-within:border-foreground/40"
                )}
              >
                <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
                <input
                  value={branch}
                  onChange={(e) => {
                    setBranch(e.target.value)
                    setBranchOpen(true)
                  }}
                  onFocus={() => setBranchOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      if (branchOpen && filteredBranches[0]) {
                        setBranch(filteredBranches[0])
                        setBranchOpen(false)
                      } else {
                        submit()
                      }
                    } else if (e.key === "Escape" && branchOpen) {
                      e.preventDefault()
                      setBranchOpen(false)
                    } else if (e.key === "ArrowDown") {
                      setBranchOpen(true)
                    }
                  }}
                  placeholder={defaultBranch ?? "main"}
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
                  spellCheck={false}
                  autoComplete="off"
                />
                {branch ? (
                  <button
                    type="button"
                    aria-label="Clear branch"
                    onClick={() => {
                      setBranch("")
                      setBranchOpen(true)
                      requestAnimationFrame(() =>
                        branchRef.current?.querySelector("input")?.focus()
                      )
                    }}
                    className="grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                ) : null}
                {branchesLoading ? (
                  <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <ChevronDown
                    className={cn(
                      "size-3.5 shrink-0 cursor-pointer opacity-60 transition-transform",
                      branchOpen && "rotate-180"
                    )}
                    onClick={() => setBranchOpen((v) => !v)}
                  />
                )}
              </div>
              {branchOpen ? (
                <div className="absolute top-full left-0 z-10 mt-1.5 max-h-64 w-full overflow-y-auto rounded-2xl border border-black/[0.06] bg-popover p-1.5 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.18)] dark:border-white/10">
                  {!branch.trim() ? null : (
                    <button
                      type="button"
                      onClick={() => {
                        setBranch("")
                        setBranchOpen(false)
                      }}
                      className="flex w-full items-center justify-between gap-6 rounded-xl px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
                    >
                      <span className="text-muted-foreground">
                        Use default branch
                        {defaultBranch ? ` (${defaultBranch})` : ""}
                      </span>
                    </button>
                  )}
                  {branches === null ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      {repo.trim()
                        ? "Loading branches..."
                        : "Enter a repo URL first."}
                    </div>
                  ) : filteredBranches.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      {branchesError
                        ? branchesError
                        : branch.trim()
                          ? "No matching branches."
                          : "No branches found."}
                    </div>
                  ) : (
                    filteredBranches.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => {
                          setBranch(name)
                          setBranchOpen(false)
                        }}
                        className="flex w-full items-center justify-between gap-6 rounded-xl px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
                      >
                        <span className="min-w-0 truncate">{name}</span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {name === defaultBranch ? (
                            <span className="text-xs text-muted-foreground">
                              default
                            </span>
                          ) : null}
                          {name === branch ? (
                            <Check className="size-4 shrink-0" />
                          ) : null}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </Field>

          <Field label="Daytona preset">
            <div ref={presetRef} className="relative">
              <button
                type="button"
                onClick={() => setPresetOpen((v) => !v)}
                className="flex h-10 w-full items-center gap-2 rounded-xl border border-border/70 bg-background px-3.5 text-sm text-foreground transition-colors hover:border-foreground/40"
              >
                <Package className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-left">
                  {presetLabel}
                </span>
                <ChevronDown className="size-3.5 shrink-0 opacity-60" />
              </button>
              {presetOpen ? (
                <div className="absolute top-full left-0 z-10 mt-1.5 max-h-64 w-full overflow-y-auto rounded-2xl border border-black/[0.06] bg-popover p-1.5 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.18)] dark:border-white/10">
                  <button
                    type="button"
                    onClick={() => {
                      setPresetId("")
                      setPresetOpen(false)
                    }}
                    className="flex w-full items-center justify-between gap-6 rounded-xl px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
                  >
                    <span>Default</span>
                    {!presetId ? <Check className="size-4 shrink-0" /> : null}
                  </button>
                  {presets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => {
                        setPresetId(preset.id)
                        setPresetOpen(false)
                      }}
                      className="flex w-full items-center justify-between gap-6 rounded-xl px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
                    >
                      <span className="min-w-0 truncate">{preset.name}</span>
                      {preset.id === presetId ? (
                        <Check className="size-4 shrink-0" strokeWidth={2.25} />
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </Field>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-border/70 px-3 py-1.5 text-sm text-foreground/80 transition-colors hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-xl bg-foreground px-3 py-1.5 text-sm text-background transition-colors hover:bg-foreground/90 disabled:opacity-40 disabled:hover:bg-foreground"
          >
            Start chat
          </button>
        </div>
      </div>
    </div>
  )
}
