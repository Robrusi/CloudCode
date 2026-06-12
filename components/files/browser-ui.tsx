"use client"

import { FileTree, type useFileTree } from "@pierre/trees/react"
import type { CSSProperties } from "react"
import { useMemo } from "react"

import { Button } from "@/components/ui/button"

export const TREE_SCROLLBAR_CSS = `
[data-file-tree-virtualized-scroll='true'],
[data-file-tree-scrollbar-measure='true'] {
  scrollbar-color: var(--trees-scrollbar-thumb) transparent;
  scrollbar-width: thin;
}

[data-file-tree-virtualized-scroll='true']::-webkit-scrollbar,
[data-file-tree-scrollbar-measure='true']::-webkit-scrollbar {
  width: var(--trees-scrollbar-gutter);
  height: var(--trees-scrollbar-gutter);
}

[data-file-tree-virtualized-scroll='true']::-webkit-scrollbar-track,
[data-file-tree-scrollbar-measure='true']::-webkit-scrollbar-track {
  background: transparent;
}

[data-file-tree-virtualized-scroll='true']::-webkit-scrollbar-thumb,
[data-file-tree-scrollbar-measure='true']::-webkit-scrollbar-thumb {
  background-color: var(--trees-scrollbar-thumb);
  background-clip: content-box;
  border: 0.5px solid transparent;
  border-radius: 999px;
}

[data-file-tree-virtualized-scroll='true']::-webkit-scrollbar-thumb:vertical,
[data-file-tree-scrollbar-measure='true']::-webkit-scrollbar-thumb:vertical {
  border-block: 14px solid transparent;
  border-inline: 0.5px solid transparent;
}

[data-file-tree-virtualized-scroll='true']::-webkit-scrollbar-thumb:horizontal,
[data-file-tree-scrollbar-measure='true']::-webkit-scrollbar-thumb:horizontal {
  border-block: 0.5px solid transparent;
  border-inline: 14px solid transparent;
}

[data-file-tree-virtualized-scroll='true']::-webkit-scrollbar-corner,
[data-file-tree-scrollbar-measure='true']::-webkit-scrollbar-corner {
  background: transparent;
}
`

// `@pierre/trees` resolves its defaults through `light-dark()` which keys off
// the host's `color-scheme` CSS property, so we declare it explicitly and
// then map every override to the same design tokens used by the rest of the
// app (sidebar, foreground, muted, accent, border).
export function FileTreeWrapper({
  dark,
  model,
}: {
  dark: boolean
  model: ReturnType<typeof useFileTree>["model"]
}) {
  const style = useMemo<CSSProperties>(
    () =>
      ({
        height: "100%",
        width: "100%",
        paddingTop: "8px",
        colorScheme: dark ? "dark" : "light",
        "--trees-bg-override": "var(--sidebar)",
        "--trees-fg-override": "var(--sidebar-foreground)",
        "--trees-fg-muted-override": "var(--muted-foreground)",
        "--trees-bg-muted-override": "var(--sidebar-accent)",
        "--trees-selected-bg-override": "var(--sidebar-accent)",
        "--trees-selected-fg-override": "var(--sidebar-accent-foreground)",
        "--trees-selected-focused-border-color-override":
          "var(--sidebar-border)",
        "--trees-border-color-override": "var(--sidebar-border)",
        "--trees-indent-guide-bg-override": "var(--sidebar-border)",
        "--trees-scrollbar-thumb-override": "var(--scrollbar-thumb)",
        "--trees-scrollbar-gutter-override": "2px",
        "--trees-focus-ring-color-override": "var(--ring)",
        "--trees-font-family-override": "var(--font-sans)",
        "--trees-font-size-override": "12.5px",
        "--trees-item-padding-x-override": "8px",
        "--trees-padding-inline-override": "6px",
      }) as CSSProperties,
    [dark]
  )

  return <FileTree model={model} style={style} />
}

export function FileBrowserEmptyState({
  message,
  actionLabel,
  onAction,
}: {
  message: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-xs text-muted-foreground">{message}</p>
      {actionLabel && onAction ? (
        <Button type="button" variant="outline" size="xs" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  )
}
