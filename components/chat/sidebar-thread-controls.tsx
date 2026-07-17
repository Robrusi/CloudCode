"use client"

import { Check, ListFilter, Search, X } from "lucide-react"
import { useMemo, useRef, useState } from "react"

import {
  popoverHeading,
  popoverItem,
  popoverPanel,
} from "@/components/chat/control-styles"
import {
  buildSidebarChatNodes,
  filterSidebarChatNodes,
  isSidebarNodeRunning,
  nodeHasLiveSandbox,
  type SidebarChat,
  type SidebarThreadFilter,
  type SidebarThreadSort,
} from "@/components/chat/sidebar-model"
import { useClickOutside } from "@/hooks/use-click-outside"
import { cn } from "@/lib/shared/utils"

const SORT_OPTIONS: Array<{ label: string; value: SidebarThreadSort }> = [
  { label: "Recent activity", value: "activity" },
  { label: "Oldest activity", value: "oldest" },
  { label: "Recently created", value: "created" },
  { label: "Title A–Z", value: "title" },
]

type ThreadCounts = { all: number; running: number; sandbox: number }

const FILTER_OPTIONS: Array<{
  count: (counts: ThreadCounts) => number
  label: string
  value: SidebarThreadFilter
}> = [
  { count: (c) => c.all, label: "All threads", value: "all" },
  { count: (c) => c.running, label: "Agent running", value: "running" },
  { count: (c) => c.sandbox, label: "Sandbox running", value: "sandbox" },
]

/** Search field plus a sort/filter popover for the sidebar thread list. Purely
 * presentational — state lives in useSidebarThreadFilters so the sidebar can
 * apply the same options when grouping. */
export function SidebarThreadControls({
  chats,
  filter,
  onFilterChange,
  onQueryChange,
  onSortChange,
  query,
  sort,
}: {
  chats: SidebarChat[]
  filter: SidebarThreadFilter
  onFilterChange: (filter: SidebarThreadFilter) => void
  onQueryChange: (query: string) => void
  onSortChange: (sort: SidebarThreadSort) => void
  query: string
  sort: SidebarThreadSort
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  useClickOutside(containerRef, menuOpen, () => setMenuOpen(false))

  // Counts mirror what each filter would list under the active search: one
  // per sidebar row, with factory-dispatched children counted into their
  // root's subtree.
  const counts = useMemo<ThreadCounts>(() => {
    const nodes = filterSidebarChatNodes(buildSidebarChatNodes(chats), {
      filter: "all",
      query,
    })
    return {
      all: nodes.length,
      running: nodes.filter(isSidebarNodeRunning).length,
      sandbox: nodes.filter(nodeHasLiveSandbox).length,
    }
  }, [chats, query])

  const customized = sort !== "activity" || filter !== "all"

  return (
    <div ref={containerRef} className="relative px-2 pt-2">
      <div className="flex items-center gap-0.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-foreground/70" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return
              event.preventDefault()
              if (query) onQueryChange("")
              else event.currentTarget.blur()
            }}
            placeholder="Search"
            aria-label="Search threads"
            className="h-7 w-full rounded-lg bg-transparent pr-6 pl-7 text-[0.8125rem] text-foreground transition-colors outline-none placeholder:text-muted-foreground/60 hover:bg-muted/50 focus:bg-muted/50"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                onQueryChange("")
                searchRef.current?.focus()
              }}
              aria-label="Clear search"
              className="absolute top-1/2 right-1 grid size-4 -translate-y-1/2 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && menuOpen) setMenuOpen(false)
          }}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Sort and filter threads"
          className="relative grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 aria-expanded:bg-muted aria-expanded:text-foreground"
        >
          <ListFilter className="size-3.5" />
          {customized ? (
            <span
              aria-hidden
              className="absolute top-1 right-1 size-1 rounded-full bg-foreground"
            />
          ) : null}
        </button>
      </div>
      {menuOpen ? (
        // Keyboard behavior intentionally matches the app's other role="menu"
        // surfaces (see ui/context-menu): items are Tab-reachable and Escape
        // closes. Arrow-key navigation and focus management are deferred to a
        // future shared menu primitive so they land app-wide, not one-off.
        <div
          role="menu"
          aria-label="Sort and filter threads"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") setMenuOpen(false)
          }}
          className={cn(popoverPanel, "top-full right-2 mt-1")}
        >
          <p className={cn(popoverHeading, "px-2 pt-1 pb-0.5")}>Sort by</p>
          {SORT_OPTIONS.map((option) => {
            const selected = option.value === sort
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  onSortChange(option.value)
                  setMenuOpen(false)
                }}
                className={cn(popoverItem, "gap-3 px-2 py-1 text-[0.8125rem]")}
              >
                <span className="min-w-0 truncate">{option.label}</span>
                {selected ? (
                  <Check className="size-3 shrink-0" strokeWidth={2.25} />
                ) : null}
              </button>
            )
          })}
          <div className="mx-1 my-1 border-t border-border/60" />
          <p className={cn(popoverHeading, "px-2 pt-1 pb-0.5")}>Show</p>
          {FILTER_OPTIONS.map((option) => {
            const selected = option.value === filter
            const count = option.count(counts)
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                disabled={!selected && count === 0}
                onClick={() => {
                  onFilterChange(option.value)
                  setMenuOpen(false)
                }}
                className={cn(
                  popoverItem,
                  "gap-3 px-2 py-1 text-[0.8125rem] disabled:pointer-events-none disabled:opacity-40"
                )}
              >
                <span className="min-w-0 truncate">{option.label}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {selected ? (
                    <Check className="size-3 shrink-0" strokeWidth={2.25} />
                  ) : null}
                  <span className="min-w-3.5 text-right text-[0.6875rem] text-muted-foreground/80 tabular-nums">
                    {count}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
