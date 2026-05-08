"use client"

import {
  File as PierreFile,
  type FileContents,
  type FileOptions,
  type ThemeTypes,
} from "@pierre/diffs/react"
import { useTheme } from "next-themes"
import { memo, type CSSProperties, useMemo } from "react"

const CODE_LANGUAGE_LABELS: Record<string, string> = {
  bash: "Bash",
  css: "CSS",
  diff: "Diff",
  html: "HTML",
  javascript: "JavaScript",
  js: "JavaScript",
  json: "JSON",
  jsx: "JSX",
  markdown: "Markdown",
  md: "Markdown",
  plaintext: "Plain text",
  python: "Python",
  py: "Python",
  sh: "Shell",
  shell: "Shell",
  ts: "TypeScript",
  tsx: "TSX",
  typescript: "TypeScript",
  yaml: "YAML",
  yml: "YAML",
}

const PIERRE_CODE_THEMES = {
  dark: "pierre-dark",
  light: "pierre-light",
} as const

const PIERRE_FILE_STYLE = {
  "--diffs-font-family": "var(--font-mono)",
  "--diffs-font-size": "13px",
  "--diffs-gap-block": "12px",
  "--diffs-line-height": "24px",
} as CSSProperties

const PIERRE_LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  md: "markdown",
  plaintext: "text",
  py: "python",
  sh: "bash",
  shell: "bash",
  text: "text",
  ts: "typescript",
  yml: "yaml",
}

export const CodeBlock = memo(function CodeBlock({
  body,
  lang,
}: {
  body: string
  lang?: string
}) {
  const code = body.replace(/\n$/, "")
  const language = lang ?? "plaintext"
  const { resolvedTheme } = useTheme()
  const themeType: ThemeTypes = resolvedTheme === "dark" ? "dark" : "light"
  const file = useMemo<FileContents>(
    () => ({
      cacheKey: `${language}:${code}`,
      contents: code,
      lang: getPierreLanguage(language),
      name: `snippet.${language}`,
    }),
    [code, language]
  )
  const options = useMemo<FileOptions<undefined>>(
    () => ({
      disableFileHeader: true,
      disableLineNumbers: true,
      overflow: "wrap",
      theme: PIERRE_CODE_THEMES,
      themeType,
    }),
    [themeType]
  )

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background">
      <div className="flex h-8 items-center border-b border-border bg-muted/70 px-3 font-mono text-[11px] font-medium text-muted-foreground uppercase">
        {formatCodeLanguage(language)}
      </div>
      <PierreFile
        file={file}
        options={options}
        disableWorkerPool
        style={PIERRE_FILE_STYLE}
      />
    </div>
  )
})

function formatCodeLanguage(lang: string) {
  return CODE_LANGUAGE_LABELS[lang] ?? lang
}

function getPierreLanguage(lang: string) {
  return PIERRE_LANGUAGE_ALIASES[lang] ?? lang
}
