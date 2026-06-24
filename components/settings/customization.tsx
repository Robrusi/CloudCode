"use client"

import { useMutation, useQuery } from "convex/react"
import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"

import {
  fieldHint,
  fieldLabel,
  navAction,
  SettingsPage,
  textareaClass,
} from "@/components/settings/shared"
import {
  SegmentedControl,
  type SegmentedOption,
} from "@/components/ui/segmented-control"
import { api } from "@/convex/_generated/api"
import { cn } from "@/lib/shared/utils"

const MAX_INSTRUCTIONS_LENGTH = 10_000

type ThemeChoice = "light" | "dark" | "system"

const THEME_OPTIONS: SegmentedOption<ThemeChoice>[] = [
  { value: "light", label: "Light", icon: <Sun className="size-3.5" /> },
  { value: "dark", label: "Dark", icon: <Moon className="size-3.5" /> },
  { value: "system", label: "System", icon: <Monitor className="size-3.5" /> },
]

function InstructionsSetting() {
  const viewer = useQuery(api.users.viewer)
  const saveInstructions = useMutation(api.users.setAgentInstructions)

  const [value, setValue] = useState("")
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  // Adopt the stored value once the viewer query resolves. After that the
  // local field owns the text so we never clobber an in-progress edit.
  useEffect(() => {
    if (!loaded && viewer !== undefined) {
      setValue(viewer?.agentInstructions ?? "")
      setLoaded(true)
    }
  }, [loaded, viewer])

  const persisted = viewer?.agentInstructions ?? ""
  const over = value.length > MAX_INSTRUCTIONS_LENGTH
  const dirty = loaded && value !== persisted

  async function handleSave() {
    setSaving(true)
    setError("")
    try {
      await saveInstructions({ instructions: value })
      // The server trims before persisting; mirror that locally so the field
      // settles to a clean, non-dirty state after a successful save.
      setValue((current) => current.trim())
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save instructions."
      )
    } finally {
      setSaving(false)
    }
  }

  const hint = error
    ? error
    : over
      ? `${value.length.toLocaleString()} / ${MAX_INSTRUCTIONS_LENGTH.toLocaleString()}`
      : "Added to every agent’s global AGENTS.md, on top of the built-in instructions."

  return (
    <label className={fieldLabel}>
      Instructions
      <textarea
        aria-label="Instructions"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={!loaded || saving}
        placeholder="e.g. Always use pnpm. Prefer TypeScript. Keep changes small and focused."
        spellCheck={false}
        className={cn(textareaClass, "min-h-32", "font-normal")}
      />
      <div className="flex items-center justify-between gap-3">
        <span className={cn(fieldHint, (over || error) && "text-destructive")}>
          {hint}
        </span>
        {dirty || saving ? (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || over}
            className={navAction}
          >
            {saving ? "Saving" : "Save"}
          </button>
        ) : null}
      </div>
    </label>
  )
}

export function CustomizationSettings() {
  const { theme, setTheme } = useTheme()
  // next-themes can't know the resolved theme until mounted; render a stable
  // fallback so the control matches after hydration instead of flickering.
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const value: ThemeChoice = mounted
    ? ((theme as ThemeChoice | undefined) ?? "system")
    : "system"

  return (
    <SettingsPage
      title="Customization"
      description="Personalize Cloudcode and how your agents behave."
    >
      <InstructionsSetting />
      <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-6">
        <div className="text-sm font-medium text-foreground/90">Theme</div>
        <SegmentedControl
          label="Theme"
          value={value}
          onChange={setTheme}
          options={THEME_OPTIONS}
        />
      </div>
    </SettingsPage>
  )
}
