"use client"

import { memo, useMemo } from "react"

import { ChangedFiles } from "@/components/diff/changed-files"
import { AssistantBody } from "@/components/chat/message-assistant"
import {
  logsForMessage,
  type ChatMessage,
} from "@/components/chat/message-model"
import {
  CollapsedPromptBubble,
  UserMessageBubble,
} from "@/components/chat/message-user"

export const MessageBlock = memo(function MessageBlock({
  collapsePromptLabel,
  message,
  onOpenFile,
  onOpenFileDiff,
  repoName,
  sandboxId,
}: {
  // When set, a user message renders collapsed behind this label.
  collapsePromptLabel?: string
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
    return collapsePromptLabel ? (
      <CollapsedPromptBubble label={collapsePromptLabel} message={message} />
    ) : (
      <UserMessageBubble message={message} />
    )
  }

  return (
    <div className="space-y-3">
      {!message.pending || message.content.trim() ? (
        <AssistantBody
          text={message.content}
          repoName={repoName}
          onOpenFile={onOpenFile}
          error={Boolean(message.error)}
          pending={Boolean(message.pending)}
          logs={logs}
          createdAt={message.createdAt}
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
    </div>
  )
})
