"use client"

import { useClerk } from "@clerk/nextjs"
import {
  Clock,
  GitPullRequest,
  Settings,
  SquarePen,
  User,
  X,
} from "lucide-react"
import { type CSSProperties, useMemo } from "react"

import { ResizeHandle } from "@/components/layout/resize-handle"
import { repoLabel } from "@/components/chat/format"
import { SidebarAutomationList } from "@/components/chat/sidebar-automations"
import { FolderGroup } from "@/components/chat/sidebar-items"
import {
  groupSidebarChats,
  sidebarThreadFilterKey,
  type SidebarChat,
} from "@/components/chat/sidebar-model"
import { SidebarSettingsNav } from "@/components/chat/sidebar-settings-nav"
import { SidebarThreadControls } from "@/components/chat/sidebar-thread-controls"
import type { SettingsSectionId } from "@/components/settings/sections"
import { Button } from "@/components/ui/button"
import type { Id } from "@/convex/_generated/dataModel"
import { useIsMobile } from "@/hooks/use-is-mobile"
import { useResizablePanel } from "@/hooks/use-resizable-panel"
import { useSidebarFolderState } from "@/hooks/use-sidebar-folder-state"
import type { SidebarThreadFiltersState } from "@/hooks/use-sidebar-thread-filters"
import { cn } from "@/lib/shared/utils"

export function Sidebar({
  chats,
  activeId,
  currentView,
  onNewChat,
  onNewChatInRepo,
  onSelect,
  onDelete,
  onRename,
  onShowAutomations,
  onShowReviews,
  onShowSettings,
  onExitSettings,
  sidebarThreadContext,
  settingsSection,
  threadFilters,
  onSelectSettingsSection,
  onClose,
  brandClassName,
}: {
  chats: SidebarChat[]
  activeId: Id<"threads"> | null
  currentView: "chat" | "settings" | "automations" | "reviews"
  onNewChat: () => void
  onNewChatInRepo: (repoUrl: string) => void
  onSelect: (id: Id<"threads">) => void
  onDelete: (id: Id<"threads">) => void
  onRename: (id: Id<"threads">, title: string) => void
  onShowAutomations: () => void
  onShowReviews: () => void
  onShowSettings: () => void
  onExitSettings: () => void
  // Selects which linked thread kind the sidebar lists. Automation/review
  // threads render as chats when opened but keep their owning nav item active.
  sidebarThreadContext: "chats" | "automations" | "reviews"
  settingsSection: SettingsSectionId
  // Owned by the chat controller so it survives the sidebar unmounting on
  // mobile navigation.
  threadFilters: SidebarThreadFiltersState
  onSelectSettingsSection: (id: SettingsSectionId) => void
  onClose: () => void
  brandClassName: string
}) {
  const clerk = useClerk()
  const isMobile = useIsMobile()
  const { width, resizing, onResizeStart, resetWidth } = useResizablePanel({
    storageKey: "cloudcode:sidebarWidth",
    defaultWidth: 256,
    minWidth: 200,
    maxWidth: 480,
    edge: "right",
    enabled: !isMobile,
  })
  const automationContext = sidebarThreadContext === "automations"
  const reviewContext = sidebarThreadContext === "reviews"
  const folders = useSidebarFolderState(sidebarThreadContext)
  // The automations context renders its own grouped list, so skip the repo
  // grouping there.
  const groups = useMemo(
    () =>
      automationContext ? [] : groupSidebarChats(chats, threadFilters.options),
    [automationContext, chats, threadFilters.options]
  )
  // Hide the controls with an empty thread list — unless filters caused the
  // emptiness, in which case they must stay reachable to be cleared.
  const showThreadControls =
    !automationContext && (chats.length > 0 || threadFilters.filtersActive)
  const emptyThreadsLabel = reviewContext
    ? "No review threads yet"
    : "No chats yet"

  return (
    <aside
      className="fixed inset-0 z-40 flex h-[100dvh] min-h-0 w-full flex-col overflow-hidden border-r border-border/60 bg-sidebar pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-sidebar-foreground md:relative md:inset-auto md:z-auto md:h-full md:w-[var(--panel-width)] md:shrink-0 md:pt-0 md:pb-0"
      style={{ "--panel-width": `${width}px` } as CSSProperties}
    >
      <ResizeHandle
        edge="right"
        resizing={resizing}
        onResizeStart={onResizeStart}
        onReset={resetWidth}
        ariaLabel="Resize sidebar"
      />
      <div className="flex items-center justify-between px-[1.125rem] pt-6 pb-5">
        <span
          className={cn(
            brandClassName,
            "text-4xl tracking-tight text-foreground"
          )}
        >
          CloudCode
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close sidebar"
          className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
        >
          <X className="size-5" />
        </button>
      </div>
      {currentView === "settings" ? (
        <SidebarSettingsNav
          settingsSection={settingsSection}
          onExitSettings={onExitSettings}
          onSelectSettingsSection={onSelectSettingsSection}
        />
      ) : (
        <>
          <div className="space-y-0.5 px-2 pt-2">
            <button
              type="button"
              onClick={onNewChat}
              className="flex w-full items-center gap-2 rounded-xl px-[0.625rem] py-2 text-[0.8125rem] text-foreground/80 transition-colors hover:bg-muted"
            >
              <SquarePen className="size-3 shrink-0" />
              <span>New chat</span>
            </button>
            <button
              type="button"
              onClick={onShowAutomations}
              aria-current={automationContext ? "page" : undefined}
              className={cn(
                "flex w-full items-center gap-2 rounded-xl px-[0.625rem] py-2 text-[0.8125rem] transition-colors",
                automationContext
                  ? "bg-muted text-foreground"
                  : "text-foreground/80 hover:bg-muted"
              )}
            >
              <Clock className="size-3 shrink-0" />
              <span>Automations</span>
            </button>
            <button
              type="button"
              onClick={onShowReviews}
              aria-current={reviewContext ? "page" : undefined}
              className={cn(
                "flex w-full items-center gap-2 rounded-xl px-[0.625rem] py-2 text-[0.8125rem] transition-colors",
                reviewContext
                  ? "bg-muted text-foreground"
                  : "text-foreground/80 hover:bg-muted"
              )}
            >
              <GitPullRequest className="size-3 shrink-0" />
              <span>Review</span>
            </button>
          </div>

          {showThreadControls ? (
            <SidebarThreadControls
              chats={chats}
              filter={threadFilters.filter}
              onFilterChange={threadFilters.setFilter}
              onQueryChange={threadFilters.setQuery}
              onSortChange={threadFilters.setSort}
              query={threadFilters.query}
              sort={threadFilters.sort}
            />
          ) : null}

          <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            {automationContext ? (
              <SidebarAutomationList
                chats={chats}
                activeId={currentView === "chat" ? activeId : null}
                onSelect={onSelect}
                onDelete={onDelete}
                onRename={onRename}
                onShowAutomations={onShowAutomations}
              />
            ) : groups.length === 0 ? (
              threadFilters.filtersActive ? (
                <div className="flex flex-col items-start gap-2.5 px-3 pt-4">
                  <p className="text-[0.6875rem] text-muted-foreground/80">
                    No threads match
                    {threadFilters.query.trim()
                      ? ` “${threadFilters.query.trim()}”`
                      : " the current filter"}
                    .
                  </p>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={threadFilters.clearFilters}
                  >
                    Clear filters
                  </Button>
                </div>
              ) : (
                <div className="px-3 pt-4 text-[0.6875rem] text-muted-foreground/80">
                  {emptyThreadsLabel}
                </div>
              )
            ) : (
              <div className="space-y-1">
                {groups.map((g) => {
                  const folder = folders.folderState(g.repo)
                  return (
                    <FolderGroup
                      key={g.repo || "untitled"}
                      label={repoLabel(g.repo)}
                      repoUrl={g.repo}
                      items={g.items}
                      activeId={currentView === "chat" ? activeId : null}
                      expanded={folder.expanded}
                      filterKey={sidebarThreadFilterKey(threadFilters.options)}
                      open={folder.open}
                      subtreeOpen={folders.subtreeOpen}
                      onExpandedChange={(expanded) =>
                        folders.updateFolder(g.repo, { expanded })
                      }
                      onOpenChange={(open) =>
                        folders.updateFolder(g.repo, { open })
                      }
                      onSubtreeOpenChange={folders.setSubtreeOpen}
                      onSelect={onSelect}
                      onDelete={onDelete}
                      onRename={onRename}
                      onNewChatInRepo={onNewChatInRepo}
                    />
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      <div className="border-t border-border/60 p-3">
        <button
          type="button"
          onClick={onShowSettings}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[0.8125rem] transition-colors",
            currentView === "settings"
              ? "bg-muted text-foreground"
              : "text-foreground/80 hover:bg-muted"
          )}
        >
          <Settings className="size-3.5" />
          <span className="truncate">Settings</span>
        </button>
        <button
          type="button"
          onClick={() => clerk.openUserProfile()}
          className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[0.8125rem] text-foreground/80 transition-colors hover:bg-muted"
        >
          <User className="size-3.5" />
          <span className="truncate">User</span>
        </button>
      </div>
    </aside>
  )
}
