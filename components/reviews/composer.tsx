"use client"

import { useQuery } from "convex/react"
import { useState } from "react"

import {
  DetailRow,
  ModelChip,
  OptionChip,
} from "@/components/chat/composer-chips"
import { PresetPill } from "@/components/chat/controls"
import { repoLabel } from "@/components/chat/format"
import { RepoChip } from "@/components/chat/repo-chip"
import { AuthorFilterChip } from "@/components/reviews/author-filter-chip"
import {
  emptyReviewDraft,
  reviewDraftFromRecord,
  reviewDraftWithAutofix,
  reviewRequestBody,
  type ReviewDraft,
  type ReviewRecord,
} from "@/components/reviews/model"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { SandboxPresetRecord } from "@/lib/sandbox/preset-types"
import { useAutoGrowTextarea } from "@/hooks/use-auto-grow-textarea"
import { postJson } from "@/lib/http/client-json"
import type { ReviewTemplate } from "@/lib/reviews/templates"

type CreatedReview = { reviewId: Id<"reviews"> }

const EMPTY_SANDBOX_PRESETS: SandboxPresetRecord[] = []

export function ReviewComposer({
  defaultRepoUrl,
  onCancel,
  onSaved,
  review,
  template,
}: {
  defaultRepoUrl: string
  onCancel?: () => void
  onSaved: (reviewId: Id<"reviews">) => void
  review: ReviewRecord | null
  template?: ReviewTemplate | null
}) {
  const [draft, setDraft] = useState<ReviewDraft>(() =>
    review
      ? reviewDraftFromRecord(review)
      : {
          ...emptyReviewDraft(),
          repoUrl: defaultRepoUrl,
          ...(template
            ? {
                name: template.name,
                prompt: template.prompt,
                ...template.config,
              }
            : {}),
        }
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const promptRef = useAutoGrowTextarea(draft.prompt)

  const [editingRepo, setEditingRepo] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [presetOpen, setPresetOpen] = useState(false)

  const rawPresets = useQuery(api.sandboxPresets.list)
  const sandboxPresets = rawPresets
    ? (rawPresets as SandboxPresetRecord[])
    : EMPTY_SANDBOX_PRESETS

  const set = <K extends keyof ReviewDraft>(key: K, value: ReviewDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  async function submit() {
    if (busy) return
    const repoUrl = draft.repoUrl.trim()
    if (!repoUrl) {
      setError("Pick a repository.")
      setEditingRepo(true)
      return
    }

    setBusy(true)
    setError("")
    try {
      const body = reviewRequestBody({
        ...draft,
        name: draft.name.trim() || `Review ${repoLabel(repoUrl)}`,
      })
      if (review) {
        await postJson(
          "/api/reviews/update",
          { reviewId: review._id, ...body },
          {},
          { fallbackError: "Unable to update review." }
        )
        onSaved(review._id)
      } else {
        const created = await postJson<CreatedReview>(
          "/api/reviews",
          body,
          {},
          { fallbackError: "Unable to create review." }
        )
        setDraft((current) => ({ ...current, name: "", prompt: "" }))
        onSaved(created.reviewId)
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to save review."
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
            aria-label="Review title"
            value={draft.name}
            onChange={(event) => set("name", event.target.value)}
            placeholder="Pull request review title"
            className="text-2xl tracking-tight placeholder:text-muted-foreground/50"
          />

          <Textarea
            ref={promptRef}
            variant="bare"
            aria-label="Review prompt"
            rows={2}
            value={draft.prompt}
            onChange={(event) => set("prompt", event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void submit()
              }
            }}
            placeholder="Empty uses the default review prompt: findings, proposed fixes, and a confidence-to-merge score"
            className="mt-5 min-h-12 overflow-hidden text-[15px] leading-6 placeholder:text-muted-foreground/50"
          />
        </div>

        <div className="w-full shrink-0 md:w-72">
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
            <DetailRow label="Reviews">
              <OptionChip
                ariaLabel="Which pull requests get reviewed"
                value={draft.reviewReadyForReview ? "ready" : "opened"}
                onChange={(value) =>
                  set("reviewReadyForReview", value === "ready")
                }
                options={[
                  { label: "Opened PRs", value: "opened" },
                  { label: "Opened + marked ready", value: "ready" },
                ]}
              />
            </DetailRow>
            <DetailRow label="New commits">
              <OptionChip
                ariaLabel="Whether new commits trigger a re-review"
                value={draft.reviewOnPush ? "rereview" : "ignore"}
                onChange={(value) => set("reviewOnPush", value === "rereview")}
                options={[
                  { label: "Ignore", value: "ignore" },
                  { label: "Re-review", value: "rereview" },
                ]}
              />
            </DetailRow>
            <DetailRow label="Autofix">
              <OptionChip
                ariaLabel="Whether findings get fixed automatically"
                value={draft.autofix ? "on" : "off"}
                onChange={(value) =>
                  setDraft((current) =>
                    reviewDraftWithAutofix(current, value === "on")
                  )
                }
                options={[
                  { label: "Report only", value: "off" },
                  { label: "Fix and push", value: "on" },
                ]}
              />
            </DetailRow>
            <DetailRow label="Authors">
              <AuthorFilterChip
                mode={draft.authorFilterMode}
                authors={draft.authorFilters}
                onChangeMode={(authorFilterMode) =>
                  set("authorFilterMode", authorFilterMode)
                }
                onChangeAuthors={(authorFilters) =>
                  set("authorFilters", authorFilters)
                }
              />
            </DetailRow>
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
              disabled={busy || !draft.repoUrl.trim()}
            >
              {review ? "Save" : "Create"}
            </Button>
          </div>
        </div>
      </div>
    </form>
  )
}
