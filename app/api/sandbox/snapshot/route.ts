import { Sandbox } from "e2b"
import { NextResponse } from "next/server"

import {
  compactSnapshotIds,
  deleteSandboxSnapshots,
  type SnapshotCleanupResult,
} from "@/lib/e2b-snapshots"
import { refreshSandboxInactivityTimeout } from "@/lib/e2b-sandbox-timeout"
import { withoutCloudcodeEnvLocal } from "@/lib/sandbox-env"

export const runtime = "nodejs"
export const maxDuration = 300

const CODEX_HOME = "/home/user/.codex"
const REPO_PATH = "/home/user/repo"
const PROMPT_PATH = "/tmp/cloudcode-prompt.txt"
const PREVIOUS_DIFF_PATH = "/tmp/cloudcode-previous.diff"
const LAST_MESSAGE_PATH = "/tmp/cloudcode-last-message.txt"
const SNAPSHOT_DELETE_RETRY_DELAY_MS = 1_000

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

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function deleteSnapshotsWithReleaseRetry(
  snapshotIds: string[],
  retryAfterSandboxKill: boolean
): Promise<SnapshotCleanupResult> {
  const cleanup = await deleteSandboxSnapshots(snapshotIds)
  if (!retryAfterSandboxKill || cleanup.deferredIds.length === 0) {
    return cleanup
  }

  await delay(SNAPSHOT_DELETE_RETRY_DELAY_MS)
  const retryCleanup = await deleteSandboxSnapshots(cleanup.deferredIds)

  return {
    deletedIds: [...cleanup.deletedIds, ...retryCleanup.deletedIds],
    deferredIds: retryCleanup.deferredIds,
    errors: {
      ...cleanup.errors,
      ...retryCleanup.errors,
    },
  }
}

async function killSandboxForCleanup(sandboxId: string) {
  try {
    await Sandbox.kill(sandboxId)
    return { sandboxKilled: true, sandboxMissing: false }
  } catch (error) {
    try {
      await Sandbox.getInfo(sandboxId)
    } catch {
      return { sandboxKilled: false, sandboxMissing: true }
    }

    throw error
  }
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
    const snapshot = await withoutCloudcodeEnvLocal(sandbox, REPO_PATH, () =>
      sandbox.createSnapshot()
    )
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

  if (!sandboxId && snapshotIds.length === 0) {
    return NextResponse.json(
      { error: "sandboxId or snapshotId required" },
      { status: 400 }
    )
  }

  try {
    let sandboxKilled = false
    let sandboxMissing = false
    if (sandboxId) {
      const sandboxCleanup = await killSandboxForCleanup(sandboxId)
      sandboxKilled = sandboxCleanup.sandboxKilled
      sandboxMissing = sandboxCleanup.sandboxMissing
    }
    const cleanup = await deleteSnapshotsWithReleaseRetry(
      snapshotIds,
      sandboxKilled
    )
    return NextResponse.json({ ...cleanup, sandboxKilled, sandboxMissing })
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
