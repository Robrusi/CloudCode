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
import { McpStringListEditor } from "@/components/settings/mcp-string-list-editor"
import { McpTextField } from "@/components/settings/mcp-text-field"

export function McpStdioFields({
  args,
  command,
  cwd,
  envVars,
  passthroughVars,
  visibleSecrets,
  onArgsChange,
  onCommandChange,
  onCwdChange,
  onEnvVarsChange,
  onPassthroughVarsChange,
  onRemoveSecret,
}: {
  args: string[]
  command: string
  cwd: string
  envVars: McpPair[]
  passthroughVars: string[]
  visibleSecrets: McpVisibleSecrets
  onArgsChange: (items: string[]) => void
  onCommandChange: McpStringSetter
  onCwdChange: McpStringSetter
  onEnvVarsChange: (items: McpPair[]) => void
  onPassthroughVarsChange: (items: string[]) => void
  onRemoveSecret: McpSecretRemover
}) {
  return (
    <>
      <McpTextField
        ariaLabel="MCP command to launch"
        label="Command to launch"
        value={command}
        onChange={onCommandChange}
        placeholder="openai-dev-mcp serve-sqlite"
      />

      <McpStringListEditor
        addLabel="Add argument"
        items={args}
        label="Arguments"
        placeholder="--project"
        onChange={onArgsChange}
      />

      <McpSavedSecretList
        label="Environment variables"
        secrets={visibleSecrets.env}
        onRemove={onRemoveSecret}
      />

      <McpPairListEditor
        addLabel="Add environment variable"
        items={envVars}
        label={
          visibleSecrets.env.length
            ? "Add environment variables"
            : "Environment variables"
        }
        leftPlaceholder="Key"
        rightPlaceholder="Value"
        secret
        onChange={onEnvVarsChange}
      />

      <McpStringListEditor
        addLabel="Add variable"
        items={passthroughVars}
        label="Environment variable passthrough"
        placeholder="GITHUB_TOKEN"
        onChange={onPassthroughVarsChange}
      />

      <McpTextField
        ariaLabel="MCP working directory"
        label="Working directory"
        value={cwd}
        onChange={onCwdChange}
        placeholder="~/code"
      />
    </>
  )
}
