"use client"

import {
  File as PierreFile,
  type FileContents,
  type FileOptions,
  type ThemeTypes,
} from "@pierre/diffs/react"
import { useTheme } from "next-themes"
import { memo, type CSSProperties, useMemo } from "react"

import {
  formatCodeLanguage,
  getPierreLanguage,
} from "@/components/code/language"
import { cardSurfaceClass } from "@/components/ui/surface"

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

export const CodeBlock = memo(function CodeBlock({
  body,
  lang,
  title,
  scrollable = false,
}: {
  body: string
  lang?: string
  /** Header label; defaults to the language name. */
  title?: string
  /** Cap the body height and scroll overflowing content. */
  scrollable?: boolean
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
    <div className={`overflow-hidden ${cardSurfaceClass}`}>
      <div
        className={`flex h-8 items-center border-b border-border bg-muted/70 px-3 font-mono text-[11px] font-medium text-muted-foreground ${title ? "" : "uppercase"}`}
      >
        <span className="min-w-0 truncate" title={title}>
          {title ?? formatCodeLanguage(language)}
        </span>
      </div>
      <div className={scrollable ? "max-h-[420px] overflow-y-auto" : undefined}>
        <PierreFile
          file={file}
          options={options}
          disableWorkerPool
          style={PIERRE_FILE_STYLE}
        />
      </div>
    </div>
  )
})
