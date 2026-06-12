export type BlockType =
  | "paragraph"
  | "heading"
  | "bullet"
  | "numbered"
  | "todo"
  | "image"
  | "code"

export type Block = {
  checked?: boolean
  id: string
  lang?: string
  text: string
  type: BlockType
  uploading?: boolean
  url?: string
}

export const LIST_TYPES: BlockType[] = ["bullet", "numbered", "todo"]

const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)]*)\)\s*$/

let blockIdSeq = 0

function nextBlockId() {
  blockIdSeq += 1
  return `mb-${blockIdSeq}`
}

export function makeBlock(
  type: BlockType,
  text: string,
  extra?: { checked?: boolean; lang?: string; url?: string }
): Block {
  return {
    id: nextBlockId(),
    type,
    text,
    ...(type === "todo" ? { checked: Boolean(extra?.checked) } : {}),
    ...(type === "image" ? { url: extra?.url ?? "" } : {}),
    ...(type === "code" ? { lang: extra?.lang ?? "" } : {}),
  }
}

export function emptyParagraph(): Block {
  return makeBlock("paragraph", "")
}

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

export function parseMarkdown(md: string): Block[] {
  if (!md) return [emptyParagraph()]
  const lines = md.replace(/\r\n/g, "\n").split("\n")
  const blocks: Block[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const fence = lines[index].match(/^```\s*([^\s`]*)\s*$/)
    if (!fence) {
      blocks.push(lineToBlock(lines[index]))
      continue
    }

    const body: string[] = []
    let closed = false
    index += 1
    for (; index < lines.length; index += 1) {
      if (/^```\s*$/.test(lines[index])) {
        closed = true
        break
      }
      body.push(lines[index])
    }
    blocks.push(makeBlock("code", body.join("\n"), { lang: fence[1] }))
    if (!closed) break
  }
  return blocks.length > 0 ? blocks : [emptyParagraph()]
}

export function serialize(blocks: Block[]): string {
  let counter = 0
  return blocks
    .map((block): string | null => {
      if (block.type === "image") {
        const url = (block.url ?? "").trim()
        return url ? `![${block.text}](${url})` : null
      }
      if (block.type === "code") {
        const lang = block.lang?.trim() ?? ""
        return `\`\`\`${lang}\n${block.text}\n\`\`\``
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

export function detectShortcut(
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

export type MarkdownEditorState = {
  blocks: Block[]
  focusedId: string | null
}

export type MarkdownEditorAction =
  | { type: "external-blocks"; blocks: Block[] }
  | { type: "focus"; id: string | null }
  | { type: "set-blocks"; blocks: Block[] }

export function createMarkdownEditorState(value: string): MarkdownEditorState {
  return {
    blocks: parseMarkdown(value),
    focusedId: null,
  }
}

export function markdownEditorReducer(
  state: MarkdownEditorState,
  action: MarkdownEditorAction
): MarkdownEditorState {
  switch (action.type) {
    case "external-blocks":
      return { blocks: action.blocks, focusedId: state.focusedId }
    case "focus":
      return { ...state, focusedId: action.id }
    case "set-blocks":
      return { ...state, blocks: action.blocks }
  }
}

export function makeTransformed(
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
    ...(type === "code" ? { lang: block.lang ?? "" } : {}),
  }
}
