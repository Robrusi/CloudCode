"use client"

import { useRef } from "react"

let mcpRowKeyCounter = 0

function nextMcpRowKey() {
  mcpRowKeyCounter += 1
  return `mcp-row-${mcpRowKeyCounter}`
}

export function useMcpRowKeys(count: number) {
  const rowKeysRef = useRef<string[]>([])
  while (rowKeysRef.current.length < count) {
    rowKeysRef.current.push(nextMcpRowKey())
  }
  rowKeysRef.current.length = count
  return rowKeysRef
}

export function appendMcpRowKey(rowKeysRef: { current: string[] }) {
  rowKeysRef.current.push(nextMcpRowKey())
}
