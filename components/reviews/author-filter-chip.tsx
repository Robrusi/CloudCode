"use client"

import { Check, ChevronDown, X } from "lucide-react"
import { useRef, useState } from "react"

import {
  chipTrigger,
  popoverItem,
  popoverPanel,
} from "@/components/chat/control-styles"
import { Input } from "@/components/ui/input"
import { useClickOutside } from "@/hooks/use-click-outside"
import { normalizeGitHubLogin } from "@/lib/reviews/config"
import { cn } from "@/lib/shared/utils"

type AuthorFilterMode = "" | "allow" | "block"

const MODE_OPTIONS: Array<{ label: string; value: AuthorFilterMode }> = [
  { label: "All authors", value: "" },
  { label: "Only these authors", value: "allow" },
  { label: "Everyone except", value: "block" },
]

function chipLabel(mode: AuthorFilterMode, authors: string[]) {
  if (!mode || authors.length === 0) return "All authors"
  const count = authors.length
  const summary = count === 1 ? authors[0] : `${count} authors`
  return mode === "allow" ? `Only ${summary}` : `Except ${summary}`
}

/** Chip + popover choosing which PR authors get reviewed: everyone, an
 * allowlist, or a blocklist of GitHub usernames. */
export function AuthorFilterChip({
  authors,
  mode,
  onChangeAuthors,
  onChangeMode,
}: {
  authors: string[]
  mode: AuthorFilterMode
  onChangeAuthors: (authors: string[]) => void
  onChangeMode: (mode: AuthorFilterMode) => void
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState("")
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))

  const addPending = () => {
    const login = normalizeGitHubLogin(pending)
    if (!login) return
    setPending("")
    if (authors.some((author) => author.toLowerCase() === login.toLowerCase()))
      return
    onChangeAuthors([...authors, login])
  }

  const remove = (login: string) =>
    onChangeAuthors(authors.filter((author) => author !== login))

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Which authors get reviewed"
        className={cn(chipTrigger, "gap-1.5 text-foreground")}
      >
        <span>{chipLabel(mode, authors)}</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </button>
      {open ? (
        <div className={cn(popoverPanel, "top-10 right-0 w-60")}>
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChangeMode(option.value)
                if (!option.value) setOpen(false)
              }}
              className={popoverItem}
            >
              <span className="whitespace-nowrap">{option.label}</span>
              {option.value === mode ? (
                <Check className="size-4 shrink-0" strokeWidth={2.25} />
              ) : null}
            </button>
          ))}

          {mode ? (
            <div className="px-2 pt-1.5 pb-2">
              <Input
                value={pending}
                onChange={(event) => setPending(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    addPending()
                  }
                }}
                onBlur={addPending}
                placeholder="GitHub username"
                aria-label="Add a GitHub username"
                className="h-8 rounded-md border-border/60 px-2.5 text-sm focus:border-border focus:ring-0"
              />
              {authors.length ? (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {authors.map((author) => (
                    <li
                      key={author}
                      className="flex items-center gap-1 rounded-md bg-muted py-0.5 pr-1 pl-2 text-xs text-foreground/90"
                    >
                      <span>{author}</span>
                      <button
                        type="button"
                        onClick={() => remove(author)}
                        aria-label={`Remove ${author}`}
                        className="grid size-4 place-items-center rounded text-muted-foreground hover:text-foreground"
                      >
                        <X className="size-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
