"use client"

import { useCallback } from "react"

import type { SettingsSectionId } from "@/components/settings/sections"
import type { Id } from "@/convex/_generated/dataModel"

export function useChatNavigation({
  clearDraftAttachments,
  isMobile,
  persistDraftRepo,
  resetThreadWorkspace,
  setActiveId,
  setEditingRepo,
  setInput,
  setPromptFocused,
  setSettingsSection,
  setSidebarOpen,
  setView,
}: {
  clearDraftAttachments: () => void
  isMobile: boolean
  persistDraftRepo: (value: string) => void
  resetThreadWorkspace: () => void
  setActiveId: (value: Id<"threads"> | null) => void
  setEditingRepo: (value: boolean) => void
  setInput: (value: string) => void
  setPromptFocused: (value: boolean) => void
  setSettingsSection: (section: SettingsSectionId) => void
  setSidebarOpen: (value: boolean) => void
  setView: (value: "chat" | "settings" | "automations" | "reviews") => void
}) {
  const closeSidebarOnMobile = useCallback(() => {
    if (isMobile) setSidebarOpen(false)
  }, [isMobile, setSidebarOpen])

  const resetChatSurface = useCallback(() => {
    setInput("")
    clearDraftAttachments()
    setEditingRepo(false)
    resetThreadWorkspace()
    setView("chat")
    closeSidebarOnMobile()
  }, [
    clearDraftAttachments,
    closeSidebarOnMobile,
    resetThreadWorkspace,
    setEditingRepo,
    setInput,
    setView,
  ])

  const startNewChat = useCallback(() => {
    setPromptFocused(false)
    setActiveId(null)
    resetChatSurface()
  }, [resetChatSurface, setActiveId, setPromptFocused])

  const startNewChatInRepo = useCallback(
    (repoUrl: string) => {
      persistDraftRepo(repoUrl)
      startNewChat()
    },
    [persistDraftRepo, startNewChat]
  )

  const selectChat = useCallback(
    (id: Id<"threads">) => {
      setPromptFocused(false)
      setActiveId(id)
      resetChatSurface()
    },
    [resetChatSurface, setActiveId, setPromptFocused]
  )

  const showSettings = useCallback(
    (section?: SettingsSectionId) => {
      setPromptFocused(false)
      if (section) setSettingsSection(section)
      setView("settings")
      clearDraftAttachments()
      resetThreadWorkspace()
      closeSidebarOnMobile()
    },
    [
      clearDraftAttachments,
      closeSidebarOnMobile,
      resetThreadWorkspace,
      setPromptFocused,
      setSettingsSection,
      setView,
    ]
  )

  const showAutomations = useCallback(() => {
    setPromptFocused(false)
    setView("automations")
    clearDraftAttachments()
    resetThreadWorkspace()
    closeSidebarOnMobile()
  }, [
    clearDraftAttachments,
    closeSidebarOnMobile,
    resetThreadWorkspace,
    setPromptFocused,
    setView,
  ])

  const showReviews = useCallback(() => {
    setPromptFocused(false)
    setView("reviews")
    clearDraftAttachments()
    resetThreadWorkspace()
    closeSidebarOnMobile()
  }, [
    clearDraftAttachments,
    closeSidebarOnMobile,
    resetThreadWorkspace,
    setPromptFocused,
    setView,
  ])

  const exitSettings = useCallback(() => {
    setView("chat")
  }, [setView])

  const selectSettingsSection = useCallback(
    (section: SettingsSectionId) => {
      setSettingsSection(section)
      closeSidebarOnMobile()
    },
    [closeSidebarOnMobile, setSettingsSection]
  )

  return {
    exitSettings,
    selectChat,
    selectSettingsSection,
    showAutomations,
    showReviews,
    showSettings,
    startNewChat,
    startNewChatInRepo,
  }
}
