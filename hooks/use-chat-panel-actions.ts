"use client"

import { useCallback, type Dispatch, type SetStateAction } from "react"

import {
  loadGithubPanel,
  loadSandboxTerminalPanel,
} from "@/components/chat/lazy-panels"
import type { FileBrowserOpenMode } from "@/components/files/browser"

type OpenFilePanel = (
  path: string,
  mode: FileBrowserOpenMode,
  diff?: string | null
) => void

type OpenNotesPanel = (options?: { closeContext?: boolean }) => void

export function useChatPanelActions({
  captureThreadScrollForPanel,
  isMobile,
  openAllDiffsPanel,
  openFilePanel,
  openNotesPanel,
  setTerminalOpen,
}: {
  captureThreadScrollForPanel: () => void
  isMobile: boolean
  openAllDiffsPanel: () => void
  openFilePanel: OpenFilePanel
  openNotesPanel: OpenNotesPanel
  setTerminalOpen: Dispatch<SetStateAction<boolean>>
}) {
  const openFile = useCallback(
    (path: string) => {
      captureThreadScrollForPanel()
      openFilePanel(path, "file")
    },
    [captureThreadScrollForPanel, openFilePanel]
  )

  const openFileDiff = useCallback(
    (path: string, diff: string) => {
      captureThreadScrollForPanel()
      openFilePanel(path, "diff", diff)
    },
    [captureThreadScrollForPanel, openFilePanel]
  )

  const openAllDiffs = useCallback(() => {
    captureThreadScrollForPanel()
    openAllDiffsPanel()
  }, [captureThreadScrollForPanel, openAllDiffsPanel])

  const openNotesFullscreen = useCallback(() => {
    captureThreadScrollForPanel()
    openNotesPanel({ closeContext: true })
  }, [captureThreadScrollForPanel, openNotesPanel])

  const openFileFromToolPanel = useCallback(
    (
      path: string,
      mode: FileBrowserOpenMode,
      closePanel: (open: boolean) => void
    ) => {
      captureThreadScrollForPanel()
      openFilePanel(path, mode)
      if (isMobile) closePanel(false)
    },
    [captureThreadScrollForPanel, isMobile, openFilePanel]
  )

  const preloadTerminalPanel = useCallback(() => {
    void loadSandboxTerminalPanel()
  }, [])

  const preloadGithubPanel = useCallback(() => {
    void loadGithubPanel()
  }, [])

  const toggleTerminal = useCallback(() => {
    void loadSandboxTerminalPanel()
    setTerminalOpen((value) => !value)
  }, [setTerminalOpen])

  return {
    openAllDiffs,
    openFile,
    openFileDiff,
    openFileFromToolPanel,
    openNotesFullscreen,
    preloadGithubPanel,
    preloadTerminalPanel,
    toggleTerminal,
  }
}
