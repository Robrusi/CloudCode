"use client"

import { useMutation, useQuery } from "convex/react"
import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"

import {
  fieldHint,
  fieldLabel,
  SettingsPage,
  textareaClass,
} from "@/components/settings/shared"
import { Button } from "@/components/ui/button"
import { ColorPicker } from "@/components/ui/color-picker"
import {
  SegmentedControl,
  type SegmentedOption,
} from "@/components/ui/segmented-control"
import { Slider } from "@/components/ui/slider"
import { api } from "@/convex/_generated/api"
import { useAccent } from "@/hooks/use-accent"
import { DEFAULT_ACCENT, DEFAULT_CUSTOM_COLOR } from "@/lib/theme/accent"
import {
  clampSandboxIdleMinutes,
  SANDBOX_IDLE_MINUTES_MAX,
  SANDBOX_IDLE_MINUTES_MIN,
} from "@/lib/sandbox/idle"
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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleSave}
            disabled={saving || over}
            className="text-muted-foreground"
          >
            {saving ? "Saving" : "Save"}
          </Button>
        ) : null}
      </div>
    </label>
  )
}

function IdleTimeoutSetting() {
  const viewer = useQuery(api.users.viewer)
  const saveIdleMinutes = useMutation(api.users.setSandboxIdleMinutes)

  const persisted = clampSandboxIdleMinutes(viewer?.sandboxIdleMinutes)
  const [value, setValue] = useState(persisted)
  const [loaded, setLoaded] = useState(false)

  // Adopt the stored value once the viewer query resolves; afterwards the
  // slider owns the value so dragging never fights an in-flight save.
  useEffect(() => {
    if (!loaded && viewer !== undefined) {
      setValue(clampSandboxIdleMinutes(viewer?.sandboxIdleMinutes))
      setLoaded(true)
    }
  }, [loaded, viewer])

  function handleCommit(next: number) {
    const clamped = clampSandboxIdleMinutes(next)
    setValue(clamped)
    if (clamped !== persisted) {
      void saveIdleMinutes({ minutes: clamped })
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border/60 pt-6">
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm font-medium text-foreground/90">
          Idle timeout
        </div>
        <div className="text-sm text-foreground/70 tabular-nums">
          {value} {value === 1 ? "minute" : "minutes"}
        </div>
      </div>
      <Slider
        aria-label="Sandbox idle timeout in minutes"
        min={SANDBOX_IDLE_MINUTES_MIN}
        max={SANDBOX_IDLE_MINUTES_MAX}
        step={1}
        disabled={!loaded}
        value={value}
        onValueChange={setValue}
        onValueCommitted={handleCommit}
      />
      <span className={fieldHint}>
        How long a sandbox stays running with no activity before it’s stopped to
        save resources. Applies the next time an agent starts in a sandbox.
      </span>
    </div>
  )
}

function AccentSetting() {
  const {
    accent,
    customColor,
    setAccent,
    previewCustomColor,
    commitCustomColor,
    mounted,
  } = useAccent()

  // Default = the neutral accent (black/white buttons); disable Reset there.
  const isDefault = mounted && accent === DEFAULT_ACCENT

  return (
    <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-6">
      <div className="text-sm font-medium text-foreground/90">Accent</div>
      <div className="flex items-center gap-2">
        <ColorPicker
          ariaLabel="Accent color"
          value={mounted ? customColor : DEFAULT_CUSTOM_COLOR}
          onChange={previewCustomColor}
          onCommit={commitCustomColor}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isDefault}
          onClick={() => setAccent(DEFAULT_ACCENT)}
        >
          Reset
        </Button>
      </div>
    </div>
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
      <IdleTimeoutSetting />
      <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-6">
        <div className="text-sm font-medium text-foreground/90">Theme</div>
        <SegmentedControl
          label="Theme"
          value={value}
          onChange={setTheme}
          options={THEME_OPTIONS}
        />
      </div>
      <AccentSetting />
    </SettingsPage>
  )
}
