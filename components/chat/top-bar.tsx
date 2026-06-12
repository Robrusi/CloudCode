"use client"

import { Folder, FolderOpen, PanelLeft, StickyNote } from "lucide-react"

import { limitThreadDisplayTitle, repoLabel } from "@/components/chat/format"
import type {
  SandboxAction,
  SandboxState,
} from "@/components/chat/sandbox-types"
import { TopBarIconButton } from "@/components/chat/top-bar-controls"
import { SandboxMenu } from "@/components/chat/top-bar-sandbox"
import { TopBarToolsMenu } from "@/components/chat/top-bar-tools"
import { IconButton as UiIconButton } from "@/components/ui/icon-button"

type TopBarIdentity = {
  isNew: boolean
  repoUrl: string
  title: string | null
}

type TopBarSandbox = {
  action: SandboxAction | null
  id: string | null
  onDelete: () => void
  onMissing: (sandboxId: string) => void
  onPause: () => void
  onResume: () => void
  onStateChange: (state: SandboxState, sandboxId: string) => void
  pending: boolean
  showControls: boolean
  state?: SandboxState
}

type TopBarToolControl = {
  canOpen: boolean
  onToggle: () => void
  open: boolean
}

type TopBarTools = {
  context: TopBarToolControl
  desktop: TopBarToolControl
  files: TopBarToolControl
  github: TopBarToolControl
  ssh: TopBarToolControl
  terminal: {
    onPreload: () => void
    onToggle: () => void
    open: boolean
  }
}

export function TopBar({
  identity,
  sandbox,
  sidebar,
  tools,
}: {
  identity: TopBarIdentity
  sandbox: TopBarSandbox
  sidebar: {
    onToggle: () => void
    open: boolean
  }
  tools: TopBarTools
}) {
  const { isNew, repoUrl, title } = identity
  const {
    action: sandboxAction,
    id: sandboxId,
    onDelete: onDeleteSandbox,
    onMissing: onSandboxMissing,
    onPause: onPauseSandbox,
    onResume: onResumeSandbox,
    onStateChange: onSandboxStateChange,
    pending: sandboxPending,
    showControls: showSandboxControls,
    state: sandboxState,
  } = sandbox
  const { context, desktop, files, github, ssh, terminal } = tools
  const { onToggle: onToggleSidebar, open: sidebarOpen } = sidebar

  const filesOpen = files.open
  const canOpenFiles = files.canOpen
  const onToggleFiles = files.onToggle
  const githubOpen = github.open
  const canOpenGithub = github.canOpen
  const onToggleGithub = github.onToggle
  const desktopOpen = desktop.open
  const canOpenDesktop = desktop.canOpen
  const onToggleDesktop = desktop.onToggle
  const sshOpen = ssh.open
  const canOpenSsh = ssh.canOpen
  const onToggleSsh = ssh.onToggle
  const contextOpen = context.open
  const canOpenContext = context.canOpen
  const onToggleContext = context.onToggle
  const terminalOpen = terminal.open
  const onPreloadTerminal = terminal.onPreload
  const onToggleTerminal = terminal.onToggle

  const fullTitle = title?.trim() || (isNew ? "New chat" : "Untitled")
  const displayTitle = limitThreadDisplayTitle(fullTitle)
  const repo = repoUrl ? repoLabel(repoUrl) : ""
  const showSandboxSection =
    showSandboxControls || Boolean(sandboxId || sandboxPending)
  const showToolsSection =
    showSandboxSection || Boolean(sandboxId || canOpenFiles) || canOpenContext

  return (
    <header className="flex h-[calc(3.25rem+env(safe-area-inset-top))] shrink-0 items-center gap-2.5 border-b border-border/60 bg-background/80 pt-[env(safe-area-inset-top)] pr-3 pl-2 backdrop-blur-xl">
      <UiIconButton
        onClick={onToggleSidebar}
        aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        className="size-9 md:size-7"
      >
        <PanelLeft className="size-3.5" />
      </UiIconButton>
      <span
        title={displayTitle === fullTitle ? undefined : fullTitle}
        aria-label={fullTitle}
        className="max-w-[55vw] min-w-0 truncate text-sm font-medium text-foreground/85 md:max-w-[42ch]"
      >
        {displayTitle}
      </span>
      {repo ? (
        <>
          <span
            className="hidden text-muted-foreground/40 sm:inline"
            aria-hidden
          >
            /
          </span>
          <div className="hidden min-w-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            <Folder className="size-4 shrink-0" />
            <span className="truncate">{repo}</span>
          </div>
        </>
      ) : null}
      <div className="ml-auto flex items-center gap-1">
        {showSandboxSection ? (
          <SandboxMenu
            key={sandboxId ?? "pending"}
            sandboxId={sandboxId}
            sandboxPending={sandboxPending}
            sandboxState={sandboxState}
            sandboxAction={sandboxAction}
            onSandboxStateChange={onSandboxStateChange}
            onSandboxMissing={onSandboxMissing}
            onPauseSandbox={onPauseSandbox}
            onResumeSandbox={onResumeSandbox}
            onDeleteSandbox={onDeleteSandbox}
          />
        ) : null}

        {showSandboxSection && showToolsSection ? (
          <span aria-hidden className="mx-1 h-5 w-px bg-border/70" />
        ) : null}

        {showToolsSection ? (
          <div className="flex items-center gap-0.5">
            <TopBarIconButton
              onClick={onToggleFiles}
              active={filesOpen}
              disabled={!canOpenFiles}
              label={filesOpen ? "Hide sandbox files" : "Show sandbox files"}
            >
              {filesOpen ? (
                <FolderOpen className="size-3.5" />
              ) : (
                <Folder className="size-3.5" />
              )}
            </TopBarIconButton>
            <TopBarIconButton
              onClick={onToggleContext}
              active={contextOpen}
              disabled={!canOpenContext}
              label={contextOpen ? "Hide context panel" : "Show context panel"}
            >
              <StickyNote className="size-3.5" />
            </TopBarIconButton>
            <TopBarToolsMenu
              sandboxId={sandboxId}
              sandboxPending={sandboxPending}
              terminalOpen={terminalOpen}
              onPreloadTerminal={onPreloadTerminal}
              onToggleTerminal={onToggleTerminal}
              githubOpen={githubOpen}
              canOpenGithub={canOpenGithub}
              onToggleGithub={onToggleGithub}
              desktopOpen={desktopOpen}
              canOpenDesktop={canOpenDesktop}
              onToggleDesktop={onToggleDesktop}
              sshOpen={sshOpen}
              canOpenSsh={canOpenSsh}
              onToggleSsh={onToggleSsh}
            />
          </div>
        ) : null}
      </div>
    </header>
  )
}
