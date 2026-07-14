import { ConvexError } from "convex/values"

/** Expected, user-actionable failures must cross the Convex production
 * boundary as ConvexError. Plain Error messages are intentionally redacted to
 * `[Request ID: …] Server Error`, which makes validation failures impossible
 * for the UI to explain or recover from. */
export function throwUserError(message: string): never {
  throw new ConvexError(message)
}
