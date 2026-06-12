"use client"

import { ArrowLeft } from "lucide-react"

import {
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from "@/components/settings/sections"
import { cn } from "@/lib/shared/utils"

export function SidebarSettingsNav({
  settingsSection,
  onExitSettings,
  onSelectSettingsSection,
}: {
  settingsSection: SettingsSectionId
  onExitSettings: () => void
  onSelectSettingsSection: (id: SettingsSectionId) => void
}) {
  return (
    <>
      <div className="px-2 pt-2">
        <button
          type="button"
          onClick={onExitSettings}
          className="flex w-full items-center gap-2 rounded-xl px-[0.625rem] py-2 text-[0.8125rem] text-foreground/80 transition-colors hover:bg-muted"
        >
          <ArrowLeft className="size-3.5 shrink-0" />
          <span>Back to chats</span>
        </button>
      </div>

      <nav className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <div className="space-y-0.5">
          {SETTINGS_SECTIONS.map((section) => {
            const Icon = section.icon
            const selected = settingsSection === section.id
            return (
              <button
                key={section.id}
                type="button"
                aria-current={selected ? "page" : undefined}
                onClick={() => onSelectSettingsSection(section.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-[0.8125rem] transition-colors",
                  selected
                    ? "bg-muted font-medium text-foreground"
                    : "text-foreground/80 hover:bg-muted"
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{section.label}</span>
              </button>
            )
          })}
        </div>
      </nav>
    </>
  )
}
