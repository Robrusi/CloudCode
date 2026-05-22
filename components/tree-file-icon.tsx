"use client"

import {
  createFileTreeIconResolver,
  getBuiltInFileIconColor,
  getBuiltInSpriteSheet,
} from "@pierre/trees"
import { useEffect } from "react"

import { cn } from "@/lib/utils"

const SPRITE_CONTAINER_ID = "pierre-tree-sprite"
const ICON_SET = "complete"

const resolver = createFileTreeIconResolver({
  set: ICON_SET,
  colored: true,
})

function ensureSpriteSheet() {
  if (typeof document === "undefined") return
  if (document.getElementById(SPRITE_CONTAINER_ID)) return
  const container = document.createElement("div")
  container.id = SPRITE_CONTAINER_ID
  container.setAttribute("aria-hidden", "true")
  container.style.position = "absolute"
  container.style.width = "0"
  container.style.height = "0"
  container.style.overflow = "hidden"
  container.style.pointerEvents = "none"
  container.innerHTML = getBuiltInSpriteSheet(ICON_SET)
  document.body.appendChild(container)
}

export function TreeFileIcon({
  path,
  className,
}: {
  path: string
  className?: string
}) {
  useEffect(() => {
    ensureSpriteSheet()
  }, [])

  const resolved = resolver.resolveIcon("file-tree-icon-file", path)
  const color = resolved.token
    ? getBuiltInFileIconColor(resolved.token)
    : undefined

  return (
    <svg
      className={cn("size-3.5 shrink-0", className)}
      style={color ? { color } : undefined}
      aria-hidden
    >
      <use href={`#${resolved.name}`} />
    </svg>
  )
}
