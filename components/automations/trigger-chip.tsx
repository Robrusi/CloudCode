"use client"

import { ChevronDown } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import {
  LinearCommentAuthorPicker,
  type LinearTriggerUser,
} from "@/components/automations/linear-comment-author-picker"
import {
  fieldBase,
  MenuSelect,
  type MenuSelectOption,
} from "@/components/automations/menu-select"
import {
  linearCommentTriggerLabel,
  type TriggerDraft,
} from "@/components/automations/model"
import { chipTrigger, popoverPanel } from "@/components/chat/control-styles"
import { GitHubIcon, LinearIcon, SlackIcon } from "@/components/ui/brand-icons"
import { useClickOutside } from "@/hooks/use-click-outside"
import { fetchJson } from "@/lib/http/client-json"
import { cn } from "@/lib/shared/utils"

type SlackTrigger = Extract<TriggerDraft, { kind: "slack" }>
type LinearTrigger = Extract<TriggerDraft, { kind: "linear" }>
type GitHubTrigger = Extract<TriggerDraft, { kind: "github" }>

type SlackChannel = { id: string; name: string }
type LinearTeam = {
  id: string
  key: string
  labels: Array<{ id: string; name: string }>
  name: string
  states: Array<{ id: string; name: string }>
}
type LinearUser = LinearTriggerUser

const ANY_VALUE = ""

const GITHUB_EVENT_OPTIONS: MenuSelectOption[] = [
  { label: "Comment created", value: "issueCommented" },
  { label: "Issue opened", value: "issueOpened" },
  { label: "Issue closed", value: "issueClosed" },
  { label: "Pull request opened", value: "pullRequestOpened" },
  { label: "Pull request merged", value: "pullRequestMerged" },
  { label: "Review submitted", value: "pullRequestReviewSubmitted" },
  { label: "Push to branch", value: "push" },
]

const LINEAR_EVENT_OPTIONS: MenuSelectOption[] = [
  { label: "New issue created", value: "issueCreated" },
  { label: "Comment created", value: "commentCreated" },
  { label: "Issue assigned to a person", value: "issueAssigned" },
  { label: "Label added to an issue", value: "labelAdded" },
  { label: "Issue status changed", value: "statusChanged" },
]

const COMMENT_AUTHOR_MODE_OPTIONS: MenuSelectOption[] = [
  { label: "Any user", value: "any" },
  { label: "Only selected users", value: "include" },
  { label: "Everyone except selected", value: "exclude" },
]

function githubTriggerLabel(trigger: GitHubTrigger) {
  if (trigger.event === "issueOpened") return "On new issue"
  if (trigger.event === "issueClosed") return "On issue closed"
  if (trigger.event === "issueCommented") return "On new comment"
  if (trigger.event === "pullRequestOpened") return "On new PR"
  if (trigger.event === "pullRequestMerged") return "On PR merged"
  if (trigger.event === "pullRequestReviewSubmitted") return "On PR review"
  return trigger.branch ? `On push to ${trigger.branch}` : "On any push"
}

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
  wide = false,
}: {
  children: React.ReactNode
  label: string
  icon: React.ReactNode
  open: boolean
  setOpen: (value: boolean) => void
  wide?: boolean
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
            "top-10 right-0 overflow-visible p-2",
            wide ? "w-64" : "w-56"
          )}
        >
          <div className="space-y-1.5">{children}</div>
        </div>
      ) : null}
    </div>
  )
}

export function GitHubTriggerChip({
  onChange,
  open,
  setOpen,
  trigger,
}: {
  onChange: (trigger: GitHubTrigger) => void
  open: boolean
  setOpen: (value: boolean) => void
  trigger: GitHubTrigger
}) {
  return (
    <TriggerPopover
      label={githubTriggerLabel(trigger)}
      icon={<GitHubIcon className="size-3.5 shrink-0" />}
      open={open}
      setOpen={setOpen}
    >
      <MenuSelect
        ariaLabel="GitHub event"
        value={trigger.event}
        options={GITHUB_EVENT_OPTIONS}
        onChange={(event) =>
          onChange({
            ...trigger,
            branch: event === "push" ? trigger.branch : "",
            event: event as GitHubTrigger["event"],
          })
        }
      />
      <input
        aria-label="GitHub user filter"
        type="text"
        spellCheck={false}
        value={trigger.actorLogin}
        onChange={(event) =>
          onChange({
            ...trigger,
            actorLogin: event.target.value.replace(/^@/, "").trim(),
          })
        }
        placeholder="Any user"
        className={cn(fieldBase, "px-2.5")}
      />
      {trigger.event === "push" ? (
        <input
          aria-label="GitHub branch filter"
          type="text"
          spellCheck={false}
          value={trigger.branch}
          onChange={(event) =>
            onChange({
              ...trigger,
              branch: event.target.value.replace(/^refs\/heads\//, "").trim(),
            })
          }
          placeholder="Any branch"
          className={cn(fieldBase, "px-2.5")}
        />
      ) : null}
      <p className="px-0.5 text-[11px] leading-4 text-muted-foreground">
        {trigger.event === "issueCommented"
          ? "Includes comments on issues and pull requests."
          : "Leave the user empty to match anyone."}
      </p>
    </TriggerPopover>
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

function sameStrings(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
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

  const usersById = useMemo(
    () => new Map((users ?? []).map((user) => [user.id, user])),
    [users]
  )
  const selectedTeam = teams?.find((team) => team.id === trigger.teamId)
  const selectedAssignee = usersById.get(trigger.assigneeId)

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
      : users.some((user) => user.assignable)
        ? users
            .filter((user) => user.assignable)
            .map((user) => ({
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
      commentAuthorNames: trigger.commentAuthorIds.map(
        (id, index) =>
          usersById.get(id)?.name ?? trigger.commentAuthorNames[index] ?? id
      ),
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
      sameStrings(resolved.commentAuthorNames, trigger.commentAuthorNames) &&
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
    usersById,
  ])

  const assigneeName = selectedAssignee?.name ?? trigger.assigneeName
  const labelName = selectedLabel?.name ?? trigger.labelName
  const stateName = selectedState?.name ?? trigger.stateName

  const label =
    trigger.event === "commentCreated"
      ? linearCommentTriggerLabel(
          trigger.commentAuthorMode,
          trigger.commentAuthorNames
        )
      : trigger.event === "issueCreated"
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
      wide={trigger.event === "commentCreated"}
    >
      <MenuSelect
        ariaLabel="Linear event"
        value={trigger.event}
        options={LINEAR_EVENT_OPTIONS}
        onChange={(event) =>
          onChange({
            ...trigger,
            assigneeId: "",
            assigneeName: "",
            commentAuthorIds: [],
            commentAuthorMode: "any",
            commentAuthorNames: [],
            event: event as LinearTrigger["event"],
            labelId: "",
            labelName: "",
            stateId: "",
            stateName: "",
            teamId: event === "commentCreated" ? "" : trigger.teamId,
            teamName: event === "commentCreated" ? "" : trigger.teamName,
          })
        }
      />
      {trigger.event !== "commentCreated" ? (
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
      ) : null}
      {trigger.event === "commentCreated" ? (
        <>
          <MenuSelect
            ariaLabel="Linear comment author filter"
            value={trigger.commentAuthorMode}
            options={COMMENT_AUTHOR_MODE_OPTIONS}
            onChange={(commentAuthorMode) =>
              onChange({
                ...trigger,
                commentAuthorIds:
                  commentAuthorMode === "any" ? [] : trigger.commentAuthorIds,
                commentAuthorMode:
                  commentAuthorMode as LinearTrigger["commentAuthorMode"],
                commentAuthorNames:
                  commentAuthorMode === "any" ? [] : trigger.commentAuthorNames,
              })
            }
          />
          {trigger.commentAuthorMode !== "any" ? (
            <LinearCommentAuthorPicker
              authorIds={trigger.commentAuthorIds}
              authorNames={trigger.commentAuthorNames}
              users={users}
              usersById={usersById}
              onChange={(commentAuthorIds, commentAuthorNames) =>
                onChange({
                  ...trigger,
                  commentAuthorIds,
                  commentAuthorNames,
                })
              }
            />
          ) : (
            <p className="px-0.5 text-[11px] leading-4 text-muted-foreground">
              Runs for comments created by any workspace user.
            </p>
          )}
        </>
      ) : trigger.event === "labelAdded" ? (
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
