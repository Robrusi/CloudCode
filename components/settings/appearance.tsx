"use client"

import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"

import { SettingsPage } from "@/components/settings/shared"
import {
  SegmentedControl,
  type SegmentedOption,
} from "@/components/ui/segmented-control"
import { cardSurfaceClass } from "@/components/ui/surface"
import { cn } from "@/lib/shared/utils"

type ThemeChoice = "light" | "dark" | "system"

const THEME_OPTIONS: SegmentedOption<ThemeChoice>[] = [
  { value: "light", label: "Light", icon: <Sun className="size-3.5" /> },
  { value: "dark", label: "Dark", icon: <Moon className="size-3.5" /> },
  { value: "system", label: "System", icon: <Monitor className="size-3.5" /> },
]

export function AppearanceSettings() {
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
      title="Appearance"
      description="Choose how Cloudcode looks. System follows your device setting."
    >
      <div
        className={cn(
          "flex items-center justify-between gap-4 px-4 py-3.5",
          cardSurfaceClass
        )}
      >
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground/90">Theme</div>
        </div>
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
