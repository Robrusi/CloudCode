import { objectRecord, stringValue } from "@/lib/shared/unknown-values"

export type McpDiscoveredTool = {
  description?: string
  name: string
  title?: string
}

export type McpDiscoveredServer = {
  name: string
  tools: McpDiscoveredTool[]
}

function toolDescription(value: unknown) {
  const record = objectRecord(value)
  return stringValue(record?.description)
}

function toolTitle(value: unknown) {
  const record = objectRecord(value)
  return stringValue(record?.title)
}

function discoveredToolsFromValue(value: unknown): McpDiscoveredTool[] {
  const tools = objectRecord(value)
  if (tools) {
    return Object.entries(tools).flatMap(([name, tool]) => {
      const trimmed = name.trim()
      if (!trimmed) return []
      const description = toolDescription(tool)
      const title = toolTitle(tool)
      return [
        {
          ...(description ? { description } : {}),
          name: trimmed,
          ...(title ? { title } : {}),
        },
      ]
    })
  }

  if (Array.isArray(value)) {
    return value.flatMap((tool) => {
      const record = objectRecord(tool)
      const name = stringValue(record?.name)
      if (!name) return []
      const description = stringValue(record?.description)
      const title = stringValue(record?.title)
      return [
        {
          ...(description ? { description } : {}),
          name,
          ...(title ? { title } : {}),
        },
      ]
    })
  }

  return []
}

export function discoveredMcpServersFromStatus(
  status: unknown
): McpDiscoveredServer[] {
  const record = objectRecord(status)
  const data = Array.isArray(record?.data) ? record.data : []

  return data.flatMap((server) => {
    const serverRecord = objectRecord(server)
    const name = stringValue(serverRecord?.name)
    if (!name) return []

    const tools = discoveredToolsFromValue(serverRecord?.tools)
    if (!tools.length) return []

    return [{ name, tools }]
  })
}
