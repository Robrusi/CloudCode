import { Sandbox } from "e2b"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const maxDuration = 300

const CODEX_HOME = "/home/user/.codex"
const PROMPT_PATH = "/tmp/cloudcode-prompt.txt"
const PREVIOUS_DIFF_PATH = "/tmp/cloudcode-previous.diff"
const LAST_MESSAGE_PATH = "/tmp/cloudcode-last-message.txt"

export async function POST(request: Request) {
  let sandboxId: string | undefined
  try {
    const body = (await request.json()) as { sandboxId?: unknown }
    if (typeof body.sandboxId === "string") sandboxId = body.sandboxId
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

    return NextResponse.json({
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
