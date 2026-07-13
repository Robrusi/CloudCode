"use client"

import { useQuery } from "convex/react"
import { useCallback, useEffect, useState } from "react"

import { CustomizationSettings } from "@/components/settings/customization"
import { BillingSettings } from "@/components/settings/billing"
import { ConnectionsSettings } from "@/components/settings/connections"
import { McpSettings } from "@/components/settings/mcp"
import { PresetSettings } from "@/components/settings/presets"
import type { SettingsSectionId } from "@/components/settings/sections"
import { api } from "@/convex/_generated/api"
import { fetchJson } from "@/lib/http/client-json"
import type { CodexAuthOverview } from "@/lib/codex/auth-types"
import type { GitHubAuthStatus } from "@/lib/github/auth"
import type { McpServerRecord } from "@/lib/mcp/server-types"
import type { SandboxPresetRecord } from "@/lib/sandbox/preset-types"

export function SettingsScreen({
  section,
  authStatus,
  authError,
  githubStatus,
  githubAuthError,
  onCodexAuthChanged,
  onGitHubAuthChanged,
  sandboxPresets,
}: {
  section: SettingsSectionId
  authStatus: CodexAuthOverview | null
  authError: string
  githubStatus: GitHubAuthStatus | null
  githubAuthError: string
  onCodexAuthChanged: () => void | Promise<void>
  onGitHubAuthChanged: () => void | Promise<void>
  sandboxPresets: SandboxPresetRecord[]
}) {
  const detailedPresets = useQuery(api.sandboxPresets.listWithEnvironments)
  const presets = (detailedPresets ?? sandboxPresets) as SandboxPresetRecord[]
  const [mcpServers, setMcpServers] = useState<McpServerRecord[]>([])
  const [mcpLoading, setMcpLoading] = useState(true)
  const [mcpError, setMcpError] = useState("")

  const reloadMcpServers = useCallback(async () => {
    setMcpError("")
    try {
      const data = await fetchJson<{ servers?: McpServerRecord[] }>(
        "/api/mcp/custom",
        { method: "GET" },
        { fallbackError: "Unable to load MCP servers." }
      )
      setMcpServers(data.servers ?? [])
    } catch (error) {
      setMcpError(
        error instanceof Error ? error.message : "Unable to load MCP servers."
      )
      setMcpServers([])
    } finally {
      setMcpLoading(false)
    }
  }, [])

  useEffect(() => {
    void reloadMcpServers()
  }, [reloadMcpServers])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 [scrollbar-gutter:stable] overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 pt-8 pb-[calc(5rem+env(safe-area-inset-bottom))] md:px-8 md:pt-12">
          {section === "connections" ? (
            <ConnectionsSettings
              authStatus={authStatus}
              authError={authError}
              githubStatus={githubStatus}
              githubAuthError={githubAuthError}
              onCodexAuthChanged={onCodexAuthChanged}
              onGitHubAuthChanged={onGitHubAuthChanged}
            />
          ) : null}
          {section === "billing" ? <BillingSettings /> : null}
          {section === "mcp" ? (
            <McpSettings
              error={mcpError}
              loading={mcpLoading}
              onReload={reloadMcpServers}
              servers={mcpServers}
            />
          ) : null}
          {section === "presets" ? <PresetSettings presets={presets} /> : null}
          {section === "customization" ? <CustomizationSettings /> : null}
        </div>
      </div>
    </div>
  )
}
