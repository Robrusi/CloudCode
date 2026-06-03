"use client"

import {
  Heading1,
  List,
  ListOrdered,
  ListTodo,
  type LucideIcon,
  Type,
} from "lucide-react"
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"

import { Checkbox } from "@/components/ui/checkbox"
import { IconButton } from "@/components/ui/icon-button"
import { cn } from "@/lib/utils"

type BlockType = "paragraph" | "heading" | "bullet" | "numbered" | "todo"

type Block = {
  checked?: boolean
  id: string
  text: string
  type: BlockType
}

const SAVE_DELAY_MS = 600
const LIST_TYPES: BlockType[] = ["bullet", "numbered", "todo"]

let blockIdSeq = 0
function nextBlockId() {
  blockIdSeq += 1
  return `nb-${blockIdSeq}`
}

function makeBlock(type: BlockType, text: string, checked?: boolean): Block {
  return {
    id: nextBlockId(),
    type,
    text,
    ...(type === "todo" ? { checked: Boolean(checked) } : {}),
  }
}

function emptyParagraph(): Block {
  return makeBlock("paragraph", "")
}

// --- markdown <-> blocks -----------------------------------------------------

function lineToBlock(line: string): Block {
  const todo = line.match(/^\s*[-*]\s+\[( |x|X)\]\s?(.*)$/)
  if (todo) return makeBlock("todo", todo[2], todo[1].toLowerCase() === "x")

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
    .map((block) => {
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

export function NotesEditor({
  notes,
  notesThreadId,
  onSave,
}: {
  notes: string
  notesThreadId: string | null
  onSave: (markdown: string) => void
}) {
  const [blocks, setBlocks] = useState<Block[]>(() => parseMarkdown(notes))
  const [focusedId, setFocusedId] = useState<string | null>(null)

  const savedRef = useRef(notes)
  const prevThreadRef = useRef(notesThreadId)
  const blocksRef = useRef(blocks)
  const lastFocusedRef = useRef<string | null>(null)
  const refs = useRef(new Map<string, HTMLTextAreaElement>())
  const pendingFocusRef = useRef<{ id: string; caret: number | "end" } | null>(
    null
  )
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  blocksRef.current = blocks

  const setRef = useCallback(
    (id: string) => (el: HTMLTextAreaElement | null) => {
      if (el) refs.current.set(id, el)
      else refs.current.delete(id)
    },
    []
  )

  const flush = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const md = serialize(blocksRef.current)
    if (md === savedRef.current) return
    savedRef.current = md
    onSave(md)
  }, [onSave])

  const commit = useCallback(
    (next: Block[]) => {
      setBlocks(next)
      const md = serialize(next)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null
        if (md === savedRef.current) return
        savedRef.current = md
        onSave(md)
      }, SAVE_DELAY_MS)
    },
    [onSave]
  )

  // Adopt server value on thread switch (always) or reactive update with no
  // unsaved local edits. Critically, when the incoming value already matches
  // what is on screen (e.g. the echo of our own debounced save), keep the
  // existing blocks so the focused textarea is NOT remounted.
  useEffect(() => {
    const threadChanged = prevThreadRef.current !== notesThreadId
    prevThreadRef.current = notesThreadId
    setBlocks((current) => {
      const currentMd = serialize(current)
      if (!threadChanged && currentMd === notes) {
        savedRef.current = notes
        return current
      }
      if (threadChanged || currentMd === savedRef.current) {
        savedRef.current = notes
        return parseMarkdown(notes)
      }
      return current
    })
  }, [notes, notesThreadId])

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

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

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
                ? makeTransformed(
                    b,
                    shortcut.type,
                    shortcut.text,
                    Boolean(shortcut.checked)
                  )
                : b
            )
          )
          // Same block id is kept, so the textarea stays focused.
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
      const caret = prev.text.length
      const next = [...current]
      next[idx - 1] = { ...prev, text: prev.text + block.text }
      next.splice(idx, 1)
      pendingFocusRef.current = { id: prev.id, caret }
      commit(next)
      return true
    },
    [commit]
  )

  // Move the caret across block boundaries (dir -1 → end of previous block,
  // dir +1 → start of next block). Focuses directly; no re-render needed.
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

  const setType = useCallback(
    (type: BlockType) => {
      const id = lastFocusedRef.current ?? blocksRef.current.at(-1)?.id
      if (!id) return
      pendingFocusRef.current = { id, caret: "end" }
      commit(
        blocksRef.current.map((b) =>
          b.id === id ? makeTransformed(b, type, b.text, false) : b
        )
      )
    },
    [commit]
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

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border/60 bg-muted/30 transition-colors focus-within:border-border focus-within:bg-muted/40">
      <div className="flex max-h-[45vh] min-h-36 flex-col overflow-y-auto px-3 py-2.5">
        <div className="space-y-1">
          {blocks.map((block) => {
            if (block.type === "numbered") numberCounter += 1
            else numberCounter = 0
            return (
              <NoteRow
                key={block.id}
                block={block}
                number={numberCounter}
                placeholder={
                  isSoleEmpty ? "Add notes, to-dos and lists…" : undefined
                }
                setRef={setRef}
                onFocus={() => onRowFocus(block.id)}
                onBlur={flush}
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
          aria-label="Focus notes"
          tabIndex={-1}
          onMouseDown={focusLast}
          className="min-h-6 flex-1 cursor-text"
        />
      </div>

      <div className="flex items-center gap-0.5 border-t border-border/60 bg-background/40 px-1 py-1">
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
      </div>
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
  checked: boolean
): Block {
  return {
    id: block.id,
    type,
    text,
    ...(type === "todo" ? { checked } : {}),
  }
}

const TEXT_CLASS: Record<BlockType, string> = {
  paragraph: "text-[13px] leading-6 text-foreground/90",
  heading: "text-[15px] font-semibold leading-7 text-foreground",
  bullet: "text-[13px] leading-6 text-foreground/90",
  numbered: "text-[13px] leading-6 text-foreground/90",
  todo: "text-[13px] leading-6 text-foreground/90",
}

const PLACEHOLDER: Record<BlockType, string> = {
  paragraph: "",
  heading: "Heading",
  bullet: "List",
  numbered: "List",
  todo: "To-do",
}

function NoteRow({
  block,
  number,
  placeholder,
  setRef,
  onFocus,
  onBlur,
  onChangeText,
  onEnter,
  onBackspaceAtStart,
  onNavigate,
  onToggle,
}: {
  block: Block
  number: number
  placeholder?: string
  setRef: (id: string) => (el: HTMLTextAreaElement | null) => void
  onFocus: () => void
  onBlur: () => void
  onChangeText: (text: string) => void
  onEnter: (caret: number) => void
  onBackspaceAtStart: () => boolean
  onNavigate: (dir: -1 | 1) => boolean
  onToggle: () => void
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
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

    // Cross-block caret navigation at the block's edges. Plain arrows only —
    // let the browser handle in-block movement and modified/extending presses.
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
      aria-label="Note"
      spellCheck
      value={block.text}
      placeholder={placeholder ?? PLACEHOLDER[block.type]}
      onFocus={onFocus}
      onBlur={onBlur}
      onChange={(event) => onChangeText(event.target.value)}
      onKeyDown={handleKeyDown}
      className={cn(
        "w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-muted-foreground/55",
        TEXT_CLASS[block.type],
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
