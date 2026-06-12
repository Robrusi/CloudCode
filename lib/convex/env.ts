const DEFAULT_CONVEX_URL_ERROR =
  "Set NEXT_PUBLIC_CONVEX_URL before using Convex storage."

export function requireConvexUrl(message = DEFAULT_CONVEX_URL_ERROR) {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL
  if (!url) throw new Error(message)
  return url
}
