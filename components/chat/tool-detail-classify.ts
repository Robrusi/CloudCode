import { extractFileOps } from "@/components/chat/tool-detail-files"
import type { ParsedLogDetail } from "@/components/chat/tool-detail-types"

export type DetailKind =
  | "read"
  | "search"
  | "command"
  | "edit"
  | "create"
  | "other"

type CommandIntent =
  | { kind: "command" }
  | { kind: "read"; target: string }
  | { kind: "search"; query: string }

const READ_PROGRAMS = new Set([
  "bat",
  "cat",
  "head",
  "less",
  "more",
  "sed",
  "tail",
  "view",
])

const SEARCH_PROGRAMS = new Set([
  "ack",
  "ag",
  "egrep",
  "fgrep",
  "find",
  "grep",
  "ripgrep",
  "rg",
])

export function unwrapShellCommand(cmd: string): string {
  let current = cmd
  for (let i = 0; i < 4; i++) {
    const envMatch = current.match(/^env(?:\s+\w+=\S+)+\s+([\s\S]*)$/)
    if (envMatch) {
      current = envMatch[1].trim()
      continue
    }
    const shellMatch = current.match(
      /^(?:\/[\w/]*\/)?(?:bash|sh|zsh)(?:\s+-[a-z]+)*\s+(['"])([\s\S]*)\1\s*$/
    )
    if (shellMatch) {
      current = shellMatch[2].trim()
      continue
    }
    const shellNoQuote = current.match(
      /^(?:\/[\w/]*\/)?(?:bash|sh|zsh)\s+-[a-z]*c\s+([\s\S]*)$/
    )
    if (shellNoQuote) {
      current = shellNoQuote[1].trim().replace(/^['"]|['"]$/g, "")
      continue
    }
    break
  }
  return current || cmd
}

export function inferCommandIntent(rawCmd: string): CommandIntent {
  if (!rawCmd) return { kind: "command" }
  const firstSegment = rawCmd.split(/\||&&|;|\n/)[0].trim()
  const tokens = tokenizeShell(firstSegment)
  if (tokens.length === 0) return { kind: "command" }
  const program = stripQuotes(tokens[0]).split("/").pop() ?? ""
  const args = tokens.slice(1).map(stripQuotes)

  if (READ_PROGRAMS.has(program)) {
    const target = pickReadTarget(program, args)
    if (target) return { kind: "read", target }
  }
  if (SEARCH_PROGRAMS.has(program)) {
    const query = pickSearchQuery(program, args)
    if (query) return { kind: "search", query }
  }
  return { kind: "command" }
}

export function classifyDetail(detail: ParsedLogDetail): DetailKind {
  const ops = extractFileOps(detail)
  if (ops.length > 0) {
    return ops.every((o) => o.op === "add") ? "create" : "edit"
  }
  if (detail.kind === "file_change") return "edit"
  if (detail.kind === "command_execution") {
    const intent = inferCommandIntent(
      unwrapShellCommand(detail.command?.trim() ?? "")
    )
    return intent.kind
  }
  const name = (detail.name || "").toLowerCase()
  if (/edit|patch|write|apply|insert|update/.test(name)) return "edit"
  if (/create/.test(name)) return "create"
  if (/list|search|grep|glob|find/.test(name)) return "search"
  if (/read|view|cat|open|file/.test(name)) return "read"
  return "other"
}

function tokenizeShell(cmd: string): string[] {
  const matches = cmd.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+/g)
  return matches ?? []
}

function stripQuotes(token: string): string {
  if (token.length >= 2) {
    const first = token[0]
    const last = token[token.length - 1]
    if ((first === '"' || first === "'") && first === last) {
      return token.slice(1, -1)
    }
  }
  return token
}

function pickReadTarget(program: string, args: string[]): string | null {
  const skipNext = new Set<number>()
  if (program === "head" || program === "tail") {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "-n" || args[i] === "-c") skipNext.add(i + 1)
    }
  }
  if (program === "sed") {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "-e" || args[i] === "-f") skipNext.add(i + 1)
    }
  }
  for (let i = args.length - 1; i >= 0; i--) {
    if (skipNext.has(i)) continue
    const arg = args[i]
    if (!arg || arg.startsWith("-")) continue
    return arg
  }
  return null
}

function pickSearchQuery(program: string, args: string[]): string | null {
  if (program === "find") {
    for (let i = 0; i < args.length - 1; i++) {
      if (args[i] === "-name" || args[i] === "-iname" || args[i] === "-path") {
        return args[i + 1]
      }
    }
    return null
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "-e" || arg === "--regexp") return args[i + 1] ?? null
    if (arg && !arg.startsWith("-")) return arg
  }
  return null
}
