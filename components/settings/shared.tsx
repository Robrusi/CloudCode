"use client"

import { type ReactNode } from "react"

export const inputClass =
  "h-9 w-full rounded-lg border border-field bg-background px-3 text-sm transition-colors outline-none placeholder:text-muted-foreground/60 focus:border-ring focus:ring-3 focus:ring-ring/20 disabled:pointer-events-none disabled:opacity-60"

export const textareaClass =
  "w-full resize-y rounded-lg border border-field bg-background px-3 py-2 font-[family-name:var(--font-mono)] text-xs leading-5 transition-colors outline-none placeholder:text-muted-foreground/60 focus:border-ring focus:ring-3 focus:ring-ring/20"

export const fieldLabel = "grid gap-1.5 text-xs font-medium text-foreground/80"

export const fieldHint =
  "text-[11px] leading-4 font-normal text-muted-foreground"

export const metaPill =
  "inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"

export const statusBadge =
  "inline-flex shrink-0 items-center gap-1.5 text-xs font-medium"

export const statusOk = "text-success"

export const statusIdle = "text-muted-foreground"

export function SettingsPage({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-medium tracking-tight text-foreground/90">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}
