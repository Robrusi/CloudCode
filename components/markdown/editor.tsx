"use client"

import { type ReactNode } from "react"

import { CodeRow } from "@/components/markdown/editor-code-row"
import { ImageRow } from "@/components/markdown/editor-image-row"
import { TextRow } from "@/components/markdown/editor-text-row"
import { MarkdownEditorToolbar } from "@/components/markdown/editor-toolbar"
import { useMarkdownEditorController } from "@/hooks/use-markdown-editor-controller"
import { cn } from "@/lib/shared/utils"

type MarkdownEditorProps = {
  ariaLabel?: string
  className?: string
  contentClassName?: string
  enableImages?: boolean
  onBlur?: () => void
  onChange: (markdown: string) => void
  onUploadImage?: (file: File) => Promise<string>
  placeholder?: string
  toolbarClassName?: string
  toolbarPlacement?: "top" | "bottom"
  toolbarTrailing?: ReactNode
  value: string
}

export function MarkdownEditor({
  value,
  onChange,
  onBlur,
  onUploadImage,
  placeholder = "Write…",
  ariaLabel = "Editor",
  enableImages = false,
  toolbarPlacement = "bottom",
  toolbarClassName,
  toolbarTrailing,
  className,
  contentClassName = "max-h-[45vh] min-h-36",
}: MarkdownEditorProps) {
  const {
    blocks,
    changeText,
    clearFocus,
    editing,
    focusLast,
    focusedType,
    handleBackspaceAtStart,
    handleEnter,
    handlePaste,
    insertImage,
    isSoleEmpty,
    navigate,
    onRowFocus,
    queueFocus,
    removeBlock,
    setImageUrl,
    setRef,
    setType,
    toggleTodo,
  } = useMarkdownEditorController({ onChange, onUploadImage, value })

  let numberCounter = 0

  const toolbar = (
    <MarkdownEditorToolbar
      className={toolbarClassName}
      enableImages={enableImages}
      focusedType={focusedType}
      onInsertImage={insertImage}
      onSetType={setType}
      placement={toolbarPlacement}
      trailing={toolbarTrailing}
    />
  )

  return (
    <div
      className={cn("flex min-h-0 flex-col", className)}
      onPaste={enableImages && onUploadImage ? handlePaste : undefined}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          // Focus left the editor entirely — drop the active row so every block
          // renders as formatted markdown.
          clearFocus()
          onBlur?.()
        }
      }}
    >
      {toolbarPlacement === "top" ? toolbar : null}
      <div
        className={cn(
          "flex flex-col overflow-y-auto px-3 py-2.5",
          contentClassName
        )}
      >
        <div className="space-y-1">
          {blocks.map((block) => {
            if (block.type === "numbered") numberCounter += 1
            else numberCounter = 0
            if (block.type === "image") {
              return (
                <ImageRow
                  key={block.id}
                  block={block}
                  setRef={setRef}
                  onFocus={() => onRowFocus(block.id)}
                  onConfirm={(url) => setImageUrl(block.id, url)}
                  onRemove={() => removeBlock(block.id)}
                />
              )
            }
            if (block.type === "code") {
              return (
                <CodeRow
                  key={block.id}
                  block={block}
                  ariaLabel={ariaLabel}
                  setRef={setRef}
                  onFocus={() => onRowFocus(block.id)}
                  onChangeText={(text) => changeText(block.id, text)}
                  onBackspaceAtStart={() => handleBackspaceAtStart(block.id)}
                  onNavigate={(dir) => navigate(block.id, dir)}
                />
              )
            }
            return (
              <TextRow
                key={block.id}
                block={block}
                number={numberCounter}
                editing={editing}
                placeholder={isSoleEmpty ? placeholder : undefined}
                ariaLabel={ariaLabel}
                setRef={setRef}
                onFocus={() => onRowFocus(block.id)}
                onStartEdit={(caret) => queueFocus(block.id, caret)}
                onChangeText={(text) => changeText(block.id, text)}
                onEnter={(caret) => handleEnter(block.id, caret)}
                onBackspaceAtStart={() => handleBackspaceAtStart(block.id)}
                onNavigate={(dir) => navigate(block.id, dir)}
                onToggle={() => toggleTodo(block.id)}
              />
            )
          })}
        </div>
        <button
          type="button"
          aria-label="Focus editor"
          tabIndex={-1}
          onMouseDown={focusLast}
          className="min-h-6 flex-1 cursor-text"
        />
      </div>

      {toolbarPlacement === "bottom" ? toolbar : null}
    </div>
  )
}
