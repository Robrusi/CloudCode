"use client"

import { useMutation } from "convex/react"
import { useCallback } from "react"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"

// Uploads an image file to Convex storage and returns its public URL, suitable
// for embedding in markdown (renders in-app and on GitHub).
export function useImageUpload() {
  const generateUploadUrl = useMutation(api.files.generateUploadUrl)
  const getUploadedUrl = useMutation(api.files.getUploadedUrl)

  return useCallback(
    async (file: File): Promise<string> => {
      const uploadUrl = await generateUploadUrl()
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      })
      if (!res.ok) throw new Error("Image upload failed.")
      const { storageId } = (await res.json()) as { storageId: string }
      const url = await getUploadedUrl({
        storageId: storageId as Id<"_storage">,
      })
      if (!url) throw new Error("Could not resolve the uploaded image.")
      return url
    },
    [generateUploadUrl, getUploadedUrl]
  )
}
