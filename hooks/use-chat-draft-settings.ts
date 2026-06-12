"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import {
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
  presetsLoaded,
  sandboxPresets,
}: {
  autoSandboxPreset: SandboxPresetRecord | null
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
    return stored && (THINKINGS as readonly string[]).includes(stored)
      ? (stored as Thinking)
      : "medium"
  })
  const [draftSandboxPresetId, setDraftSandboxPresetId] = useState<
    Id<"sandboxPresets"> | ""
  >(() => (readBrowserStorage(PRESET_KEY) as Id<"sandboxPresets"> | null) ?? "")
  const draftSandboxPresetValid =
    !draftSandboxPresetId ||
    !presetsLoaded ||
    sandboxPresets.some((preset) => preset.id === draftSandboxPresetId)
  const effectiveDraftSandboxPresetId: Id<"sandboxPresets"> | "" =
    draftSandboxPresetId && draftSandboxPresetValid
      ? draftSandboxPresetId
      : (autoSandboxPreset?.id ?? "")

  useEffect(() => {
    if (autoPresetDefaultedRef.current) return
    if (hasBrowserStorageKey(PRESET_KEY) || draftSandboxPresetId) {
      autoPresetDefaultedRef.current = true
      return
    }

    if (!autoSandboxPreset) return
    autoPresetDefaultedRef.current = true
    setDraftSandboxPresetId(autoSandboxPreset.id)
    writeBrowserStorage(PRESET_KEY, autoSandboxPreset.id)
  }, [autoSandboxPreset, draftSandboxPresetId])

  useEffect(() => {
    if (!draftSandboxPresetId || !presetsLoaded) return
    if (draftSandboxPresetValid) return
    if (!autoSandboxPreset) return

    setDraftSandboxPresetId(autoSandboxPreset.id)
    writeBrowserStorage(PRESET_KEY, autoSandboxPreset.id)
  }, [
    autoSandboxPreset,
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
