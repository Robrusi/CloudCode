"use client"

import { useQuery } from "convex/react"
import { useEffect, useState } from "react"

import {
  automationDraftFromRecord,
  automationRequestBody,
  deriveAutomationName,
  emptyAutomationDraft,
  emptyLinearTrigger,
  emptySlackTrigger,
  type AutomationDraft,
  type AutomationRecord,
} from "@/components/automations/model"
import { ScheduleChip } from "@/components/automations/schedule-chip"
import {
  LinearTriggerChip,
  SlackTriggerChip,
} from "@/components/automations/trigger-chip"
import { BranchChip } from "@/components/chat/branch-chip"
import { BranchTargetChip } from "@/components/chat/branch-target-chip"
import {
  DetailRow,
  ModelChip,
  OptionChip,
} from "@/components/chat/composer-chips"
import { PresetPill } from "@/components/chat/controls"
import { RepoChip } from "@/components/chat/repo-chip"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { SandboxPresetRecord } from "@/lib/sandbox/preset-types"
import { useAutoGrowTextarea } from "@/hooks/use-auto-grow-textarea"
import { fetchJson, postJson } from "@/lib/http/client-json"

type CreatedAutomation = { automationId: Id<"automations"> }

type IntegrationInstallation = {
  enabled: boolean
  id: string
  provider: "slack" | "linear"
}

const EMPTY_SANDBOX_PRESETS: SandboxPresetRecord[] = []

/** Fields the client can validate before submitting; the server re-checks. */
function triggerDraftError(draft: AutomationDraft) {
  const trigger = draft.trigger
  if (trigger.kind === "slack") {
    if (trigger.event === "keyword" && !trigger.keyword.trim()) {
      return "Pick a keyword for the Slack trigger."
    }
    if (trigger.event === "reaction" && !trigger.emoji.trim()) {
      return "Pick an emoji for the Slack trigger."
    }
  }
  if (
    trigger.kind === "linear" &&
    trigger.event === "labelAdded" &&
    !trigger.labelId
  ) {
    return "Pick a label for the Linear trigger."
  }
  if (
    trigger.kind === "linear" &&
    trigger.event === "issueAssigned" &&
    !trigger.assigneeId
  ) {
    return "Pick a person for the Linear trigger."
  }
  return null
}

export function AutomationComposer({
  automation,
  defaultRepoUrl,
  onCancel,
  onSaved,
}: {
  automation: AutomationRecord | null
  defaultRepoUrl: string
  onCancel?: () => void
  onSaved: (automationId: Id<"automations">) => void
}) {
  const [draft, setDraft] = useState<AutomationDraft>(() =>
    automation
      ? automationDraftFromRecord(automation)
      : { ...emptyAutomationDraft(), repoUrl: defaultRepoUrl }
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const promptRef = useAutoGrowTextarea(draft.prompt)

  const [branchTargetOpen, setBranchTargetOpen] = useState(false)
  const [editingRepo, setEditingRepo] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [presetOpen, setPresetOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [triggerOpen, setTriggerOpen] = useState(false)
  const [installations, setInstallations] = useState<IntegrationInstallation[]>(
    []
  )

  const rawPresets = useQuery(api.sandboxPresets.list)
  const sandboxPresets = rawPresets
    ? (rawPresets as SandboxPresetRecord[])
    : EMPTY_SANDBOX_PRESETS

  // Connected integrations decide which trigger kinds the chip offers.
  useEffect(() => {
    let cancelled = false
    void fetchJson<{ installations: IntegrationInstallation[] }>(
      "/api/integrations",
      { method: "GET" },
      { fallbackError: "Unable to load integrations." }
    )
      .then((data) => {
        if (!cancelled) {
          setInstallations(
            data.installations.filter((installation) => installation.enabled)
          )
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const slackInstallation = installations.find(
    (installation) => installation.provider === "slack"
  )
  const linearInstallation = installations.find(
    (installation) => installation.provider === "linear"
  )

  const set = <K extends keyof AutomationDraft>(
    key: K,
    value: AutomationDraft[K]
  ) => setDraft((current) => ({ ...current, [key]: value }))

  async function submit() {
    if (busy) return
    const prompt = draft.prompt.trim()
    if (!prompt) return
    if (!draft.repoUrl.trim()) {
      setError("Pick a repository.")
      setEditingRepo(true)
      return
    }
    const triggerError = triggerDraftError(draft)
    if (triggerError) {
      setError(triggerError)
      setTriggerOpen(true)
      return
    }

    setBusy(true)
    setError("")
    try {
      const body = automationRequestBody({
        ...draft,
        name: draft.name.trim() || deriveAutomationName(prompt),
        prompt,
      })
      if (automation) {
        await postJson(
          "/api/automations/update",
          { automationId: automation._id, ...body },
          {},
          { fallbackError: "Unable to update automation." }
        )
        onSaved(automation._id)
      } else {
        const created = await postJson<CreatedAutomation>(
          "/api/automations",
          body,
          {},
          { fallbackError: "Unable to create automation." }
        )
        setDraft((current) => ({ ...current, name: "", prompt: "" }))
        onSaved(created.automationId)
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to save automation."
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      className="w-full"
    >
      <div className="flex flex-col gap-8 md:flex-row md:gap-16">
        <div className="min-w-0 flex-1">
          <Input
            variant="bare"
            aria-label="Automation title"
            value={draft.name}
            onChange={(event) => set("name", event.target.value)}
            placeholder="Scheduled task title"
            className="text-2xl tracking-tight placeholder:text-muted-foreground/50"
          />

          <Textarea
            ref={promptRef}
            variant="bare"
            aria-label="Automation prompt"
            rows={2}
            value={draft.prompt}
            onChange={(event) => set("prompt", event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void submit()
              }
            }}
            placeholder="Add prompt e.g. check Linear and work on my top issue"
            className="mt-5 min-h-12 overflow-hidden text-[15px] leading-6 placeholder:text-muted-foreground/50"
          />
        </div>

        <div className="w-full shrink-0 md:sticky md:top-12 md:w-72 md:self-start">
          <div className="text-sm text-muted-foreground">Details</div>

          <div className="mt-2">
            <DetailRow label="Repository">
              <RepoChip
                value={draft.repoUrl}
                editing={editingRepo}
                setEditing={setEditingRepo}
                onChange={(repoUrl) => set("repoUrl", repoUrl)}
                locked={false}
              />
            </DetailRow>
            <DetailRow label="Base branch">
              <BranchChip
                value={draft.baseBranch}
                repoUrl={draft.repoUrl}
                onChange={(baseBranch) => set("baseBranch", baseBranch)}
                locked={false}
              />
            </DetailRow>
            <DetailRow label="Branch target">
              <BranchTargetChip
                mode={draft.branchMode}
                branchName={draft.branchName}
                baseBranch={draft.baseBranch}
                menuPlacement="down"
                open={branchTargetOpen}
                setOpen={setBranchTargetOpen}
                onChangeMode={(branchMode) => set("branchMode", branchMode)}
                onChangeBranchName={(branchName) =>
                  set("branchName", branchName)
                }
              />
            </DetailRow>
            {slackInstallation || linearInstallation ? (
              <DetailRow label="Trigger">
                <OptionChip
                  ariaLabel="Trigger kind"
                  value={draft.trigger.kind}
                  onChange={(kind) => {
                    setTriggerOpen(false)
                    if (kind === "cron") set("trigger", { kind: "cron" })
                    else if (kind === "slack" && slackInstallation) {
                      set("trigger", emptySlackTrigger(slackInstallation.id))
                    } else if (kind === "linear" && linearInstallation) {
                      set("trigger", emptyLinearTrigger(linearInstallation.id))
                    }
                  }}
                  options={[
                    { label: "Schedule", value: "cron" as const },
                    ...(slackInstallation
                      ? [{ label: "Slack event", value: "slack" as const }]
                      : []),
                    ...(linearInstallation
                      ? [{ label: "Linear event", value: "linear" as const }]
                      : []),
                  ]}
                />
              </DetailRow>
            ) : null}
            {draft.trigger.kind === "cron" ? (
              <DetailRow label="Repeats">
                <ScheduleChip
                  schedule={draft.schedule}
                  timezone={draft.timezone}
                  open={scheduleOpen}
                  setOpen={setScheduleOpen}
                  onScheduleChange={(schedule) => set("schedule", schedule)}
                  onTimezoneChange={(timezone) => set("timezone", timezone)}
                />
              </DetailRow>
            ) : draft.trigger.kind === "slack" ? (
              <DetailRow label="Slack event">
                <SlackTriggerChip
                  trigger={draft.trigger}
                  open={triggerOpen}
                  setOpen={setTriggerOpen}
                  onChange={(trigger) => set("trigger", trigger)}
                />
              </DetailRow>
            ) : (
              <DetailRow label="Linear event">
                <LinearTriggerChip
                  trigger={draft.trigger}
                  open={triggerOpen}
                  setOpen={setTriggerOpen}
                  onChange={(trigger) => set("trigger", trigger)}
                />
              </DetailRow>
            )}
            <DetailRow label="Model">
              <ModelChip
                model={draft.model}
                thinking={draft.reasoningEffort}
                onSelectModel={(model) => set("model", model)}
                onSelectThinking={(thinking) =>
                  set("reasoningEffort", thinking)
                }
                open={modelOpen}
                setOpen={setModelOpen}
              />
            </DetailRow>
            <DetailRow label="Environment setup">
              <PresetPill
                value={draft.sandboxPresetId as Id<"sandboxPresets"> | ""}
                presets={sandboxPresets}
                open={presetOpen}
                setOpen={setPresetOpen}
                menuPlacement="down"
                onSelect={(sandboxPresetId) =>
                  set("sandboxPresetId", sandboxPresetId)
                }
              />
            </DetailRow>
            <DetailRow label="Sandbox">
              <OptionChip
                ariaLabel="Sandbox after run"
                value={draft.sandboxRetention}
                onChange={(sandboxRetention) =>
                  set("sandboxRetention", sandboxRetention)
                }
                options={[
                  { label: "Delete after run", value: "delete" },
                  { label: "Keep idle", value: "idle" },
                ]}
              />
            </DetailRow>
            <DetailRow label="Chat">
              <OptionChip
                ariaLabel="Chat per run"
                value={draft.threadMode}
                onChange={(threadMode) => set("threadMode", threadMode)}
                options={[
                  { label: "Same chat", value: "single" },
                  { label: "New chat per run", value: "per-run" },
                ]}
              />
            </DetailRow>
          </div>

          {error ? (
            <p className="mt-3 text-xs text-destructive">{error}</p>
          ) : null}

          <div className="mt-6 flex items-center justify-end gap-2">
            {onCancel ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onCancel}
                className="text-muted-foreground"
              >
                Cancel
              </Button>
            ) : null}
            <Button
              type="submit"
              size="sm"
              disabled={busy || !draft.prompt.trim()}
            >
              {automation ? "Save" : "Create"}
            </Button>
          </div>
        </div>
      </div>
    </form>
  )
}
