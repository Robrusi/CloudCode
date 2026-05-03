import { Sandbox } from "e2b"
import { NextResponse } from "next/server"

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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sandboxId = searchParams.get("sandboxId")
  const root = searchParams.get("root") || REPO_PATH

  if (!sandboxId) {
    return NextResponse.json({ error: "sandboxId required" }, { status: 400 })
  }

  try {
    const sandbox = await Sandbox.connect(sandboxId)

    const queue: string[] = [root]
    const out: EntryOut[] = []
    const seen = new Set<string>()

    while (queue.length > 0 && out.length < MAX_ENTRIES) {
      const dir = queue.shift()!
      if (seen.has(dir)) continue
      seen.add(dir)

      let entries
      try {
        entries = await sandbox.files.list(dir, { depth: 1 })
      } catch {
        continue
      }

      for (const entry of entries) {
        const rel = entry.path.startsWith(root + "/")
          ? entry.path.slice(root.length + 1)
          : entry.path === root
            ? ""
            : entry.path
        if (!rel) continue
        if (entry.type === "dir") {
          out.push({ path: rel, type: "dir" })
          if (!SKIP_DESCEND.has(entry.name)) {
            queue.push(entry.path)
          }
        } else {
          out.push({ path: rel, type: "file" })
        }
        if (out.length >= MAX_ENTRIES) break
      }
    }

    out.sort((a, b) => a.path.localeCompare(b.path))

    return NextResponse.json({
      root,
      entries: out,
      truncated: out.length >= MAX_ENTRIES,
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
