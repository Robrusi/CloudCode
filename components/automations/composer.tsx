"use client"

import { useQuery } from "convex/react"
import { Check, ChevronDown } from "lucide-react"
import { useRef, useState, type ReactNode } from "react"

import {
  automationDraftFromRecord,
  automationRequestBody,
  deriveAutomationName,
  emptyAutomationDraft,
  type AutomationDraft,
  type AutomationRecord,
} from "@/components/automations/model"
import { ScheduleChip } from "@/components/automations/schedule-chip"
import { BranchChip } from "@/components/chat/branch-chip"
import { BranchTargetChip } from "@/components/chat/branch-target-chip"
import {
  chipTrigger,
  popoverItem,
  popoverPanel,
} from "@/components/chat/control-styles"
import { PresetPill } from "@/components/chat/controls"
import { RepoChip } from "@/components/chat/repo-chip"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { SandboxPresetRecord } from "@/lib/sandbox/preset-types"
import {
  MODEL_LABEL,
  MODELS,
  THINKING_LABEL,
  THINKINGS,
  type Model,
  type Thinking,
} from "@/lib/chat/options"
import { useAutoGrowTextarea } from "@/hooks/use-auto-grow-textarea"
import { useClickOutside } from "@/hooks/use-click-outside"
import { postJson } from "@/lib/http/client-json"
import { cn } from "@/lib/shared/utils"

type CreatedAutomation = { automationId: Id<"automations"> }

const EMPTY_SANDBOX_PRESETS: SandboxPresetRecord[] = []

function DetailRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3">
      <span className="shrink-0 text-sm text-foreground/90">{label}</span>
      <div className="flex min-w-0 justify-end">{children}</div>
    </div>
  )
}

/** Chip + popover for a small fixed set of options. Matches the sidebar
 * thread context menu: a compact single-line menu, not a tall detail list. */
function OptionChip<T extends string>({
  ariaLabel,
  onChange,
  options,
  value,
}: {
  ariaLabel: string
  onChange: (value: T) => void
  options: Array<{ value: T; label: string }>
  value: T
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => setOpen(false))
  const current = options.find((option) => option.value === value)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={cn(chipTrigger, "gap-1.5 text-foreground")}
      >
        <span>{current?.label ?? value}</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </button>
      {open ? (
        <div className={cn(popoverPanel, "top-10 right-0")}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
              className={popoverItem}
            >
              <span className="whitespace-nowrap">{option.label}</span>
              {option.value === value ? (
                <Check className="size-4 shrink-0" strokeWidth={2.25} />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ModelChip({
  model,
  thinking,
  onSelectModel,
  onSelectThinking,
  open,
  setOpen,
}: {
  model: Model
  thinking: Thinking
  onSelectModel: (value: Model) => void
  onSelectThinking: (value: Thinking) => void
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
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(chipTrigger, "gap-1.5 text-foreground")}
      >
        <span>{MODEL_LABEL[model]}</span>
        <span className="text-muted-foreground">
          {THINKING_LABEL[thinking]}
        </span>
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </button>
      {open ? (
        <div className={cn(popoverPanel, "top-10 right-0 min-w-52")}>
          <div className="px-2.5 pt-1.5 pb-1 text-left text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase">
            Model
          </div>
          {MODELS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onSelectModel(option)}
              className={cn(popoverItem, "pl-5")}
            >
              <span>{MODEL_LABEL[option]}</span>
              {option === model ? (
                <Check className="size-4 shrink-0" strokeWidth={2.25} />
              ) : null}
            </button>
          ))}
          <div className="my-1 h-px bg-border/60" />
          <div className="px-2.5 pt-1 pb-1 text-left text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase">
            Thinking
          </div>
          {THINKINGS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                onSelectThinking(option)
                setOpen(false)
              }}
              className={cn(popoverItem, "pl-5")}
            >
              <span>{THINKING_LABEL[option]}</span>
              {option === thinking ? (
                <Check className="size-4 shrink-0" strokeWidth={2.25} />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
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

  const rawPresets = useQuery(api.sandboxPresets.list)
  const sandboxPresets = rawPresets
    ? (rawPresets as SandboxPresetRecord[])
    : EMPTY_SANDBOX_PRESETS

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

      <div className="mt-8 text-sm text-muted-foreground">Details</div>

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
            open={branchTargetOpen}
            setOpen={setBranchTargetOpen}
            onChangeMode={(branchMode) => set("branchMode", branchMode)}
            onChangeBranchName={(branchName) => set("branchName", branchName)}
          />
        </DetailRow>
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
        <DetailRow label="Model">
          <ModelChip
            model={draft.model}
            thinking={draft.reasoningEffort}
            onSelectModel={(model) => set("model", model)}
            onSelectThinking={(thinking) => set("reasoningEffort", thinking)}
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

      {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}

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
        <Button type="submit" size="sm" disabled={busy || !draft.prompt.trim()}>
          {automation ? "Save" : "Create"}
        </Button>
      </div>
    </form>
  )
}
