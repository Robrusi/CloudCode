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

export type ParsedDiffMetadata = {
  files: FileDiffMetadata[]
  stats: DiffStats
}

const EMPTY_DIFF_STATS: DiffStats = { additions: 0, deletions: 0, files: [] }
const EMPTY_PARSED_DIFF: ParsedDiffMetadata = {
  files: [],
  stats: EMPTY_DIFF_STATS,
}
const PARSED_DIFF_CACHE_LIMIT = 12
const parsedDiffCache = new Map<string, ParsedDiffMetadata>()

function countChangedLines(file: FileDiffMetadata) {
  let additions = 0
  let deletions = 0
  for (const hunk of file.hunks) {
    additions += hunk.additionLines
    deletions += hunk.deletionLines
  }
  return { additions, deletions }
}

function setParsedDiffCache(diff: string, parsed: ParsedDiffMetadata) {
  parsedDiffCache.set(diff, parsed)
  if (parsedDiffCache.size <= PARSED_DIFF_CACHE_LIMIT) return

  const oldestKey = parsedDiffCache.keys().next().value
  if (oldestKey !== undefined) parsedDiffCache.delete(oldestKey)
}

export function getParsedDiffMetadata(diff?: string): ParsedDiffMetadata {
  if (!diff?.trim()) return EMPTY_PARSED_DIFF

  const cached = parsedDiffCache.get(diff)
  if (cached) {
    parsedDiffCache.delete(diff)
    parsedDiffCache.set(diff, cached)
    return cached
  }

  try {
    const files = parsePatchFiles(diff, "cloudcode-diff", false).flatMap(
      (patch) => patch.files
    )
    const statsFiles = files.map((file) => {
      const counts = countChangedLines(file)
      return {
        ...counts,
        path: file.name,
        prevPath: file.prevName,
        type: file.type,
      }
    })

    const totals = statsFiles.reduce(
      (acc, file) => ({
        additions: acc.additions + file.additions,
        deletions: acc.deletions + file.deletions,
      }),
      { additions: 0, deletions: 0 }
    )
    const parsed = {
      files,
      stats: { ...totals, files: statsFiles },
    }
    setParsedDiffCache(diff, parsed)
    return parsed
  } catch {
    return EMPTY_PARSED_DIFF
  }
}

export function getDiffStats(diff?: string): DiffStats {
  return getParsedDiffMetadata(diff).stats
}

export function findDiffForPath(diff: string | undefined, path: string) {
  return getParsedDiffMetadata(diff).files.find(
    (file) => file.name === path || file.prevName === path
  )
}

export function diffTypeToGitStatus(
  type: ChangeTypes
): GitStatusEntry["status"] {
  if (type === "new") return "added"
  if (type === "deleted") return "deleted"
  if (type === "rename-pure" || type === "rename-changed") return "renamed"
  return "modified"
}

export function formatDiffStat(additions: number, deletions: number) {
  return `+${additions} / -${deletions}`
}
