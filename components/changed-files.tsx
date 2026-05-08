"use client"

import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder,
} from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { getDiffStats, type DiffFileStat } from "@/lib/diff-metadata"
import { cn } from "@/lib/utils"

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

export function ChangedFiles({ diff }: { diff: string }) {
  const stats = useMemo(() => getDiffStats(diff), [diff])
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
