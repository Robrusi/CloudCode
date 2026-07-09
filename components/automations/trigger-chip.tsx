"use client"

import { ChevronDown } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import {
  fieldBase,
  MenuSelect,
  type MenuSelectOption,
} from "@/components/automations/menu-select"
import type { TriggerDraft } from "@/components/automations/model"
import { chipTrigger, popoverPanel } from "@/components/chat/control-styles"
import { LinearIcon, SlackIcon } from "@/components/ui/brand-icons"
import { useClickOutside } from "@/hooks/use-click-outside"
import { fetchJson } from "@/lib/http/client-json"
import { cn } from "@/lib/shared/utils"

type SlackTrigger = Extract<TriggerDraft, { kind: "slack" }>
type LinearTrigger = Extract<TriggerDraft, { kind: "linear" }>

type SlackChannel = { id: string; name: string }
type LinearTeam = {
  id: string
  key: string
  labels: Array<{ id: string; name: string }>
  name: string
  states: Array<{ id: string; name: string }>
}

const ANY_VALUE = ""

function TriggerPopover({
  children,
  label,
  icon,
  open,
  setOpen,
}: {
  children: React.ReactNode
  label: string
  icon: React.ReactNode
  open: boolean
  setOpen: (value: boolean) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Trigger event"
        className={cn(chipTrigger, "max-w-64 text-foreground/80")}
      >
        {icon}
        <span className="truncate">{label}</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </button>
      {open ? (
        <div
          className={cn(
            popoverPanel,
            "top-10 right-0 w-56 overflow-visible p-2"
          )}
        >
          <div className="space-y-1.5">{children}</div>
        </div>
      ) : null}
    </div>
  )
}

export function SlackTriggerChip({
  onChange,
  open,
  setOpen,
  trigger,
}: {
  onChange: (trigger: SlackTrigger) => void
  open: boolean
  setOpen: (value: boolean) => void
  trigger: SlackTrigger
}) {
  const [channels, setChannels] = useState<SlackChannel[] | null>(null)
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    if (!open || channels !== null) return
    let cancelled = false
    void fetchJson<{ channels: SlackChannel[] }>(
      "/api/integrations/slack/channels",
      { method: "GET" },
      { fallbackError: "Unable to load Slack channels." }
    )
      .then((data) => {
        if (!cancelled) setChannels(data.channels)
      })
      .catch((error) => {
        if (!cancelled) {
          setChannels([])
          setLoadError(
            error instanceof Error ? error.message : "Unable to load channels."
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, channels])

  const channelOptions: MenuSelectOption[] = [
    { label: "Any channel", value: ANY_VALUE },
    ...(channels ?? []).map((channel) => ({
      label: `#${channel.name}`,
      value: channel.id,
    })),
  ]

  const label =
    trigger.event === "reaction"
      ? trigger.emoji
        ? `On :${trigger.emoji}: reaction`
        : "On reaction"
      : trigger.keyword
        ? `On “${trigger.keyword}”`
        : "On keyword"

  return (
    <TriggerPopover
      label={label}
      icon={<SlackIcon className="size-3.5 shrink-0" />}
      open={open}
      setOpen={setOpen}
    >
      <MenuSelect
        ariaLabel="Slack event"
        value={trigger.event}
        options={[
          { label: "Keyword in a message", value: "keyword" },
          { label: "Emoji reaction", value: "reaction" },
        ]}
        onChange={(event) =>
          onChange({ ...trigger, event: event as SlackTrigger["event"] })
        }
      />
      <MenuSelect
        ariaLabel="Slack channel"
        value={trigger.channelId}
        options={channelOptions}
        onChange={(channelId) =>
          onChange({
            ...trigger,
            channelId,
            channelName:
              channels?.find((channel) => channel.id === channelId)?.name ?? "",
          })
        }
      />
      {trigger.event === "keyword" ? (
        <input
          aria-label="Keyword"
          type="text"
          value={trigger.keyword}
          onChange={(event) =>
            onChange({ ...trigger, keyword: event.target.value })
          }
          placeholder="deploy please"
          className={cn(fieldBase, "px-2.5")}
        />
      ) : (
        <input
          aria-label="Emoji name"
          type="text"
          spellCheck={false}
          value={trigger.emoji}
          onChange={(event) =>
            onChange({
              ...trigger,
              emoji: event.target.value.replace(/:/g, "").trim(),
            })
          }
          placeholder="rocket"
          className={cn(fieldBase, "px-2.5")}
        />
      )}
      {loadError ? (
        <p className="px-0.5 text-xs text-destructive">{loadError}</p>
      ) : null}
    </TriggerPopover>
  )
}

export function LinearTriggerChip({
  onChange,
  open,
  setOpen,
  trigger,
}: {
  onChange: (trigger: LinearTrigger) => void
  open: boolean
  setOpen: (value: boolean) => void
  trigger: LinearTrigger
}) {
  const [teams, setTeams] = useState<LinearTeam[] | null>(null)
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    if (!open || teams !== null) return
    let cancelled = false
    void fetchJson<{ teams: LinearTeam[] }>(
      "/api/integrations/linear/teams",
      { method: "GET" },
      { fallbackError: "Unable to load Linear teams." }
    )
      .then((data) => {
        if (!cancelled) setTeams(data.teams)
      })
      .catch((error) => {
        if (!cancelled) {
          setTeams([])
          setLoadError(
            error instanceof Error ? error.message : "Unable to load teams."
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, teams])

  const scopedTeams = trigger.teamId
    ? (teams ?? []).filter((team) => team.id === trigger.teamId)
    : (teams ?? [])
  const labelOptions: MenuSelectOption[] = scopedTeams.flatMap((team) =>
    team.labels.map((label) => ({
      label: trigger.teamId ? label.name : `${team.key} · ${label.name}`,
      value: label.id,
    }))
  )
  const stateOptions: MenuSelectOption[] = [
    { label: "Any status", value: ANY_VALUE },
    ...scopedTeams.flatMap((team) =>
      team.states.map((state) => ({
        label: trigger.teamId ? state.name : `${team.key} · ${state.name}`,
        value: state.id,
      }))
    ),
  ]

  const label =
    trigger.event === "labelAdded"
      ? trigger.labelName
        ? `On label “${trigger.labelName}”`
        : "On label added"
      : trigger.stateName
        ? `On status → ${trigger.stateName}`
        : "On status change"

  return (
    <TriggerPopover
      label={label}
      icon={<LinearIcon className="size-3.5 shrink-0" />}
      open={open}
      setOpen={setOpen}
    >
      <MenuSelect
        ariaLabel="Linear event"
        value={trigger.event}
        options={[
          { label: "Label added to an issue", value: "labelAdded" },
          { label: "Issue status changed", value: "statusChanged" },
        ]}
        onChange={(event) =>
          onChange({
            ...trigger,
            event: event as LinearTrigger["event"],
            labelId: "",
            labelName: "",
            stateId: "",
            stateName: "",
          })
        }
      />
      <MenuSelect
        ariaLabel="Linear team"
        value={trigger.teamId}
        options={[
          { label: "Any team", value: ANY_VALUE },
          ...(teams ?? []).map((team) => ({
            label: team.name,
            value: team.id,
          })),
        ]}
        onChange={(teamId) =>
          onChange({
            ...trigger,
            labelId: "",
            labelName: "",
            stateId: "",
            stateName: "",
            teamId,
            teamName: teams?.find((team) => team.id === teamId)?.name ?? "",
          })
        }
      />
      {trigger.event === "labelAdded" ? (
        <MenuSelect
          ariaLabel="Label"
          value={trigger.labelId}
          options={
            labelOptions.length > 0
              ? labelOptions
              : [{ label: "No labels found", value: ANY_VALUE }]
          }
          onChange={(labelId) =>
            onChange({
              ...trigger,
              labelId,
              labelName:
                scopedTeams
                  .flatMap((team) => team.labels)
                  .find((label) => label.id === labelId)?.name ?? "",
            })
          }
        />
      ) : (
        <MenuSelect
          ariaLabel="Status"
          value={trigger.stateId}
          options={stateOptions}
          onChange={(stateId) =>
            onChange({
              ...trigger,
              stateId,
              stateName:
                scopedTeams
                  .flatMap((team) => team.states)
                  .find((state) => state.id === stateId)?.name ?? "",
            })
          }
        />
      )}
      {loadError ? (
        <p className="px-0.5 text-xs text-destructive">{loadError}</p>
      ) : null}
    </TriggerPopover>
  )
}
