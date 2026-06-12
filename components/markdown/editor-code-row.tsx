"use client"

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useLayoutEffect,
  useRef,
} from "react"

import { formatCodeLanguage } from "@/components/code/language"
import type { Block } from "@/components/markdown/editor-model"
import type { EditableMarkdownField } from "@/components/markdown/editor-types"
import { cardSurfaceClass } from "@/components/ui/surface"

export function CodeRow({
  ariaLabel,
  block,
  onBackspaceAtStart,
  onChangeText,
  onFocus,
  onNavigate,
  setRef,
}: {
  ariaLabel: string
  block: Block
  onBackspaceAtStart: () => boolean
  onChangeText: (text: string) => void
  onFocus: () => void
  onNavigate: (dir: -1 | 1) => boolean
  setRef: (id: string) => (el: EditableMarkdownField | null) => void
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = `${el.scrollHeight}px`
  }, [block.text])

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    const el = event.currentTarget

    if (
      event.key === "Backspace" &&
      el.selectionStart === 0 &&
      el.selectionEnd === 0
    ) {
      if (onBackspaceAtStart()) event.preventDefault()
      return
    }

    const collapsed = el.selectionStart === el.selectionEnd
    if (
      !collapsed ||
      event.shiftKey ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    ) {
      return
    }

    const atStart = el.selectionStart === 0
    const atEnd = el.selectionStart === el.value.length

    if (event.key === "ArrowLeft" && atStart) {
      if (onNavigate(-1)) event.preventDefault()
    } else if (event.key === "ArrowRight" && atEnd) {
      if (onNavigate(1)) event.preventDefault()
    } else if (event.key === "ArrowUp" && atStart) {
      if (onNavigate(-1)) event.preventDefault()
    } else if (event.key === "ArrowDown" && atEnd) {
      if (onNavigate(1)) event.preventDefault()
    }
  }

  return (
    <div className={`overflow-hidden ${cardSurfaceClass}`}>
      <div className="flex h-8 items-center border-b border-border bg-muted/70 px-3 font-mono text-[11px] font-medium text-muted-foreground uppercase">
        {formatCodeLanguage(block.lang?.trim() || "plaintext")}
      </div>
      <textarea
        ref={(el) => {
          ref.current = el
          setRef(block.id)(el)
        }}
        rows={1}
        aria-label={ariaLabel}
        spellCheck={false}
        value={block.text}
        onFocus={onFocus}
        onChange={(event) => onChangeText(event.target.value)}
        onKeyDown={handleKeyDown}
        className="w-full resize-none overflow-hidden bg-transparent px-3 py-2 font-mono text-[13px] leading-6 text-foreground outline-none"
      />
    </div>
  )
}
