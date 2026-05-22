"use client"

import dynamic from "next/dynamic"
import { memo, useMemo, type ReactNode } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "@/lib/utils"

const CodeBlock = dynamic(
  () => import("@/components/code-block").then((mod) => mod.CodeBlock),
  { ssr: false }
)

const remarkPlugins = [remarkGfm]

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
  const normalizedText = useMemo(() => closeOpenCodeFence(text), [text])
  const components = useMemo<Components>(
    () => ({
      a: ({ children, href }) => {
        const normalizedHref = href ? normalizeLinkHref(href) : undefined

        return normalizedHref ? (
          <MarkdownLink
            href={normalizedHref}
            fileLinkContext={{ onOpenFile, repoName }}
          >
            {children}
          </MarkdownLink>
        ) : (
          <span>{children}</span>
        )
      },
      blockquote: ({ children }) => (
        <blockquote className="border-l-2 border-border pl-4 text-muted-foreground">
          {children}
        </blockquote>
      ),
      code: ({ children, className: codeClassName }) => {
        const body = String(children).replace(/\n$/, "")
        const language = /language-([^\s]+)/.exec(codeClassName ?? "")?.[1]
        const isBlock = Boolean(
          language || codeClassName || body.includes("\n")
        )

        if (isBlock) {
          return <CodeBlock body={body} lang={language?.toLowerCase()} />
        }

        return (
          <code
            className={cn(
              "rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]",
              codeClassName
            )}
          >
            {children}
          </code>
        )
      },
      h1: ({ children }) => (
        <h1 className="mt-6 mb-3 text-xl font-semibold first:mt-0">
          {children}
        </h1>
      ),
      h2: ({ children }) => (
        <h2 className="mt-5 mb-2.5 text-lg font-semibold first:mt-0">
          {children}
        </h2>
      ),
      h3: ({ children }) => (
        <h3 className="mt-4 mb-2 text-base font-semibold first:mt-0">
          {children}
        </h3>
      ),
      hr: () => <hr className="border-border" />,
      li: ({ children }) => <li className="pl-1">{children}</li>,
      ol: ({ children }) => (
        <ol className="list-decimal space-y-1.5 pl-5">{children}</ol>
      ),
      p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
      pre: ({ children }) => <>{children}</>,
      table: ({ children }) => (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">{children}</table>
        </div>
      ),
      td: ({ children }) => (
        <td className="border border-border px-2 py-1 align-top">{children}</td>
      ),
      th: ({ children }) => (
        <th className="border border-border bg-muted px-2 py-1 text-left align-top font-semibold">
          {children}
        </th>
      ),
      ul: ({ children }) => (
        <ul className="list-disc space-y-1.5 pl-5">{children}</ul>
      ),
    }),
    [onOpenFile, repoName]
  )

  return (
    <div className={cn("space-y-4 break-words", className)}>
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {normalizedText}
      </ReactMarkdown>
    </div>
  )
})

function closeOpenCodeFence(value: string) {
  const fenceCount = value.match(/(^|\n)```/g)?.length ?? 0
  return fenceCount % 2 === 1 ? `${value}\n\`\`\`` : value
}

type FileLinkContext = {
  onOpenFile: (path: string) => void
  repoName: string | null
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
  const filePath = getFilePathFromHref(href, fileLinkContext.repoName)
  const external = !filePath && /^https?:\/\//i.test(href)

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
  const trimmed = href.trim().replace(/^<(.+)>$/, "$1")
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
  if (/^(mailto:|#)/i.test(href)) return null

  let path = href.trim()
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname
    } catch {
      return null
    }
  }
  try {
    path = decodeURI(path)
  } catch {
    // Keep the raw href if it is not URI-encoded cleanly.
  }

  path = path.replace(/^file:\/\//i, "")
  path = path.replace(/#L\d+$/i, "")
  path = path.replace(/:\d+(?::\d+)?$/, "")
  path = path.replace(/^\.\/+/, "")

  const sandboxRepoRoots = [
    "/home/daytona/repo/",
    "/home/user/repo/",
    "/root/repo/",
  ]
  for (const repoRoot of sandboxRepoRoots) {
    if (path.startsWith(repoRoot)) {
      return sanitizeRelativeFilePath(path.slice(repoRoot.length))
    }
  }

  const repoRootIndex = path.indexOf("/repo/")
  if (repoRootIndex >= 0) {
    return sanitizeRelativeFilePath(path.slice(repoRootIndex + "/repo/".length))
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
