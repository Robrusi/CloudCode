"use client"

import { useCallback, useState } from "react"

export type SidebarFolderState = { expanded: boolean; open: boolean }

const DEFAULT_FOLDER_STATE: SidebarFolderState = { expanded: false, open: true }

/** Persistent collapse and preview-expansion state for sidebar repo folders,
 * owned above the folder components so it survives a group unmounting while a
 * search/filter temporarily removes its repo from the list. Keyed by thread
 * context and repo, so chats and reviews folders collapse independently. */
export function useSidebarFolderState(
  context: "chats" | "automations" | "reviews"
) {
  const [stateByFolder, setStateByFolder] = useState<
    Record<string, SidebarFolderState>
  >({})

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

  return { folderState, updateFolder }
}
