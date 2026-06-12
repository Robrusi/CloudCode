"use client"

import type {
  McpPair,
  McpVisibleSecrets,
} from "@/components/settings/mcp-model"
import type {
  McpSecretRemover,
  McpStringSetter,
} from "@/components/settings/mcp-form-types"
import { McpPairListEditor } from "@/components/settings/mcp-pair-list-editor"
import { McpSavedSecretList } from "@/components/settings/mcp-saved-secret-list"
import { McpTextField } from "@/components/settings/mcp-text-field"

export function McpHttpFields({
  bearerTokenEnvVar,
  envHeaders,
  headers,
  url,
  visibleSecrets,
  onBearerTokenEnvVarChange,
  onEnvHeadersChange,
  onHeadersChange,
  onRemoveSecret,
  onUrlChange,
}: {
  bearerTokenEnvVar: string
  envHeaders: McpPair[]
  headers: McpPair[]
  url: string
  visibleSecrets: McpVisibleSecrets
  onBearerTokenEnvVarChange: McpStringSetter
  onEnvHeadersChange: (items: McpPair[]) => void
  onHeadersChange: (items: McpPair[]) => void
  onRemoveSecret: McpSecretRemover
  onUrlChange: McpStringSetter
}) {
  return (
    <>
      <McpTextField
        ariaLabel="MCP server URL"
        label="URL"
        value={url}
        onChange={onUrlChange}
        placeholder="https://mcp.example.com/mcp"
      />
      <McpTextField
        ariaLabel="MCP bearer token environment variable"
        label="Bearer token env var"
        value={bearerTokenEnvVar}
        onChange={onBearerTokenEnvVarChange}
        placeholder="MCP_BEARER_TOKEN"
      />
      <McpSavedSecretList
        label="Headers"
        secrets={visibleSecrets.headers}
        onRemove={onRemoveSecret}
      />
      <McpPairListEditor
        addLabel="Add header"
        items={headers}
        label={visibleSecrets.headers.length ? "Add headers" : "Headers"}
        leftPlaceholder="Key"
        rightPlaceholder="Value"
        secret
        onChange={onHeadersChange}
      />
      <McpSavedSecretList
        label="Headers from environment variables"
        secrets={visibleSecrets.envHeaders}
        onRemove={onRemoveSecret}
      />
      <McpPairListEditor
        addLabel="Add variable"
        items={envHeaders}
        label={
          visibleSecrets.envHeaders.length
            ? "Add headers from environment variables"
            : "Headers from environment variables"
        }
        leftPlaceholder="Header"
        rightPlaceholder="Env var"
        onChange={onEnvHeadersChange}
      />
    </>
  )
}
