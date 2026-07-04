"use client"

import {
  Check,
  Copy,
  Loader2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { cardSurfaceClass } from "@/components/ui/surface"
import { cn } from "@/lib/shared/utils"

export const SHORT_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
})

/** "4h" / "2d" style compact age; falls back to "Jun 3" past a month. */
export function shortAgo(timestamp: number, now: number) {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 60) return "now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d`
  return SHORT_DATE_FORMAT.format(timestamp)
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
      <TriangleAlert className="mt-px size-3 shrink-0" />
      <span className="break-words">{message}</span>
    </div>
  )
}

export function PrimaryButton({
  children,
  className,
  disabled,
  loading,
  onClick,
}: {
  children: ReactNode
  className?: string
  disabled?: boolean
  loading?: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className={className}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
      {children}
    </Button>
  )
}

export function SecondaryButton({
  children,
  className,
  disabled,
  loading,
  onClick,
}: {
  children: ReactNode
  className?: string
  disabled?: boolean
  loading?: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className={className}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
      {children}
    </Button>
  )
}

export function CopyIconButton({
  label,
  value,
}: {
  label: string
  value: string
}) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearCopiedTimer = useCallback(() => {
    if (!timerRef.current) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  useEffect(() => clearCopiedTimer, [clearCopiedTimer])

  return (
    <IconButton
      size="xs"
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setCopied(true)
            clearCopiedTimer()
            timerRef.current = setTimeout(() => setCopied(false), 1500)
          })
          .catch(() => undefined)
      }}
    >
      {copied ? (
        <Check className="size-3 text-success" />
      ) : (
        <Copy className="size-3" />
      )}
    </IconButton>
  )
}

export function UserAvatar({
  className,
  name,
  url,
}: {
  className?: string
  name?: string | null
  url?: string
}) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        title={name ?? undefined}
        loading="lazy"
        className={cn("shrink-0 rounded-full bg-muted", className)}
      />
    )
  }
  return (
    <span
      title={name ?? undefined}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground uppercase",
        className
      )}
    >
      {name?.charAt(0) ?? "?"}
    </span>
  )
}

export function EmptyTabState({
  action,
  children,
  icon: Icon,
}: {
  action?: ReactNode
  children: ReactNode
  icon?: LucideIcon
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      {Icon ? (
        <span className="flex size-9 items-center justify-center rounded-full bg-muted/60">
          <Icon className="size-4 text-muted-foreground/70" />
        </span>
      ) : null}
      <p className="max-w-56 text-xs leading-relaxed text-muted-foreground">
        {children}
      </p>
      {action}
    </div>
  )
}

/** Placeholder rows shaped like the card lists, shown while data loads. */
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse overflow-hidden", cardSurfaceClass)}
    >
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="border-b border-border/50 px-3 py-3 last:border-b-0"
        >
          <div className="h-3 w-3/5 rounded bg-muted" />
          <div className="mt-2 h-2.5 w-2/5 rounded bg-muted/70" />
        </div>
      ))}
    </div>
  )
}
