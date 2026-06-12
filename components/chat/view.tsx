"use client"

import { Show } from "@clerk/nextjs"

import { SignedOutScreen } from "@/components/auth/signed-out-screen"
import { ChatShell } from "@/components/chat/shell"
import { useChatController } from "@/hooks/use-chat-controller"

export function Chat() {
  return (
    <>
      <Show when="signed-out">
        <SignedOutScreen />
      </Show>
      <Show when="signed-in">
        <ChatInner />
      </Show>
    </>
  )
}

function ChatInner() {
  const shellProps = useChatController()

  return <ChatShell {...shellProps} />
}
