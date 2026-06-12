import type { DiffFileStat } from "@/lib/diff/metadata"
import type { SandboxFileEntry } from "@/lib/sandbox/file-cache"

export type FileBrowserOpenMode = "diff" | "file" | "preview"
export type BrowserView = "diffs" | "env" | "files"

export type FileBrowserListResponse = {
  entries: SandboxFileEntry[]
  error?: string
  root: string
  truncated?: boolean
}

export function applyLiveDiffToEntries(
  entries: readonly SandboxFileEntry[],
  changedFiles: readonly DiffFileStat[],
  {
    includeMissingChangedFiles,
  }: {
    includeMissingChangedFiles: boolean
  }
): SandboxFileEntry[] {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]))

  for (const file of changedFiles) {
    if (file.prevPath && file.prevPath !== file.path) {
      byPath.delete(file.prevPath)
    }

    if (file.type === "deleted") {
      byPath.delete(file.path)
      continue
    }

    if (!includeMissingChangedFiles && !byPath.has(file.path)) {
      continue
    }

    byPath.set(file.path, { path: file.path, type: "file" })
  }

  return Array.from(byPath.values()).sort((a, b) =>
    a.path.localeCompare(b.path)
  )
}
