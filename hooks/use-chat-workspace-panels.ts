"use client"

import { useCallback, useEffect, useState } from "react"

import type { FileBrowserOpenMode } from "@/components/files/browser"
import type { DaytonaUiTestRun } from "@/components/sandbox/ui-tests-model"
import { TERMINAL_OPEN_KEY } from "@/components/chat/storage"
import {
  readBrowserStorage,
  removeBrowserStorage,
  writeBrowserStorage,
} from "@/lib/browser/storage"

export type ChatToolPanelId = "context" | "desktop" | "files" | "github" | "ssh"

export type UiTestRunView = {
  run: DaytonaUiTestRun
  sandboxId: string | null
}

export function useChatWorkspacePanels() {
  const [filesOpen, setFilesOpen] = useState(false)
  const [githubOpen, setGithubOpen] = useState(false)
  const [desktopOpen, setDesktopOpen] = useState(false)
  const [sshOpen, setSshOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(
    () => readBrowserStorage(TERMINAL_OPEN_KEY) === "true"
  )
  const [terminalDockMounted, setTerminalDockMounted] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(380)
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null)
  const [activeFileMode, setActiveFileMode] =
    useState<FileBrowserOpenMode>("file")
  const [activeFileDiff, setActiveFileDiff] = useState<string | null>(null)
  const [allDiffsOpen, setAllDiffsOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [uiTestRun, setUiTestRun] = useState<UiTestRunView | null>(null)
  const [diffStyle, setDiffStyle] = useState<"unified" | "split">("unified")

  useEffect(() => {
    if (terminalOpen) writeBrowserStorage(TERMINAL_OPEN_KEY, "true")
    else removeBrowserStorage(TERMINAL_OPEN_KEY)
  }, [terminalOpen])

  const closeToolPanels = useCallback((except?: ChatToolPanelId) => {
    if (except !== "files") setFilesOpen(false)
    if (except !== "github") setGithubOpen(false)
    if (except !== "desktop") setDesktopOpen(false)
    if (except !== "ssh") setSshOpen(false)
    if (except !== "context") setContextOpen(false)
  }, [])

  const resetThreadWorkspace = useCallback(() => {
    setActiveFilePath(null)
    closeToolPanels()
    setNotesOpen(false)
    setUiTestRun(null)
    setTerminalOpen(false)
  }, [closeToolPanels])

  const resetActiveThreadScroll = useCallback(() => {
    setActiveFileDiff(null)
  }, [])

  const closeFileEditor = useCallback(() => {
    setActiveFilePath(null)
    setActiveFileDiff(null)
  }, [])

  const openFilePanel = useCallback(
    (path: string, mode: FileBrowserOpenMode, diff: string | null = null) => {
      setActiveFilePath(path)
      setActiveFileMode(mode)
      setActiveFileDiff(diff)
      setAllDiffsOpen(false)
      setNotesOpen(false)
      setUiTestRun(null)
    },
    []
  )

  const openAllDiffsPanel = useCallback(() => {
    setActiveFilePath(null)
    setActiveFileDiff(null)
    setAllDiffsOpen(true)
    setNotesOpen(false)
    setUiTestRun(null)
  }, [])

  const openNotesPanel = useCallback(
    ({ closeContext = false }: { closeContext?: boolean } = {}) => {
      setActiveFilePath(null)
      setActiveFileDiff(null)
      setAllDiffsOpen(false)
      setNotesOpen(true)
      setUiTestRun(null)
      if (closeContext) setContextOpen(false)
    },
    []
  )

  const openUiTestRunPanel = useCallback((view: UiTestRunView) => {
    setActiveFilePath(null)
    setActiveFileDiff(null)
    setAllDiffsOpen(false)
    setNotesOpen(false)
    setUiTestRun(view)
  }, [])

  const closeUiTestRunPanel = useCallback(() => {
    setUiTestRun(null)
  }, [])

  const markTerminalDockMounted = useCallback(() => {
    setTerminalDockMounted(true)
  }, [])

  const toggleToolPanel = useCallback(
    (panel: ChatToolPanelId) => {
      const toggle = {
        context: setContextOpen,
        desktop: setDesktopOpen,
        files: setFilesOpen,
        github: setGithubOpen,
        ssh: setSshOpen,
      }[panel]

      toggle((open) => {
        if (!open) closeToolPanels(panel)
        return !open
      })
    },
    [closeToolPanels]
  )

  return {
    activeFileDiff,
    activeFileMode,
    activeFilePath,
    allDiffsOpen,
    closeFileEditor,
    closeToolPanels,
    closeUiTestRunPanel,
    contextOpen,
    desktopOpen,
    diffStyle,
    filesOpen,
    githubOpen,
    markTerminalDockMounted,
    notesOpen,
    openAllDiffsPanel,
    openFilePanel,
    openNotesPanel,
    openUiTestRunPanel,
    resetActiveThreadScroll,
    resetThreadWorkspace,
    setActiveFileMode,
    setActiveFilePath,
    setAllDiffsOpen,
    setContextOpen,
    setDesktopOpen,
    setDiffStyle,
    setFilesOpen,
    setGithubOpen,
    setNotesOpen,
    setSshOpen,
    setTerminalHeight,
    setTerminalOpen,
    sshOpen,
    terminalDockMounted,
    terminalHeight,
    terminalOpen,
    toggleToolPanel,
    uiTestRun,
  }
}
