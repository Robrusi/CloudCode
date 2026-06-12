import type { Sandbox } from "@daytona/sdk"

import {
  isChatImageAttachmentMimeType,
  MAX_CHAT_IMAGE_ATTACHMENT_BYTES,
  sanitizeImageAttachmentName,
  type ChatImageAttachment,
  type SandboxImageAttachment,
} from "@/lib/chat/attachments"
import { compactLine } from "@/lib/shared/compact-line"
import {
  runDaytonaCommand,
  shellQuote,
  writeDaytonaFile,
  type DaytonaSandboxPaths,
} from "@/lib/daytona/sandbox"

function imageAttachmentExtension(attachment: ChatImageAttachment) {
  const fromName = sanitizeImageAttachmentName(attachment.name)
    .split(".")
    .pop()
    ?.toLowerCase()
  if (
    fromName === "gif" ||
    fromName === "jpeg" ||
    fromName === "jpg" ||
    fromName === "png" ||
    fromName === "webp"
  ) {
    return fromName
  }

  switch (attachment.mimeType) {
    case "image/gif":
      return "gif"
    case "image/jpeg":
      return "jpg"
    case "image/png":
      return "png"
    case "image/webp":
      return "webp"
    default:
      return "img"
  }
}

function sandboxImageAttachmentPath({
  attachment,
  index,
  paths,
  runId,
}: {
  attachment: ChatImageAttachment
  index: number
  paths: DaytonaSandboxPaths
  runId?: string
}) {
  const safeRunId = runId?.replace(/[^\w.-]+/g, "_") || "run"
  const safeName = sanitizeImageAttachmentName(attachment.name).replace(
    /\.[^.]*$/,
    ""
  )
  const extension = imageAttachmentExtension(attachment)
  return `${paths.runtimeHome}/attachments/${safeRunId}/image-${index + 1}-${safeName}.${extension}`
}

async function downloadImageAttachment(
  attachment: ChatImageAttachment,
  signal?: AbortSignal
) {
  const response = await fetch(attachment.url, { signal })
  if (!response.ok) {
    throw new Error(`Unable to download image attachment ${attachment.name}.`)
  }

  const contentType = response.headers
    .get("content-type")
    ?.split(";")[0]
    ?.toLowerCase()
  const mimeType =
    contentType && isChatImageAttachmentMimeType(contentType)
      ? contentType
      : attachment.mimeType
  if (!isChatImageAttachmentMimeType(mimeType)) {
    throw new Error(`Unsupported image attachment type: ${mimeType}.`)
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0)
  if (contentLength > MAX_CHAT_IMAGE_ATTACHMENT_BYTES) {
    throw new Error(`Image attachment ${attachment.name} is too large.`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength > MAX_CHAT_IMAGE_ATTACHMENT_BYTES) {
    throw new Error(`Image attachment ${attachment.name} is too large.`)
  }

  return buffer
}

export async function materializeSandboxImageAttachments({
  attachments,
  onAttachmentReady,
  paths,
  runId,
  sandbox,
  signal,
}: {
  attachments: ChatImageAttachment[]
  onAttachmentReady?: (
    attachment: SandboxImageAttachment
  ) => void | Promise<void>
  paths: DaytonaSandboxPaths
  runId?: string
  sandbox: Sandbox
  signal?: AbortSignal
}): Promise<SandboxImageAttachment[]> {
  if (attachments.length === 0) return []

  const root = `${paths.runtimeHome}/attachments/${
    runId?.replace(/[^\w.-]+/g, "_") || "run"
  }`
  const mkdir = await runDaytonaCommand(
    sandbox,
    `mkdir -p ${shellQuote(root)}`,
    {
      signal,
      timeoutMs: 10_000,
    }
  )
  if (mkdir.exitCode !== 0) {
    throw new Error(
      compactLine(mkdir.stderr || mkdir.stdout) ||
        "Unable to prepare image attachment directory."
    )
  }

  const materialized: SandboxImageAttachment[] = []
  for (let index = 0; index < attachments.length; index += 1) {
    const attachment = attachments[index]
    const sandboxPath = sandboxImageAttachmentPath({
      attachment,
      index,
      paths,
      runId,
    })
    const buffer = await downloadImageAttachment(attachment, signal)
    await writeDaytonaFile(sandbox, sandboxPath, buffer)
    const imageAttachment = { ...attachment, sandboxPath }
    materialized.push(imageAttachment)
    await onAttachmentReady?.(imageAttachment)
  }

  return materialized
}
