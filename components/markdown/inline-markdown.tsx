"use client"

import { memo, useMemo } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "@/lib/shared/utils"

const remarkPlugins = [remarkGfm]

// Strip everything except inline formatting. Block wrappers are unwrapped so the
// result drops straight into an inline context (a single editor line).
const DISALLOWED = [
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "ul",
  "ol",
  "li",
  "hr",
  "pre",
  "img",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "input",
]

const components: Components = {
  a: ({ children, href }) =>
    href ? (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        // Keep clicks on the link from also entering edit mode on the row.
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        className="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  code: ({ children }) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
      {children}
    </code>
  ),
}

/**
 * Renders the inline markdown of a single editor line (bold, italic, inline
 * code, strikethrough, links). Soft newlines are turned into hard breaks so a
 * multi-line block keeps its shape when rendered.
 */
export const InlineMarkdown = memo(function InlineMarkdown({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  const prepared = useMemo(() => text.replace(/\n/g, "  \n"), [text])
  return (
    <span className={cn("break-words", className)}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        components={components}
        disallowedElements={DISALLOWED}
        unwrapDisallowed
      >
        {prepared}
      </ReactMarkdown>
    </span>
  )
})
