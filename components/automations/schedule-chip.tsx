"use client"

import { ChevronDown, Clock, Globe } from "lucide-react"
import { useMemo, useRef } from "react"

import {
  fieldBase,
  MenuSelect,
  type MenuSelectOption as Option,
} from "@/components/automations/menu-select"
import {
  formatInstantShort,
  timezoneOptions,
} from "@/components/automations/model"
import { formatRelative } from "@/components/chat/format"
import { chipTrigger, popoverPanel } from "@/components/chat/control-styles"
import {
  cronFromScheduleDraft,
  describeScheduleDraft,
  FREQUENCY_LABEL,
  FREQUENCY_OPTIONS,
  frequencyOfSchedule,
  HOURLY_INTERVALS,
  MINUTE_INTERVALS,
  scheduleForFrequency,
  upcomingRuns,
  WEEKDAY_LONG,
  WEEKDAY_SHORT,
  type FrequencyOption,
  type ScheduleDraft,
} from "@/lib/automations/schedule-draft"
import { useClickOutside } from "@/hooks/use-click-outside"
import { cn } from "@/lib/shared/utils"

const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, index) => index * 5)
const pad2 = (value: number) => String(value).padStart(2, "0")

/** A single compact time input; its native picker is never clipped now that
 * the popover allows overflow. */
function TimeField({
  onChange,
  value,
}: {
  onChange: (value: string) => void
  value: string
}) {
  return (
    <input
      aria-label="Time of day"
      type="time"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        fieldBase,
        "px-2.5 tabular-nums [&::-webkit-inner-spin-button]:hidden"
      )}
    />
  )
}

function WeekdayPicker({
  days,
  onChange,
}: {
  days: number[]
  onChange: (days: number[]) => void
}) {
  return (
    <fieldset className="flex w-full items-center gap-0.5 rounded-lg border border-field bg-muted/40 p-0.5">
      <legend className="sr-only">Days of the week</legend>
      {WEEKDAY_SHORT.map((short, day) => {
        const active = days.includes(day)
        return (
          <button
            key={WEEKDAY_LONG[day]}
            type="button"
            aria-pressed={active}
            aria-label={WEEKDAY_LONG[day]}
            title={WEEKDAY_LONG[day]}
            onClick={() => {
              const next = active
                ? days.filter((value) => value !== day)
                : [...days, day]
              if (next.length === 0) return
              onChange(next)
            }}
            className={cn(
              "h-7 flex-1 rounded-md text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
              active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-background hover:text-foreground"
            )}
          >
            {short}
          </button>
        )
      })}
    </fieldset>
  )
}

function ScheduleFields({
  schedule,
  onScheduleChange,
}: {
  schedule: ScheduleDraft
  onScheduleChange: (schedule: ScheduleDraft) => void
}) {
  if (schedule.kind === "minutely") {
    const intervalOptions: Option[] = [
      ...(MINUTE_INTERVALS.includes(schedule.every)
        ? []
        : [
            {
              label: `Every ${schedule.every} minutes`,
              value: String(schedule.every),
            },
          ]),
      ...MINUTE_INTERVALS.map((every) => ({
        label: every === 1 ? "Every minute" : `Every ${every} minutes`,
        value: String(every),
      })),
    ]
    return (
      <MenuSelect
        ariaLabel="Minute interval"
        value={String(schedule.every)}
        options={intervalOptions}
        onChange={(value) =>
          onScheduleChange({ ...schedule, every: Number(value) })
        }
      />
    )
  }

  if (schedule.kind === "hourly") {
    const intervalOptions: Option[] = [
      ...(HOURLY_INTERVALS.includes(schedule.every)
        ? []
        : [
            {
              label: `Every ${schedule.every} hours`,
              value: String(schedule.every),
            },
          ]),
      ...HOURLY_INTERVALS.map((every) => ({
        label: every === 1 ? "Every hour" : `Every ${every} hours`,
        value: String(every),
      })),
    ]
    const minuteOptions: Option[] = [
      ...(MINUTE_OPTIONS.includes(schedule.minute)
        ? []
        : [
            {
              label: `At :${pad2(schedule.minute)}`,
              value: String(schedule.minute),
            },
          ]),
      ...MINUTE_OPTIONS.map((minute) => ({
        label: `At :${pad2(minute)}`,
        value: String(minute),
      })),
    ]
    return (
      <>
        <MenuSelect
          ariaLabel="Hour interval"
          value={String(schedule.every)}
          options={intervalOptions}
          onChange={(value) =>
            onScheduleChange({ ...schedule, every: Number(value) })
          }
        />
        <MenuSelect
          ariaLabel="Minute past the hour"
          value={String(schedule.minute)}
          options={minuteOptions}
          onChange={(value) =>
            onScheduleChange({ ...schedule, minute: Number(value) })
          }
        />
      </>
    )
  }

  if (schedule.kind === "weekly") {
    return (
      <>
        <WeekdayPicker
          days={schedule.days}
          onChange={(days) => onScheduleChange({ ...schedule, days })}
        />
        <TimeField
          value={schedule.time}
          onChange={(time) => onScheduleChange({ ...schedule, time })}
        />
      </>
    )
  }

  if (schedule.kind === "custom") {
    return (
      <div className="space-y-1">
        <input
          aria-label="Cron expression"
          type="text"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          value={schedule.cron}
          onChange={(event) =>
            onScheduleChange({ ...schedule, cron: event.target.value })
          }
          placeholder="0 9 * * 1"
          className={cn(fieldBase, "px-2.5 font-mono text-xs tabular-nums")}
        />
        <p className="px-0.5 text-[10px] text-muted-foreground/60">
          min · hour · day · month · weekday
        </p>
      </div>
    )
  }

  return (
    <TimeField
      value={schedule.time}
      onChange={(time) => onScheduleChange({ ...schedule, time })}
    />
  )
}

export function ScheduleChip({
  schedule,
  timezone,
  open,
  setOpen,
  onScheduleChange,
  onTimezoneChange,
}: {
  schedule: ScheduleDraft
  timezone: string
  open: boolean
  setOpen: (value: boolean) => void
  onScheduleChange: (schedule: ScheduleDraft) => void
  onTimezoneChange: (timezone: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))
  const timezones = useMemo(timezoneOptions, [])

  const preview = useMemo(() => {
    if (!open) return null
    try {
      const cron = cronFromScheduleDraft(schedule)
      const now = Date.now()
      const [ms] = upcomingRuns(cron, timezone, 1, now)
      return {
        error: undefined,
        next: {
          absolute: formatInstantShort(ms, timezone),
          relative: formatRelative(ms, now),
        },
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Invalid schedule.",
        next: null,
      }
    }
  }, [open, schedule, timezone])

  const frequencyOptions: Option[] = FREQUENCY_OPTIONS.map((option) => ({
    label: FREQUENCY_LABEL[option],
    value: option,
  }))

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Schedule"
        className={cn(chipTrigger, "max-w-64 text-foreground/80")}
      >
        <Clock className="size-3.5 shrink-0" />
        <span className="truncate">{describeScheduleDraft(schedule)}</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </button>

      {open ? (
        <div
          className={cn(
            popoverPanel,
            "top-10 right-0 w-52 overflow-visible p-2"
          )}
        >
          <div className="space-y-1.5">
            <MenuSelect
              ariaLabel="Frequency"
              value={frequencyOfSchedule(schedule)}
              options={frequencyOptions}
              onChange={(value) =>
                onScheduleChange(
                  scheduleForFrequency(value as FrequencyOption, schedule)
                )
              }
            />

            <ScheduleFields
              schedule={schedule}
              onScheduleChange={onScheduleChange}
            />
          </div>

          <div className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
            {preview?.error ? (
              <p className="px-0.5 text-xs text-destructive">{preview.error}</p>
            ) : preview?.next ? (
              <p className="truncate px-0.5 text-xs text-muted-foreground">
                Next{" "}
                <span className="text-foreground">{preview.next.absolute}</span>{" "}
                · {preview.next.relative}
              </p>
            ) : null}

            <div className="relative">
              <Globe className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground/60" />
              <select
                aria-label="Time zone"
                value={timezone}
                onChange={(event) => onTimezoneChange(event.target.value)}
                className="h-7 w-full appearance-none rounded-md pr-6 pl-6 text-xs text-muted-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                {timezones.includes(timezone) ? null : (
                  <option value={timezone}>{timezone}</option>
                )}
                {timezones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3 -translate-y-1/2 text-muted-foreground/60" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
