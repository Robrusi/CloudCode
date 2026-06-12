"use client"

import { GitBranch } from "lucide-react"

import type { FileBrowserOpenMode } from "@/components/files/browser"
import {
  PrimaryButton,
  SecondaryButton,
  SectionHeading,
} from "@/components/github/panel-shared"
import type { GithubPanelBusyKind } from "@/components/github/panel-types"
import { Textarea } from "@/components/ui/textarea"
import { cardSurfaceClass } from "@/components/ui/surface"
import type { DiffFileStat } from "@/lib/diff/metadata"
import type { SandboxGitFile } from "@/lib/sandbox/git"
import { cn } from "@/lib/shared/utils"

export function BranchRow({
  ahead,
  baseBranch,
  behind,
  branch,
  upstream,
}: {
  ahead: number
  baseBranch: string
  behind: number
  branch: string | null
  upstream: string | null
}) {
  return (
    <div className="flex items-center gap-1.5 px-0.5 pb-3 text-xs">
      <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate font-medium text-foreground">
        {branch ?? "detached HEAD"}
      </span>
      {baseBranch ? (
        <>
          <span className="shrink-0 text-muted-foreground/50">→</span>
          <span className="truncate text-muted-foreground">{baseBranch}</span>
        </>
      ) : null}
      <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
        {!upstream
          ? "unpushed"
          : ahead || behind
            ? `${ahead ? `↑${ahead}` : ""}${behind ? `↓${behind}` : ""}`
            : "up to date"}
      </span>
    </div>
  )
}

export function ChangesSection({
  diffStatByPath,
  files,
  onOpenFile,
}: {
  diffStatByPath: Map<string, DiffFileStat>
  files: SandboxGitFile[]
  onOpenFile: (path: string, mode: FileBrowserOpenMode) => void
}) {
  return (
    <div>
      <SectionHeading count={files.length || undefined}>Changes</SectionHeading>
      <div className={cn("overflow-hidden", cardSurfaceClass)}>
        {files.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">No changes.</p>
        ) : (
          <ul>
            {files.map((file) => (
              <FileRow
                key={file.path}
                file={file}
                stat={diffStatByPath.get(file.path)}
                onOpen={() => onOpenFile(file.path, "diff")}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function statusCodeColor(code: string) {
  if (code === "A" || code === "U") {
    return "text-success"
  }
  if (code === "D") return "text-destructive"
  return "text-muted-foreground"
}

function FileRow({
  file,
  onOpen,
  stat,
}: {
  file: SandboxGitFile
  onOpen: () => void
  stat?: DiffFileStat
}) {
  const slash = file.path.lastIndexOf("/")
  const dir = slash === -1 ? "" : file.path.slice(0, slash + 1)
  const name = slash === -1 ? file.path : file.path.slice(slash + 1)

  return (
    <li className="border-b border-border/50 last:border-b-0">
      <button
        type="button"
        onClick={onOpen}
        title={file.path}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/30"
      >
        <span
          className={cn(
            "w-3 shrink-0 text-center font-mono text-[11px] font-medium",
            statusCodeColor(file.code)
          )}
        >
          {file.code}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
          {dir ? <span className="text-muted-foreground">{dir}</span> : null}
          {name}
        </span>
        {stat ? (
          <span className="shrink-0 font-mono text-[11px] tabular-nums">
            <span className="text-success">+{stat.additions}</span>{" "}
            <span className="text-destructive">−{stat.deletions}</span>
          </span>
        ) : null}
      </button>
    </li>
  )
}

export function CommitSection({
  busy,
  canCommit,
  connected,
  hasChanges,
  onChange,
  onCommit,
  onCommitAndPush,
  onPush,
  pushLabel,
  value,
}: {
  busy: GithubPanelBusyKind
  canCommit: boolean
  connected: boolean
  hasChanges: boolean
  onChange: (value: string) => void
  onCommit: () => void
  onCommitAndPush: () => void
  onPush: () => void
  pushLabel: string | null
  value: string
}) {
  return (
    <div className="mt-4">
      <SectionHeading>Commit</SectionHeading>
      <Textarea
        aria-label="Commit message"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Message"
        rows={3}
        spellCheck={false}
        className="text-[13px]"
      />
      {hasChanges ? (
        <div className="mt-2 flex items-center justify-end gap-2">
          <SecondaryButton
            onClick={onCommit}
            disabled={!canCommit}
            loading={busy === "commit"}
          >
            Commit
          </SecondaryButton>
          <PrimaryButton
            onClick={onCommitAndPush}
            disabled={!canCommit || !connected}
            loading={busy === "commit-push"}
          >
            Commit &amp; Push
          </PrimaryButton>
        </div>
      ) : pushLabel ? (
        <div className="mt-2 flex justify-end">
          <PrimaryButton
            onClick={onPush}
            disabled={busy !== null}
            loading={busy === "push"}
          >
            {pushLabel}
          </PrimaryButton>
        </div>
      ) : null}
    </div>
  )
}
