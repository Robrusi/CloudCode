"use client"

import type { RefObject, UIEventHandler } from "react"
import { useCallback, useEffect, useRef, useState } from "react"

import { ArrowDown } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"

import {
  ChatComposer,
  type ChatComposerProps,
} from "@/components/chat/composer"
import {
  FileEditorPanel,
  SandboxTerminalPanel,
  UiTestReportMainPanel,
} from "@/components/chat/lazy-panels"
import { MessageBlock } from "@/components/chat/message"
import { logsForMessage } from "@/components/chat/message-model"
import { RunSetupSummary } from "@/components/chat/message-setup"
import { AllDiffsPanel, NotesPanel } from "@/components/chat/panels"
import { AutomationsScreen } from "@/components/automations/screen"
import { ReviewsScreen } from "@/components/reviews/screen"
import type { SettingsSectionId } from "@/components/settings/sections"
import { SettingsScreen } from "@/components/settings/screen"
import type { Message } from "@/components/chat/types"
import { OnboardingChecklist } from "@/components/chat/onboarding-checklist"
import type { FileBrowserOpenMode } from "@/components/files/browser"
import type { Id } from "@/convex/_generated/dataModel"
import type { UiTestRunView } from "@/hooks/use-chat-workspace-panels"
import type { CodexAuthOverview } from "@/lib/codex/auth-types"
import type { GitHubAuthStatus } from "@/lib/github/auth"
import type { SandboxPresetRecord } from "@/lib/sandbox/preset-types"
import { cn } from "@/lib/shared/utils"

type ChatView = "chat" | "settings" | "automations" | "reviews"
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

type AutomationsContent = {
  defaultRepoUrl: string
  onOpenThread: (threadId: Id<"threads">) => void
}

type ReviewsContent = {
  defaultRepoUrl: string
  onOpenThread: (threadId: Id<"threads">) => void
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
  onCloseUiTestRun: () => void
  onOpenFile: (path: string) => void
  onSaveNotes: (notes: string) => void
  uiTestRun: UiTestRunView | null
}

type ThreadContent = {
  activeRepoName: string | null
  activeSandboxId: string | null
  bottomInset: number
  codexConnected: boolean
  composerLaunchToken: number
  empty: boolean
  emptyPromptTitle: string
  githubAppReady: boolean
  githubConnected: boolean
  githubUserReady: boolean
  messages: Message[]
  onCodexAuthChanged: () => void | Promise<void>
  onDismissOnboarding: () => void
  onOpenFile: (path: string) => void
  onOpenFileDiff: (path: string, diff: string) => void
  onScroll: UIEventHandler<HTMLDivElement>
  onScrollToLatest: () => void
  // Set on review threads: the review's name, used as the label of the
  // collapsed prompt pill so the thread opens on the agent's report.
  reviewPromptLabel: string | null
  scrollable: boolean
  setElement: (element: HTMLDivElement | null) => void
  showNewActivity: boolean
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
  automations,
  composer,
  reviews,
  settings,
  terminal,
  thread,
  view,
  workspace,
}: {
  automations: AutomationsContent
  composer: ComposerContent
  reviews: ReviewsContent
  settings: SettingsContent
  terminal: TerminalContent
  thread: ThreadContent
  view: ChatView
  workspace: WorkspaceMainPanel
}) {
  /* Composer launch choreography. The composer is one persistent element
     (PersistentComposer) that only ever moves vertically; the git/preset
     settings collapse/expand inside it. Two flags sequence the two phases:

       - launching (send from a draft, composerLaunchToken bumps): hold the
         composer centered while the settings collapse up into it, then drop the
         hold so the composer glides down to the dock.
       - opening (entering the empty view from a thread = new chat): the
         composer glides up to center first, then the settings expand back down.

     This makes the new-chat action the exact 1:1 reverse of send. */
  const [launching, setLaunching] = useState(false)
  const [opening, setOpening] = useState(false)
  const launchTokenRef = useRef(thread.composerLaunchToken)
  const wasEmptyRef = useRef(thread.empty)
  // Both transitions are detected during render (not in an effect) so the hold
  // applies in the same commit as the data change — a frame's delay would flash
  // the wrong layout. Each self-terminates because its ref updates immediately.
  if (thread.composerLaunchToken !== launchTokenRef.current) {
    launchTokenRef.current = thread.composerLaunchToken
    setLaunching(true)
  }
  const enteringEmpty = thread.empty && !wasEmptyRef.current
  if (wasEmptyRef.current !== thread.empty) {
    wasEmptyRef.current = thread.empty
  }
  if (enteringEmpty && !launching) {
    setOpening(true)
  }

  // Centered while empty, and held centered through the send collapse.
  const composerCentered = thread.empty || launching
  // Settings rest open only in the idle new-chat state; closed while the send
  // collapse runs and while the reverse up-glide runs (they expand afterwards).
  const settingsOpen = composerCentered && !launching && !opening

  const onSettingsCollapsed = useCallback(() => setLaunching(false), [])
  const onComposerMoved = useCallback(() => setOpening(false), [])
  // Safety nets so a missed completion signal can never wedge a transition.
  useEffect(() => {
    if (!launching) return
    const timeout = setTimeout(() => setLaunching(false), 700)
    return () => clearTimeout(timeout)
  }, [launching])
  useEffect(() => {
    if (!opening) return
    const timeout = setTimeout(() => setOpening(false), 700)
    return () => clearTimeout(timeout)
  }, [opening])

  if (view === "settings") {
    return <SettingsScreen {...settings} />
  }

  if (view === "automations") {
    return <AutomationsScreen {...automations} />
  }

  if (view === "reviews") {
    return <ReviewsScreen {...reviews} />
  }

  const panelOpen =
    Boolean(workspace.activeFilePath) ||
    workspace.allDiffsOpen ||
    workspace.notesOpen ||
    Boolean(workspace.uiTestRun)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatMainArea
        composerCentered={composerCentered}
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

      <PersistentComposer
        composer={composer}
        centered={composerCentered}
        hidden={panelOpen}
        settingsOpen={settingsOpen}
        terminalHeight={terminal.height}
        terminalVisible={terminal.visible}
        onSettingsCollapsed={onSettingsCollapsed}
        onComposerMoved={onComposerMoved}
      />
    </div>
  )
}

function ChatMainArea({
  composerCentered,
  thread,
  workspace,
}: {
  composerCentered: boolean
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

  if (workspace.uiTestRun) {
    return (
      <UiTestReportMainPanel
        run={workspace.uiTestRun.run}
        sandboxId={workspace.uiTestRun.sandboxId}
        onClose={workspace.onCloseUiTestRun}
      />
    )
  }

  if (composerCentered) {
    return <ChatEmptyContent thread={thread} />
  }

  return <ChatThreadMessages thread={thread} />
}

function ChatThreadMessages({ thread }: { thread: ThreadContent }) {
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
  // Only the composed review prompt collapses; later user messages in the
  // thread are real conversation.
  const collapsedPromptId = thread.reviewPromptLabel
    ? thread.messages.find((message) => message.role === "user")?.id
    : undefined

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        key={thread.threadViewKey}
        ref={thread.setElement}
        onScroll={thread.onScroll}
        className={cn(
          "min-h-0 flex-1 [scrollbar-gutter:stable] overscroll-contain [contain:paint] [overflow-anchor:none]",
          thread.scrollable ? "overflow-y-auto" : "overflow-hidden"
        )}
        style={{ scrollPaddingBottom: thread.bottomInset }}
      >
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 pt-16 md:px-6">
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
                  collapsePromptLabel={
                    message.id === collapsedPromptId
                      ? (thread.reviewPromptLabel ?? undefined)
                      : undefined
                  }
                  repoName={thread.activeRepoName}
                  sandboxId={thread.activeSandboxId}
                  onOpenFile={thread.onOpenFile}
                  onOpenFileDiff={thread.onOpenFileDiff}
                />
              )
            )}
          </div>
          <div
            aria-hidden="true"
            className="shrink-0"
            style={{ height: thread.bottomInset }}
          />
        </div>
      </div>
      <NewActivityPill
        show={thread.showNewActivity}
        onClick={thread.onScrollToLatest}
      />
    </div>
  )
}

/* Minimal "jump to latest" affordance: a small circular button that springs in
   at the bottom of the thread only when new output arrives while scrolled up. */
function NewActivityPill({
  show,
  onClick,
}: {
  show: boolean
  onClick: () => void
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
      <AnimatePresence>
        {show ? (
          <motion.button
            type="button"
            onClick={onClick}
            aria-label="Jump to latest"
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.9 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="pointer-events-auto grid size-8 place-items-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowDown className="size-4" />
          </motion.button>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

/* The greeting only — never the composer. The composer is the persistent
   element below it (PersistentComposer); keeping them separate is what lets the
   composer glide on its own without remounting. Auto height (no flex-1) so the
   column's justify positions the greeting + composer together: centered at 22vh
   on desktop, bottom-aligned on mobile. */
function ChatEmptyContent({ thread }: { thread: ThreadContent }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 pt-[16vh] md:px-6 md:pt-[22vh]">
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
            onCodexAuthChanged={thread.onCodexAuthChanged}
            onDismiss={thread.onDismissOnboarding}
          />
        </div>
      ) : null}
    </div>
  )
}

/* One persistent composer for every state. Its horizontal box is identical in
   both positions (mx-auto max-w-3xl, same padding), so it only ever moves
   vertically — no diagonal drift. `layout="position"` with
   `layoutDependency={centered}` animates that move only when the position flips
   (send / new chat), never on textarea resize. The outer wrapper carries the
   vertical spacing for each state and is swapped instantly. */
function PersistentComposer({
  composer,
  centered,
  hidden,
  settingsOpen,
  terminalHeight,
  terminalVisible,
  onSettingsCollapsed,
  onComposerMoved,
}: {
  composer: ComposerContent
  centered: boolean
  hidden: boolean
  settingsOpen: boolean
  terminalHeight: number
  terminalVisible: boolean
  onSettingsCollapsed: () => void
  onComposerMoved: () => void
}) {
  if (!composer.enabled) return null

  return (
    <div
      className={cn(
        "shrink-0",
        terminalVisible
          ? "pointer-events-none absolute inset-x-0 z-10"
          : centered
            ? "mt-6 md:mt-8"
            : "pt-1 pb-[max(var(--chat-composer-dock-bottom-space),env(safe-area-inset-bottom))] md:pt-3 md:pb-[max(1.5rem,env(safe-area-inset-bottom))]",
        hidden && "hidden"
      )}
      style={terminalVisible ? { bottom: terminalHeight } : undefined}
    >
      <motion.div
        layout="position"
        layoutDependency={centered}
        ref={composer.ref}
        onLayoutAnimationComplete={onComposerMoved}
        className="mx-auto flex w-full max-w-3xl justify-center px-4 md:px-6"
      >
        <ChatComposerInstance
          composer={composer}
          settingsOpen={settingsOpen}
          onSettingsCollapsed={onSettingsCollapsed}
        />
      </motion.div>
    </div>
  )
}

function ChatComposerInstance({
  composer,
  settingsOpen,
  onSettingsCollapsed,
}: {
  composer: ComposerContent
  settingsOpen: boolean
  onSettingsCollapsed: () => void
}) {
  if (!composer.enabled) return null

  return (
    <ChatComposer
      {...composer.props}
      settingsOpen={settingsOpen}
      onSettingsCollapsed={onSettingsCollapsed}
    />
  )
}
