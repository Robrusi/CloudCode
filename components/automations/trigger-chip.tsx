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
type LinearUser = { email: string; id: string; name: string }

const ANY_VALUE = ""

function keepSelectedOption(
  options: MenuSelectOption[],
  value: string,
  fallbackLabel: string
) {
  if (!value || options.some((option) => option.value === value)) return options
  return [{ label: fallbackLabel, value }, ...options]
}

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
  const [users, setUsers] = useState<LinearUser[] | null>(null)
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    if (teams !== null) return
    let cancelled = false
    void fetchJson<{ teams: LinearTeam[]; users: LinearUser[] }>(
      "/api/integrations/linear/teams",
      { method: "GET" },
      { fallbackError: "Unable to load Linear trigger options." }
    )
      .then((data) => {
        if (!cancelled) {
          setTeams(data.teams)
          setUsers(data.users)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setTeams([])
          setUsers([])
          setLoadError(
            error instanceof Error
              ? error.message
              : "Unable to load Linear trigger options."
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [teams])

  const selectedTeam = teams?.find((team) => team.id === trigger.teamId)
  const selectedAssignee = users?.find((user) => user.id === trigger.assigneeId)

  const scopedTeams = trigger.teamId
    ? (teams ?? []).filter((team) => team.id === trigger.teamId)
    : (teams ?? [])
  const selectedLabel = scopedTeams
    .flatMap((team) => team.labels)
    .find((label) => label.id === trigger.labelId)
  const selectedState = scopedTeams
    .flatMap((team) => team.states)
    .find((state) => state.id === trigger.stateId)
  const teamOptions = keepSelectedOption(
    [
      { label: "Any team", value: ANY_VALUE },
      ...(teams ?? []).map((team) => ({
        label: team.name,
        value: team.id,
      })),
    ],
    trigger.teamId,
    trigger.teamName || (teams === null ? "Loading team…" : "Unavailable team")
  )
  const rawLabelOptions: MenuSelectOption[] = scopedTeams.flatMap((team) =>
    team.labels.map((label) => ({
      label: trigger.teamId ? label.name : `${team.key} · ${label.name}`,
      value: label.id,
    }))
  )
  const labelOptions = keepSelectedOption(
    rawLabelOptions.length > 0
      ? rawLabelOptions
      : [
          {
            label: teams === null ? "Loading labels…" : "No labels found",
            value: ANY_VALUE,
          },
        ],
    trigger.labelId,
    trigger.labelName ||
      (teams === null ? "Loading label…" : "Unavailable label")
  )
  const stateOptions = keepSelectedOption(
    [
      { label: "Any status", value: ANY_VALUE },
      ...scopedTeams.flatMap((team) =>
        team.states.map((state) => ({
          label: trigger.teamId ? state.name : `${team.key} · ${state.name}`,
          value: state.id,
        }))
      ),
    ],
    trigger.stateId,
    trigger.stateName ||
      (teams === null ? "Loading status…" : "Unavailable status")
  )
  const personOptions = keepSelectedOption(
    users === null
      ? [{ label: "Loading people…", value: ANY_VALUE }]
      : users.length > 0
        ? users.map((user) => ({
            label: `${user.name} (${user.email})`,
            value: user.id,
          }))
        : [{ label: "No people found", value: ANY_VALUE }],
    trigger.assigneeId,
    trigger.assigneeName ||
      (users === null ? "Loading person…" : "Unavailable person")
  )

  // Older automation rows may have only stable IDs. Once the catalog loads,
  // hydrate their display metadata so this edit also repairs the saved row.
  useEffect(() => {
    if (teams === null || users === null) return
    const resolved = {
      assigneeName: trigger.assigneeId
        ? (selectedAssignee?.name ?? trigger.assigneeName)
        : "",
      labelName: trigger.labelId
        ? (selectedLabel?.name ?? trigger.labelName)
        : "",
      stateName: trigger.stateId
        ? (selectedState?.name ?? trigger.stateName)
        : "",
      teamName: trigger.teamId ? (selectedTeam?.name ?? trigger.teamName) : "",
    }
    if (
      resolved.assigneeName === trigger.assigneeName &&
      resolved.labelName === trigger.labelName &&
      resolved.stateName === trigger.stateName &&
      resolved.teamName === trigger.teamName
    ) {
      return
    }
    onChange({ ...trigger, ...resolved })
  }, [
    onChange,
    selectedAssignee,
    selectedLabel,
    selectedState,
    selectedTeam,
    teams,
    trigger,
    users,
  ])

  const assigneeName = selectedAssignee?.name ?? trigger.assigneeName
  const labelName = selectedLabel?.name ?? trigger.labelName
  const stateName = selectedState?.name ?? trigger.stateName

  const label =
    trigger.event === "issueCreated"
      ? "On new issue"
      : trigger.event === "issueAssigned"
        ? assigneeName
          ? `On assigned to ${assigneeName}`
          : "On issue assigned"
        : trigger.event === "labelAdded"
          ? labelName
            ? `On label “${labelName}”`
            : "On label added"
          : stateName
            ? `On status → ${stateName}`
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
          { label: "New issue created", value: "issueCreated" },
          { label: "Issue assigned to a person", value: "issueAssigned" },
          { label: "Label added to an issue", value: "labelAdded" },
          { label: "Issue status changed", value: "statusChanged" },
        ]}
        onChange={(event) =>
          onChange({
            ...trigger,
            assigneeId: "",
            assigneeName: "",
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
        options={teamOptions}
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
          options={labelOptions}
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
      ) : trigger.event === "issueAssigned" ? (
        <MenuSelect
          ariaLabel="Person"
          value={trigger.assigneeId}
          options={personOptions}
          onChange={(assigneeId) =>
            onChange({
              ...trigger,
              assigneeId,
              assigneeName:
                users?.find((user) => user.id === assigneeId)?.name ?? "",
            })
          }
        />
      ) : trigger.event === "statusChanged" ? (
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
      ) : null}
      {loadError ? (
        <p className="px-0.5 text-xs text-destructive">{loadError}</p>
      ) : null}
    </TriggerPopover>
  )
}
