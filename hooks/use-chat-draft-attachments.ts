"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { DraftImageAttachment } from "@/components/chat/types"
import { useImageUpload } from "@/hooks/use-image-upload"
import {
  isChatImageAttachmentMimeType,
  MAX_CHAT_IMAGE_ATTACHMENT_BYTES,
  MAX_CHAT_IMAGE_ATTACHMENTS,
  sanitizeImageAttachmentName,
  type ChatImageAttachment,
} from "@/lib/chat/attachments"

export function useChatDraftAttachments() {
  const uploadImage = useImageUpload()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const objectUrlsRef = useRef<Set<string>>(new Set())
  const [draftAttachments, setDraftAttachments] = useState<
    DraftImageAttachment[]
  >([])
  const [attachmentError, setAttachmentError] = useState("")
  const [attachmentDragActive, setAttachmentDragActive] = useState(false)

  const attachmentSummary = useMemo(() => {
    const ready: ChatImageAttachment[] = []
    let failed = 0
    let uploading = 0

    for (const attachment of draftAttachments) {
      if (attachment.status === "ready" && attachment.url) {
        ready.push({
          id: attachment.id,
          kind: "image",
          mimeType: attachment.mimeType,
          name: attachment.name,
          size: attachment.size,
          url: attachment.url,
        })
      } else if (attachment.status === "uploading") {
        uploading += 1
      } else if (attachment.status === "failed") {
        failed += 1
      }
    }

    return { failed, ready, uploading }
  }, [draftAttachments])

  const revokeObjectUrl = useCallback((url: string | undefined) => {
    if (!url) return
    URL.revokeObjectURL(url)
    objectUrlsRef.current.delete(url)
  }, [])

  const clearDraftAttachments = useCallback(() => {
    setDraftAttachments((current) => {
      for (const attachment of current) {
        revokeObjectUrl(attachment.objectUrl)
      }
      return []
    })
    setAttachmentError("")
    setAttachmentDragActive(false)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }, [revokeObjectUrl])

  const removeDraftAttachment = useCallback(
    (id: string) => {
      setDraftAttachments((current) => {
        const removed = current.find((attachment) => attachment.id === id)
        revokeObjectUrl(removed?.objectUrl)
        return current.filter((attachment) => attachment.id !== id)
      })
      setAttachmentError("")
    },
    [revokeObjectUrl]
  )

  const addImageFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return

      setAttachmentError("")
      const openSlots = MAX_CHAT_IMAGE_ATTACHMENTS - draftAttachments.length
      if (openSlots <= 0) {
        setAttachmentError(
          `You can attach up to ${MAX_CHAT_IMAGE_ATTACHMENTS} images.`
        )
        return
      }

      const accepted: File[] = []
      for (const file of files) {
        if (accepted.length >= openSlots) break
        if (!isChatImageAttachmentMimeType(file.type)) {
          setAttachmentError(
            "Only PNG, JPEG, GIF, and WebP images are supported."
          )
          continue
        }
        if (file.size > MAX_CHAT_IMAGE_ATTACHMENT_BYTES) {
          setAttachmentError("Each image must be 10 MB or smaller.")
          continue
        }
        accepted.push(file)
      }

      if (files.length > openSlots) {
        setAttachmentError(
          `Only ${openSlots} more image${openSlots === 1 ? "" : "s"} can be attached.`
        )
      }
      if (accepted.length === 0) return

      const pending = accepted.map((file) => {
        const objectUrl = URL.createObjectURL(file)
        objectUrlsRef.current.add(objectUrl)
        return {
          id: crypto.randomUUID(),
          kind: "image" as const,
          mimeType: file.type,
          name: sanitizeImageAttachmentName(file.name),
          objectUrl,
          size: file.size,
          status: "uploading" as const,
        }
      })

      setDraftAttachments((current) => [...current, ...pending])

      pending.forEach((attachment, index) => {
        const file = accepted[index]
        uploadImage(file)
          .then((url) => {
            setDraftAttachments((current) =>
              current.map((candidate) => {
                if (candidate.id !== attachment.id) return candidate
                revokeObjectUrl(candidate.objectUrl)
                return {
                  ...candidate,
                  objectUrl: undefined,
                  status: "ready",
                  url,
                }
              })
            )
          })
          .catch((error) => {
            setDraftAttachments((current) =>
              current.map((candidate) => {
                if (candidate.id !== attachment.id) return candidate
                return {
                  ...candidate,
                  error:
                    error instanceof Error ? error.message : "Upload failed.",
                  status: "failed",
                }
              })
            )
          })
      })
    },
    [draftAttachments.length, revokeObjectUrl, uploadImage]
  )

  const openAttachmentPicker = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const appendReadyDraftAttachments = useCallback(
    (attachments: ChatImageAttachment[]) => {
      if (attachments.length === 0) return
      setDraftAttachments((current) => [
        ...current,
        ...attachments.map((attachment) => ({
          ...attachment,
          status: "ready" as const,
        })),
      ])
      setAttachmentError("")
    },
    []
  )

  useEffect(
    () => () => {
      for (const url of objectUrlsRef.current) {
        URL.revokeObjectURL(url)
      }
      objectUrlsRef.current.clear()
    },
    []
  )

  return {
    addImageFiles,
    appendReadyDraftAttachments,
    attachmentDragActive,
    attachmentError,
    clearDraftAttachments,
    draftAttachments,
    failedAttachmentCount: attachmentSummary.failed,
    fileInputRef,
    openAttachmentPicker,
    readyDraftAttachments: attachmentSummary.ready,
    removeDraftAttachment,
    setAttachmentDragActive,
    setAttachmentError,
    uploadingAttachmentCount: attachmentSummary.uploading,
  }
}
