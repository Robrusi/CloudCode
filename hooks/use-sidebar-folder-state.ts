"use client"

import { useCallback, useState } from "react"

export type SidebarFolderState = { expanded: boolean; open: boolean }

const DEFAULT_FOLDER_STATE: SidebarFolderState = { expanded: false, open: true }

/** Persistent expansion state for the sidebar thread list — repo folder
 * collapse/preview state and factory-subtree expansion — owned above the row
 * components so it survives rows unmounting while a search/filter temporarily
 * removes them. Keyed by thread context, so chats and reviews folders and
 * subtrees collapse independently. */
export function useSidebarFolderState(
  context: "chats" | "automations" | "reviews"
) {
  const [stateByFolder, setStateByFolder] = useState<
    Record<string, SidebarFolderState>
  >({})
  const [openBySubtree, setOpenBySubtree] = useState<Record<string, boolean>>(
    {}
  )

  const folderState = useCallback(
    (repo: string) =>
      stateByFolder[`${context}:${repo}`] ?? DEFAULT_FOLDER_STATE,
    [context, stateByFolder]
  )

  const updateFolder = useCallback(
    (repo: string, patch: Partial<SidebarFolderState>) => {
      setStateByFolder((current) => {
        const key = `${context}:${repo}`
        return {
          ...current,
          [key]: { ...DEFAULT_FOLDER_STATE, ...current[key], ...patch },
        }
      })
    },
    [context]
  )

  const subtreeOpen = useCallback(
    (rootId: string) => openBySubtree[`${context}:${rootId}`] ?? true,
    [context, openBySubtree]
  )

  const setSubtreeOpen = useCallback(
    (rootId: string, open: boolean) => {
      setOpenBySubtree((current) => ({
        ...current,
        [`${context}:${rootId}`]: open,
      }))
    },
    [context]
  )

  return { folderState, setSubtreeOpen, subtreeOpen, updateFolder }
}
