"use client"

import {
  type ClipboardEvent as ReactClipboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useReducer,
  useRef,
} from "react"

import {
  LIST_TYPES,
  createMarkdownEditorState,
  detectShortcut,
  emptyParagraph,
  makeBlock,
  makeTransformed,
  markdownEditorReducer,
  parseMarkdown,
  serialize,
  type Block,
  type BlockType,
} from "@/components/markdown/editor-model"
import type { EditableMarkdownField } from "@/components/markdown/editor-types"

type UseMarkdownEditorControllerParams = {
  onChange: (markdown: string) => void
  onUploadImage?: (file: File) => Promise<string>
  value: string
}

export function useMarkdownEditorController({
  value,
  onChange,
  onUploadImage,
}: UseMarkdownEditorControllerParams) {
  const [state, dispatch] = useReducer(
    markdownEditorReducer,
    value,
    createMarkdownEditorState
  )
  const { blocks, focusedId } = state

  const blocksRef = useRef(blocks)
  const lastEmittedRef = useRef(value)
  const lastFocusedRef = useRef<string | null>(null)
  const refs = useRef<Map<string, EditableMarkdownField> | null>(null)
  if (refs.current === null) refs.current = new Map()
  const fieldRefs = refs.current
  const pendingFocusRef = useRef<{ id: string; caret: number | "end" } | null>(
    null
  )

  blocksRef.current = blocks

  const setRef = useCallback(
    (id: string) => (el: EditableMarkdownField | null) => {
      if (el) fieldRefs.set(id, el)
      else fieldRefs.delete(id)
    },
    [fieldRefs]
  )

  const commit = useCallback(
    (next: Block[]) => {
      // Keep the ref current synchronously so back-to-back commits (e.g. async
      // image uploads resolving) always read the latest blocks.
      blocksRef.current = next
      dispatch({ type: "set-blocks", blocks: next })
      const md = serialize(next)
      lastEmittedRef.current = md
      onChange(md)
    },
    [onChange]
  )

  useEffect(() => {
    if (value === lastEmittedRef.current) return
    lastEmittedRef.current = value
    const next = parseMarkdown(value)
    blocksRef.current = next
    dispatch({ type: "external-blocks", blocks: next })
  }, [value])

  useEffect(() => {
    const pending = pendingFocusRef.current
    if (!pending) return
    pendingFocusRef.current = null
    const el = fieldRefs.get(pending.id)
    if (!el) return
    el.focus()
    const pos = pending.caret === "end" ? el.value.length : pending.caret
    el.setSelectionRange(pos, pos)
  })

  const queueFocus = useCallback((id: string, caret: number | "end") => {
    pendingFocusRef.current = { id, caret }
    dispatch({ type: "focus", id })
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
        queueFocus(para.id, 0)
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
      queueFocus(newBlock.id, 0)
      commit(next)
    },
    [commit, queueFocus]
  )

  const removeBlock = useCallback(
    (id: string) => {
      const current = blocksRef.current
      const idx = current.findIndex((b) => b.id === id)
      if (idx === -1) return
      let next = current.filter((b) => b.id !== id)
      if (next.length === 0) next = [emptyParagraph()]
      const focusTarget = next[idx - 1] ?? next[0]
      queueFocus(focusTarget.id, "end")
      commit(next)
    },
    [commit, queueFocus]
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
        queueFocus(para.id, 0)
        commit(next)
        return true
      }

      if (idx === 0) return false
      const prev = current[idx - 1]
      if (prev.type === "image") {
        removeBlock(prev.id)
        return true
      }
      if (prev.type === "code") {
        return false
      }
      const caret = prev.text.length
      const next = [...current]
      next[idx - 1] = { ...prev, text: prev.text + block.text }
      next.splice(idx, 1)
      queueFocus(prev.id, caret)
      commit(next)
      return true
    },
    [commit, queueFocus, removeBlock]
  )

  const navigate = useCallback(
    (id: string, dir: -1 | 1) => {
      const current = blocksRef.current
      const idx = current.findIndex((b) => b.id === id)
      if (idx === -1) return false
      const target = current[idx + dir]
      if (!target) return false
      queueFocus(target.id, dir < 0 ? "end" : 0)
      return true
    },
    [queueFocus]
  )

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
      queueFocus(id, "end")
      commit(
        blocksRef.current.map((b) =>
          b.id === id ? makeTransformed(b, type, b.text) : b
        )
      )
    },
    [commit, queueFocus]
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
    if (focused && focused.type === "paragraph" && focused.text === "") {
      next[idx] = image
    } else {
      next.splice(idx + 1, 0, image)
    }
    queueFocus(image.id, 0)
    commit(next)
  }, [commit, queueFocus])

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

  const focusLast = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      const last = blocksRef.current.at(-1)
      if (!last) return
      queueFocus(last.id, "end")
    },
    [queueFocus]
  )

  const onRowFocus = useCallback((id: string) => {
    lastFocusedRef.current = id
    dispatch({ type: "focus", id })
  }, [])

  const focusedType = blocks.find((b) => b.id === focusedId)?.type ?? null
  const editing = focusedId !== null
  const isSoleEmpty =
    blocks.length === 1 &&
    blocks[0].type === "paragraph" &&
    blocks[0].text === ""

  const clearFocus = useCallback(() => {
    dispatch({ type: "focus", id: null })
  }, [])

  return {
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
  }
}
