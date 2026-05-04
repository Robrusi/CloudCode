import { Sandbox } from "e2b"
import { NextResponse } from "next/server"

import {
  compactSnapshotIds,
  deleteSandboxSnapshots,
} from "@/lib/e2b-snapshots"
import { refreshSandboxInactivityTimeout } from "@/lib/e2b-sandbox-timeout"

export const runtime = "nodejs"
export const maxDuration = 300

const CODEX_HOME = "/home/user/.codex"
const PROMPT_PATH = "/tmp/cloudcode-prompt.txt"
const PREVIOUS_DIFF_PATH = "/tmp/cloudcode-previous.diff"
const LAST_MESSAGE_PATH = "/tmp/cloudcode-last-message.txt"

function snapshotIdsFromBody(body: {
  previousSnapshotId?: unknown
  previousSnapshotIds?: unknown
  snapshotId?: unknown
  snapshotIds?: unknown
}) {
  return compactSnapshotIds([
    typeof body.previousSnapshotId === "string"
      ? body.previousSnapshotId
      : undefined,
    ...(Array.isArray(body.previousSnapshotIds)
      ? body.previousSnapshotIds.map((id) =>
          typeof id === "string" ? id : undefined
        )
      : []),
    typeof body.snapshotId === "string" ? body.snapshotId : undefined,
    ...(Array.isArray(body.snapshotIds)
      ? body.snapshotIds.map((id) => (typeof id === "string" ? id : undefined))
      : []),
  ])
}

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
    previousSnapshotIds = snapshotIdsFromBody(body)
  } catch {
    // ignore
  }

  if (!sandboxId) {
    return NextResponse.json({ error: "sandboxId required" }, { status: 400 })
  }

  try {
    const sandbox = await Sandbox.connect(sandboxId)
    await refreshSandboxInactivityTimeout(sandbox)
    await sandbox.commands
      .run(
        `rm -f ${CODEX_HOME}/auth.json ${PROMPT_PATH} ${PREVIOUS_DIFF_PATH} ${LAST_MESSAGE_PATH}`,
        { timeoutMs: 10_000 }
      )
      .catch(() => undefined)
    const snapshot = await sandbox.createSnapshot()
    const cleanup = await deleteSandboxSnapshots(
      previousSnapshotIds,
      snapshot.snapshotId
    )

    return NextResponse.json({
      previousSnapshotDeletedIds: cleanup.deletedIds,
      previousSnapshotDeleteErrors: cleanup.errors,
      previousSnapshotDeferredIds: cleanup.deferredIds,
      sandboxSnapshotId: snapshot.snapshotId,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to snapshot sandbox",
      },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  let sandboxId: string | undefined
  let snapshotIds: string[] = []
  try {
    const body = (await request.json()) as {
      sandboxId?: unknown
      snapshotId?: unknown
      snapshotIds?: unknown
    }
    if (typeof body.sandboxId === "string") sandboxId = body.sandboxId
    snapshotIds = snapshotIdsFromBody(body)
  } catch {
    // ignore
  }

  if (snapshotIds.length === 0) {
    return NextResponse.json({ error: "snapshotId required" }, { status: 400 })
  }

  try {
    if (sandboxId) await Sandbox.kill(sandboxId).catch(() => undefined)
    const cleanup = await deleteSandboxSnapshots(snapshotIds)
    return NextResponse.json(cleanup)
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete snapshot",
      },
      { status: 500 }
    )
  }
}
