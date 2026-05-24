import { ConvexHttpClient } from "convex/browser"

import { api } from "@/convex/_generated/api"
import { getConvexAuthToken } from "@/lib/codex-auth"

export class SandboxAuthorizationError extends Error {
  constructor() {
    super("Sandbox not found.")
    this.name = "SandboxAuthorizationError"
  }
}

export type CurrentUserSandbox = {
  repoUrl: string
}

function getConvexUrl() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL

  if (!url) {
    throw new Error("Set NEXT_PUBLIC_CONVEX_URL before using Convex storage.")
  }

  return url
}

export async function requireCurrentUserSandbox(
  sandboxId: string
): Promise<CurrentUserSandbox> {
  const client = new ConvexHttpClient(getConvexUrl())
  client.setAuth(await getConvexAuthToken())

  const sandbox = await client.query(api.codexRuns.sandboxAccess, {
    sandboxId,
  })

  if (!sandbox) throw new SandboxAuthorizationError()

  return sandbox
}
