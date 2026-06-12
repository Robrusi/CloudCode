"use client"

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useLayoutEffect,
  useRef,
} from "react"

import { InlineMarkdown } from "@/components/markdown/inline-markdown"
import type { Block, BlockType } from "@/components/markdown/editor-model"
import type { EditableMarkdownField } from "@/components/markdown/editor-types"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/shared/utils"

type CaretDoc = Document & {
  caretPositionFromPoint?: (
    x: number,
    y: number
  ) => { offsetNode: Node; offset: number } | null
  caretRangeFromPoint?: (x: number, y: number) => Range | null
}

const TEXT_CLASS: Record<Exclude<BlockType, "image" | "code">, string> = {
  paragraph: "text-[13px] leading-6 text-foreground/90",
  heading: "text-[15px] font-semibold leading-7 text-foreground",
  bullet: "text-[13px] leading-6 text-foreground/90",
  numbered: "text-[13px] leading-6 text-foreground/90",
  todo: "text-[13px] leading-6 text-foreground/90",
}

const PLACEHOLDER: Record<Exclude<BlockType, "image" | "code">, string> = {
  paragraph: "",
  heading: "Heading",
  bullet: "List",
  numbered: "List",
  todo: "To-do",
}

function renderedOffsetFromPoint(
  root: HTMLElement,
  x: number,
  y: number
): number | null {
  const doc = root.ownerDocument as CaretDoc
  let node: Node | null = null
  let offset = 0
  const pos = doc.caretPositionFromPoint?.(x, y)
  if (pos) {
    node = pos.offsetNode
    offset = pos.offset
  } else {
    const range = doc.caretRangeFromPoint?.(x, y)
    if (!range) return null
    node = range.startContainer
    offset = range.startOffset
  }
  if (!node || node.nodeType !== Node.TEXT_NODE || !root.contains(node)) {
    return null
  }
  let total = 0
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let cur: Node | null
  while ((cur = walker.nextNode())) {
    if (cur === node) return total + offset
    total += cur.textContent?.length ?? 0
  }
  return null
}

function mapRenderedToRawOffset(
  rendered: string,
  raw: string,
  renderedOffset: number
): number {
  let r = 0
  for (let i = 0; i < renderedOffset && r < raw.length; i += 1) {
    while (r < raw.length && raw[r] !== rendered[i]) r += 1
    if (r < raw.length) r += 1
  }
  return r
}

function isSingleVisualLine(el: HTMLTextAreaElement) {
  const cs = window.getComputedStyle(el)
  const lineHeight =
    parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4 || 20
  const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
  return el.scrollHeight - pad <= lineHeight * 1.5
}

export function TextRow({
  ariaLabel,
  block,
  editing,
  number,
  onBackspaceAtStart,
  onChangeText,
  onEnter,
  onFocus,
  onNavigate,
  onStartEdit,
  onToggle,
  placeholder,
  setRef,
}: {
  ariaLabel: string
  block: Block
  editing: boolean
  number: number
  onBackspaceAtStart: () => boolean
  onChangeText: (text: string) => void
  onEnter: (caret: number) => void
  onFocus: () => void
  onNavigate: (dir: -1 | 1) => boolean
  onStartEdit: (caret: number | "end") => void
  onToggle: () => void
  placeholder?: string
  setRef: (id: string) => (el: EditableMarkdownField | null) => void
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const type = block.type as Exclude<BlockType, "image" | "code">
  const done = block.type === "todo" && block.checked
  const showEditor = editing || block.text === ""

  useLayoutEffect(() => {
    if (!showEditor) return
    const el = ref.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = `${el.scrollHeight}px`
  }, [block.text, block.type, showEditor])

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    const el = event.currentTarget

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      onEnter(el.selectionStart)
      return
    }
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
    } else if (event.key === "ArrowUp" && (atStart || isSingleVisualLine(el))) {
      if (onNavigate(-1)) event.preventDefault()
    } else if (event.key === "ArrowDown" && (atEnd || isSingleVisualLine(el))) {
      if (onNavigate(1)) event.preventDefault()
    }
  }

  const content = showEditor ? (
    <textarea
      ref={(el) => {
        ref.current = el
        setRef(block.id)(el)
      }}
      rows={1}
      aria-label={ariaLabel}
      spellCheck
      value={block.text}
      placeholder={placeholder ?? PLACEHOLDER[type]}
      onFocus={onFocus}
      onChange={(event) => onChangeText(event.target.value)}
      onKeyDown={handleKeyDown}
      className={cn(
        "w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-muted-foreground/55",
        TEXT_CLASS[type],
        done && "text-muted-foreground line-through"
      )}
    />
  ) : (
    <button
      type="button"
      aria-label="Edit line"
      onMouseDown={(event) => {
        event.preventDefault()
        const el = event.currentTarget
        const rendered = el.textContent ?? ""
        const offset = renderedOffsetFromPoint(el, event.clientX, event.clientY)
        if (offset === null || offset >= rendered.length) {
          onStartEdit("end")
          return
        }
        onStartEdit(mapRenderedToRawOffset(rendered, block.text, offset))
      }}
      className={cn(
        "w-full cursor-text border-0 bg-transparent p-0 text-left whitespace-pre-wrap",
        TEXT_CLASS[type],
        done && "text-muted-foreground line-through"
      )}
    >
      <InlineMarkdown text={block.text} />
    </button>
  )

  if (block.type === "heading" || block.type === "paragraph") {
    return content
  }

  return (
    <div className="flex items-start gap-2">
      {block.type === "todo" ? (
        <Checkbox
          checked={Boolean(block.checked)}
          onCheckedChange={onToggle}
          aria-label={done ? "Mark as not done" : "Mark as done"}
          className="mt-[3px]"
        />
      ) : block.type === "numbered" ? (
        <span className="mt-px min-w-4 shrink-0 text-right text-[13px] leading-6 text-muted-foreground tabular-nums">
          {number}.
        </span>
      ) : (
        <span className="mt-px w-4 shrink-0 text-center text-[13px] leading-6 text-muted-foreground/70 select-none">
          •
        </span>
      )}
      {content}
    </div>
  )
}
