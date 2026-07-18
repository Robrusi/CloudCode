"use client"

import { Trash2 } from "lucide-react"

import { PresetEnvironmentList } from "@/components/settings/presets-environments"
import { PresetSecretsSection } from "@/components/settings/presets-secrets"
import type { usePresetSettingsController } from "@/components/settings/presets-controller"
import {
  fieldHint,
  fieldLabel,
  inputClass,
  textareaClass,
} from "@/components/settings/shared"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { CLOUDCODE_YAML_PATH } from "@/lib/cloudcode/config-path"
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
  | "selectedIsDefault"
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
        {props.selectedIsDefault ? (
          <DefaultPresetSummary />
        ) : props.selectedIsAuto ? (
          <>
            <PresetNameField name={props.name} onNameChange={props.setName} />
            <AutoPresetEnvironmentSummary
              selected={props.selected}
              saving={props.saving}
              onDeleteEnvironment={props.deleteEnvironment}
            />
          </>
        ) : (
          <>
            <PresetNameField name={props.name} onNameChange={props.setName} />
            <ManualPresetFields {...props} />
          </>
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

function DefaultPresetSummary() {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-foreground/80">Default</div>
      <p className={fieldHint}>
        Starts a sandbox from the base Daytona environment without auto
        environment setup, install scripts, or preset secrets.
      </p>
    </div>
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
        Automatic {CLOUDCODE_YAML_PATH} environments
      </div>
      <p className={fieldHint}>
        When this preset runs against a repo, Cloudcode uses the repo&apos;s{" "}
        {CLOUDCODE_YAML_PATH} first. If the repo does not have one, it uses the
        saved Convex cloudcode.yaml for the live sandbox.
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
            Use the repo&apos;s {CLOUDCODE_YAML_PATH} for each live chat
            sandbox, falling back to the saved Convex cloudcode.yaml when the
            repo does not include one. The scripts and secrets below run after
            the environment is ready.
          </p>
        </div>
        <Switch
          aria-label="Auto environment"
          className="mt-0.5"
          checked={props.autoEnvironment}
          onCheckedChange={props.setAutoEnvironment}
        />
      </div>

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
  selectedIsDefault,
}: Pick<
  PresetEditorFieldsProps,
  | "deletePreset"
  | "name"
  | "resetEditor"
  | "savePreset"
  | "saving"
  | "selected"
  | "selectedIsAuto"
  | "selectedIsDefault"
>) {
  if (selectedIsDefault) {
    return (
      <div className="mt-4 flex items-center justify-end gap-2 border-t border-border/60 pt-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={resetEditor}
          disabled={saving}
          className="text-muted-foreground"
        >
          Close
        </Button>
      </div>
    )
  }

  return (
    <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/60 pt-4">
      {!selectedIsAuto ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={deletePreset}
          disabled={!selected || saving}
          className="gap-1.5 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
          Delete
        </Button>
      ) : (
        <div />
      )}
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={resetEditor}
          disabled={saving}
          className="text-muted-foreground"
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={savePreset}
          disabled={saving || !name.trim()}
        >
          {saving ? "Saving" : selected ? "Save preset" : "Create preset"}
        </Button>
      </div>
    </div>
  )
}
