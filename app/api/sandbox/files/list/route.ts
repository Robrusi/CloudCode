import { NextResponse } from "next/server"

import {
  getStartedDaytonaSandbox,
  resolveDaytonaPaths,
  runDaytonaCommand,
  shellQuote,
} from "@/lib/daytona-sandbox"

export const runtime = "nodejs"

const SKIP_DESCEND = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  ".turbo",
  ".cache",
  ".vercel",
])
const MAX_ENTRIES = 5000

type EntryOut = { path: string; type: "file" | "dir" }

function toEntries(stdout: string) {
  const entries: EntryOut[] = []
  const seen = new Set<string>()
  let total = 0

  for (const raw of stdout.split("\0")) {
    const path = raw.trim().replace(/^\.\//, "")
    if (!path || seen.has(path)) continue
    if (
      path.startsWith("tmp/cloudcode-") ||
      path.startsWith(".codex/") ||
      path.includes("/.env")
    ) {
      continue
    }
    total += 1
    seen.add(path)
    entries.push({ path, type: "file" })
    if (entries.length >= MAX_ENTRIES) break
  }

  entries.sort((a, b) => a.path.localeCompare(b.path))
  return { entries, truncated: total > MAX_ENTRIES }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sandboxId = searchParams.get("sandboxId")
  const requestedRoot = searchParams.get("root")

  if (!sandboxId) {
    return NextResponse.json({ error: "sandboxId required" }, { status: 400 })
  }

  try {
    const sandbox = await getStartedDaytonaSandbox(sandboxId)
    const root = requestedRoot || (await resolveDaytonaPaths(sandbox)).repoPath
    const skipNames = [...SKIP_DESCEND]
      .map((name) => `-name ${shellQuote(name)}`)
      .join(" -o ")
    const command = [
      "set -e",
      `if [ ! -d ${shellQuote(root)} ]; then exit 0; fi`,
      `cd ${shellQuote(root)}`,
      "if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then",
      `  git ls-files -co --exclude-standard -z | head -z -n ${MAX_ENTRIES + 1}`,
      "else",
      `  find . \\( ${skipNames} \\) -prune -o -type f -print0 | head -z -n ${MAX_ENTRIES + 1}`,
      "fi",
    ].join("\n")
    const result = await runDaytonaCommand(sandbox, command, {
      timeoutMs: 10_000,
    })
    const out = toEntries(result.stdout)

    return NextResponse.json({
      entries: out.entries,
      root,
      truncated: out.truncated,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to list files",
      },
      { status: 500 }
    )
  }
}
