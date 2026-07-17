"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  DEFAULT_SIDEBAR_THREAD_OPTIONS,
  hasActiveSidebarThreadFilters,
  type SidebarThreadFilter,
  type SidebarThreadListOptions,
  type SidebarThreadSort,
} from "@/components/chat/sidebar-model"
import { readBrowserStorage, writeBrowserStorage } from "@/lib/browser/storage"

const SORT_STORAGE_KEY = "cloudcode:sidebarThreadSort"

const SIDEBAR_THREAD_SORTS: SidebarThreadSort[] = [
  "activity",
  "created",
  "oldest",
  "title",
]

function isSidebarThreadSort(value: string | null): value is SidebarThreadSort {
  return SIDEBAR_THREAD_SORTS.includes(value as SidebarThreadSort)
}

export type SidebarThreadFiltersState = ReturnType<
  typeof useSidebarThreadFilters
>

/** Search/sort/filter state for the sidebar thread list. Sort persists across
 * sessions; search and status filter are session-local and reset when the
 * sidebar switches thread contexts, so a chats-context search never silently
 * empties the reviews list. Pass null while the sidebar shows a non-thread
 * view (settings); a transient visit then leaves the filters of the
 * underlying context untouched. Owned by the chat controller rather than the
 * sidebar itself: the sidebar unmounts on mobile navigation, and state here
 * must survive that. */
export function useSidebarThreadFilters(
  context: "chats" | "automations" | "reviews" | null
) {
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<SidebarThreadFilter>(
    DEFAULT_SIDEBAR_THREAD_OPTIONS.filter
  )
  const [sort, setSortState] = useState<SidebarThreadSort>(
    DEFAULT_SIDEBAR_THREAD_OPTIONS.sort
  )

  // Hydrate once from storage after mount to avoid SSR markup mismatches.
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true
    const stored = readBrowserStorage(SORT_STORAGE_KEY)
    if (isSidebarThreadSort(stored)) setSortState(stored)
  }, [])

  const setSort = useCallback((value: SidebarThreadSort) => {
    setSortState(value)
    writeBrowserStorage(SORT_STORAGE_KEY, value)
  }, [])

  // Context switches swap the underlying thread list; drop the stale search
  // and filter during render, before they can filter the new list. A null
  // context is skipped entirely so settings visits neither reset nor count
  // as the context to return to.
  const [lastContext, setLastContext] = useState(context)
  if (context !== null && lastContext !== context) {
    setLastContext(context)
    setQuery("")
    setFilter(DEFAULT_SIDEBAR_THREAD_OPTIONS.filter)
  }

  const clearFilters = useCallback(() => {
    setQuery("")
    setFilter(DEFAULT_SIDEBAR_THREAD_OPTIONS.filter)
  }, [])

  const options = useMemo<SidebarThreadListOptions>(
    () => ({ filter, query, sort }),
    [filter, query, sort]
  )

  return {
    clearFilters,
    filter,
    filtersActive: hasActiveSidebarThreadFilters(options),
    options,
    query,
    setFilter,
    setQuery,
    setSort,
    sort,
  }
}
