"use client"

import { Check } from "lucide-react"
import { useMemo, useState } from "react"

import { fieldBase } from "@/components/automations/menu-select"
import { popoverItem } from "@/components/chat/control-styles"
import { LINEAR_COMMENT_AUTHOR_FILTER_MAX } from "@/lib/automations/linear-comment-trigger"
import { cn } from "@/lib/shared/utils"

export type LinearTriggerUser = {
  assignable: boolean
  email: string
  id: string
  name: string
}

export function LinearCommentAuthorPicker({
  authorIds,
  authorNames,
  onChange,
  users,
  usersById,
}: {
  authorIds: string[]
  authorNames: string[]
  onChange: (authorIds: string[], authorNames: string[]) => void
  users: LinearTriggerUser[] | null
  usersById: Map<string, LinearTriggerUser>
}) {
  const [search, setSearch] = useState("")
  const savedNamesById = useMemo(
    () => new Map(authorIds.map((id, index) => [id, authorNames[index] ?? id])),
    [authorIds, authorNames]
  )
  const selectedIds = useMemo(() => new Set(authorIds), [authorIds])
  const options = useMemo(() => {
    const unavailable = authorIds
      .filter((id) => !usersById.has(id))
      .map((id) => ({
        assignable: false,
        email: "Unavailable user",
        id,
        name: savedNamesById.get(id) ?? id,
      }))
    const all = [...unavailable, ...(users ?? [])]
    const query = search.trim().toLowerCase()
    return query
      ? all.filter((user) =>
          `${user.name} ${user.email}`.toLowerCase().includes(query)
        )
      : all
  }, [authorIds, savedNamesById, search, users, usersById])

  function toggleUser(user: LinearTriggerUser) {
    const nextIds = selectedIds.has(user.id)
      ? authorIds.filter((id) => id !== user.id)
      : [...authorIds, user.id]
    onChange(
      nextIds,
      nextIds.map(
        (id) => usersById.get(id)?.name ?? savedNamesById.get(id) ?? id
      )
    )
  }

  const atLimit = authorIds.length >= LINEAR_COMMENT_AUTHOR_FILTER_MAX

  return (
    <div className="space-y-1.5">
      <input
        aria-label="Search Linear users"
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search people"
        className={cn(fieldBase, "px-2.5")}
      />
      <fieldset
        aria-label="Linear comment authors"
        className="max-h-40 overflow-y-auto rounded-lg border border-field bg-background p-1"
      >
        {options.length > 0 ? (
          options.map((user) => {
            const selected = selectedIds.has(user.id)
            return (
              <button
                key={user.id}
                type="button"
                aria-pressed={selected}
                disabled={!selected && atLimit}
                onClick={() => toggleUser(user)}
                className={cn(
                  popoverItem,
                  "gap-2 px-2 py-1.5 disabled:opacity-40"
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">
                    {user.name}
                  </span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {user.email}
                  </span>
                </span>
                {selected ? <Check className="size-3.5 shrink-0" /> : null}
              </button>
            )
          })
        ) : (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">
            {users === null ? "Loading people…" : "No people found"}
          </p>
        )}
      </fieldset>
      <p className="px-0.5 text-[11px] leading-4 text-muted-foreground">
        {authorIds.length} selected
        {atLimit ? ` · maximum ${LINEAR_COMMENT_AUTHOR_FILTER_MAX}` : ""}
      </p>
    </div>
  )
}
