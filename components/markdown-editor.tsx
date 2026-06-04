"use client"

import {
  Heading1,
  Image as ImageIcon,
  List,
  ListOrdered,
  ListTodo,
  Loader2,
  type LucideIcon,
  Type,
  X,
} from "lucide-react"
import {
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"

import { Checkbox } from "@/components/ui/checkbox"
import { IconButton } from "@/components/ui/icon-button"
import { cn } from "@/lib/utils"

type BlockType =
  | "paragraph"
  | "heading"
  | "bullet"
  | "numbered"
  | "todo"
  | "image"

type Block = {
  checked?: boolean
  id: string
  text: string
  type: BlockType
  uploading?: boolean
  url?: string
}

type EditableField = HTMLInputElement | HTMLTextAreaElement

const LIST_TYPES: BlockType[] = ["bullet", "numbered", "todo"]
const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)]*)\)\s*$/

let blockIdSeq = 0
function nextBlockId() {
  blockIdSeq += 1
  return `mb-${blockIdSeq}`
}

function makeBlock(
  type: BlockType,
  text: string,
  extra?: { checked?: boolean; url?: string }
): Block {
  return {
    id: nextBlockId(),
    type,
    text,
    ...(type === "todo" ? { checked: Boolean(extra?.checked) } : {}),
    ...(type === "image" ? { url: extra?.url ?? "" } : {}),
  }
}

function emptyParagraph(): Block {
  return makeBlock("paragraph", "")
}

// --- markdown <-> blocks -----------------------------------------------------

function lineToBlock(line: string): Block {
  const image = line.match(IMAGE_LINE)
  if (image) return makeBlock("image", image[1], { url: image[2] })

  const todo = line.match(/^\s*[-*]\s+\[( |x|X)\]\s?(.*)$/)
  if (todo) {
    return makeBlock("todo", todo[2], {
      checked: todo[1].toLowerCase() === "x",
    })
  }

  const heading = line.match(/^\s*#{1,6}\s+(.*)$/)
  if (heading) return makeBlock("heading", heading[1])

  const bullet = line.match(/^\s*[-*]\s+(.*)$/)
  if (bullet) return makeBlock("bullet", bullet[1])

  const numbered = line.match(/^\s*\d+\.\s+(.*)$/)
  if (numbered) return makeBlock("numbered", numbered[1])

  return makeBlock("paragraph", line)
}

function parseMarkdown(md: string): Block[] {
  if (!md) return [emptyParagraph()]
  const blocks = md.replace(/\r\n/g, "\n").split("\n").map(lineToBlock)
  return blocks.length > 0 ? blocks : [emptyParagraph()]
}

function serialize(blocks: Block[]): string {
  let counter = 0
  return blocks
    .map((block): string | null => {
      if (block.type === "image") {
        const url = (block.url ?? "").trim()
        return url ? `![${block.text}](${url})` : null
      }
      if (block.type === "numbered") {
        counter += 1
        return `${counter}. ${block.text}`
      }
      counter = 0
      if (block.type === "heading") return `# ${block.text}`
      if (block.type === "bullet") return `- ${block.text}`
      if (block.type === "todo") {
        return `- [${block.checked ? "x" : " "}] ${block.text}`
      }
      return block.text
    })
    .filter((line): line is string => line !== null)
    .join("\n")
}

// Markdown shortcut typed at the start of a paragraph (e.g. "- ", "[] ", "# ").
function detectShortcut(
  text: string
): { type: BlockType; text: string; checked?: boolean } | null {
  let m: RegExpMatchArray | null
  if ((m = text.match(/^(#{1,6})\s(.*)$/))) {
    return { type: "heading", text: m[2] }
  }
  if ((m = text.match(/^[-*]\s(.*)$/))) {
    return { type: "bullet", text: m[1] }
  }
  if ((m = text.match(/^\[( |x|X)?\]\s(.*)$/))) {
    return {
      type: "todo",
      text: m[2],
      checked: (m[1] ?? "").toLowerCase() === "x",
    }
  }
  if ((m = text.match(/^\d+\.\s(.*)$/))) {
    return { type: "numbered", text: m[1] }
  }
  return null
}

const TOOLS: { type: BlockType; icon: LucideIcon; label: string }[] = [
  { type: "paragraph", icon: Type, label: "Text" },
  { type: "heading", icon: Heading1, label: "Heading" },
  { type: "bullet", icon: List, label: "Bulleted list" },
  { type: "numbered", icon: ListOrdered, label: "Numbered list" },
  { type: "todo", icon: ListTodo, label: "To-do list" },
]

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
}: {
  value: string
  onChange: (markdown: string) => void
  onBlur?: () => void
  onUploadImage?: (file: File) => Promise<string>
  placeholder?: string
  ariaLabel?: string
  enableImages?: boolean
  toolbarPlacement?: "top" | "bottom"
  toolbarClassName?: string
  toolbarTrailing?: ReactNode
  className?: string
  contentClassName?: string
}) {
  const [blocks, setBlocks] = useState<Block[]>(() => parseMarkdown(value))
  const [focusedId, setFocusedId] = useState<string | null>(null)

  const blocksRef = useRef(blocks)
  const lastEmittedRef = useRef(value)
  const lastFocusedRef = useRef<string | null>(null)
  const refs = useRef(new Map<string, EditableField>())
  const pendingFocusRef = useRef<{ id: string; caret: number | "end" } | null>(
    null
  )

  blocksRef.current = blocks

  const setRef = useCallback(
    (id: string) => (el: EditableField | null) => {
      if (el) refs.current.set(id, el)
      else refs.current.delete(id)
    },
    []
  )

  const commit = useCallback(
    (next: Block[]) => {
      // Keep the ref current synchronously so back-to-back commits (e.g. async
      // image uploads resolving) always read the latest blocks.
      blocksRef.current = next
      setBlocks(next)
      const md = serialize(next)
      lastEmittedRef.current = md
      onChange(md)
    },
    [onChange]
  )

  // Adopt the value only when it is a genuine external change (not the echo of
  // our own onChange), so the focused field is never remounted mid-edit.
  useEffect(() => {
    if (value === lastEmittedRef.current) return
    lastEmittedRef.current = value
    setBlocks(parseMarkdown(value))
  }, [value])

  // Apply queued focus + caret after structural edits.
  useEffect(() => {
    const pending = pendingFocusRef.current
    if (!pending) return
    pendingFocusRef.current = null
    const el = refs.current.get(pending.id)
    if (!el) return
    el.focus()
    const pos = pending.caret === "end" ? el.value.length : pending.caret
    el.setSelectionRange(pos, pos)
  })

  const changeText = useCallback(
    (id: string, text: string) => {
      const current = blocksRef.current
      const block = current.find((b) => b.id === id)
      if (block?.type === "paragraph") {
        const shortcut = detectShortcut(text)
        if (shortcut) {
          commit(
            current.map((b) =>
              b.id === id
                ? makeTransformed(b, shortcut.type, shortcut.text, {
                    checked: shortcut.checked,
                  })
                : b
            )
          )
          return
        }
      }
      commit(current.map((b) => (b.id === id ? { ...b, text } : b)))
    },
    [commit]
  )

  const handleEnter = useCallback(
    (id: string, caret: number) => {
      const current = blocksRef.current
      const idx = current.findIndex((b) => b.id === id)
      if (idx === -1) return
      const block = current[idx]

      if (LIST_TYPES.includes(block.type) && block.text === "") {
        const para = makeBlock("paragraph", "")
        const next = [...current]
        next[idx] = para
        pendingFocusRef.current = { id: para.id, caret: 0 }
        commit(next)
        return
      }

      const before = block.text.slice(0, caret)
      const after = block.text.slice(caret)
      const inheritType: BlockType =
        block.type === "heading" ? "paragraph" : block.type
      const newBlock = makeBlock(inheritType, after)
      const next = [...current]
      next[idx] = { ...block, text: before }
      next.splice(idx + 1, 0, newBlock)
      pendingFocusRef.current = { id: newBlock.id, caret: 0 }
      commit(next)
    },
    [commit]
  )

  const removeBlock = useCallback(
    (id: string) => {
      const current = blocksRef.current
      const idx = current.findIndex((b) => b.id === id)
      if (idx === -1) return
      let next = current.filter((b) => b.id !== id)
      if (next.length === 0) next = [emptyParagraph()]
      const focusTarget = next[idx - 1] ?? next[0]
      pendingFocusRef.current = { id: focusTarget.id, caret: "end" }
      commit(next)
    },
    [commit]
  )

  const handleBackspaceAtStart = useCallback(
    (id: string) => {
      const current = blocksRef.current
      const idx = current.findIndex((b) => b.id === id)
      if (idx === -1) return false
      const block = current[idx]

      if (block.type !== "paragraph") {
        const para = makeBlock("paragraph", block.text)
        const next = [...current]
        next[idx] = para
        pendingFocusRef.current = { id: para.id, caret: 0 }
        commit(next)
        return true
      }

      if (idx === 0) return false
      const prev = current[idx - 1]
      if (prev.type === "image") {
        // Remove the image rather than merging into it.
        removeBlock(prev.id)
        return true
      }
      const caret = prev.text.length
      const next = [...current]
      next[idx - 1] = { ...prev, text: prev.text + block.text }
      next.splice(idx, 1)
      pendingFocusRef.current = { id: prev.id, caret }
      commit(next)
      return true
    },
    [commit, removeBlock]
  )

  const navigate = useCallback((id: string, dir: -1 | 1) => {
    const current = blocksRef.current
    const idx = current.findIndex((b) => b.id === id)
    if (idx === -1) return false
    const target = current[idx + dir]
    if (!target) return false
    const el = refs.current.get(target.id)
    if (!el) return false
    el.focus()
    const pos = dir < 0 ? el.value.length : 0
    el.setSelectionRange(pos, pos)
    return true
  }, [])

  const toggleTodo = useCallback(
    (id: string) => {
      commit(
        blocksRef.current.map((b) =>
          b.id === id ? { ...b, checked: !b.checked } : b
        )
      )
    },
    [commit]
  )

  const setImageUrl = useCallback(
    (id: string, url: string) => {
      const trimmed = url.trim()
      if (!trimmed) {
        removeBlock(id)
        return
      }
      commit(
        blocksRef.current.map((b) => (b.id === id ? { ...b, url: trimmed } : b))
      )
    },
    [commit, removeBlock]
  )

  const setType = useCallback(
    (type: BlockType) => {
      const id = lastFocusedRef.current ?? blocksRef.current.at(-1)?.id
      if (!id) return
      pendingFocusRef.current = { id, caret: "end" }
      commit(
        blocksRef.current.map((b) =>
          b.id === id ? makeTransformed(b, type, b.text) : b
        )
      )
    },
    [commit]
  )

  const insertImage = useCallback(() => {
    const current = blocksRef.current
    const focusId = lastFocusedRef.current
    const idx = focusId
      ? current.findIndex((b) => b.id === focusId)
      : current.length - 1
    const focused = idx >= 0 ? current[idx] : undefined
    const image = makeBlock("image", "")
    const next = [...current]
    // Replace a focused empty paragraph, otherwise insert after it.
    if (focused && focused.type === "paragraph" && focused.text === "") {
      next[idx] = image
    } else {
      next.splice(idx + 1, 0, image)
    }
    pendingFocusRef.current = { id: image.id, caret: 0 }
    commit(next)
  }, [commit])

  // Insert a placeholder for each pasted/dropped image, upload it, then swap in
  // its public URL (or drop the placeholder if the upload fails).
  const addImageFiles = useCallback(
    (files: File[]) => {
      if (!onUploadImage || files.length === 0) return
      const current = blocksRef.current
      const placeholders = files.map(
        (): Block => ({ ...makeBlock("image", ""), uploading: true })
      )
      const focusId = lastFocusedRef.current
      const idx = focusId
        ? current.findIndex((b) => b.id === focusId)
        : current.length - 1
      const focused = idx >= 0 ? current[idx] : undefined
      const next = [...current]
      if (focused && focused.type === "paragraph" && focused.text === "") {
        next.splice(idx, 1, ...placeholders)
      } else {
        next.splice(idx + 1, 0, ...placeholders)
      }
      commit(next)

      files.forEach((file, index) => {
        const blockId = placeholders[index].id
        onUploadImage(file)
          .then((url) => {
            commit(
              blocksRef.current.map((b) =>
                b.id === blockId ? { ...b, uploading: false, url } : b
              )
            )
          })
          .catch(() => removeBlock(blockId))
      })
    },
    [commit, onUploadImage, removeBlock]
  )

  const handlePaste = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      if (!onUploadImage) return
      const files = Array.from(event.clipboardData?.files ?? []).filter(
        (file) => file.type.startsWith("image/")
      )
      if (files.length === 0) return
      event.preventDefault()
      addImageFiles(files)
    },
    [addImageFiles, onUploadImage]
  )

  const focusLast = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const last = blocksRef.current.at(-1)
    if (!last) return
    const el = refs.current.get(last.id)
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const onRowFocus = useCallback((id: string) => {
    lastFocusedRef.current = id
    setFocusedId(id)
  }, [])

  const focusedType = blocks.find((b) => b.id === focusedId)?.type ?? null
  const isSoleEmpty =
    blocks.length === 1 &&
    blocks[0].type === "paragraph" &&
    blocks[0].text === ""

  let numberCounter = 0

  const toolbar = (
    <div
      className={cn(
        "flex items-center gap-0.5 border-border/60 px-1 py-1",
        toolbarPlacement === "top" ? "border-b" : "border-t",
        toolbarClassName
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
            onClick={() => setType(tool.type)}
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
            onClick={insertImage}
          >
            <ImageIcon className="size-4" />
          </IconButton>
        </>
      ) : null}
      {toolbarTrailing ? (
        <div className="ml-auto flex items-center">{toolbarTrailing}</div>
      ) : null}
    </div>
  )

  return (
    <div
      className={cn("flex min-h-0 flex-col", className)}
      onPaste={enableImages && onUploadImage ? handlePaste : undefined}
      onBlur={(event) => {
        if (
          onBlur &&
          !event.currentTarget.contains(event.relatedTarget as Node | null)
        ) {
          onBlur()
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
            return (
              <TextRow
                key={block.id}
                block={block}
                number={numberCounter}
                placeholder={isSoleEmpty ? placeholder : undefined}
                ariaLabel={ariaLabel}
                setRef={setRef}
                onFocus={() => onRowFocus(block.id)}
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

// Whether the textarea currently renders as a single visual line, so a vertical
// arrow press should cross to the adjacent block rather than stay put.
function isSingleVisualLine(el: HTMLTextAreaElement) {
  const cs = window.getComputedStyle(el)
  const lineHeight =
    parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4 || 20
  const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
  return el.scrollHeight - pad <= lineHeight * 1.5
}

function makeTransformed(
  block: Block,
  type: BlockType,
  text: string,
  extra?: { checked?: boolean }
): Block {
  return {
    id: block.id,
    type,
    text,
    ...(type === "todo" ? { checked: Boolean(extra?.checked) } : {}),
  }
}

const TEXT_CLASS: Record<Exclude<BlockType, "image">, string> = {
  paragraph: "text-[13px] leading-6 text-foreground/90",
  heading: "text-[15px] font-semibold leading-7 text-foreground",
  bullet: "text-[13px] leading-6 text-foreground/90",
  numbered: "text-[13px] leading-6 text-foreground/90",
  todo: "text-[13px] leading-6 text-foreground/90",
}

const PLACEHOLDER: Record<Exclude<BlockType, "image">, string> = {
  paragraph: "",
  heading: "Heading",
  bullet: "List",
  numbered: "List",
  todo: "To-do",
}

function TextRow({
  block,
  number,
  placeholder,
  ariaLabel,
  setRef,
  onFocus,
  onChangeText,
  onEnter,
  onBackspaceAtStart,
  onNavigate,
  onToggle,
}: {
  block: Block
  number: number
  placeholder?: string
  ariaLabel: string
  setRef: (id: string) => (el: EditableField | null) => void
  onFocus: () => void
  onChangeText: (text: string) => void
  onEnter: (caret: number) => void
  onBackspaceAtStart: () => boolean
  onNavigate: (dir: -1 | 1) => boolean
  onToggle: () => void
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const type = block.type as Exclude<BlockType, "image">
  const done = block.type === "todo" && block.checked

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = `${el.scrollHeight}px`
  }, [block.text, block.type])

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

  const textarea = (
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
  )

  if (block.type === "heading" || block.type === "paragraph") {
    return textarea
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
      {textarea}
    </div>
  )
}

function ImageRow({
  block,
  setRef,
  onFocus,
  onConfirm,
  onRemove,
}: {
  block: Block
  setRef: (id: string) => (el: EditableField | null) => void
  onFocus: () => void
  onConfirm: (url: string) => void
  onRemove: () => void
}) {
  const [draft, setDraft] = useState(block.url ?? "")

  if (block.uploading) {
    return (
      <div className="flex items-center gap-2 py-1 text-[13px] text-muted-foreground">
        <Loader2 className="size-4 shrink-0 animate-spin" />
        Uploading image…
      </div>
    )
  }

  if (!block.url) {
    return (
      <div className="flex items-center gap-2 py-0.5">
        <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={setRef(block.id)}
          type="url"
          inputMode="url"
          aria-label="Image URL"
          value={draft}
          placeholder="Paste an image URL, then press Enter"
          onFocus={onFocus}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              onConfirm(draft)
            } else if (event.key === "Escape") {
              event.preventDefault()
              onRemove()
            }
          }}
          onBlur={() => onConfirm(draft)}
          className="w-full bg-transparent text-[13px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/55"
        />
      </div>
    )
  }

  return (
    <div className="group/img relative w-fit max-w-full py-1">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={block.url}
        alt={block.text}
        className="max-h-72 w-auto max-w-full rounded-lg border border-border/60"
      />
      <IconButton
        size="xs"
        aria-label="Remove image"
        title="Remove image"
        onClick={onRemove}
        className="absolute top-1.5 right-1.5 border border-border/60 bg-background/85 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover/img:opacity-100"
      >
        <X className="size-3.5" />
      </IconButton>
    </div>
  )
}
