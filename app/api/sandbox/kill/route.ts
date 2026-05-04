import { Sandbox } from "e2b"
import { NextResponse } from "next/server"

import { compactSnapshotIds, deleteSandboxSnapshots } from "@/lib/e2b-snapshots"

export const runtime = "nodejs"
export const maxDuration = 300

const CODEX_HOME = "/home/user/.codex"
const PROMPT_PATH = "/tmp/cloudcode-prompt.txt"
const PREVIOUS_DIFF_PATH = "/tmp/cloudcode-previous.diff"
const LAST_MESSAGE_PATH = "/tmp/cloudcode-last-message.txt"

export async function POST(request: Request) {
  let sandboxId: string | undefined
  let previousSnapshotIds: string[] = []
  try {
    const body = (await request.json()) as {
      previousSnapshotId?: unknown
      previousSnapshotIds?: unknown
      sandboxId?: unknown
    }
    if (typeof body.sandboxId === "string") sandboxId = body.sandboxId
    previousSnapshotIds = compactSnapshotIds([
      typeof body.previousSnapshotId === "string"
        ? body.previousSnapshotId
        : undefined,
      ...(Array.isArray(body.previousSnapshotIds)
        ? body.previousSnapshotIds.map((id) =>
            typeof id === "string" ? id : undefined
          )
        : []),
    ])
  } catch {
    // ignore
  }

  if (!sandboxId) {
    return NextResponse.json({ error: "sandboxId required" }, { status: 400 })
  }

  try {
    const sandbox = await Sandbox.connect(sandboxId)
    await sandbox.commands
      .run(
        `rm -f ${CODEX_HOME}/auth.json ${PROMPT_PATH} ${PREVIOUS_DIFF_PATH} ${LAST_MESSAGE_PATH}`,
        { timeoutMs: 10_000 }
      )
      .catch(() => undefined)
    const snapshot = await sandbox.createSnapshot()
    const killed = await Sandbox.kill(sandboxId)
    const cleanup = await deleteSandboxSnapshots(
      previousSnapshotIds,
      snapshot.snapshotId
    )
    return NextResponse.json({
      killed,
      previousSnapshotDeletedIds: cleanup.deletedIds,
      previousSnapshotDeleteErrors: cleanup.errors,
      previousSnapshotDeferredIds: cleanup.deferredIds,
      sandboxSnapshotId: snapshot.snapshotId,
    })
  } catch (error) {
    try {
      const killed = await Sandbox.kill(sandboxId)
      return NextResponse.json({
        killed,
        snapshotError:
          error instanceof Error ? error.message : "Failed to snapshot sandbox",
      })
    } catch {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Failed to kill sandbox",
        },
        { status: 500 }
      )
    }
  }
}
