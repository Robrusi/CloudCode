"use client"

import dynamic from "next/dynamic"
import { memo, useMemo, type ReactNode } from "react"

import { cn } from "@/lib/utils"

const CodeBlock = dynamic(
  () => import("@/components/code-block").then((mod) => mod.CodeBlock),
  { ssr: false }
)

export const Markdown = memo(function Markdown({
  text,
  className,
  onOpenFile,
  repoName,
}: {
  text: string
  className?: string
  onOpenFile: (path: string) => void
  repoName: string | null
}) {
  const blocks = useMemo(() => {
    const out: Array<{ kind: "code" | "text"; lang?: string; body: string }> =
      []
    const fence = /```([^\n`]*)\n([\s\S]*?)```/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = fence.exec(text)) !== null) {
      if (m.index > last)
        out.push({ kind: "text", body: text.slice(last, m.index) })
      out.push({ kind: "code", lang: parseCodeLanguage(m[1]), body: m[2] })
      last = m.index + m[0].length
    }
    if (last < text.length) out.push({ kind: "text", body: text.slice(last) })
    return out
  }, [text])

  return (
    <div className={cn("space-y-4", className)}>
      {blocks.map((b, i) =>
        b.kind === "code" ? (
          <CodeBlock key={i} body={b.body} lang={b.lang} />
        ) : (
          <InlineProse
            key={i}
            text={b.body}
            repoName={repoName}
            onOpenFile={onOpenFile}
          />
        )
      )}
    </div>
  )
})

function parseCodeLanguage(info: string) {
  const lang = info.trim().split(/\s+/)[0]?.replace(/^\./, "").toLowerCase()
  return lang || undefined
}

const InlineProse = memo(function InlineProse({
  text,
  onOpenFile,
  repoName,
}: {
  text: string
  onOpenFile: (path: string) => void
  repoName: string | null
}) {
  const lines = text.split("\n")
  const out: ReactNode[] = []
  let buf: string[] = []
  let listBuf: string[] = []

  function flushPara() {
    if (!buf.length) return
    const body = buf.join("\n").trim()
    buf = []
    if (!body) return
    out.push(
      <p key={out.length} className="whitespace-pre-wrap">
        {renderInline(body, { onOpenFile, repoName })}
      </p>
    )
  }
  function flushList() {
    if (!listBuf.length) return
    const items = listBuf
    listBuf = []
    out.push(
      <ul key={out.length} className="list-disc space-y-1.5 pl-5">
        {items.map((it, i) => (
          <li key={i}>{renderInline(it, { onOpenFile, repoName })}</li>
        ))}
      </ul>
    )
  }

  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    const bullet = /^[-*]\s+(.*)$/.exec(line)
    if (heading) {
      flushPara()
      flushList()
      const level = heading[1].length
      const content = heading[2]
      const cls =
        level === 1
          ? "text-xl font-semibold"
          : level === 2
            ? "text-lg font-semibold"
            : "text-base font-semibold"
      out.push(
        <div key={out.length} className={cls}>
          {renderInline(content, { onOpenFile, repoName })}
        </div>
      )
    } else if (bullet) {
      flushPara()
      listBuf.push(bullet[1])
    } else if (line.trim() === "") {
      flushPara()
      flushList()
    } else {
      flushList()
      buf.push(line)
    }
  }
  flushPara()
  flushList()

  return <>{out}</>
})

type FileLinkContext = {
  onOpenFile: (path: string) => void
  repoName: string | null
}

function renderInline(text: string, context: FileLinkContext): ReactNode {
  const parts: ReactNode[] = []
  const re =
    /(\[([^\]]+)\]\(([^)\s]+)\)|\bhttps?:\/\/[^\s<>()]+[^\s<>().,!?;:]|\*\*([^*]+)\*\*|`([^`]+)`)/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[2] !== undefined && m[3] !== undefined) {
      const href = normalizeLinkHref(m[3])
      parts.push(
        href ? (
          <MarkdownLink key={key++} href={href} fileLinkContext={context}>
            {renderInline(m[2], context)}
          </MarkdownLink>
        ) : (
          m[0]
        )
      )
    } else if (m[0].startsWith("http")) {
      const href = normalizeLinkHref(m[0])
      parts.push(
        href ? (
          <MarkdownLink key={key++} href={href} fileLinkContext={context}>
            {m[0]}
          </MarkdownLink>
        ) : (
          m[0]
        )
      )
    } else if (m[4] !== undefined) {
      parts.push(
        <strong key={key++} className="font-semibold">
          {m[4]}
        </strong>
      )
    } else if (m[5] !== undefined) {
      parts.push(
        <code
          key={key++}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
        >
          {m[5]}
        </code>
      )
    }
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

function MarkdownLink({
  children,
  fileLinkContext,
  href,
}: {
  children: ReactNode
  fileLinkContext: FileLinkContext
  href: string
}) {
  const external = /^https?:\/\//i.test(href)
  const filePath = getFilePathFromHref(href, fileLinkContext.repoName)

  return (
    <a
      href={href}
      onClick={
        filePath
          ? (event) => {
              event.preventDefault()
              fileLinkContext.onOpenFile(filePath)
            }
          : undefined
      }
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
    >
      {children}
    </a>
  )
}

function normalizeLinkHref(href: string) {
  const trimmed = href.trim()
  if (/^(https?:\/\/|mailto:|\/|#)/i.test(trimmed)) return trimmed
  if (looksLikeFileHref(trimmed)) return trimmed
  return undefined
}

function looksLikeFileHref(href: string) {
  if (/^(file:\/\/|\.{1,2}\/|~\/)/.test(href)) return true
  if (/^[\w@.-]+\.[A-Za-z0-9]+(?::\d+(?::\d+)?)?(?:#L\d+)?$/.test(href)) {
    return true
  }
  if (/^[\w@.-]+(?:\/[\w@.-]+)+(?::\d+(?::\d+)?)?(?:#L\d+)?$/.test(href)) {
    return true
  }
  return false
}

function getFilePathFromHref(href: string, repoName: string | null) {
  if (/^(https?:\/\/|mailto:|#)/i.test(href)) return null

  let path = href.trim()
  try {
    path = decodeURI(path)
  } catch {
    // Keep the raw href if it is not URI-encoded cleanly.
  }

  path = path.replace(/^file:\/\//i, "")
  path = path.replace(/#L\d+$/i, "")
  path = path.replace(/:\d+(?::\d+)?$/, "")
  path = path.replace(/^\.\/+/, "")

  const repoRoot = "/home/user/repo/"
  if (path.startsWith(repoRoot)) {
    return sanitizeRelativeFilePath(path.slice(repoRoot.length))
  }

  if (repoName) {
    const repoMarker = `/${repoName}/`
    const repoIndex = path.lastIndexOf(repoMarker)
    if (repoIndex >= 0) {
      return sanitizeRelativeFilePath(path.slice(repoIndex + repoMarker.length))
    }
  }

  if (path.startsWith("/")) {
    return null
  }

  if (!looksLikeFileHref(path)) return null
  return sanitizeRelativeFilePath(path)
}

function sanitizeRelativeFilePath(path: string) {
  const cleaned = path.replace(/^\/+/, "")
  if (!cleaned || cleaned.split("/").includes("..")) return null
  return cleaned
}
