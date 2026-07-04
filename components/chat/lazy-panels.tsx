"use client"

import dynamic from "next/dynamic"

export const FileBrowser = dynamic(
  () => import("@/components/files/browser").then((mod) => mod.FileBrowser),
  { ssr: false }
)

export const loadSandboxTerminalPanel = () =>
  import("@/components/sandbox/terminal").then(
    (mod) => mod.SandboxTerminalPanel
  )

export const SandboxTerminalPanel = dynamic(loadSandboxTerminalPanel, {
  ssr: false,
})

export const loadGithubPanel = () =>
  import("@/components/github/panel").then((mod) => mod.GithubPanel)

export const GithubPanel = dynamic(loadGithubPanel, { ssr: false })

export const SandboxDesktopPanel = dynamic(
  () =>
    import("@/components/sandbox/desktop").then(
      (mod) => mod.SandboxDesktopPanel
    ),
  { ssr: false }
)

export const SshPanel = dynamic(
  () => import("@/components/sandbox/ssh-panel").then((mod) => mod.SshPanel),
  { ssr: false }
)

export const FileEditorPanel = dynamic(
  () => import("@/components/files/editor").then((mod) => mod.FileEditorPanel),
  { ssr: false }
)

export const ChatContextPanel = dynamic(
  () =>
    import("@/components/chat/context-panel").then(
      (mod) => mod.ChatContextPanel
    ),
  { ssr: false }
)

export const UiTestReportMainPanel = dynamic(
  () =>
    import("@/components/sandbox/ui-test-report").then(
      (mod) => mod.UiTestReportMainPanel
    ),
  { ssr: false }
)
