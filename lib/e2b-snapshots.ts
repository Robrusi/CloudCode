import { Sandbox } from "e2b"

export type SnapshotCleanupResult = {
  deletedIds: string[]
  deferredIds: string[]
  errors: Record<string, string>
}

export async function deleteSandboxSnapshot(snapshotId?: string | null) {
  const trimmed = snapshotId?.trim()
  if (!trimmed) return false

  return await Sandbox.deleteSnapshot(trimmed)
}

function snapshotDeleteErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Failed to delete snapshot"
}

function isSnapshotInUseError(error: unknown) {
  return /running sandboxes using it|cannot delete template/i.test(
    snapshotDeleteErrorMessage(error)
  )
}

export function compactSnapshotIds(snapshotIds: Array<string | undefined>) {
  return [
    ...new Set(
      snapshotIds
        .map((id) => id?.trim())
        .filter((id): id is string => Boolean(id))
    ),
  ]
}

export async function deleteSandboxSnapshots(
  snapshotIds: Array<string | undefined>,
  currentSnapshotId?: string
): Promise<SnapshotCleanupResult> {
  const result: SnapshotCleanupResult = {
    deletedIds: [],
    deferredIds: [],
    errors: {},
  }

  for (const snapshotId of compactSnapshotIds(snapshotIds)) {
    if (snapshotId === currentSnapshotId) continue

    try {
      const deleted = await deleteSandboxSnapshot(snapshotId)
      if (deleted) result.deletedIds.push(snapshotId)
    } catch (error) {
      if (isSnapshotInUseError(error)) {
        result.deferredIds.push(snapshotId)
      } else {
        result.errors[snapshotId] = snapshotDeleteErrorMessage(error)
      }
    }
  }

  return result
}
