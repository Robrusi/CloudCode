import type { Id } from "@/convex/_generated/dataModel"

export type SandboxPresetSecretRecord = {
  hasValue: boolean
  id: Id<"sandboxPresetSecrets">
  name: string
  updatedAt: number
}

export type SandboxPresetEnvironmentRecord = {
  activeSandboxId?: string
  builtAt?: number
  environmentSlug: string
  id: Id<"sandboxPresetEnvironments">
  repoUrl: string
  status: "empty" | "building" | "ready" | "failed" | "stale"
  updatedAt: number
}

export type SandboxPresetRecord = {
  createdAt: number
  daytonaSnapshot?: string
  environmentSlug?: string
  environments?: SandboxPresetEnvironmentRecord[]
  id: Id<"sandboxPresets">
  installScript?: string
  mode?: "manual" | "auto"
  name: string
  pathInstallScript?: string
  secrets: SandboxPresetSecretRecord[]
  updatedAt: number
}
