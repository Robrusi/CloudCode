import type { FileDiffMetadata } from "@pierre/diffs"
import type { CSSProperties } from "react"

const IMAGE_EXTENSIONS = new Set([
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

const PIERRE_LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  md: "markdown",
  mdx: "markdown",
  plaintext: "text",
  py: "python",
  sh: "bash",
  shell: "bash",
  text: "text",
  ts: "typescript",
  tsx: "typescript",
  yml: "yaml",
}

// Match @pierre/diffs line splitting so reconstructed hunks preserve newlines.
const SPLIT_KEEP_NEWLINES = /(?<=\n)/

export type FileViewMode = "diff" | "file" | "preview"

export const PIERRE_CODE_THEMES = {
  dark: "pierre-dark",
  light: "pierre-light",
} as const

export const PIERRE_FILE_STYLE: CSSProperties = {
  "--diffs-font-family": "var(--font-mono)",
  "--diffs-font-size": "13px",
  "--diffs-line-height": "1.6",
  "--diffs-gap-block": "16px",
  "--diffs-gap-inline": "16px",
} as CSSProperties

export function getPierreLanguageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "text"
  return PIERRE_LANGUAGE_ALIASES[ext] ?? ext
}

export function basename(path: string): string {
  return path.split("/").pop() ?? path
}

export function isImagePath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase()
  return ext ? IMAGE_EXTENSIONS.has(ext) : false
}

export function isMarkdownPath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase()
  return ext === "md" || ext === "mdx" || ext === "markdown"
}

export function diffStat(fileDiff: FileDiffMetadata) {
  return fileDiff.hunks.reduce(
    (acc, hunk) => ({
      additions: acc.additions + hunk.additionLines,
      deletions: acc.deletions + hunk.deletionLines,
    }),
    { additions: 0, deletions: 0 }
  )
}

export function sandboxFileReadUrl({
  path,
  refreshNonce,
  sandboxId,
}: {
  path: string
  refreshNonce: number
  sandboxId: string | null
}) {
  const params = new URLSearchParams({
    path,
    format: "raw",
    refresh: String(refreshNonce),
    ...(sandboxId ? { sandboxId } : {}),
  })
  return `/api/sandbox/files/read?${params}`
}

export function reconstructOldContent(
  newContent: string,
  fileDiff: FileDiffMetadata
): string {
  const oldLines = newContent.split(SPLIT_KEEP_NEWLINES)

  for (let i = fileDiff.hunks.length - 1; i >= 0; i--) {
    const hunk = fileDiff.hunks[i]
    const oldHunkLines: string[] = []

    for (const block of hunk.hunkContent) {
      if (block.type === "context") {
        for (let j = 0; j < block.lines; j++) {
          oldHunkLines.push(fileDiff.deletionLines[block.deletionLineIndex + j])
        }
      } else {
        for (let j = 0; j < block.deletions; j++) {
          oldHunkLines.push(fileDiff.deletionLines[block.deletionLineIndex + j])
        }
      }
    }

    const start = Math.max(0, hunk.additionStart - 1)
    oldLines.splice(start, hunk.additionCount, ...oldHunkLines)
  }

  return oldLines.join("")
}

export function contentFromAdditionLines(fileDiff: FileDiffMetadata) {
  const lines: string[] = []

  for (const hunk of fileDiff.hunks) {
    for (const block of hunk.hunkContent) {
      if (block.type === "context") {
        for (let j = 0; j < block.lines; j += 1) {
          lines.push(fileDiff.additionLines[block.additionLineIndex + j])
        }
      } else {
        for (let j = 0; j < block.additions; j += 1) {
          lines.push(fileDiff.additionLines[block.additionLineIndex + j])
        }
      }
    }
  }

  return lines.join("")
}

export function applyDiffToOldContent(
  oldContent: string,
  fileDiff: FileDiffMetadata
): string | null {
  if (fileDiff.type === "deleted") return null
  if (fileDiff.type === "new") return contentFromAdditionLines(fileDiff)
  if (fileDiff.hunks.length === 0) return oldContent

  const nextLines = oldContent.split(SPLIT_KEEP_NEWLINES)

  for (let i = fileDiff.hunks.length - 1; i >= 0; i -= 1) {
    const hunk = fileDiff.hunks[i]
    const newHunkLines: string[] = []

    for (const block of hunk.hunkContent) {
      if (block.type === "context") {
        for (let j = 0; j < block.lines; j += 1) {
          newHunkLines.push(fileDiff.additionLines[block.additionLineIndex + j])
        }
      } else {
        for (let j = 0; j < block.additions; j += 1) {
          newHunkLines.push(fileDiff.additionLines[block.additionLineIndex + j])
        }
      }
    }

    const start = Math.max(0, hunk.deletionStart - 1)
    nextLines.splice(start, hunk.deletionCount, ...newHunkLines)
  }

  return nextLines.join("")
}
