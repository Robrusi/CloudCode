import type { Id } from "@/convex/_generated/dataModel"

export type McpSecretRemover = (id: Id<"mcpServerSecrets">) => void
export type McpStringSetter = (value: string) => void
