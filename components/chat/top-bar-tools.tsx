"use client"

import {
  Check,
  GitBranch,
  KeyRound,
  Monitor,
  PanelRight,
  SquareTerminal,
} from "lucide-react"
import { createPortal } from "react-dom"

import { TopBarIconButton } from "@/components/chat/top-bar-controls"
import { MenuItem } from "@/components/ui/menu"
import { menuPanelClass } from "@/components/ui/menu-styles"
import { useAnchoredRightMenu } from "@/hooks/use-anchored-right-menu"
import { cn } from "@/lib/shared/utils"

export function TopBarToolsMenu({
  className,
  terminalOpen,
  canOpenTerminal,
  onPreloadTerminal,
  onToggleTerminal,
  githubOpen,
  canOpenGithub,
  onPreloadGithub,
  onToggleGithub,
  desktopOpen,
  canOpenDesktop,
  onToggleDesktop,
  sshOpen,
  canOpenSsh,
  onToggleSsh,
}: {
  className?: string
  terminalOpen: boolean
  canOpenTerminal: boolean
  onPreloadTerminal: () => void
  onToggleTerminal: () => void
  githubOpen: boolean
  canOpenGithub: boolean
  onPreloadGithub?: () => void
  onToggleGithub: () => void
  desktopOpen: boolean
  canOpenDesktop: boolean
  onToggleDesktop: () => void
  sshOpen: boolean
  canOpenSsh: boolean
  onToggleSsh: () => void
}) {
  const { closeMenu, menuPos, open, toggleMenu, triggerRef } =
    useAnchoredRightMenu()

  const anyOpen = terminalOpen || githubOpen || desktopOpen || sshOpen
  const items = [
    {
      key: "terminal",
      label: terminalOpen ? "Hide terminals" : "Terminals",
      icon: <SquareTerminal className="size-4" />,
      active: terminalOpen,
      disabled: !canOpenTerminal,
      onSelect: () => {
        onPreloadTerminal()
        onToggleTerminal()
      },
    },
    {
      key: "desktop",
      label: desktopOpen ? "Hide desktop" : "Desktop",
      icon: <Monitor className="size-4" />,
      active: desktopOpen,
      disabled: !canOpenDesktop,
      onSelect: onToggleDesktop,
    },
    {
      key: "ssh",
      label: sshOpen ? "Hide SSH" : "SSH",
      icon: <KeyRound className="size-4" />,
      active: sshOpen,
      disabled: !canOpenSsh,
      onSelect: onToggleSsh,
    },
    {
      key: "github",
      label: githubOpen ? "Hide GitHub" : "GitHub",
      icon: <GitBranch className="size-4" />,
      active: githubOpen,
      disabled: !canOpenGithub,
      onSelect: () => {
        onPreloadGithub?.()
        onToggleGithub()
      },
    },
  ]
  const preloadPanels = () => {
    onPreloadTerminal()
    onPreloadGithub?.()
  }

  return (
    <div className={cn("relative", className)}>
      <TopBarIconButton
        ref={triggerRef}
        onClick={toggleMenu}
        onFocus={preloadPanels}
        onPointerEnter={preloadPanels}
        label="Sandbox tools"
        active={open || anyOpen}
        ariaHasPopup="menu"
        ariaExpanded={open}
      >
        <PanelRight className="size-[18px] md:size-3.5" />
      </TopBarIconButton>
      {open && menuPos && typeof document !== "undefined"
        ? createPortal(
            <>
              <button
                type="button"
                aria-label="Close tools menu"
                className="fixed inset-0 z-[60] cursor-default border-0 bg-transparent p-0"
                onClick={closeMenu}
              />
              <div
                role="menu"
                tabIndex={-1}
                style={{ top: menuPos.top, right: menuPos.right }}
                className={cn("fixed z-[61] min-w-44", menuPanelClass)}
              >
                {items.map((item) => (
                  <MenuItem
                    key={item.key}
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => {
                      item.onSelect()
                      closeMenu()
                    }}
                  >
                    <span className="shrink-0 text-muted-foreground">
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {item.label}
                    </span>
                    {item.active ? (
                      <Check className="size-4 shrink-0" strokeWidth={2.25} />
                    ) : null}
                  </MenuItem>
                ))}
              </div>
            </>,
            document.body
          )
        : null}
    </div>
  )
}
