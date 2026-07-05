"use client"

import { useUser } from "@clerk/nextjs"
import { useCallback, useEffect, useMemo, useState } from "react"

import type { ChatComposerProps } from "@/components/chat/composer"
import type { Id } from "@/convex/_generated/dataModel"
import { repoLabel } from "@/components/chat/format"
import type { ChatShellProps } from "@/components/chat/shell"
import type { DaytonaUiTestRun } from "@/components/sandbox/ui-tests-model"
import { useChatThreadScroll } from "@/components/chat/thread-scroll"
import {
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from "@/components/settings/sections"
import { useChatConnectionStatus } from "@/hooks/use-chat-connection-status"
import { useChatComposerActions } from "@/hooks/use-chat-composer-actions"
import { useChatComposerLayout } from "@/hooks/use-chat-composer-layout"
import { useChatDiffState } from "@/hooks/use-chat-diff-state"
import { useChatDraftSettings } from "@/hooks/use-chat-draft-settings"
import { useChatDraftAttachments } from "@/hooks/use-chat-draft-attachments"
import { useChatNavigation } from "@/hooks/use-chat-navigation"
import { useChatOnboarding } from "@/hooks/use-chat-onboarding"
import { useChatPanelActions } from "@/hooks/use-chat-panel-actions"
import { useChatRecords } from "@/hooks/use-chat-records"
import { useChatRunActions } from "@/hooks/use-chat-run-actions"
import { useChatRunBookkeeping } from "@/hooks/use-chat-run-bookkeeping"
import { useChatSandboxActions } from "@/hooks/use-chat-sandbox-actions"
import { useChatRunViewState } from "@/hooks/use-chat-run-view-state"
import { useChatThreadActions } from "@/hooks/use-chat-thread-actions"
import { useChatThreadNotes } from "@/hooks/use-chat-thread-notes"
import { useChatWorkspacePanels } from "@/hooks/use-chat-workspace-panels"
import { MOBILE_MEDIA_QUERY, useIsMobile } from "@/hooks/use-is-mobile"
import { useStoreUserEffect } from "@/hooks/use-store-user-effect"
import type { BranchMode, Speed, Thinking } from "@/lib/chat/options"

const DEFAULT_COMPOSER_HEIGHT = 144
const THREAD_BOTTOM_CLEARANCE = 32

export function useChatController(): ChatShellProps {
  const { user } = useUser()
  const { isLoading: userLoading } = useStoreUserEffect()
  const {
    activeId,
    activeReviewName,
    activeRunKey,
    activeThreadLoading,
    beginComposerLaunch,
    composerLaunchToken,
    appendRunMessages,
    autoSandboxPreset,
    chats,
    clearSandbox,
    completeAssistantMessage,
    createThread,
    defaultSandboxPreset,
    deleteThreadMutation,
    dismissOnboardingMutation,
    ensureDefaultPresets,
    hideThread,
    liveRun,
    presetsLoaded,
    promoteDraftToThread,
    restoreThread,
    sandboxPresets,
    saveRunState,
    setActiveId,
    setThreadNotes,
    threadViewKey,
    updateThread,
    viewer,
  } = useChatRecords()
  const [input, setInput] = useState("")
  const {
    draftBaseBranch,
    draftBranchMode,
    draftBranchName,
    draftModel,
    draftRepo,
    draftSpeed,
    draftThinking,
    effectiveDraftSandboxPresetId,
    persistDraftBaseBranch,
    persistDraftBranchMode,
    persistDraftBranchName,
    persistDraftModel,
    persistDraftRepo,
    persistDraftSandboxPreset,
    persistDraftSpeed,
    persistDraftThinking,
    storeModelPreference,
  } = useChatDraftSettings({
    autoSandboxPreset,
    defaultSandboxPreset,
    presetsLoaded,
    sandboxPresets,
  })
  const [branchTargetOpen, setBranchTargetOpen] = useState(false)
  const [editingRepo, setEditingRepo] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [presetOpen, setPresetOpen] = useState(false)
  const [thinkingOpen, setThinkingOpen] = useState(false)
  const {
    activeFileDiff,
    activeFileMode,
    activeFilePath,
    allDiffsOpen,
    closeFileEditor,
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
  } = useChatWorkspacePanels()
  const {
    addImageFiles,
    appendReadyDraftAttachments,
    attachmentDragActive,
    attachmentError,
    clearDraftAttachments,
    draftAttachments,
    failedAttachmentCount,
    fileInputRef,
    openAttachmentPicker,
    readyDraftAttachments,
    removeDraftAttachment,
    setAttachmentDragActive,
    setAttachmentError,
    uploadingAttachmentCount,
  } = useChatDraftAttachments()
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window === "undefined"
      ? true
      : !window.matchMedia(MOBILE_MEDIA_QUERY).matches
  )
  const isMobile = useIsMobile()
  const [view, setView] = useState<
    "chat" | "settings" | "automations" | "reviews"
  >(() => {
    if (typeof window === "undefined") return "chat"
    const requested = new URLSearchParams(window.location.search).get("view")
    return requested === "settings" ||
      requested === "automations" ||
      requested === "reviews"
      ? requested
      : "chat"
  })
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>(
    () => {
      if (typeof window === "undefined") return "connections"
      const section = new URLSearchParams(window.location.search).get("section")
      return SETTINGS_SECTIONS.some((entry) => entry.id === section)
        ? (section as SettingsSectionId)
        : "connections"
    }
  )
  const {
    authError,
    authStatus,
    githubAuthError,
    githubStatus,
    refreshCodexAuth,
    refreshGitHubAuth,
  } = useChatConnectionStatus(userLoading)
  const {
    cancelRequestedThreadIds,
    clearInactiveRunKeys,
    clearOptimisticRun,
    clearRunKey,
    clearSettledOptimisticRuns,
    liveRunStates,
    markRunActive,
    mergeThreadRunState,
    optimisticRuns,
    queueingRunKeys,
    removeThreadRunState,
    runningRunKeys,
    runningRunKeysSet,
    showOptimisticRun,
    threadRunStateRef,
    transferRunKey,
  } = useChatRunBookkeeping()
  const {
    active,
    activeFileCacheScope,
    activeRunPending,
    activeSandboxId,
    activeSandboxState,
    canStopActiveRun,
    empty,
    messages,
    sidebarChats,
    threadContentVersion,
    visibleLiveRun,
  } = useChatRunViewState({
    activeId,
    activeRunKey,
    activeThreadLoading,
    chats,
    liveRun,
    liveRunStates,
    optimisticRuns,
    runningRunKeys,
  })
  const terminalVisible =
    terminalOpen && (Boolean(activeSandboxId) || activeRunPending)
  const repoUrl = active ? active.repoUrl : draftRepo
  const baseBranch = active ? (active.baseBranch ?? "") : draftBaseBranch
  const model = active ? active.model : draftModel
  const effectiveDraftBranchMode: BranchMode =
    draftBranchMode === "custom" && !draftBranchName.trim()
      ? "auto"
      : draftBranchMode
  const sandboxPresetId = active
    ? active.sandboxPresetId
    : effectiveDraftSandboxPresetId
  // Session-local per-thread picks. An open thread must reflect what IT runs
  // with, not the new-chat draft — an automation chat set to "medium" must not
  // read as the draft's "high".
  const [threadRunSettings, setThreadRunSettings] = useState<
    Record<string, { speed?: Speed; thinking?: Thinking }>
  >({})
  // What the thread last actually ran with; every run stamps speed/thinking
  // onto its assistant message (chat sends and automation dispatches alike).
  const lastRunSettings = useMemo(() => {
    const threadMessages = active?.messages
    if (!threadMessages) return undefined
    for (let index = threadMessages.length - 1; index >= 0; index -= 1) {
      const message = threadMessages[index]
      if (message.speed || message.thinking) {
        return { speed: message.speed, thinking: message.thinking }
      }
    }
    return undefined
  }, [active?.messages])
  const activeRunSettings = active
    ? threadRunSettings[active.id as string]
    : undefined
  const speed = active
    ? (activeRunSettings?.speed ?? lastRunSettings?.speed ?? draftSpeed)
    : draftSpeed
  const thinking = active
    ? (activeRunSettings?.thinking ??
      lastRunSettings?.thinking ??
      draftThinking)
    : draftThinking
  const { composerHeight, composerRef, focusComposer, textareaRef } =
    useChatComposerLayout({
      defaultComposerHeight: DEFAULT_COMPOSER_HEIGHT,
      input,
      isMobile,
      measureComposer: terminalVisible,
      measureVersion: `${activeFilePath ?? ""}:${empty ? 1 : 0}`,
    })
  const threadBottomInset =
    THREAD_BOTTOM_CLEARANCE +
    (terminalVisible
      ? Math.max(composerHeight, DEFAULT_COMPOSER_HEIGHT) + terminalHeight
      : 0)

  useEffect(() => {
    if (terminalVisible) markTerminalDockMounted()
  }, [markTerminalDockMounted, terminalVisible])

  const {
    codexConnected,
    dismissOnboarding,
    githubAppReady,
    githubConnected,
    githubUserReady,
    showOnboarding,
  } = useChatOnboarding({
    authStatus,
    dismissOnboarding: dismissOnboardingMutation,
    githubStatus,
    viewer,
  })
  const threadScrollable = !isMobile || !empty || showOnboarding
  const {
    captureThreadScrollForPanel,
    onThreadScroll,
    scrollToLatest,
    setPromptFocused,
    setThreadElement,
    showNewActivity,
  } = useChatThreadScroll({
    activeRunKey,
    empty,
    isMobile,
    onActiveThreadReset: resetActiveThreadScroll,
    threadBottomInset,
    threadContentVersion,
  })
  const {
    exitSettings,
    selectChat,
    selectSettingsSection,
    showAutomations,
    showReviews,
    showSettings,
    startNewChat,
    startNewChatInRepo,
  } = useChatNavigation({
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
  })
  const {
    activeQueuedMessages,
    cancelCodexRun,
    clearQueuedMessages,
    editQueuedMessage,
    removeQueuedMessage,
    send,
    steerQueuedMessage,
    stopActiveRun,
  } = useChatRunActions({
    active,
    activeId,
    activeRunKey,
    activeRunPending,
    activeSandboxId,
    appendReadyDraftAttachments,
    appendRunMessages,
    authStatus,
    beginComposerLaunch,
    cancelRequestedThreadIds,
    clearDraftAttachments,
    clearOptimisticRun,
    clearRunKey,
    completeAssistantMessage,
    createThread,
    draftBaseBranch,
    draftBranchName,
    draftModel,
    draftSpeed,
    draftThinking,
    effectiveDraftBranchMode,
    effectiveDraftSandboxPresetId,
    failedAttachmentCount,
    focusComposer,
    markRunActive,
    mergeThreadRunState,
    model,
    onAuthRequired: () => showSettings("connections"),
    promoteDraftToThread,
    queueingRunKeys,
    readyDraftAttachments,
    repoUrl,
    runningRunKeysSet,
    saveRunState,
    setAttachmentError,
    setEditingRepo,
    setInput,
    setTerminalOpen,
    showOptimisticRun,
    speed,
    thinking,
    threadRunStateRef,
    transferRunKey,
    uploadingAttachmentCount,
    userLoading,
  })
  const {
    cancelDeleteActiveSandbox,
    clearResumeBillingNotice,
    confirmDeleteActiveSandbox,
    handleSandboxMissing,
    handleSandboxStateChange,
    pauseActiveSandbox,
    pendingSandboxDelete,
    requestDeleteActiveSandbox,
    resumeActiveSandbox,
    resumeBillingNotice,
    sandboxAction,
  } = useChatSandboxActions({
    active,
    activeRunPending,
    activeSandboxId,
    cancelCodexRun,
    clearRunKey,
    clearSandbox,
    mergeThreadRunState,
    removeThreadRunState,
    saveRunState,
    setActiveFilePath,
    setDesktopOpen,
    setFilesOpen,
    setGithubOpen,
    setSshOpen,
    setTerminalOpen,
    threadRunStateRef,
  })
  const {
    cancelDeleteChat,
    confirmDeleteChat,
    deleteBusy,
    deleteError,
    pendingDeleteDisplayTitle,
    pendingDeleteId,
    renameChat,
    requestDeleteChat,
  } = useChatThreadActions({
    activeId,
    cancelCodexRun,
    chats,
    clearQueuedMessages,
    clearRunKey,
    deleteThread: deleteThreadMutation,
    hideThread,
    removeThreadRunState,
    restoreThread,
    setActiveFilePath,
    setActiveId,
    setDesktopOpen,
    setFilesOpen,
    setGithubOpen,
    setSshOpen,
    setTerminalOpen,
    threadRunStateRef,
    updateThreadTitle: updateThread,
  })
  const {
    onAttachmentInputChange,
    onBaseBranchChange,
    onBranchModeChange,
    onBranchNameChange,
    onComposerDragLeave,
    onComposerDragOver,
    onComposerDrop,
    onComposerPaste,
    onKeyDown,
    onModelSelect,
    onRepoChange,
    onSandboxPresetSelect,
    onSpeedSelect: onDraftSpeedSelect,
    onSubmit,
    onTextareaBlur,
    onTextareaFocus,
    onThinkingSelect: onDraftThinkingSelect,
  } = useChatComposerActions({
    activeThreadId: active?.id ?? null,
    addImageFiles,
    input,
    isMobile,
    persistDraftBaseBranch,
    persistDraftBranchMode,
    persistDraftBranchName,
    persistDraftModel,
    persistDraftRepo,
    persistDraftSandboxPreset,
    persistDraftSpeed,
    persistDraftThinking,
    send,
    setAttachmentDragActive,
    setPromptFocused,
    storeModelPreference,
    updateThread,
  })
  // Inside a thread the pill adjusts that thread's next runs only; the
  // new-chat draft (and its persisted preference) is untouched.
  const activeThreadKey = active ? (active.id as string) : null
  const onSpeedSelect = useCallback(
    (value: Speed) => {
      if (!activeThreadKey) {
        onDraftSpeedSelect(value)
        return
      }
      setThreadRunSettings((current) => ({
        ...current,
        [activeThreadKey]: { ...current[activeThreadKey], speed: value },
      }))
    },
    [activeThreadKey, onDraftSpeedSelect]
  )
  const onThinkingSelect = useCallback(
    (value: Thinking) => {
      if (!activeThreadKey) {
        onDraftThinkingSelect(value)
        return
      }
      setThreadRunSettings((current) => ({
        ...current,
        [activeThreadKey]: { ...current[activeThreadKey], thinking: value },
      }))
    },
    [activeThreadKey, onDraftThinkingSelect]
  )
  const { activeBranch, activeDiff, changeStats, editorDiff } =
    useChatDiffState({
      active,
      activeFileCacheScope,
      activeFileDiff,
      activeSandboxId,
    })
  const activeRepoLabel = repoLabel(repoUrl)
  const activeRepoName = activeRepoLabel.split("/").pop() || null
  const userName =
    user?.firstName ??
    user?.fullName ??
    user?.primaryEmailAddress?.emailAddress?.split("@")[0]
  const userFirstName = userName?.trim().split(/\s+/)[0] || null
  const emptyPromptTitle = userFirstName
    ? `What are we building, ${userFirstName}?`
    : "What are we building?"
  const {
    openAllDiffs,
    openFile,
    openFileDiff,
    openFileFromToolPanel,
    openNotesFullscreen,
    preloadTerminalPanel,
    toggleTerminal,
  } = useChatPanelActions({
    captureThreadScrollForPanel,
    isMobile,
    openAllDiffsPanel,
    openFilePanel,
    openNotesPanel,
    setTerminalOpen,
  })
  const saveThreadNotes = useChatThreadNotes({ activeId, setThreadNotes })

  const openUiTestRun = useCallback(
    (run: DaytonaUiTestRun) => {
      captureThreadScrollForPanel()
      openUiTestRunPanel({ run, sandboxId: activeSandboxId })
      // On mobile the desktop panel overlays the main area; close it so the
      // report is actually visible.
      if (isMobile) setDesktopOpen(false)
    },
    [
      activeSandboxId,
      captureThreadScrollForPanel,
      isMobile,
      openUiTestRunPanel,
      setDesktopOpen,
    ]
  )

  useEffect(() => {
    if (userLoading) return
    void ensureDefaultPresets().catch((error) => {
      console.warn("Unable to ensure default presets.", error)
    })
  }, [ensureDefaultPresets, userLoading])

  useEffect(() => {
    clearSettledOptimisticRuns(chats)
  }, [chats, clearSettledOptimisticRuns])

  useEffect(() => {
    const liveThreadKey = visibleLiveRun?.threadId as string | undefined
    clearInactiveRunKeys(chats, liveThreadKey)
  }, [chats, clearInactiveRunKeys, runningRunKeys, visibleLiveRun?.threadId])

  const composerEnabled =
    view === "chat" && !activeFilePath && !notesOpen && !uiTestRun
  const composerProps: ChatComposerProps = {
    activeQueuedMessages,
    activeRunPending,
    activeThreadKey: activeId ? (activeId as string) : null,
    attachmentDragActive,
    attachmentError,
    baseBranch,
    branchTargetOpen,
    canStopActiveRun,
    draftAttachments,
    draftBranchMode,
    draftBranchName,
    editingRepo,
    fileInputRef,
    hasActiveChat: Boolean(active),
    input,
    isMobile,
    model,
    modelOpen,
    onAttachmentInputChange,
    onBaseBranchChange,
    onBranchModeChange,
    onBranchNameChange,
    onComposerDragLeave,
    onComposerDragOver,
    onComposerDrop,
    onComposerPaste,
    onEditQueuedMessage: editQueuedMessage,
    onInputChange: setInput,
    onKeyDown,
    onModelSelect,
    onOpenAttachmentPicker: openAttachmentPicker,
    onRemoveDraftAttachment: removeDraftAttachment,
    onRemoveQueuedMessage: removeQueuedMessage,
    onRepoChange,
    onSandboxPresetSelect,
    onSpeedSelect,
    onSteerQueuedMessage: steerQueuedMessage,
    onStopActiveRun: stopActiveRun,
    onSubmit,
    onTextareaBlur,
    onTextareaFocus,
    onThinkingSelect,
    presetOpen,
    readyAttachmentCount: readyDraftAttachments.length,
    repoUrl,
    sandboxPresetId: sandboxPresetId ?? "",
    sandboxPresets,
    setBranchTargetOpen,
    setEditingRepo,
    setModelOpen,
    setPresetOpen,
    setThinkingOpen,
    speed,
    textareaRef,
    thinking,
    thinkingOpen,
    uploadingAttachmentCount,
  }

  // Automation and review threads live in their own sidebar contexts. Normal
  // chat views list regular chats only; opening an automation/review thread
  // still renders as chat but keeps the matching sidebar context active.
  // Factory-dispatched threads carry no automation/review tag themselves and
  // follow their root thread's context so they nest under it in the sidebar.
  const contextAnchorFor = useCallback(
    (chat: {
      automationId?: Id<"automations">
      factoryRootThreadId?: Id<"threads">
      reviewId?: Id<"reviews">
    }) => {
      if (!chat.factoryRootThreadId) return chat
      return (
        sidebarChats.find((entry) => entry.id === chat.factoryRootThreadId) ??
        chat
      )
    },
    [sidebarChats]
  )
  const activeAnchor = active ? contextAnchorFor(active) : null
  const sidebarThreadContext =
    view === "automations" ||
    (view === "chat" && Boolean(activeAnchor?.automationId))
      ? "automations"
      : view === "reviews" ||
          (view === "chat" && Boolean(activeAnchor?.reviewId))
        ? "reviews"
        : "chats"
  const visibleSidebarChats = useMemo(() => {
    return sidebarChats.filter((chat) => {
      const anchor = contextAnchorFor(chat)
      switch (sidebarThreadContext) {
        case "automations":
          return Boolean(anchor.automationId)
        case "reviews":
          return Boolean(anchor.reviewId)
        default:
          return !anchor.automationId && !anchor.reviewId
      }
    })
  }, [contextAnchorFor, sidebarChats, sidebarThreadContext])

  return {
    dialogs: {
      deleteBusy,
      deleteError,
      onCancelDeleteChat: cancelDeleteChat,
      onCancelDeleteSandbox: cancelDeleteActiveSandbox,
      onClearResumeBillingNotice: clearResumeBillingNotice,
      onConfirmDeleteChat: confirmDeleteChat,
      onConfirmDeleteSandbox: confirmDeleteActiveSandbox,
      onOpenBillingSettings: () => showSettings("billing"),
      pendingDeleteDisplayTitle,
      pendingDeleteId,
      pendingSandboxDelete,
      resumeBillingNotice,
    },
    main: {
      automations: {
        defaultRepoUrl: draftRepo,
        onOpenThread: selectChat,
      },
      reviews: {
        defaultRepoUrl: draftRepo,
        onOpenThread: selectChat,
      },
      composer: {
        enabled: composerEnabled,
        props: composerProps,
        ref: composerRef,
      },
      settings: {
        authError,
        authStatus,
        githubAuthError,
        githubStatus,
        onCodexAuthChanged: refreshCodexAuth,
        onGitHubAuthChanged: refreshGitHubAuth,
        sandboxPresets,
        section: settingsSection,
      },
      terminal: {
        height: terminalHeight,
        mounted: terminalDockMounted,
        onClose: () => setTerminalOpen(false),
        onHeightChange: setTerminalHeight,
        sandboxId: activeSandboxId,
        visible: terminalVisible,
      },
      thread: {
        activeRepoName,
        activeSandboxId,
        bottomInset: threadBottomInset,
        codexConnected,
        composerLaunchToken,
        empty,
        emptyPromptTitle,
        githubAppReady,
        githubConnected,
        githubUserReady,
        messages,
        onCodexAuthChanged: refreshCodexAuth,
        onDismissOnboarding: dismissOnboarding,
        onOpenFile: openFile,
        onOpenFileDiff: openFileDiff,
        onScroll: onThreadScroll,
        onScrollToLatest: scrollToLatest,
        reviewPromptLabel: active?.reviewId
          ? (activeReviewName ?? "Review prompt")
          : null,
        scrollable: threadScrollable,
        setElement: setThreadElement,
        showNewActivity,
        showOnboarding,
        threadViewKey,
        userFirstName,
      },
      view,
      workspace: {
        activeDiff,
        activeFileCacheScope,
        activeFileMode,
        activeFilePath,
        activeSandboxId,
        allDiffsOpen,
        diffStyle,
        editorDiff,
        notes: active?.notes ?? "",
        notesOpen,
        notesThreadId: activeId as string | null,
        onActiveFileModeChange: setActiveFileMode,
        onCloseAllDiffs: () => setAllDiffsOpen(false),
        onCloseFileEditor: closeFileEditor,
        onCloseNotes: () => setNotesOpen(false),
        onCloseUiTestRun: closeUiTestRunPanel,
        onOpenFile: openFile,
        onSaveNotes: saveThreadNotes,
        uiTestRun,
      },
    },
    sidebar: {
      open: sidebarOpen,
      props: {
        activeId,
        chats: visibleSidebarChats,
        currentView: view,
        onClose: () => setSidebarOpen(false),
        onDelete: requestDeleteChat,
        onExitSettings: exitSettings,
        onNewChat: startNewChat,
        onNewChatInRepo: startNewChatInRepo,
        onRename: renameChat,
        onSelect: selectChat,
        onSelectSettingsSection: selectSettingsSection,
        onShowAutomations: showAutomations,
        onShowReviews: showReviews,
        onShowSettings: () => showSettings(),
        sidebarThreadContext,
        settingsSection,
      },
    },
    sidePanels: {
      active: Boolean(active),
      activeBranch,
      activeDiff,
      activeFileCacheScope,
      activeFileMode,
      activeFilePath,
      activeRepoName,
      activeSandboxId,
      baseBranch,
      changeStats,
      contextOpen,
      desktopOpen,
      diffStyle,
      filesOpen,
      githubConnected: Boolean(githubStatus?.connected),
      githubOpen,
      notes: active?.notes ?? "",
      notesThreadId: activeId as string | null,
      onCloseContext: () => setContextOpen(false),
      onCloseDesktop: () => setDesktopOpen(false),
      onCloseSsh: () => setSshOpen(false),
      onCloseUiTestRun: closeUiTestRunPanel,
      onDiffStyleChange: setDiffStyle,
      onFilesOpenChange: setFilesOpen,
      onGithubOpenChange: setGithubOpen,
      onOpenAllDiffs: openAllDiffs,
      onOpenFileFromToolPanel: openFileFromToolPanel,
      onOpenNotesFullscreen: openNotesFullscreen,
      onOpenUiTestRun: openUiTestRun,
      onSaveNotes: saveThreadNotes,
      repoUrl,
      sshOpen,
      uiTestRun,
    },
    topBar: {
      identity: {
        isNew: view === "chat" && !active,
        repoUrl: view === "chat" ? repoUrl : "",
        title:
          view === "settings"
            ? "Settings"
            : view === "automations"
              ? "Automations"
              : view === "reviews"
                ? "Review"
                : (active?.title ?? null),
      },
      sandbox: {
        action: sandboxAction,
        id: view === "chat" ? activeSandboxId : null,
        onDelete: requestDeleteActiveSandbox,
        onMissing: handleSandboxMissing,
        onPause: pauseActiveSandbox,
        onResume: resumeActiveSandbox,
        onStateChange: handleSandboxStateChange,
        pending: view === "chat" && activeRunPending,
        showControls:
          view === "chat" &&
          (Boolean(active) || activeRunPending || Boolean(activeSandboxId)),
        state: activeSandboxState,
      },
      sidebar: {
        onToggle: () => setSidebarOpen((value) => !value),
        open: sidebarOpen,
      },
      tools: {
        context: {
          canOpen: view === "chat" && Boolean(active),
          onToggle: () => toggleToolPanel("context"),
          open: contextOpen,
        },
        desktop: {
          canOpen: view === "chat" && Boolean(activeSandboxId),
          onToggle: () => toggleToolPanel("desktop"),
          open: desktopOpen,
        },
        files: {
          canOpen: view === "chat" && Boolean(activeFileCacheScope),
          onToggle: () => toggleToolPanel("files"),
          open: filesOpen,
        },
        github: {
          canOpen: view === "chat" && Boolean(activeSandboxId),
          onToggle: () => toggleToolPanel("github"),
          open: githubOpen,
        },
        ssh: {
          canOpen: view === "chat" && Boolean(activeSandboxId),
          onToggle: () => toggleToolPanel("ssh"),
          open: sshOpen,
        },
        terminal: {
          canOpen: view === "chat" && Boolean(activeSandboxId),
          onPreload: preloadTerminalPanel,
          onToggle: toggleTerminal,
          open: terminalVisible,
        },
      },
    },
  }
}
