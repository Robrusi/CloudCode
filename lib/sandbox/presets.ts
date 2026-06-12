import type { Id } from "@/convex/_generated/dataModel"

export type SandboxPresetForRun = {
  daytonaSnapshot?: string
  environmentSlug?: string
  id: Id<"sandboxPresets">
  installScript?: string
  mode?: "manual" | "auto"
  name: string
  pathInstallScript?: string
  secrets: Array<{
    name: string
    value: string
  }>
}
