"use client"

import { ClipboardPaste, KeyRound, Trash2 } from "lucide-react"

import {
  fieldHint,
  iconBtn,
  inputClass,
  metaPill,
  navAction,
  navPrimary,
  textareaClass,
} from "@/components/settings/shared"
import { dotenvImportSummary } from "@/components/settings/presets-model"
import type { Id } from "@/convex/_generated/dataModel"
import type { DotenvParseResult, ParsedEnvVar } from "@/lib/env/dotenv-parse"
import type { SandboxPresetRecord } from "@/lib/sandbox/preset-types"
import { cn } from "@/lib/shared/utils"

export function PresetSecretsSection({
  importMode,
  importText,
  importVars,
  parsedImport,
  saving,
  secretName,
  secretValue,
  selected,
  onDeleteSecret,
  onImportSecrets,
  onImportTextChange,
  onSaveSecret,
  onSecretNameChange,
  onSecretValueChange,
  onToggleImportMode,
}: {
  importMode: boolean
  importText: string
  importVars: ParsedEnvVar[]
  parsedImport: DotenvParseResult
  saving: boolean
  secretName: string
  secretValue: string
  selected: SandboxPresetRecord | null
  onDeleteSecret: (secretId: Id<"sandboxPresetSecrets">) => void
  onImportSecrets: () => void
  onImportTextChange: (value: string) => void
  onSaveSecret: () => void
  onSecretNameChange: (value: string) => void
  onSecretValueChange: (value: string) => void
  onToggleImportMode: () => void
}) {
  return (
    <div className="border-t border-border/60 pt-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground/80">
        <KeyRound className="size-3.5 text-muted-foreground" />
        Secrets
        {selected?.secrets.length ? (
          <span className={metaPill}>{selected.secrets.length}</span>
        ) : null}
        <button
          type="button"
          onClick={onToggleImportMode}
          className={cn(navAction, "ml-auto h-7 px-2.5")}
        >
          <ClipboardPaste className="size-3.5" />
          {importMode ? "Add manually" : "Paste .env"}
        </button>
      </div>

      {selected?.secrets.length ? (
        <div className="mb-3 border-y border-border/60">
          {selected.secrets.map((secret) => (
            <div
              key={secret.id}
              className="flex items-center gap-2 border-b border-border/60 py-2 last:border-0"
            >
              <span className="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-xs text-foreground/85">
                {secret.name}
              </span>
              <button
                type="button"
                onClick={() => onDeleteSecret(secret.id)}
                disabled={saving}
                aria-label={`Delete ${secret.name}`}
                title={`Delete ${secret.name}`}
                className={cn(iconBtn, "hover:text-destructive")}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : selected ? (
        <p className="mb-3 text-xs text-muted-foreground">No preset secrets.</p>
      ) : null}

      {importMode ? (
        <div className="grid gap-2">
          <textarea
            aria-label="Paste .env file"
            value={importText}
            onChange={(event) => onImportTextChange(event.target.value)}
            placeholder={
              "# Paste the contents of your .env file\nSUPABASE_URL=https://xyz.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=ey..."
            }
            spellCheck={false}
            className={cn(textareaClass, "min-h-32")}
          />
          <div className="flex items-center justify-between gap-2">
            <span className={fieldHint}>
              {dotenvImportSummary({ importText, importVars, parsedImport })}
            </span>
            <button
              type="button"
              onClick={onImportSecrets}
              disabled={saving || importVars.length === 0}
              className={cn(navPrimary, "h-9 shrink-0 justify-center px-4")}
            >
              {saving
                ? "Importing"
                : importVars.length > 0
                  ? `Import ${importVars.length}`
                  : "Import"}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            aria-label="Secret name"
            value={secretName}
            onChange={(event) => onSecretNameChange(event.target.value)}
            placeholder="SUPABASE_SERVICE_ROLE_KEY"
            className={cn(
              inputClass,
              "font-[family-name:var(--font-mono)] text-xs"
            )}
            spellCheck={false}
          />
          <input
            aria-label="Secret value"
            value={secretValue}
            onChange={(event) => onSecretValueChange(event.target.value)}
            placeholder="Value"
            type="password"
            className={cn(inputClass, "text-xs")}
          />
          <button
            type="button"
            onClick={onSaveSecret}
            disabled={saving || !secretName || !secretValue}
            className={cn(navPrimary, "h-9 justify-center px-4")}
          >
            Add
          </button>
        </div>
      )}
    </div>
  )
}
