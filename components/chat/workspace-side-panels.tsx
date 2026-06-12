"use client"

import {
  ChatContextPanel,
  FileBrowser,
  GithubPanel,
  SandboxDesktopPanel,
  SshPanel,
} from "@/components/chat/lazy-panels"
import type { FileBrowserOpenMode } from "@/components/files/browser"

type ChangeStats = {
  additions: number
  deletions: number
  files: unknown[]
}

type OpenFileFromToolPanel = (
  path: string,
  mode: FileBrowserOpenMode,
  closePanel: (open: boolean) => void
) => void

export function ChatWorkspaceSidePanels({
  active,
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
  githubConnected,
  githubOpen,
  notes,
  notesThreadId,
  repoUrl,
  sshOpen,
  onCloseContext,
  onCloseDesktop,
  onCloseSsh,
  onDiffStyleChange,
  onFilesOpenChange,
  onGithubOpenChange,
  onOpenAllDiffs,
  onOpenFileFromToolPanel,
  onOpenNotesFullscreen,
  onSaveNotes,
}: {
  active: boolean
  activeBranch: string | null
  activeDiff: string | null
  activeFileCacheScope: string | null
  activeFileMode: FileBrowserOpenMode
  activeFilePath: string | null
  activeRepoName: string | null
  activeSandboxId: string | null
  baseBranch: string
  changeStats: ChangeStats
  contextOpen: boolean
  desktopOpen: boolean
  diffStyle: "split" | "unified"
  filesOpen: boolean
  githubConnected: boolean
  githubOpen: boolean
  notes: string
  notesThreadId: string | null
  repoUrl: string
  sshOpen: boolean
  onCloseContext: () => void
  onCloseDesktop: () => void
  onCloseSsh: () => void
  onDiffStyleChange: (style: "split" | "unified") => void
  onFilesOpenChange: (open: boolean) => void
  onGithubOpenChange: (open: boolean) => void
  onOpenAllDiffs: () => void
  onOpenFileFromToolPanel: OpenFileFromToolPanel
  onOpenNotesFullscreen: () => void
  onSaveNotes: (notes: string) => void
}) {
  return (
    <>
      <FileBrowser
        open={filesOpen && Boolean(activeFileCacheScope)}
        sandboxId={activeSandboxId}
        cacheScope={activeFileCacheScope}
        diff={activeDiff ?? undefined}
        activePath={activeFilePath}
        activeMode={activeFileMode}
        onClose={() => onFilesOpenChange(false)}
        onOpenFile={(path, mode) => {
          onOpenFileFromToolPanel(path, mode, onFilesOpenChange)
        }}
        onOpenAllDiffs={onOpenAllDiffs}
        diffStyle={diffStyle}
        onDiffStyleChange={onDiffStyleChange}
      />
      <GithubPanel
        open={githubOpen && Boolean(activeSandboxId)}
        sandboxId={activeSandboxId}
        repoUrl={repoUrl}
        baseBranch={baseBranch}
        diff={activeDiff ?? undefined}
        githubConnected={githubConnected}
        onClose={() => onGithubOpenChange(false)}
        onOpenFile={(path, mode) => {
          onOpenFileFromToolPanel(path, mode, onGithubOpenChange)
        }}
      />
      <SandboxDesktopPanel
        key={`desktop:${activeSandboxId ?? "no-sandbox"}`}
        open={desktopOpen && Boolean(activeSandboxId)}
        sandboxId={activeSandboxId}
        onClose={onCloseDesktop}
      />
      <SshPanel
        key={`ssh:${activeSandboxId ?? "no-sandbox"}`}
        open={sshOpen && Boolean(activeSandboxId)}
        sandboxId={activeSandboxId}
        onClose={onCloseSsh}
      />
      <ChatContextPanel
        open={contextOpen && active}
        environment={{
          additions: changeStats.additions,
          baseBranch,
          branch: activeBranch,
          changedFileCount: changeStats.files.length,
          deletions: changeStats.deletions,
          repoName: activeRepoName,
        }}
        notes={notes}
        notesThreadId={notesThreadId}
        onClose={onCloseContext}
        onSaveNotes={onSaveNotes}
        onOpenChanges={onOpenAllDiffs}
        onOpenNotesFullscreen={onOpenNotesFullscreen}
      />
    </>
  )
}
