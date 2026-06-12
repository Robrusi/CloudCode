import { positiveNumberValue, stringValue } from "@/lib/shared/unknown-values"

export const CHAT_IMAGE_ATTACHMENT_MIME_TYPES = [
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const

export const MAX_CHAT_IMAGE_ATTACHMENTS = 6
export const MAX_CHAT_IMAGE_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_CHAT_IMAGE_ATTACHMENT_NAME_LENGTH = 120

export type ChatImageAttachment = {
  id: string
  kind: "image"
  mimeType: string
  name: string
  size: number
  url: string
}

export type SandboxImageAttachment = ChatImageAttachment & {
  sandboxPath: string
}

const CHAT_IMAGE_ATTACHMENT_MIME_TYPE_SET = new Set<string>(
  CHAT_IMAGE_ATTACHMENT_MIME_TYPES
)

export function isChatImageAttachmentMimeType(value: string) {
  return CHAT_IMAGE_ATTACHMENT_MIME_TYPE_SET.has(value.toLowerCase())
}

export function sanitizeImageAttachmentName(name: string) {
  const trimmed = name.trim() || "image"
  const compact = trimmed
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, MAX_CHAT_IMAGE_ATTACHMENT_NAME_LENGTH)

  return compact || "image"
}

export function parseChatImageAttachments(value: unknown) {
  if (!Array.isArray(value)) return []

  return value.slice(0, MAX_CHAT_IMAGE_ATTACHMENTS).flatMap((attachment) => {
    if (!attachment || typeof attachment !== "object") return []
    const record = attachment as Record<string, unknown>
    const id = stringValue(record.id)
    const kind = record.kind === "image" ? record.kind : undefined
    const mimeType = stringValue(record.mimeType)?.toLowerCase()
    const name = stringValue(record.name)
    const size = positiveNumberValue(record.size)
    const url = stringValue(record.url)

    if (
      !id ||
      kind !== "image" ||
      !mimeType ||
      !isChatImageAttachmentMimeType(mimeType) ||
      !name ||
      !size ||
      size > MAX_CHAT_IMAGE_ATTACHMENT_BYTES ||
      !url ||
      !isHttpUrl(url)
    ) {
      return []
    }

    return [
      {
        id: id.slice(0, 120),
        kind,
        mimeType,
        name: sanitizeImageAttachmentName(name),
        size,
        url,
      } satisfies ChatImageAttachment,
    ]
  })
}

export function buildImageAttachmentPromptBlock(
  attachments: SandboxImageAttachment[]
) {
  if (attachments.length === 0) return ""

  const lines = attachments.map(
    (attachment, index) =>
      `${index + 1}. ${attachment.name} (${attachment.mimeType}, ${formatBytes(
        attachment.size
      )}): ${attachment.sandboxPath}`
  )

  return [
    "Attached images are available in the sandbox at these local paths:",
    ...lines,
    "Use these image files as context for the user's request.",
  ].join("\n")
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}
