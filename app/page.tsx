import type { Metadata } from "next"

import { Chat } from "@/components/chat/view"

export const metadata: Metadata = {
  title: "Cloudcode",
  description: "Chat with Codex in a Daytona sandbox.",
}

export default function Page() {
  return <Chat />
}
