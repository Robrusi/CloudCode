"use client"

import { useMutation } from "convex/react"
import { useMemo, useState } from "react"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { requestJson } from "@/lib/http/client-json"
import { dedupeEnvVars, parseDotenv } from "@/lib/env/dotenv-parse"
import type { SandboxPresetRecord } from "@/lib/sandbox/preset-types"

export function usePresetSettingsController(presets: SandboxPresetRecord[]) {
  const createPreset = useMutation(api.sandboxPresets.create)
  const updatePreset = useMutation(api.sandboxPresets.update)
  const removePreset = useMutation(api.sandboxPresets.remove)
  const removeEnvironment = useMutation(api.sandboxPresets.removeEnvironment)
  const [selectedId, setSelectedId] = useState<Id<"sandboxPresets"> | null>(
    null
  )
  const selected = presets.find((preset) => preset.id === selectedId) ?? null
  const selectedIsAuto = selected?.mode === "auto"
  const [name, setName] = useState("")
  const [autoEnvironment, setAutoEnvironment] = useState(false)
  const [pathInstallScript, setPathInstallScript] = useState("")
  const [installScript, setInstallScript] = useState("")
  const [secretName, setSecretName] = useState("")
  const [secretValue, setSecretValue] = useState("")
  const [importMode, setImportMode] = useState(false)
  const [importText, setImportText] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [creating, setCreating] = useState(false)

  const parsedImport = useMemo(() => parseDotenv(importText), [importText])
  const importVars = useMemo(
    () => dedupeEnvVars(parsedImport.vars),
    [parsedImport]
  )

  function resetEditor() {
    setSelectedId(null)
    setCreating(false)
    setName("")
    setAutoEnvironment(false)
    setPathInstallScript("")
    setInstallScript("")
    setSecretName("")
    setSecretValue("")
    setImportMode(false)
    setImportText("")
    setError("")
  }

  function startNewPreset() {
    resetEditor()
    setCreating(true)
  }

  function selectPreset(preset: SandboxPresetRecord) {
    setSelectedId(preset.id)
    setCreating(false)
    setName(preset.name)
    setAutoEnvironment(preset.mode === "auto")
    setPathInstallScript(preset.pathInstallScript ?? "")
    setInstallScript(preset.installScript ?? "")
    setSecretName("")
    setSecretValue("")
    setImportMode(false)
    setImportText("")
    setError("")
  }

  async function savePreset() {
    setSaving(true)
    setError("")
    try {
      const mode = autoEnvironment ? "auto" : "manual"
      if (selected) {
        await updatePreset({
          installScript: installScript.trim() || undefined,
          mode,
          name,
          pathInstallScript: pathInstallScript.trim() || undefined,
          presetId: selected.id,
        })
      } else {
        const id = await createPreset({
          installScript: installScript.trim() || undefined,
          mode,
          name,
          pathInstallScript: pathInstallScript.trim() || undefined,
        })
        setSelectedId(id)
        setCreating(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save preset.")
    } finally {
      setSaving(false)
    }
  }

  async function deletePreset() {
    if (!selected || saving) return
    if (selectedIsAuto) {
      setError("Auto environment presets cannot be deleted.")
      return
    }
    setSaving(true)
    setError("")
    try {
      await removePreset({ presetId: selected.id })
      resetEditor()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete preset.")
    } finally {
      setSaving(false)
    }
  }

  async function deleteEnvironment(
    environmentId: Id<"sandboxPresetEnvironments">
  ) {
    if (saving) return
    setSaving(true)
    setError("")
    try {
      await removeEnvironment({ environmentId })
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to delete cloudcode.yaml environment."
      )
    } finally {
      setSaving(false)
    }
  }

  async function ensurePresetId(): Promise<Id<"sandboxPresets"> | null> {
    if (selected?.id) return selected.id
    if (!name.trim()) {
      setError("Name the preset before adding secrets.")
      return null
    }
    const presetId = await createPreset({
      installScript: installScript.trim() || undefined,
      mode: autoEnvironment ? "auto" : "manual",
      name,
      pathInstallScript: pathInstallScript.trim() || undefined,
    })
    setSelectedId(presetId)
    setCreating(false)
    return presetId
  }

  async function saveSecret() {
    setSaving(true)
    setError("")
    try {
      const presetId = await ensurePresetId()
      if (!presetId) return
      await requestJson(
        "/api/sandbox/presets/secrets",
        "POST",
        {
          name: secretName,
          presetId,
          value: secretValue,
        },
        {
          fallbackError: "Unable to save secret.",
        }
      )
      setSecretName("")
      setSecretValue("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save secret.")
    } finally {
      setSaving(false)
    }
  }

  async function importSecrets() {
    if (importVars.length === 0) return
    setSaving(true)
    setError("")
    try {
      const presetId = await ensurePresetId()
      if (!presetId) return
      const data = await requestJson<{
        failed?: Array<{ error: string; name: string }>
      }>(
        "/api/sandbox/presets/secrets",
        "POST",
        { presetId, secrets: importVars },
        {
          fallbackError: "Unable to import secrets.",
        }
      )

      const failed = data?.failed ?? []
      if (failed.length > 0) {
        setError(
          `Imported, but skipped ${failed.length}: ${failed
            .map((entry) => entry.name)
            .join(", ")}`
        )
      } else {
        setImportMode(false)
      }
      setImportText("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to import secrets.")
    } finally {
      setSaving(false)
    }
  }

  async function deleteSecret(secretId: Id<"sandboxPresetSecrets">) {
    setSaving(true)
    setError("")
    try {
      await requestJson(
        "/api/sandbox/presets/secrets",
        "DELETE",
        { secretId },
        {
          fallbackError: "Unable to delete secret.",
        }
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete secret.")
    } finally {
      setSaving(false)
    }
  }

  function toggleImportMode() {
    setImportMode((value) => !value)
    setError("")
  }

  return {
    autoEnvironment,
    creating,
    deleteEnvironment,
    deletePreset,
    deleteSecret,
    error,
    importMode,
    importSecrets,
    importText,
    importVars,
    installScript,
    name,
    parsedImport,
    pathInstallScript,
    resetEditor,
    savePreset,
    saveSecret,
    saving,
    secretName,
    secretValue,
    selectPreset,
    selected,
    selectedIsAuto,
    setAutoEnvironment,
    setImportText,
    setInstallScript,
    setName,
    setPathInstallScript,
    setSecretName,
    setSecretValue,
    startNewPreset,
    toggleImportMode,
  }
}
