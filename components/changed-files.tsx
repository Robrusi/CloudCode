"use client"

import { FileDiff, type ThemeTypes } from "@pierre/diffs/react"
import type { FileDiffOptions } from "@pierre/diffs"
import { ChevronDown, ChevronRight, Folder } from "lucide-react"
import { useTheme } from "next-themes"
import { type CSSProperties, useMemo, useState } from "react"

import { TreeFileIcon } from "@/components/tree-file-icon"
import { Button } from "@/components/ui/button"
import {
  getDiffStats,
  parsePatchDiff,
  type DiffFileStat,
} from "@/lib/diff-metadata"
import { cn } from "@/lib/utils"

const PIERRE_CODE_THEMES = {
  dark: "pierre-dark",
  light: "pierre-light",
} as const

// Match the file-editor styling exactly so diff rows here look identical to
// the single-file viewer.
const PIERRE_FILE_STYLE: CSSProperties = {
  "--diffs-font-family": "var(--font-mono)",
  "--diffs-font-size": "13px",
  "--diffs-line-height": "1.6",
  "--diffs-gap-block": "16px",
  "--diffs-gap-inline": "16px",
} as CSSProperties

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
  onOpenDiff,
  onToggle,
}: {
  nodes: TreeNode[]
  depth: number
  expanded: Set<string>
  onOpenDiff?: (path: string) => void
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
                <span className="flex-1 truncate text-[13px] text-foreground">
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
                  onOpenDiff={onOpenDiff}
                  onToggle={onToggle}
                />
              ) : null}
            </div>
          )
        }

        return (
          <button
            type="button"
            key={`file:${node.path}`}
            onClick={() => onOpenDiff?.(node.path)}
            className="flex w-full items-center gap-2 rounded-md py-1 pr-2 text-left transition-colors hover:bg-muted/60"
            style={indentStyle}
            title={node.path}
          >
            <span className="size-3.5 shrink-0" />
            <TreeFileIcon path={node.path} />
            <span className="flex-1 truncate text-[13px] text-foreground">
              {node.name}
            </span>
            <DiffStatBadge
              additions={node.stat.additions}
              deletions={node.stat.deletions}
            />
          </button>
        )
      })}
    </>
  )
}

export function ChangedFiles({
  diff,
  onOpenDiff,
}: {
  diff: string
  onOpenDiff?: (path: string) => void
}) {
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
          onOpenDiff={onOpenDiff}
          onToggle={toggle}
        />
      </div>
    </div>
  )
}

export type DiffStyle = "unified" | "split"

export function DiffList({
  diff,
  diffStyle = "unified",
}: {
  diff: string
  diffStyle?: DiffStyle
}) {
  const files = useMemo(() => parsePatchDiff(diff), [diff])
  const fileStats = useMemo(() => {
    const map = new Map<string, { additions: number; deletions: number }>()
    for (const file of getDiffStats(diff).files) {
      map.set(file.path, {
        additions: file.additions,
        deletions: file.deletions,
      })
    }
    return map
  }, [diff])

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(files.map((f) => f.name))
  )

  const { resolvedTheme } = useTheme()
  const themeType: ThemeTypes = resolvedTheme === "dark" ? "dark" : "light"

  const diffOptions = useMemo<FileDiffOptions<undefined>>(
    () => ({
      diffIndicators: "bars",
      diffStyle,
      disableFileHeader: true,
      disableLineNumbers: false,
      hunkSeparators: "line-info-basic",
      lineDiffType: "word",
      overflow: "wrap",
      theme: PIERRE_CODE_THEMES,
      themeType,
    }),
    [diffStyle, themeType]
  )

  if (files.length === 0) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        No changed files.
      </div>
    )
  }

  const toggle = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  return (
    <div className="divide-y divide-border/60">
      {files.map((file) => {
        const isOpen = expanded.has(file.name)
        const stat = fileStats.get(file.name) ?? { additions: 0, deletions: 0 }
        return (
          <div key={file.name}>
            <button
              type="button"
              onClick={() => toggle(file.name)}
              aria-expanded={isOpen}
              className="sticky top-0 z-10 flex w-full items-center gap-2.5 border-b border-border/60 bg-background/85 px-4 py-2.5 text-left backdrop-blur-xl transition-colors hover:bg-muted/60"
            >
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground transition-transform",
                  isOpen && "rotate-90"
                )}
                strokeWidth={2}
              />
              <TreeFileIcon path={file.name} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                {file.name}
              </span>
              <DiffStatBadge
                additions={stat.additions}
                deletions={stat.deletions}
              />
            </button>
            {isOpen ? (
              <div className="overflow-x-auto bg-background pb-3">
                <FileDiff
                  fileDiff={file}
                  options={diffOptions}
                  disableWorkerPool
                  style={PIERRE_FILE_STYLE}
                />
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
