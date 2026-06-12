"use client"

import { ImageIcon, Loader2 } from "lucide-react"
import NextImage from "next/image"
import { useEffect, useMemo, useState } from "react"

import { basename, sandboxFileReadUrl } from "@/components/files/editor-model"
import { cn } from "@/lib/shared/utils"

export function ImageDimensionsLabel({
  sandboxId,
  path,
  refreshNonce,
}: {
  sandboxId: string | null
  path: string
  refreshNonce: number
}) {
  const [dimensions, setDimensions] = useState<{
    width: number
    height: number
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    const image = new window.Image()
    image.onload = () => {
      if (cancelled) return
      setDimensions({
        width: image.naturalWidth,
        height: image.naturalHeight,
      })
    }
    image.onerror = () => {
      if (!cancelled) setDimensions(null)
    }
    image.src = sandboxFileReadUrl({
      path,
      refreshNonce,
      sandboxId,
    })

    return () => {
      cancelled = true
      image.onload = null
      image.onerror = null
    }
  }, [path, refreshNonce, sandboxId])

  if (!dimensions) return null

  return (
    <span className="shrink-0 font-sans text-[11px] text-muted-foreground tabular-nums">
      {dimensions.width} x {dimensions.height}
    </span>
  )
}

export function ImageViewer({
  sandboxId,
  path,
  refreshNonce,
}: {
  sandboxId: string | null
  path: string
  refreshNonce: number
}) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)

  const src = useMemo(() => {
    return sandboxFileReadUrl({
      path,
      refreshNonce,
      sandboxId,
    })
  }, [path, refreshNonce, sandboxId])

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-background px-6 text-center">
        <ImageIcon className="size-5 text-muted-foreground" />
        <p className="text-xs text-destructive">Failed to load image.</p>
      </div>
    )
  }

  return (
    <div className="relative h-full min-h-0 overflow-auto bg-background">
      {!loaded ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : null}
      <NextImage
        src={src}
        alt={basename(path)}
        width={0}
        height={0}
        sizes="100vw"
        unoptimized
        onError={() => setError(true)}
        onLoad={() => setLoaded(true)}
        className={cn(
          "mx-auto block max-h-none max-w-none p-6",
          loaded ? "opacity-100" : "opacity-0"
        )}
        style={{ width: "auto", height: "auto" }}
      />
    </div>
  )
}
