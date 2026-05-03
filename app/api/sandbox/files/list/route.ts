import { NextResponse } from "next/server"

import { withReadableSandbox } from "@/lib/e2b-sandbox-files"
import { refreshSandboxInactivityTimeout } from "@/lib/e2b-sandbox-timeout"

export const runtime = "nodejs"

const REPO_PATH = "/home/user/repo"
// Directories whose contents we don't recurse into (we still surface the
// directory itself so it shows up — collapsed — in the tree).
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

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function toEntries(stdout: string) {
  const entries: EntryOut[] = []
  const seen = new Set<string>()
  let total = 0

  for (const raw of stdout.split("\0")) {
    const path = raw.trim().replace(/^\.\//, "")
    if (!path || seen.has(path)) continue
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
  const snapshotId = searchParams.get("snapshotId")
  const root = searchParams.get("root") || REPO_PATH

  if (!sandboxId && !snapshotId) {
    return NextResponse.json(
      { error: "sandboxId or snapshotId required" },
      { status: 400 }
    )
  }

  try {
    const out = await withReadableSandbox(
      { sandboxId, snapshotId },
      async (sandbox, source) => {
        if (source === "sandbox") {
          await refreshSandboxInactivityTimeout(sandbox)
        }
        const skipNames = [...SKIP_DESCEND]
          .map((name) => `-name ${shellQuote(name)}`)
          .join(" -o ")
        const command = [
          "set -e",
          `cd ${shellQuote(root)}`,
          "if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then",
          `  git ls-files -co --exclude-standard -z | head -z -n ${MAX_ENTRIES + 1}`,
          "else",
          `  find . \\( ${skipNames} \\) -prune -o -type f -print0 | head -z -n ${MAX_ENTRIES + 1}`,
          "fi",
        ].join("\n")
        const result = await sandbox.commands.run(
          `bash -lc ${shellQuote(command)}`,
          {
            timeoutMs: 10_000,
          }
        )
        return toEntries(result.stdout)
      }
    )

    return NextResponse.json({
      root,
      entries: out.entries,
      truncated: out.truncated,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to list files",
      },
      { status: 500 }
    )
  }
}
