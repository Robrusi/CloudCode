import type { ParsedLogDetail } from "@/components/chat/tool-detail-types"

export type FileOp = { op: "add" | "delete" | "update"; path: string }

const PATCH_FILE_REGEX = /\*\*\* (Add|Update|Delete) File:\s*([^\n]+)/g

function normalizeChangeOp(kind: string | undefined): FileOp["op"] | null {
  if (kind === "add" || kind === "create") return "add"
  if (kind === "delete" || kind === "remove") return "delete"
  if (kind === "update" || kind === "modify" || kind === "edit") {
    return "update"
  }
  return null
}

export function extractFileOps(detail: ParsedLogDetail): FileOp[] {
  const changeOps = (detail.changes ?? []).flatMap((change) => {
    const op = normalizeChangeOp(change.kind)
    return op && change.path ? [{ op, path: change.path }] : []
  })
  if (changeOps.length > 0) return changeOps

  const sources: string[] = []
  if (detail.command) sources.push(detail.command)
  if (detail.text) sources.push(detail.text)
  const ops: FileOp[] = []
  for (const src of sources) {
    PATCH_FILE_REGEX.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = PATCH_FILE_REGEX.exec(src)) !== null) {
      const op = m[1].toLowerCase() as FileOp["op"]
      ops.push({ op, path: m[2].trim() })
    }
  }
  return ops
}

export function extractPatchBody(detail: ParsedLogDetail): string | null {
  const sources = [detail.command, detail.text].filter(
    (s): s is string => typeof s === "string" && s.length > 0
  )
  for (const src of sources) {
    const patch = src.match(/\*\*\* Begin Patch[\s\S]*?\*\*\* End Patch/)
    if (patch) return patch[0].trim()

    const start = src.search(/\*\*\* (Add|Update|Delete) File:/)
    if (start !== -1) return src.slice(start).trim()
  }
  return null
}

export function buildDiffFromChanges(
  detail: ParsedLogDetail,
  fileOp?: FileOp
): string | null {
  const changes = detail.changes ?? []
  const parts: string[] = []
  for (const change of changes) {
    if (
      fileOp &&
      (!change.path || !pathsReferToSameFile(change.path, fileOp.path))
    ) {
      continue
    }
    if (!change.diff?.trim()) continue
    const normalized = normalizeChangeDiff(change)
    if (normalized) parts.push(normalized)
  }
  return parts.length > 0 ? parts.join("\n") : null
}

// The diff renderer (@pierre/diffs) only accepts hunk headers with explicit
// ranges: `@@ -N[,M] +N[,M] @@`. Codex emits apply_patch-style diffs whose
// hunk markers are bare `@@` or `@@ context`, and fileChange items can carry
// raw file content with no unified prefixes at all, so every diff we hand to
// the renderer goes through normalizeUnifiedHunks to get computed ranges.
const HUNK_RANGE_HEADER = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/
const FILE_BOUNDARY_LINE = /^(?:diff --git |index |--- |\+\+\+ )/

type PendingHunk = { context: string; lines: string[] }

function normalizeUnifiedHunks(body: string): string {
  const out: string[] = []
  let pending: PendingHunk | null = null
  let passthrough = false
  let oldLine = 1
  let newLine = 1

  const flush = () => {
    if (!pending) return
    const lines = [...pending.lines]
    while (lines.length > 0 && lines.at(-1) === "") lines.pop()
    const context = pending.context
    pending = null
    if (lines.length === 0) return

    let additions = 0
    let deletions = 0
    let unchanged = 0
    for (const line of lines) {
      if (line.startsWith("+")) additions += 1
      else if (line.startsWith("-")) deletions += 1
      else if (!line.startsWith("\\")) unchanged += 1
    }
    const oldCount = deletions + unchanged
    const newCount = additions + unchanged
    const oldStart = oldCount === 0 ? 0 : oldLine
    const newStart = newCount === 0 ? 0 : newLine
    out.push(
      `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${context ? ` ${context}` : ""}`
    )
    out.push(...lines)
    oldLine = Math.max(oldStart + oldCount, 1)
    newLine = Math.max(newStart + newCount, 1)
  }

  for (const line of body.split("\n")) {
    if (FILE_BOUNDARY_LINE.test(line)) {
      flush()
      passthrough = false
      oldLine = 1
      newLine = 1
      out.push(line)
      continue
    }
    if (HUNK_RANGE_HEADER.test(line)) {
      // Already a valid hunk; trust it and pass its lines through untouched.
      flush()
      passthrough = true
      out.push(line)
      continue
    }
    if (line.startsWith("@@")) {
      flush()
      passthrough = false
      const context = line
        .replace(/^@@+/, "")
        .replace(/@@+\s*$/, "")
        .trim()
      pending = { context, lines: [] }
      continue
    }
    if (passthrough) {
      out.push(line)
      continue
    }
    if (!pending) pending = { context: "", lines: [] }
    pending.lines.push(line)
  }
  flush()
  return out.join("\n")
}

function ensureUnifiedPrefixes(diff: string, op: FileOp["op"]): string {
  const lines = diff.split("\n")
  const isMeta = (line: string) =>
    line.startsWith("@@") || line.startsWith("\\")
  const looksUnified =
    op === "add"
      ? lines.every(
          (line) => line === "" || line.startsWith("+") || isMeta(line)
        )
      : op === "delete"
        ? lines.every(
            (line) => line === "" || line.startsWith("-") || isMeta(line)
          )
        : lines.every((line) => line === "" || /^[+\- @\\]/.test(line)) &&
          lines.some((line) => /^[+-]/.test(line) || line.startsWith("@@"))
  if (looksUnified) return diff

  const prefix = op === "add" ? "+" : op === "delete" ? "-" : " "
  return lines.map((line) => prefix + line).join("\n")
}

function normalizeChangeDiff(change: {
  diff?: string
  kind?: string
  path?: string
}): string | null {
  const diff = change.diff?.trim()
  if (!diff) return null
  if (/^\*\*\* (Add|Update|Delete) File:/.test(diff)) {
    return applyPatchToUnifiedDiff(diff)
  }
  if (/^---\s/m.test(diff) && /^\+\+\+\s/m.test(diff)) {
    return normalizeUnifiedHunks(diff)
  }

  const path = change.path?.trim() ?? "file"
  const op = normalizeChangeOp(change.kind) ?? "update"
  const header: string[] = []
  if (op === "add") {
    header.push(`--- /dev/null`, `+++ b/${path}`)
  } else if (op === "delete") {
    header.push(`--- a/${path}`, `+++ /dev/null`)
  } else {
    header.push(`--- a/${path}`, `+++ b/${path}`)
  }
  const body = normalizeUnifiedHunks(ensureUnifiedPrefixes(diff, op))
  if (!body) return null
  return `${header.join("\n")}\n${body}`
}

export function applyPatchToUnifiedDiff(patch: string): string {
  const inner = patch
    .replace(/^\*\*\* Begin Patch\s*\n?/, "")
    .replace(/\n?\*\*\* End Patch\s*$/, "")
    .trim()

  const fileBlockRegex =
    /\*\*\* (Add|Update|Delete) File:\s*([^\n]+)\n?([\s\S]*?)(?=\n\*\*\* (?:Add|Update|Delete) File:|$)/g

  const out: string[] = []
  let m: RegExpExecArray | null
  fileBlockRegex.lastIndex = 0
  while ((m = fileBlockRegex.exec(inner)) !== null) {
    const op = m[1]
    const path = m[2].trim()
    const body = m[3].replace(/\n+$/, "")
    if (op === "Add") {
      out.push(`--- /dev/null`, `+++ b/${path}`)
    } else if (op === "Delete") {
      out.push(`--- a/${path}`, `+++ /dev/null`)
    } else {
      out.push(`--- a/${path}`, `+++ b/${path}`)
    }
    if (body) {
      const normalized = normalizeUnifiedHunks(body)
      if (normalized) out.push(normalized)
    }
  }
  return out.length > 0 ? out.join("\n") : patch
}

export function extractPatchForFileOp(
  patch: string,
  fileOp: FileOp
): string | null {
  const inner = patch
    .replace(/^\*\*\* Begin Patch\s*\n?/, "")
    .replace(/\n?\*\*\* End Patch\s*$/, "")
    .trim()
  const fileBlockRegex =
    /\*\*\* (Add|Update|Delete) File:\s*([^\n]+)\n?([\s\S]*?)(?=\n\*\*\* (?:Add|Update|Delete) File:|$)/g

  let m: RegExpExecArray | null
  fileBlockRegex.lastIndex = 0
  while ((m = fileBlockRegex.exec(inner)) !== null) {
    const path = m[2].trim()
    if (!pathsReferToSameFile(path, fileOp.path)) continue
    return `*** ${m[1]} File: ${path}\n${m[3].replace(/\n+$/, "")}`
  }
  return null
}

function normalizeDiffPath(path: string): string {
  return path
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .replace(/^\/dev\/null$/, "")
    .replace(/^[ab]\//, "")
    .replace(/^\/root\/repo\//, "")
    .replace(/^\/workspace\//, "")
    .replace(/^\/+/, "")
}

function pathsReferToSameFile(left: string, right: string): boolean {
  const a = normalizeDiffPath(left)
  const b = normalizeDiffPath(right)
  if (!a || !b) return false
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`)
}

function filePathsFromUnifiedDiffBlock(block: string): string[] {
  const paths: string[] = []
  const gitHeader = block.match(/^diff --git\s+(\S+)\s+(\S+)/m)
  if (gitHeader) paths.push(gitHeader[1], gitHeader[2])

  for (const marker of [/^---\s+([^\t\n]+)/m, /^\+\+\+\s+([^\t\n]+)/m]) {
    const match = block.match(marker)
    if (match) paths.push(match[1])
  }

  return paths.filter((path) => normalizeDiffPath(path))
}

export function extractRunDiffForFileOps(
  runDiff: string | undefined,
  fileOps: FileOp[]
): string | null {
  if (!runDiff?.trim() || fileOps.length === 0) return null

  const blocks = runDiff.split(/(?=^diff --git\s+)/m).flatMap((block) => {
    const trimmed = block.trim()
    return trimmed ? [trimmed] : []
  })
  const candidates = blocks.length > 0 ? blocks : [runDiff.trim()]
  const matched = candidates.filter((block) => {
    const blockPaths = filePathsFromUnifiedDiffBlock(block)
    return fileOps.some((op) =>
      blockPaths.some((path) => pathsReferToSameFile(path, op.path))
    )
  })

  return matched.length > 0 ? matched.join("\n\n") : null
}
