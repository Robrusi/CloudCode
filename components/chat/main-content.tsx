"use client"

import type { RefObject, UIEventHandler } from "react"

import {
  ChatComposer,
  type ChatComposerProps,
} from "@/components/chat/composer"
import {
  FileEditorPanel,
  SandboxTerminalPanel,
} from "@/components/chat/lazy-panels"
import { MessageBlock } from "@/components/chat/message"
import { logsForMessage } from "@/components/chat/message-model"
import { RunSetupSummary } from "@/components/chat/message-setup"
import { AllDiffsPanel, NotesPanel } from "@/components/chat/panels"
import type { SettingsSectionId } from "@/components/settings/sections"
import { SettingsScreen } from "@/components/settings/screen"
import type { Message } from "@/components/chat/types"
import { OnboardingChecklist } from "@/components/chat/onboarding-checklist"
import type { FileBrowserOpenMode } from "@/components/files/browser"
import type { CodexAuthOverview } from "@/lib/codex/auth-types"
import type { GitHubAuthStatus } from "@/lib/github/auth"
import type { SandboxPresetRecord } from "@/lib/sandbox/preset-types"
import { cn } from "@/lib/shared/utils"

type ChatView = "chat" | "settings"
type MainContentDiffStyle = "split" | "unified"

type SettingsContent = {
  authError: string
  authStatus: CodexAuthOverview | null
  githubAuthError: string
  githubStatus: GitHubAuthStatus | null
  onCodexAuthChanged: () => void | Promise<void>
  onGitHubAuthChanged: () => void | Promise<void>
  sandboxPresets: SandboxPresetRecord[]
  section: SettingsSectionId
}

type WorkspaceMainPanel = {
  activeDiff: string | null
  activeFileCacheScope: string | null
  activeFileMode: FileBrowserOpenMode
  activeFilePath: string | null
  activeSandboxId: string | null
  allDiffsOpen: boolean
  diffStyle: MainContentDiffStyle
  editorDiff: string | null
  notes: string
  notesOpen: boolean
  notesThreadId: string | null
  onActiveFileModeChange: (mode: FileBrowserOpenMode) => void
  onCloseAllDiffs: () => void
  onCloseFileEditor: () => void
  onCloseNotes: () => void
  onOpenFile: (path: string) => void
  onSaveNotes: (notes: string) => void
}

type ThreadContent = {
  activeRepoName: string | null
  activeSandboxId: string | null
  bottomInset: number
  codexConnected: boolean
  empty: boolean
  emptyPromptTitle: string
  githubAppReady: boolean
  githubConnected: boolean
  githubUserReady: boolean
  messages: Message[]
  onDismissOnboarding: () => void
  onOpenFile: (path: string) => void
  onOpenConnectionsSettings: () => void
  onOpenFileDiff: (path: string, diff: string) => void
  onScroll: UIEventHandler<HTMLDivElement>
  scrollable: boolean
  setElement: (element: HTMLDivElement | null) => void
  showOnboarding: boolean
  threadViewKey: string
  userFirstName: string | null
}

type TerminalContent = {
  height: number
  mounted: boolean
  onClose: () => void
  onHeightChange: (height: number) => void
  sandboxId: string | null
  visible: boolean
}

type ComposerContent = {
  enabled: boolean
  props: ChatComposerProps
  ref: RefObject<HTMLDivElement | null>
}

export function ChatMainContent({
  composer,
  settings,
  terminal,
  thread,
  view,
  workspace,
}: {
  composer: ComposerContent
  settings: SettingsContent
  terminal: TerminalContent
  thread: ThreadContent
  view: ChatView
  workspace: WorkspaceMainPanel
}) {
  if (view === "settings") {
    return <SettingsScreen {...settings} />
  }

  return (
    <>
      <ChatWorkspaceMainPanel
        composer={composer}
        thread={thread}
        workspace={workspace}
      />

      {terminal.mounted ? (
        <SandboxTerminalPanel
          open={terminal.visible}
          sandboxId={terminal.sandboxId}
          onClose={terminal.onClose}
          height={terminal.height}
          onHeightChange={terminal.onHeightChange}
        />
      ) : null}

      <ChatComposerDock
        composer={composer}
        empty={thread.empty}
        hidden={
          Boolean(workspace.activeFilePath) ||
          workspace.allDiffsOpen ||
          workspace.notesOpen
        }
        terminalHeight={terminal.height}
        terminalVisible={terminal.visible}
      />
    </>
  )
}

function ChatWorkspaceMainPanel({
  composer,
  thread,
  workspace,
}: {
  composer: ComposerContent
  thread: ThreadContent
  workspace: WorkspaceMainPanel
}) {
  if (workspace.activeFilePath) {
    return (
      <FileEditorPanel
        sandboxId={workspace.activeSandboxId}
        cacheScope={workspace.activeFileCacheScope}
        activePath={workspace.activeFilePath}
        diff={workspace.editorDiff ?? undefined}
        mode={workspace.activeFileMode}
        onOpenFile={workspace.onOpenFile}
        onModeChange={workspace.onActiveFileModeChange}
        onClose={workspace.onCloseFileEditor}
        placement="main"
      />
    )
  }

  if (workspace.allDiffsOpen) {
    return (
      <AllDiffsPanel
        diff={workspace.activeDiff ?? ""}
        diffStyle={workspace.diffStyle}
        onClose={workspace.onCloseAllDiffs}
      />
    )
  }

  if (workspace.notesOpen) {
    return (
      <NotesPanel
        notes={workspace.notes}
        notesThreadId={workspace.notesThreadId}
        onSave={workspace.onSaveNotes}
        onClose={workspace.onCloseNotes}
      />
    )
  }

  return <ChatThreadContent composer={composer} thread={thread} />
}

function ChatThreadContent({
  composer,
  thread,
}: {
  composer: ComposerContent
  thread: ThreadContent
}) {
  /* The thread owns a single setup line, rendered in place of the last
     pending assistant message and keyed by the thread. Message identity
     changes during send (optimistic -> server) therefore never remount it,
     and finished messages can never flash a setup line of their own. */
  const lastMessage = thread.messages.at(-1)
  const setupMessage =
    lastMessage?.role === "assistant" &&
    lastMessage.pending &&
    !lastMessage.content.trim()
      ? lastMessage
      : null

  return (
    <div
      key={thread.threadViewKey}
      ref={thread.setElement}
      onScroll={thread.onScroll}
      className={cn(
        "min-h-0 flex-1 overscroll-contain [contain:paint] [overflow-anchor:none]",
        thread.scrollable ? "overflow-y-auto" : "overflow-hidden"
      )}
      style={{ scrollPaddingBottom: thread.bottomInset }}
    >
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 pt-16 md:px-6">
        {thread.empty ? (
          <ChatEmptyState composer={composer} thread={thread} />
        ) : (
          <div className="mx-auto w-full max-w-2xl space-y-6 md:space-y-8">
            {thread.messages.map((message) =>
              message === setupMessage ? (
                <RunSetupSummary
                  key={`setup-${thread.threadViewKey}`}
                  createdAt={message.createdAt}
                  logs={logsForMessage(message.id, message.meta?.logs)}
                />
              ) : (
                <MessageBlock
                  key={message.id}
                  message={message}
                  repoName={thread.activeRepoName}
                  sandboxId={thread.activeSandboxId}
                  onOpenFile={thread.onOpenFile}
                  onOpenFileDiff={thread.onOpenFileDiff}
                />
              )
            )}
          </div>
        )}
        <div
          aria-hidden="true"
          className="shrink-0"
          style={{ height: thread.empty ? 0 : thread.bottomInset }}
        />
      </div>
    </div>
  )
}

function ChatEmptyState({
  composer,
  thread,
}: {
  composer: ComposerContent
  thread: ThreadContent
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-end pb-[max(var(--chat-empty-bottom-space),env(safe-area-inset-bottom))] md:min-h-0 md:justify-start md:pt-[22vh] md:pb-0">
      <h1 className="text-center text-2xl font-normal tracking-tight text-balance text-foreground/90 md:text-3xl">
        {thread.showOnboarding
          ? thread.userFirstName
            ? `Let’s set you up, ${thread.userFirstName}`
            : "Let’s set you up"
          : thread.emptyPromptTitle}
      </h1>
      {thread.showOnboarding ? (
        <div className="mt-10 flex w-full justify-center md:mt-8">
          <OnboardingChecklist
            codexConnected={thread.codexConnected}
            githubAppReady={thread.githubAppReady}
            githubConnected={thread.githubConnected}
            githubUserReady={thread.githubUserReady}
            onDismiss={thread.onDismissOnboarding}
            onOpenConnectionsSettings={thread.onOpenConnectionsSettings}
          />
        </div>
      ) : (
        <div
          ref={composer.ref}
          className="mt-10 flex w-full justify-center md:mt-8"
        >
          <ChatComposerInstance composer={composer} />
        </div>
      )}
    </div>
  )
}

function ChatComposerDock({
  composer,
  empty,
  hidden,
  terminalHeight,
  terminalVisible,
}: {
  composer: ComposerContent
  empty: boolean
  hidden: boolean
  terminalHeight: number
  terminalVisible: boolean
}) {
  if (!composer.enabled || empty) return null

  if (terminalVisible) {
    return (
      <div
        ref={composer.ref}
        className={cn(
          "pointer-events-none absolute inset-x-0 z-10 flex justify-center bg-background px-3 pt-3 pb-4 md:px-4 md:pb-6",
          hidden && "hidden"
        )}
        style={{ bottom: terminalHeight }}
      >
        <ChatComposerInstance composer={composer} />
      </div>
    )
  }

  return (
    <div
      ref={composer.ref}
      className="shrink-0 bg-background px-3 pt-1 pb-[max(var(--chat-composer-dock-bottom-space),env(safe-area-inset-bottom))] md:px-4 md:pt-3 md:pb-[max(1.5rem,env(safe-area-inset-bottom))]"
    >
      <div className="flex justify-center">
        <ChatComposerInstance composer={composer} />
      </div>
    </div>
  )
}

function ChatComposerInstance({ composer }: { composer: ComposerContent }) {
  if (!composer.enabled) return null

  return <ChatComposer {...composer.props} />
}
