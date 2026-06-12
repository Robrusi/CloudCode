"use client"

import { useState } from "react"

import {
  cleanMcpPairs,
  cleanMcpStringList,
  visibleMcpSecrets,
  type McpPair,
} from "@/components/settings/mcp-model"
import type { Id } from "@/convex/_generated/dataModel"
import { requestJson } from "@/lib/http/client-json"
import type { McpServerRecord } from "@/lib/mcp/server-types"

type UseMcpServerFormControllerParams = {
  onRemove?: () => void | Promise<void>
  onSaved: (serverId: Id<"mcpServers">) => void | Promise<void>
  server?: McpServerRecord
}

export function useMcpServerFormController({
  server,
  onSaved,
  onRemove,
}: UseMcpServerFormControllerParams) {
  const editing = Boolean(server)
  const [transport, setTransport] = useState<McpServerRecord["transport"]>(
    server?.transport ?? "stdio"
  )
  const [name, setName] = useState(server?.name ?? "")
  const [command, setCommand] = useState(server?.command ?? "")
  const [url, setUrl] = useState(server?.url ?? "")
  const [bearerTokenEnvVar, setBearerTokenEnvVar] = useState(
    server?.bearerTokenEnvVar ?? ""
  )
  const [cwd, setCwd] = useState(server?.cwd ?? "")
  const [args, setArgs] = useState<string[]>(server?.args ?? [])
  const [envVars, setEnvVars] = useState<McpPair[]>([])
  const [passthroughVars, setPassthroughVars] = useState<string[]>(
    server?.envVars ?? []
  )
  const [headers, setHeaders] = useState<McpPair[]>([])
  const [envHeaders, setEnvHeaders] = useState<McpPair[]>([])
  const [removeSecretIds, setRemoveSecretIds] = useState<
    Array<Id<"mcpServerSecrets">>
  >([])
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState("")

  const visibleSecrets = visibleMcpSecrets(server, removeSecretIds)

  function removeSavedSecret(id: Id<"mcpServerSecrets">) {
    setRemoveSecretIds((prev) => [...prev, id])
  }

  async function save() {
    setSaving(true)
    setError("")
    try {
      const data = await requestJson<{ serverId?: Id<"mcpServers"> }>(
        "/api/mcp/custom",
        editing ? "PATCH" : "POST",
        {
          args: cleanMcpStringList(args),
          bearerTokenEnvVar,
          command,
          cwd,
          envHttpHeaders: cleanMcpPairs(envHeaders),
          envVars: cleanMcpStringList(passthroughVars),
          httpHeaders: cleanMcpPairs(headers),
          name,
          secrets: cleanMcpPairs(envVars),
          transport,
          url,
          ...(editing && server
            ? { removeSecretIds, serverId: server.id }
            : {}),
        },
        {
          fallbackError: "Unable to save MCP server.",
        }
      )
      if (!data.serverId) {
        throw new Error("Unable to save MCP server.")
      }
      await onSaved(data.serverId)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to save MCP server."
      )
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!onRemove) return
    setRemoving(true)
    setError("")
    try {
      await onRemove()
    } catch (err) {
      setRemoving(false)
      setError(
        err instanceof Error ? err.message : "Unable to remove MCP server."
      )
    }
  }

  const canSave =
    !saving &&
    !removing &&
    Boolean(name.trim()) &&
    (transport === "stdio" ? Boolean(command.trim()) : Boolean(url.trim()))

  return {
    args,
    bearerTokenEnvVar,
    canSave,
    command,
    cwd,
    editing,
    envHeaders,
    envVars,
    error,
    headers,
    name,
    passthroughVars,
    remove,
    removeSavedSecret,
    removing,
    save,
    saving,
    setArgs,
    setBearerTokenEnvVar,
    setCommand,
    setCwd,
    setEnvHeaders,
    setEnvVars,
    setHeaders,
    setName,
    setPassthroughVars,
    setTransport,
    setUrl,
    transport,
    url,
    visibleSecrets,
  }
}
