"use client"

import { useUser } from "@clerk/nextjs"
import { useEffect, useState } from "react"

import type { ChatComposerProps } from "@/components/chat/composer"
import { repoLabel } from "@/components/chat/format"
import type { ChatShellProps } from "@/components/chat/shell"
import { useChatThreadScroll } from "@/components/chat/thread-scroll"
import type { SettingsSectionId } from "@/components/settings/sections"
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
import type { BranchMode } from "@/lib/chat/options"

const DEFAULT_COMPOSER_HEIGHT = 144
const THREAD_BOTTOM_CLEARANCE = 32

export function useChatController(): ChatShellProps {
  const { user } = useUser()
  const { isLoading: userLoading } = useStoreUserEffect()
  const {
    activeId,
    activeRunKey,
    appendRunMessages,
    autoSandboxPreset,
    chats,
    clearSandbox,
    completeAssistantMessage,
    createThread,
    deleteThreadMutation,
    dismissOnboardingMutation,
    ensureDefaultPresets,
    liveRun,
    presetsLoaded,
    sandboxPresets,
    saveRunState,
    setActiveId,
    setThreadNotes,
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
  const [view, setView] = useState<"chat" | "settings">(() =>
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("view") === "settings"
      ? "settings"
      : "chat"
  )
  const [settingsSection, setSettingsSection] =
    useState<SettingsSectionId>("connections")
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
  const speed = draftSpeed
  const thinking = draftThinking
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
    setPromptFocused,
    setThreadElement,
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
    queueingRunKeys,
    readyDraftAttachments,
    repoUrl,
    runningRunKeysSet,
    saveRunState,
    setActiveId,
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
    removeThreadRunState,
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
    onSpeedSelect,
    onSubmit,
    onTextareaBlur,
    onTextareaFocus,
    onThinkingSelect,
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

  const composerEnabled = view !== "settings" && !activeFilePath && !notesOpen
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

  return {
    dialogs: {
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
        activeRunKey,
        activeSandboxId,
        bottomInset: threadBottomInset,
        codexConnected,
        empty,
        emptyPromptTitle,
        githubAppReady,
        githubConnected,
        githubUserReady,
        messages,
        onDismissOnboarding: dismissOnboarding,
        onOpenConnectionsSettings: () => showSettings("connections"),
        onOpenFile: openFile,
        onOpenFileDiff: openFileDiff,
        onScroll: onThreadScroll,
        scrollable: threadScrollable,
        setElement: setThreadElement,
        showOnboarding,
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
        onOpenFile: openFile,
        onSaveNotes: saveThreadNotes,
      },
    },
    sidebar: {
      open: sidebarOpen,
      props: {
        activeId,
        chats: sidebarChats,
        currentView: view,
        onClose: () => setSidebarOpen(false),
        onDelete: requestDeleteChat,
        onExitSettings: exitSettings,
        onNewChat: startNewChat,
        onNewChatInRepo: startNewChatInRepo,
        onRename: renameChat,
        onSelect: selectChat,
        onSelectSettingsSection: selectSettingsSection,
        onShowSettings: () => showSettings(),
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
      onDiffStyleChange: setDiffStyle,
      onFilesOpenChange: setFilesOpen,
      onGithubOpenChange: setGithubOpen,
      onOpenAllDiffs: openAllDiffs,
      onOpenFileFromToolPanel: openFileFromToolPanel,
      onOpenNotesFullscreen: openNotesFullscreen,
      onSaveNotes: saveThreadNotes,
      repoUrl,
      sshOpen,
    },
    topBar: {
      identity: {
        isNew: view !== "settings" && !active,
        repoUrl: view === "settings" ? "" : repoUrl,
        title: view === "settings" ? "Settings" : (active?.title ?? null),
      },
      sandbox: {
        action: sandboxAction,
        id: view === "settings" ? null : activeSandboxId,
        onDelete: requestDeleteActiveSandbox,
        onMissing: handleSandboxMissing,
        onPause: pauseActiveSandbox,
        onResume: resumeActiveSandbox,
        onStateChange: handleSandboxStateChange,
        pending: view !== "settings" && activeRunPending,
        showControls:
          view !== "settings" &&
          (Boolean(active) || activeRunPending || Boolean(activeSandboxId)),
        state: activeSandboxState,
      },
      sidebar: {
        onToggle: () => setSidebarOpen((value) => !value),
        open: sidebarOpen,
      },
      tools: {
        context: {
          canOpen: view !== "settings" && Boolean(active),
          onToggle: () => toggleToolPanel("context"),
          open: contextOpen,
        },
        desktop: {
          canOpen: view !== "settings" && Boolean(activeSandboxId),
          onToggle: () => toggleToolPanel("desktop"),
          open: desktopOpen,
        },
        files: {
          canOpen: view !== "settings" && Boolean(activeFileCacheScope),
          onToggle: () => toggleToolPanel("files"),
          open: filesOpen,
        },
        github: {
          canOpen: view !== "settings" && Boolean(activeSandboxId),
          onToggle: () => toggleToolPanel("github"),
          open: githubOpen,
        },
        ssh: {
          canOpen: view !== "settings" && Boolean(activeSandboxId),
          onToggle: () => toggleToolPanel("ssh"),
          open: sshOpen,
        },
        terminal: {
          onPreload: preloadTerminalPanel,
          onToggle: toggleTerminal,
          open: terminalVisible,
        },
      },
    },
  }
}
