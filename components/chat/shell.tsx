"use client"

import type { ComponentProps } from "react"

import { GeistPixelSquare } from "geist/font/pixel"

import { ChatDialogs } from "@/components/chat/dialogs"
import { ChatMainContent } from "@/components/chat/main-content"
import { Sidebar } from "@/components/chat/sidebar"
import { TopBar } from "@/components/chat/top-bar"
import { ChatWorkspaceSidePanels } from "@/components/chat/workspace-side-panels"

type SidebarProps = Omit<ComponentProps<typeof Sidebar>, "brandClassName">

export type ChatShellProps = {
  dialogs: ComponentProps<typeof ChatDialogs>
  main: ComponentProps<typeof ChatMainContent>
  sidebar: {
    open: boolean
    props: SidebarProps
  }
  sidePanels: ComponentProps<typeof ChatWorkspaceSidePanels>
  topBar: ComponentProps<typeof TopBar>
}

export function ChatShell({
  dialogs,
  main,
  sidebar,
  sidePanels,
  topBar,
}: ChatShellProps) {
  return (
    <div className="fixed inset-0 flex min-w-0 overflow-hidden bg-background text-foreground">
      {sidebar.open ? (
        <Sidebar
          {...sidebar.props}
          brandClassName={GeistPixelSquare.className}
        />
      ) : null}

      <ChatDialogs {...dialogs} />

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar {...topBar} />
        <ChatMainContent {...main} />
      </div>

      <ChatWorkspaceSidePanels {...sidePanels} />
    </div>
  )
}
