import type { LucideIcon } from "lucide-react"
import { CreditCard, Layers3, Plug, Server } from "lucide-react"

/** Settings sections, shared by the sidebar nav and the settings content. */
export type SettingsSectionId = "connections" | "billing" | "mcp" | "presets"

export const SETTINGS_SECTIONS: ReadonlyArray<{
  icon: LucideIcon
  id: SettingsSectionId
  label: string
}> = [
  { icon: Plug, id: "connections", label: "Connections" },
  { icon: CreditCard, id: "billing", label: "Billing" },
  { icon: Server, id: "mcp", label: "MCP" },
  { icon: Layers3, id: "presets", label: "Presets" },
]
