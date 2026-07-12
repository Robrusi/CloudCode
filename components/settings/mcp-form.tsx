"use client"

import { Trash2 } from "lucide-react"

import { McpHttpFields } from "@/components/settings/mcp-http-fields"
import { MCP_TRANSPORT_OPTIONS } from "@/components/settings/mcp-model"
import { McpStdioFields } from "@/components/settings/mcp-stdio-fields"
import { McpTextField } from "@/components/settings/mcp-text-field"
import { Button } from "@/components/ui/button"
import { SegmentedControl } from "@/components/ui/segmented-control"
import type { Id } from "@/convex/_generated/dataModel"
import { useMcpServerFormController } from "@/hooks/use-mcp-server-form-controller"
import type { McpServerRecord } from "@/lib/mcp/server-types"

export function McpServerForm({
  server,
  onSaved,
  onCancel,
  onRemove,
}: {
  server?: McpServerRecord
  onSaved: (serverId: Id<"mcpServers">) => void | Promise<void>
  onCancel: () => void
  onRemove?: () => void | Promise<void>
}) {
  const form = useMcpServerFormController({ onRemove, onSaved, server })

  return (
    <div className="grid gap-4">
      <McpTextField
        ariaLabel="MCP server name"
        label="Name"
        value={form.name}
        onChange={form.setName}
        placeholder="MCP server name"
      />

      <SegmentedControl
        fill
        label="MCP transport"
        value={form.transport}
        onChange={form.setTransport}
        options={MCP_TRANSPORT_OPTIONS}
        className="h-9"
        itemClassName="text-sm"
      />

      {form.transport === "stdio" ? (
        <McpStdioFields
          args={form.args}
          command={form.command}
          cwd={form.cwd}
          envVars={form.envVars}
          passthroughVars={form.passthroughVars}
          visibleSecrets={form.visibleSecrets}
          onArgsChange={form.setArgs}
          onCommandChange={form.setCommand}
          onCwdChange={form.setCwd}
          onEnvVarsChange={form.setEnvVars}
          onPassthroughVarsChange={form.setPassthroughVars}
          onRemoveSecret={form.removeSavedSecret}
        />
      ) : (
        <McpHttpFields
          bearerTokenEnvVar={form.bearerTokenEnvVar}
          envHeaders={form.envHeaders}
          headers={form.headers}
          url={form.url}
          visibleSecrets={form.visibleSecrets}
          onBearerTokenEnvVarChange={form.setBearerTokenEnvVar}
          onEnvHeadersChange={form.setEnvHeaders}
          onHeadersChange={form.setHeaders}
          onRemoveSecret={form.removeSavedSecret}
          onUrlChange={form.setUrl}
        />
      )}

      {form.error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {form.error}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        {form.editing && onRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={form.remove}
            disabled={form.saving || form.removing}
            className="gap-1.5 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
            {form.removing ? "Removing" : "Remove"}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={form.saving || form.removing}
            className="text-muted-foreground"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={form.save}
            disabled={!form.canSave}
          >
            {form.saving ? "Saving" : form.editing ? "Save changes" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  )
}
