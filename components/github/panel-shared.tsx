import { Loader2, TriangleAlert } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"

export function SectionHeading({
  children,
  count,
  trailing,
}: {
  children: ReactNode
  count?: number
  trailing?: ReactNode
}) {
  return (
    <div className="flex items-center gap-2 px-0.5 pb-2">
      <h2 className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground/80 uppercase">
        {children}
      </h2>
      {count || trailing ? (
        <div className="ml-auto flex items-center gap-2">
          {count ? (
            <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
              {count}
            </span>
          ) : null}
          {trailing}
        </div>
      ) : null}
    </div>
  )
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mb-3 flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
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
