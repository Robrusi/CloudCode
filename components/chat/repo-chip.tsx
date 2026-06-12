"use client"

import { GitBranch, LoaderCircle } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import {
  chipTrigger,
  popoverItem,
  popoverPanel,
} from "@/components/chat/control-styles"
import { repoLabel } from "@/components/chat/format"
import { Input } from "@/components/ui/input"
import { fetchJson } from "@/lib/http/client-json"
import { canonicalGitHubRepoUrl } from "@/lib/github/repo"
import { cn } from "@/lib/shared/utils"

type GitHubRepoOption = {
  cloneUrl: string
  fullName: string
  private: boolean
}

export function RepoChip({
  editing,
  locked,
  onChange,
  setEditing,
  value,
}: {
  editing: boolean
  locked?: boolean
  onChange: (v: string) => void
  setEditing: (v: boolean) => void
  value: string
}) {
  const [draft, setDraft] = useState("")
  const [repoOptions, setRepoOptions] = useState<GitHubRepoOption[]>([])
  const [reposError, setReposError] = useState("")
  const [reposLoading, setReposLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const reposControllerRef = useRef<AbortController | null>(null)
  const setFocusedInputRef = useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node
    node?.focus()
  }, [])

  const abortReposLoad = useCallback(() => {
    reposControllerRef.current?.abort()
    reposControllerRef.current = null
  }, [])

  const loadRepos = useCallback(async () => {
    abortReposLoad()
    const controller = new AbortController()
    reposControllerRef.current = controller
    setReposLoading(true)
    setReposError("")
    try {
      const data = await fetchJson<{
        repositories?: GitHubRepoOption[]
      }>(
        "/api/github/repos",
        { signal: controller.signal },
        { fallbackError: "Unable to load repositories." }
      )

      if (!controller.signal.aborted) {
        setRepoOptions(data.repositories ?? [])
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setReposError(
          error instanceof Error
            ? error.message
            : "Unable to load repositories."
        )
        setRepoOptions([])
      }
    } finally {
      if (!controller.signal.aborted) {
        setReposLoading(false)
        if (reposControllerRef.current === controller) {
          reposControllerRef.current = null
        }
      }
    }
  }, [abortReposLoad])

  useEffect(() => abortReposLoad, [abortReposLoad])

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
      <div className="relative min-w-0">
        <div className="flex h-8 min-w-0 items-center gap-1.5 rounded-lg border border-field bg-background pr-1 pl-2.5 text-xs focus-within:ring-3 focus-within:ring-ring/30">
          <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            ref={setFocusedInputRef}
            variant="bare"
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
            className="w-36 text-xs sm:w-40"
            spellCheck={false}
          />
          {reposLoading ? (
            <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : null}
        </div>
        {visibleRepos.length || reposError ? (
          <div
            className={cn(
              popoverPanel,
              "top-10 right-0 w-72 max-w-[calc(100vw-2rem)] sm:right-auto sm:left-0"
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
          void loadRepos()
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
