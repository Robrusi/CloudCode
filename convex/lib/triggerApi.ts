/**
 * Minimal Trigger.dev REST client for Convex actions. Convex cannot import
 * @trigger.dev/sdk (it assumes the Trigger worker runtime), but dispatching a
 * task is one authenticated POST. Requires TRIGGER_SECRET_KEY (and optionally
 * TRIGGER_API_URL for self-hosted deployments) in the Convex deployment
 * environment — the same secret key the Next.js server uses.
 */

const TRIGGER_SECRET_KEY_ERROR =
  "Set TRIGGER_SECRET_KEY in the Convex deployment environment before dispatching factory runs."

function triggerApiBaseUrl() {
  const configured = process.env.TRIGGER_API_URL?.trim().replace(/\/+$/, "")
  return configured || "https://api.trigger.dev"
}

function triggerSecretKey() {
  const key = process.env.TRIGGER_SECRET_KEY?.trim()
  if (!key) throw new Error(TRIGGER_SECRET_KEY_ERROR)
  return key
}

export async function triggerTaskViaApi(input: {
  idempotencyKey: string
  payload: Record<string, unknown>
  tags?: string[]
  taskId: string
}): Promise<{ id: string }> {
  const response = await fetch(
    `${triggerApiBaseUrl()}/api/v1/tasks/${encodeURIComponent(input.taskId)}/trigger`,
    {
      body: JSON.stringify({
        // The public REST API takes the payload as a plain JSON object and
        // encodes it server-side; pre-stringifying double-encodes it and the
        // task receives a string instead of the object.
        payload: input.payload,
        options: {
          idempotencyKey: input.idempotencyKey,
          ...(input.tags?.length ? { tags: input.tags } : {}),
        },
      }),
      headers: {
        authorization: `Bearer ${triggerSecretKey()}`,
        "content-type": "application/json",
      },
      method: "POST",
    }
  )

  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(
      `Unable to queue the Trigger.dev task (${response.status}). ${detail}`.trim()
    )
  }

  const data = (await response.json()) as { id?: string }
  if (!data.id) {
    throw new Error("Trigger.dev returned no run id for the queued task.")
  }

  return { id: data.id }
}
