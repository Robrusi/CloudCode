import { ConvexHttpClient } from "convex/browser"

import {
  getConvexAuthToken,
  getConvexAuthTokenForSession,
} from "@/lib/codex/auth"
import { requireConvexUrl } from "@/lib/convex/env"

type ConvexClerkAuthSession = Parameters<typeof getConvexAuthTokenForSession>[0]

export function createConvexHttpClient() {
  return new ConvexHttpClient(requireConvexUrl())
}

export async function currentUserConvexHttpClient() {
  const client = createConvexHttpClient()
  client.setAuth(await getConvexAuthToken())
  return client
}

export async function convexHttpClientForSession(
  session: ConvexClerkAuthSession
) {
  const client = createConvexHttpClient()
  client.setAuth(await getConvexAuthTokenForSession(session))
  return client
}
