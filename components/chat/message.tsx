"use client"

import { memo, useMemo } from "react"

import { ChangedFiles } from "@/components/diff/changed-files"
import { AssistantBody } from "@/components/chat/message-assistant"
import {
  logsForMessage,
  type ChatMessage,
} from "@/components/chat/message-model"
import { RunSetupSummary } from "@/components/chat/message-setup"
import { UserMessageBubble } from "@/components/chat/message-user"

export const MessageBlock = memo(function MessageBlock({
  message,
  onOpenFile,
  onOpenFileDiff,
  repoName,
  sandboxId,
}: {
  message: ChatMessage
  onOpenFile: (path: string) => void
  onOpenFileDiff: (path: string, diff: string) => void
  repoName: string | null
  sandboxId?: string | null
}) {
  const logs = useMemo(
    () => logsForMessage(message.id, message.meta?.logs),
    [message.id, message.meta?.logs]
  )

  if (message.role === "user") {
    return <UserMessageBubble message={message} />
  }

  const contentStarted = Boolean(message.content.trim())
  const showSetup = message.pending || logs.length > 0

  return (
    <div className="space-y-3">
      {showSetup ? (
        <RunSetupSummary
          contentStarted={contentStarted}
          logs={logs}
          pending={Boolean(message.pending)}
        />
      ) : null}
      {!message.pending || message.content.trim() ? (
        <AssistantBody
          text={message.content}
          repoName={repoName}
          onOpenFile={onOpenFile}
          error={Boolean(message.error)}
          pending={Boolean(message.pending)}
          logs={logs}
          runDiff={message.meta?.diff}
          sandboxId={sandboxId}
        />
      ) : null}
      {!message.pending && message.meta?.diff ? (
        <ChangedFiles
          diff={message.meta.diff}
          onOpenDiff={(path) => onOpenFileDiff(path, message.meta!.diff!)}
        />
      ) : null}
      {message.meta?.branch ? (
        <div className="font-mono text-[11px] text-muted-foreground">
          ↳ {message.meta.branch}
        </div>
      ) : null}
    </div>
  )
})
