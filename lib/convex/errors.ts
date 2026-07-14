import { ConvexError } from "convex/values"

/** Returns the stable payload from an expected Convex application error.
 * ConvexError.message contains transport/debug context, while data is the
 * value intentionally exposed by the mutation. */
export function convexErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ConvexError && typeof error.data === "string") {
    return error.data
  }
  return error instanceof Error ? error.message : fallback
}
