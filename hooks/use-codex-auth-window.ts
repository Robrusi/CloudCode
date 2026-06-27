"use client"

import { useCallback, useEffect, useRef, useState } from "react"

type CodexAuthWindowMessage = {
  error?: string
  status: "complete" | "error"
  type: "cloudcode:codex-auth"
}

function isCodexAuthWindowMessage(
  value: unknown
): value is CodexAuthWindowMessage {
  if (!value || typeof value !== "object") {
    return false
  }

  const message = value as Partial<CodexAuthWindowMessage>

  return (
    message.type === "cloudcode:codex-auth" &&
    (message.status === "complete" || message.status === "error")
  )
}

function trustedCodexAuthOrigin(origin: string) {
  if (origin === window.location.origin) {
    return true
  }

  return /^http:\/\/(?:localhost|127\.0\.0\.1):(?:1455|1457)$/.test(origin)
}

export function useCodexAuthWindow({
  onComplete,
}: {
  onComplete: () => void | Promise<void>
}) {
  const [error, setError] = useState("")
  const [opening, setOpening] = useState(false)
  const cleanupRef = useRef<(() => void) | null>(null)
  const settledRef = useRef(false)

  const cleanup = useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
  }, [])

  useEffect(() => cleanup, [cleanup])

  const start = useCallback(() => {
    if (opening) return

    cleanup()
    settledRef.current = false
    setError("")
    setOpening(true)

    const authWindow = window.open("/api/codex-auth/login", "_blank")

    if (!authWindow) {
      setError("New window blocked. Allow pop-ups for Cloudcode and try again.")
      setOpening(false)
      return
    }

    authWindow.focus()

    const finish = () => {
      cleanup()
      setOpening(false)
    }

    const handleAuthMessage = (data: unknown) => {
      if (!isCodexAuthWindowMessage(data) || settledRef.current) {
        return
      }

      settledRef.current = true
      finish()

      if (data.status === "error") {
        setError(data.error ?? "ChatGPT sign-in failed.")
        return
      }

      void Promise.resolve(onComplete()).catch((completeError: unknown) => {
        setError(
          completeError instanceof Error
            ? completeError.message
            : "ChatGPT connected, but Cloudcode could not refresh the connection status."
        )
      })
    }

    const handleWindowMessage = (event: MessageEvent) => {
      if (!trustedCodexAuthOrigin(event.origin)) {
        return
      }

      handleAuthMessage(event.data)
    }

    const channel =
      "BroadcastChannel" in window
        ? new BroadcastChannel("cloudcode:codex-auth")
        : null
    const handleChannelMessage = (event: MessageEvent) => {
      handleAuthMessage(event.data)
    }

    const closedInterval = window.setInterval(() => {
      if (!authWindow.closed || settledRef.current) {
        return
      }

      settledRef.current = true
      finish()
      setError("Sign-in window closed before completion.")
    }, 500)

    window.addEventListener("message", handleWindowMessage)
    channel?.addEventListener("message", handleChannelMessage)
    cleanupRef.current = () => {
      window.clearInterval(closedInterval)
      window.removeEventListener("message", handleWindowMessage)
      channel?.removeEventListener("message", handleChannelMessage)
      channel?.close()
    }
  }, [cleanup, onComplete, opening])

  return { error, opening, start }
}
