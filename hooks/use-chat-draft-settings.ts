"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import {
  AUTO_PRESET_DEFAULT_RESTORED_KEY,
  BASE_BRANCH_KEY,
  BRANCH_MODE_KEY,
  BRANCH_NAME_KEY,
  MODEL_KEY,
  PRESET_KEY,
  REPO_KEY,
  SPEED_KEY,
  THINKING_KEY,
} from "@/components/chat/storage"
import type { Id } from "@/convex/_generated/dataModel"
import {
  MODELS,
  SPEEDS,
  THINKINGS,
  normalizeThinkingForModel,
  type BranchMode,
  type Model,
  type Speed,
  type Thinking,
} from "@/lib/chat/options"
import {
  hasBrowserStorageKey,
  readBrowserStorage,
  removeBrowserStorage,
  writeBrowserStorage,
} from "@/lib/browser/storage"
import type { SandboxPresetRecord } from "@/lib/sandbox/preset-types"

export function useChatDraftSettings({
  autoSandboxPreset,
  defaultSandboxPreset,
  presetsLoaded,
  sandboxPresets,
}: {
  autoSandboxPreset: SandboxPresetRecord | null
  defaultSandboxPreset: SandboxPresetRecord | null
  presetsLoaded: boolean
  sandboxPresets: SandboxPresetRecord[]
}) {
  const autoPresetDefaultedRef = useRef(false)
  const [draftRepo, setDraftRepo] = useState(
    () => readBrowserStorage(REPO_KEY) ?? ""
  )
  const [draftBaseBranch, setDraftBaseBranch] = useState(
    () => readBrowserStorage(BASE_BRANCH_KEY) ?? ""
  )
  const [draftBranchMode, setDraftBranchMode] = useState<BranchMode>(() => {
    const stored = readBrowserStorage(BRANCH_MODE_KEY)
    return stored === "custom" || stored === "base" ? stored : "auto"
  })
  const [draftBranchName, setDraftBranchName] = useState(
    () => readBrowserStorage(BRANCH_NAME_KEY) ?? ""
  )
  const [draftModel, setDraftModel] = useState<Model>(() => {
    const stored = readBrowserStorage(MODEL_KEY)
    return stored && (MODELS as readonly string[]).includes(stored)
      ? (stored as Model)
      : "gpt-5.5"
  })
  const [draftSpeed, setDraftSpeed] = useState<Speed>(() => {
    const stored = readBrowserStorage(SPEED_KEY)
    return stored && (SPEEDS as readonly string[]).includes(stored)
      ? (stored as Speed)
      : "standard"
  })
  const [draftThinking, setDraftThinking] = useState<Thinking>(() => {
    const stored = readBrowserStorage(THINKING_KEY)
    const thinking =
      stored && (THINKINGS as readonly string[]).includes(stored)
        ? (stored as Thinking)
        : "medium"
    return normalizeThinkingForModel(draftModel, thinking)
  })
  const [draftSandboxPresetId, setDraftSandboxPresetId] = useState<
    Id<"sandboxPresets"> | ""
  >(() => (readBrowserStorage(PRESET_KEY) as Id<"sandboxPresets"> | null) ?? "")
  const draftSandboxPresetValid =
    !draftSandboxPresetId ||
    !presetsLoaded ||
    sandboxPresets.some((preset) => preset.id === draftSandboxPresetId)
  const autoSandboxPresetId = autoSandboxPreset?.id ?? ""
  const defaultSandboxPresetId = defaultSandboxPreset?.id ?? ""
  const effectiveDraftSandboxPresetId: Id<"sandboxPresets"> | "" =
    draftSandboxPresetId && draftSandboxPresetValid
      ? draftSandboxPresetId
      : autoSandboxPresetId

  useEffect(() => {
    if (autoPresetDefaultedRef.current) return
    if (!autoSandboxPresetId) return

    const shouldRestoreAutoDefault =
      !hasBrowserStorageKey(AUTO_PRESET_DEFAULT_RESTORED_KEY) &&
      Boolean(defaultSandboxPresetId) &&
      draftSandboxPresetId === defaultSandboxPresetId

    if (
      hasBrowserStorageKey(PRESET_KEY) &&
      draftSandboxPresetId &&
      !shouldRestoreAutoDefault
    ) {
      autoPresetDefaultedRef.current = true
      writeBrowserStorage(AUTO_PRESET_DEFAULT_RESTORED_KEY, "1")
      return
    }

    autoPresetDefaultedRef.current = true
    setDraftSandboxPresetId(autoSandboxPresetId)
    writeBrowserStorage(PRESET_KEY, autoSandboxPresetId)
    writeBrowserStorage(AUTO_PRESET_DEFAULT_RESTORED_KEY, "1")
  }, [autoSandboxPresetId, defaultSandboxPresetId, draftSandboxPresetId])

  useEffect(() => {
    if (!draftSandboxPresetId || !presetsLoaded) return
    if (draftSandboxPresetValid) return
    if (!autoSandboxPresetId) return

    setDraftSandboxPresetId(autoSandboxPresetId)
    writeBrowserStorage(PRESET_KEY, autoSandboxPresetId)
    writeBrowserStorage(AUTO_PRESET_DEFAULT_RESTORED_KEY, "1")
  }, [
    autoSandboxPresetId,
    draftSandboxPresetId,
    draftSandboxPresetValid,
    presetsLoaded,
  ])

  const persistDraftRepo = useCallback((value: string) => {
    setDraftRepo(value)
    if (value) writeBrowserStorage(REPO_KEY, value)
    else removeBrowserStorage(REPO_KEY)
  }, [])

  const persistDraftBaseBranch = useCallback((value: string) => {
    setDraftBaseBranch(value)
    if (value) writeBrowserStorage(BASE_BRANCH_KEY, value)
    else removeBrowserStorage(BASE_BRANCH_KEY)
  }, [])

  const persistDraftBranchMode = useCallback((value: BranchMode) => {
    setDraftBranchMode(value)
    if (value === "auto") removeBrowserStorage(BRANCH_MODE_KEY)
    else writeBrowserStorage(BRANCH_MODE_KEY, value)
  }, [])

  const persistDraftBranchName = useCallback((value: string) => {
    setDraftBranchName(value)
    if (value) writeBrowserStorage(BRANCH_NAME_KEY, value)
    else removeBrowserStorage(BRANCH_NAME_KEY)
  }, [])

  const storeModelPreference = useCallback((next: Model) => {
    writeBrowserStorage(MODEL_KEY, next)
  }, [])

  const persistDraftModel = useCallback(
    (next: Model) => {
      setDraftModel(next)
      storeModelPreference(next)
    },
    [storeModelPreference]
  )

  const persistDraftSpeed = useCallback((next: Speed) => {
    setDraftSpeed(next)
    writeBrowserStorage(SPEED_KEY, next)
  }, [])

  const persistDraftThinking = useCallback((next: Thinking) => {
    setDraftThinking(next)
    writeBrowserStorage(THINKING_KEY, next)
  }, [])

  const persistDraftSandboxPreset = useCallback(
    (next: Id<"sandboxPresets"> | "") => {
      setDraftSandboxPresetId(next)
      if (next) writeBrowserStorage(PRESET_KEY, next)
      else removeBrowserStorage(PRESET_KEY)
      writeBrowserStorage(AUTO_PRESET_DEFAULT_RESTORED_KEY, "1")
    },
    []
  )

  return {
    draftBaseBranch,
    draftBranchMode,
    draftBranchName,
    draftModel,
    draftRepo,
    draftSpeed,
    draftThinking,
    effectiveDraftSandboxPresetId,
    persistDraftBaseBranch,
    persistDraftBranchMode,
    persistDraftBranchName,
    persistDraftModel,
    persistDraftRepo,
    persistDraftSandboxPreset,
    persistDraftSpeed,
    persistDraftThinking,
    storeModelPreference,
  }
}
