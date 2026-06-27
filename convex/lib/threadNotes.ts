import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import { codexRunInput } from "./codexRunRecords"

export const MAX_NOTES_LENGTH = 20_000

export async function requireRunThreadNotesAccess(
  ctx: QueryCtx | MutationCtx,
  args: {
    notesAccessToken: string
    runId: Id<"codexRuns">
    threadId: Id<"threads">
  }
) {
  const [run, input, thread] = await Promise.all([
    ctx.db.get(args.runId),
    codexRunInput(ctx, args.runId),
    ctx.db.get(args.threadId),
  ])
  const notesAccessToken = input?.notesAccessToken ?? run?.notesAccessToken

  if (
    !run ||
    !thread ||
    run.threadId !== args.threadId ||
    thread.userId !== run.userId ||
    !notesAccessToken ||
    notesAccessToken !== args.notesAccessToken
  ) {
    throw new Error("Shared notes are unavailable for this run.")
  }

  return thread
}

function notesChecksum(notes: string) {
  let hash = 2166136261
  for (let index = 0; index < notes.length; index += 1) {
    hash ^= notes.charCodeAt(index)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash.toString(36)
}

export function notesRevision(notes: string) {
  return `v1:${notes.length}:${notesChecksum(notes)}`
}

export function notesResponse(thread: Doc<"threads">) {
  const notes = thread.notes ?? ""
  return {
    maxLength: MAX_NOTES_LENGTH,
    notes,
    revision: notesRevision(notes),
  }
}

export function normalizeNotes(notes: string) {
  return notes.replace(/\r\n/g, "\n").slice(0, MAX_NOTES_LENGTH)
}

export function patchNotesValue(notes: string) {
  return notes.length > 0 ? notes : undefined
}

export function appendNotes(current: string, addition: string) {
  const text = addition.replace(/\r\n/g, "\n").trim()
  if (!text) return current

  const base = current.replace(/\r\n/g, "\n").trimEnd()
  return normalizeNotes(base ? `${base}\n\n${text}` : text)
}

export function todoLine(text: string, checked: boolean) {
  return `- [${checked ? "x" : " "}] ${text.replace(/\s+/g, " ").trim()}`
}

export function setTodoStatus(
  current: string,
  text: string,
  checked: boolean,
  occurrence: number
) {
  const target = text.trim()
  if (!target) return { notes: current, updated: false }

  const targetOccurrence = Math.max(1, Math.floor(occurrence || 1))
  let seen = 0
  let updated = false
  const lines = current.replace(/\r\n/g, "\n").split("\n")
  const next = lines.map((line) => {
    const match = line.match(/^(\s*[-*]\s+\[)( |x|X)(\]\s?)(.*)$/)
    if (!match || match[4].trim() !== target) return line

    seen += 1
    if (seen !== targetOccurrence) return line

    updated = true
    return `${match[1]}${checked ? "x" : " "}${match[3]}${match[4]}`
  })

  return {
    notes: updated ? normalizeNotes(next.join("\n")) : current,
    updated,
  }
}
