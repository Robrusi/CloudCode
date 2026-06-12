"use client"

import {
  ClipboardPaste,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  TriangleAlert,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DraftRow,
  EmptyState,
  EnvRow,
} from "@/components/sandbox/environment-panel-rows"
import { IconButton } from "@/components/ui/icon-button"
import { Textarea } from "@/components/ui/textarea"
import { cardSurfaceClass } from "@/components/ui/surface"
import { useEnvironmentPanelController } from "@/hooks/use-environment-panel-controller"
import { cn } from "@/lib/shared/utils"

export function EnvironmentPanel({ sandboxId }: { sandboxId: string | null }) {
  const {
    adding,
    allRevealed,
    cancelDraft,
    cancelPasting,
    dirty,
    draftName,
    draftValue,
    error,
    importPasted,
    isEmpty,
    isLoadingInitial,
    pasteParsed,
    pasteText,
    pasteVars,
    pasting,
    removeRow,
    revealed,
    rows,
    save,
    saving,
    setPasteTextareaRef,
    showRevealAll,
    startAdding,
    startPasting,
    status,
    submitDraft,
    toggleReveal,
    toggleRevealAll,
    updateDraftName,
    updateDraftValue,
    updatePasteText,
    updateRow,
  } = useEnvironmentPanelController(sandboxId)

  if (!sandboxId) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <p className="text-xs text-muted-foreground">No active sandbox.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-4 pb-4">
        <div className="flex items-center justify-between gap-2 px-0.5 pb-3">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-sm font-medium text-foreground/85">
              Secrets
            </h2>
            {status === "loading" ? (
              <Loader2
                aria-label="Refreshing"
                className="size-3 animate-spin text-muted-foreground"
              />
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {showRevealAll ? (
              <IconButton
                aria-label={allRevealed ? "Hide values" : "Reveal values"}
                aria-pressed={allRevealed}
                title={allRevealed ? "Hide values" : "Reveal values"}
                onClick={toggleRevealAll}
              >
                {allRevealed ? (
                  <EyeOff className="size-3.5" />
                ) : (
                  <Eye className="size-3.5" />
                )}
              </IconButton>
            ) : null}
            <IconButton
              aria-label="Paste .env file"
              aria-pressed={pasting}
              title="Paste .env file"
              onClick={pasting ? cancelPasting : startPasting}
            >
              <ClipboardPaste className="size-3.5" />
            </IconButton>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Add variable"
              onClick={startAdding}
            >
              <Plus />
              Add
            </Button>
          </div>
        </div>

        {pasting ? (
          <div className={cn("mb-3 overflow-hidden", cardSurfaceClass)}>
            <Textarea
              ref={setPasteTextareaRef}
              variant="bare"
              aria-label="Paste .env file contents"
              className="block max-h-72 min-h-32 resize-y px-4 py-3 text-[13px] leading-5 text-foreground"
              onChange={(event) => updatePasteText(event.target.value)}
              placeholder={
                "# Paste your .env file\nAPI_KEY=sk-...\nDATABASE_URL=postgres://..."
              }
              spellCheck={false}
              value={pasteText}
            />
            <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/30 px-4 py-2.5">
              <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                {pasteVars.length > 0
                  ? `${pasteVars.length} variable${
                      pasteVars.length === 1 ? "" : "s"
                    }${
                      pasteParsed.errors.length
                        ? ` · ${pasteParsed.errors.length} line${
                            pasteParsed.errors.length === 1 ? "" : "s"
                          } skipped`
                        : ""
                    }`
                  : pasteText.trim()
                    ? "No valid variables found"
                    : ""}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={cancelPasting}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={pasteVars.length === 0}
                  onClick={importPasted}
                >
                  {pasteVars.length > 0 ? `Add ${pasteVars.length}` : "Add"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {isLoadingInitial ? (
          <div className={cn("grid h-32 place-items-center", cardSurfaceClass)}>
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : isEmpty ? (
          <EmptyState onAdd={startAdding} />
        ) : rows.length > 0 || adding ? (
          <div className={cn("overflow-hidden", cardSurfaceClass)}>
            <ul>
              {rows.map((row) => (
                <EnvRow
                  key={row.id}
                  onChange={(patch) => updateRow(row.id, patch)}
                  onRemove={() => removeRow(row.id)}
                  onToggleReveal={() => toggleReveal(row.id)}
                  revealed={revealed.has(row.id)}
                  row={row}
                  saving={saving}
                />
              ))}
              {adding ? (
                <DraftRow
                  name={draftName}
                  onCancel={cancelDraft}
                  onChangeName={updateDraftName}
                  onChangeValue={updateDraftValue}
                  onSubmit={submitDraft}
                  value={draftValue}
                />
              ) : null}
            </ul>

            {error ? (
              <div className="flex items-start gap-1.5 border-t border-border/60 bg-destructive/10 px-3.5 py-2 text-[11px] text-destructive">
                <TriangleAlert className="mt-px size-3 shrink-0" />
                <span className="break-words">{error}</span>
              </div>
            ) : null}

            {dirty ? (
              <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/30 px-4 py-2.5">
                <span className="text-[11px] text-muted-foreground">
                  Unsaved changes
                </span>
                <Button
                  type="button"
                  size="sm"
                  disabled={saving}
                  onClick={save}
                >
                  {saving ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  Save
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {(isLoadingInitial || isEmpty) && error ? (
          <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
            <TriangleAlert className="mt-px size-3 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
