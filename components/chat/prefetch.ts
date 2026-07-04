export const MAX_PREFETCHED_CHANGED_TEXT_FILES = 24
export const TEXT_FILE_PREFETCH_CONCURRENCY = 4
export const TEXT_FILE_PREFETCH_DELAY_MS = 100

const PREFETCH_IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
])

export function canPrefetchAsText(path: string) {
  const ext = path.split(".").pop()?.toLowerCase()
  return !ext || !PREFETCH_IMAGE_EXTENSIONS.has(ext)
}
