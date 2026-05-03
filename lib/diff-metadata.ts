import {
  parsePatchFiles,
  type ChangeTypes,
  type FileDiffMetadata,
} from "@pierre/diffs"
import type { GitStatusEntry } from "@pierre/trees"

export type DiffFileStat = {
  additions: number
  deletions: number
  path: string
  prevPath?: string
  type: ChangeTypes
}

export type DiffStats = {
  additions: number
  deletions: number
  files: DiffFileStat[]
}

function countChangedLines(file: FileDiffMetadata) {
  let additions = 0
  let deletions = 0
  for (const hunk of file.hunks) {
    additions += hunk.additionLines
    deletions += hunk.deletionLines
  }
  return { additions, deletions }
}

export function parsePatchDiff(diff?: string): FileDiffMetadata[] {
  if (!diff?.trim()) return []
  try {
    return parsePatchFiles(diff, "cloudcode-diff", false).flatMap(
      (patch) => patch.files
    )
  } catch {
    return []
  }
}

export function getDiffStats(diff?: string): DiffStats {
  const files = parsePatchDiff(diff).map((file) => {
    const counts = countChangedLines(file)
    return {
      ...counts,
      path: file.name,
      prevPath: file.prevName,
      type: file.type,
    }
  })

  const totals = files.reduce(
    (acc, file) => ({
      additions: acc.additions + file.additions,
      deletions: acc.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 }
  )

  return { ...totals, files }
}

export function findDiffForPath(diff: string | undefined, path: string) {
  return parsePatchDiff(diff).find(
    (file) => file.name === path || file.prevName === path
  )
}

export function diffTypeToGitStatus(type: ChangeTypes): GitStatusEntry["status"] {
  if (type === "new") return "added"
  if (type === "deleted") return "deleted"
  if (type === "rename-pure" || type === "rename-changed") return "renamed"
  return "modified"
}

export function formatDiffStat(additions: number, deletions: number) {
  return `+${additions} / -${deletions}`
}
