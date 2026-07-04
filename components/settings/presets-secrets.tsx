"use client"

import { ClipboardPaste, KeyRound, Trash2 } from "lucide-react"

import {
  fieldHint,
  inputClass,
  metaPill,
  textareaClass,
} from "@/components/settings/shared"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onToggleImportMode}
          className="ml-auto gap-1.5 text-muted-foreground"
        >
          <ClipboardPaste className="size-3.5" />
          {importMode ? "Add manually" : "Paste .env"}
        </Button>
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
              <IconButton
                size="sm"
                onClick={() => onDeleteSecret(secret.id)}
                disabled={saving}
                aria-label={`Delete ${secret.name}`}
                title={`Delete ${secret.name}`}
                className="hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </IconButton>
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
            <Button
              type="button"
              size="sm"
              onClick={onImportSecrets}
              disabled={saving || importVars.length === 0}
            >
              {saving
                ? "Importing"
                : importVars.length > 0
                  ? `Import ${importVars.length}`
                  : "Import"}
            </Button>
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
          <Button
            type="button"
            size="sm"
            onClick={onSaveSecret}
            disabled={saving || !secretName || !secretValue}
            className="self-center"
          >
            Add
          </Button>
        </div>
      )}
    </div>
  )
}
