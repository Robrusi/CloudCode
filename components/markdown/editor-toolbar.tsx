"use client"

import {
  Heading1,
  Image as ImageIcon,
  List,
  ListOrdered,
  ListTodo,
  type LucideIcon,
  Type,
} from "lucide-react"
import type { ReactNode } from "react"

import type { BlockType } from "@/components/markdown/editor-model"
import { IconButton } from "@/components/ui/icon-button"
import { cn } from "@/lib/shared/utils"

const TOOLS: { type: BlockType; icon: LucideIcon; label: string }[] = [
  { type: "paragraph", icon: Type, label: "Text" },
  { type: "heading", icon: Heading1, label: "Heading" },
  { type: "bullet", icon: List, label: "Bulleted list" },
  { type: "numbered", icon: ListOrdered, label: "Numbered list" },
  { type: "todo", icon: ListTodo, label: "To-do list" },
]

export function MarkdownEditorToolbar({
  className,
  enableImages,
  focusedType,
  onInsertImage,
  onSetType,
  placement,
  trailing,
}: {
  className?: string
  enableImages: boolean
  focusedType: BlockType | null
  onInsertImage: () => void
  onSetType: (type: BlockType) => void
  placement: "top" | "bottom"
  trailing?: ReactNode
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-0.5 border-border/60 px-1 py-1",
        placement === "top" ? "border-b" : "border-t",
        className
      )}
    >
      {TOOLS.map((tool) => {
        const Icon = tool.icon
        const active = focusedType === tool.type
        return (
          <IconButton
            key={tool.type}
            size="sm"
            aria-label={tool.label}
            aria-pressed={active}
            title={tool.label}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSetType(tool.type)}
          >
            <Icon className="size-4" />
          </IconButton>
        )
      })}
      {enableImages ? (
        <>
          <span aria-hidden className="mx-0.5 h-4 w-px bg-border/60" />
          <IconButton
            size="sm"
            aria-label="Insert image"
            title="Insert image by URL"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onInsertImage}
          >
            <ImageIcon className="size-4" />
          </IconButton>
        </>
      ) : null}
      {trailing ? (
        <div className="ml-auto flex items-center">{trailing}</div>
      ) : null}
    </div>
  )
}
