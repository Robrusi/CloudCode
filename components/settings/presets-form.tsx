"use client"

import { Trash2 } from "lucide-react"

import { PresetEnvironmentList } from "@/components/settings/presets-environments"
import { PresetSecretsSection } from "@/components/settings/presets-secrets"
import type { usePresetSettingsController } from "@/components/settings/presets-controller"
import {
  fieldHint,
  fieldLabel,
  inputClass,
  navAction,
  navDestructive,
  navPrimary,
  textareaClass,
} from "@/components/settings/shared"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/shared/utils"

type PresetSettingsController = ReturnType<typeof usePresetSettingsController>

type PresetEditorFieldsProps = Pick<
  PresetSettingsController,
  | "autoEnvironment"
  | "deleteEnvironment"
  | "deletePreset"
  | "deleteSecret"
  | "error"
  | "importMode"
  | "importSecrets"
  | "importText"
  | "importVars"
  | "installScript"
  | "name"
  | "parsedImport"
  | "pathInstallScript"
  | "resetEditor"
  | "savePreset"
  | "saveSecret"
  | "saving"
  | "secretName"
  | "secretValue"
  | "selected"
  | "selectedIsAuto"
  | "setAutoEnvironment"
  | "setImportText"
  | "setInstallScript"
  | "setName"
  | "setPathInstallScript"
  | "setSecretName"
  | "setSecretValue"
  | "toggleImportMode"
>

export function PresetEditorFields(props: PresetEditorFieldsProps) {
  return (
    <>
      <div className="grid gap-4">
        <PresetNameField name={props.name} onNameChange={props.setName} />

        {props.selectedIsAuto ? (
          <AutoPresetEnvironmentSummary
            selected={props.selected}
            saving={props.saving}
            onDeleteEnvironment={props.deleteEnvironment}
          />
        ) : (
          <ManualPresetFields {...props} />
        )}

        {props.error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {props.error}
          </div>
        ) : null}
      </div>

      <PresetEditorActions {...props} />
    </>
  )
}

function PresetNameField({
  name,
  onNameChange,
}: {
  name: string
  onNameChange: (value: string) => void
}) {
  return (
    <label className={fieldLabel}>
      Name
      <input
        aria-label="Preset name"
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
        placeholder="Node 22 workspace"
        className={cn(inputClass, "font-normal")}
      />
    </label>
  )
}

function AutoPresetEnvironmentSummary({
  selected,
  saving,
  onDeleteEnvironment,
}: {
  selected: PresetEditorFieldsProps["selected"]
  saving: PresetEditorFieldsProps["saving"]
  onDeleteEnvironment: PresetEditorFieldsProps["deleteEnvironment"]
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-foreground/80">
        Automatic cloudcode.yaml environments
      </div>
      <p className={fieldHint}>
        When this preset runs against a repo, Cloudcode uses the repo&apos;s
        cloudcode.yaml first. If the repo does not have one, it uses the saved
        Convex cloudcode.yaml for the live sandbox.
      </p>
      {selected?.environments?.length ? (
        <div className="mt-3">
          <PresetEnvironmentList
            environments={selected.environments}
            saving={saving}
            onDelete={onDeleteEnvironment}
          />
        </div>
      ) : null}
    </div>
  )
}

function ManualPresetFields(props: PresetEditorFieldsProps) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-foreground/80">
            Auto environment
          </div>
          <p className={fieldHint}>
            Use the repo&apos;s cloudcode.yaml for each live chat sandbox,
            falling back to the saved Convex cloudcode.yaml when the repo does
            not include one. The scripts and secrets below run after the
            environment is ready.
          </p>
        </div>
        <Switch
          aria-label="Auto environment"
          className="mt-0.5"
          checked={props.autoEnvironment}
          onCheckedChange={props.setAutoEnvironment}
        />
      </div>

      {props.autoEnvironment && props.selected?.environments?.length ? (
        <PresetEnvironmentList
          environments={props.selected.environments}
          saving={props.saving}
          onDelete={props.deleteEnvironment}
        />
      ) : null}

      <PresetScriptTextarea
        label="PATH setup script"
        value={props.pathInstallScript}
        onChange={props.setPathInstallScript}
        placeholder={
          "curl -fsSL https://vite.plus | bash\nnpm install -g vercel"
        }
        minHeightClass="min-h-24"
        hint="Runs from the sandbox home before repo setup. Use it for CLIs and language tools that should be available on PATH."
      />

      <PresetScriptTextarea
        label="Repo install script"
        value={props.installScript}
        onChange={props.setInstallScript}
        placeholder={"pnpm install\npnpm test -- --runInBand"}
        minHeightClass="min-h-28"
        hint="Runs from the cloned repo root before Codex starts. Leave blank when the base environment already has everything."
      />

      <PresetSecretsSection
        importMode={props.importMode}
        importText={props.importText}
        importVars={props.importVars}
        parsedImport={props.parsedImport}
        saving={props.saving}
        secretName={props.secretName}
        secretValue={props.secretValue}
        selected={props.selected}
        onDeleteSecret={props.deleteSecret}
        onImportSecrets={props.importSecrets}
        onImportTextChange={props.setImportText}
        onSaveSecret={props.saveSecret}
        onSecretNameChange={props.setSecretName}
        onSecretValueChange={props.setSecretValue}
        onToggleImportMode={props.toggleImportMode}
      />
    </>
  )
}

function PresetScriptTextarea({
  label,
  value,
  onChange,
  placeholder,
  minHeightClass,
  hint,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  minHeightClass: string
  hint: string
}) {
  return (
    <label className={fieldLabel}>
      {label}
      <textarea
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className={cn(textareaClass, minHeightClass, "font-normal")}
      />
      <span className={fieldHint}>{hint}</span>
    </label>
  )
}

function PresetEditorActions({
  deletePreset,
  name,
  resetEditor,
  savePreset,
  saving,
  selected,
  selectedIsAuto,
}: Pick<
  PresetEditorFieldsProps,
  | "deletePreset"
  | "name"
  | "resetEditor"
  | "savePreset"
  | "saving"
  | "selected"
  | "selectedIsAuto"
>) {
  return (
    <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/60 pt-4">
      {!selectedIsAuto ? (
        <button
          type="button"
          onClick={deletePreset}
          disabled={!selected || saving}
          className={navDestructive}
        >
          <Trash2 className="size-3.5" />
          Delete
        </button>
      ) : (
        <div />
      )}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={resetEditor}
          disabled={saving}
          className={navAction}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={savePreset}
          disabled={saving || !name.trim()}
          className={navPrimary}
        >
          {saving ? "Saving" : selected ? "Save preset" : "Create preset"}
        </button>
      </div>
    </div>
  )
}
