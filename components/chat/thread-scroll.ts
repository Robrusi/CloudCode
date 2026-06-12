"use client"

import {
  type UIEvent as ReactUIEvent,
  useCallback,
  useLayoutEffect,
  useRef,
} from "react"

type ThreadScrollSnapshot = {
  atBottom: boolean
  runKey: string
  scrollTop: number
}

export function useChatThreadScroll({
  activeRunKey,
  empty,
  isMobile,
  onActiveThreadReset,
  threadBottomInset,
  threadContentVersion,
}: {
  activeRunKey: string
  empty: boolean
  isMobile: boolean
  onActiveThreadReset: () => void
  threadBottomInset: number
  threadContentVersion: string
}) {
  const threadRef = useRef<HTMLDivElement | null>(null)
  const isAtBottomRef = useRef(true)
  const promptFocusedRef = useRef(false)
  const pendingRestoreRef = useRef<ThreadScrollSnapshot | null>(null)
  const pendingRestoreFrameRef = useRef<number | null>(null)

  const isThreadAtBottom = useCallback((el: HTMLDivElement) => {
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }, [])

  const scrollThreadToBottom = useCallback(() => {
    const el = threadRef.current
    if (!el) return
    el.style.scrollBehavior = "auto"
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
    isAtBottomRef.current = true
  }, [])

  const settleThreadAtBottom = useCallback(() => {
    if (isMobile && promptFocusedRef.current) return

    isAtBottomRef.current = true
    scrollThreadToBottom()

    requestAnimationFrame(() => {
      if (isMobile && promptFocusedRef.current) return
      scrollThreadToBottom()
      requestAnimationFrame(() => {
        if (isMobile && promptFocusedRef.current) return
        scrollThreadToBottom()
      })
    })
  }, [isMobile, scrollThreadToBottom])

  const cancelPendingRestoreFrame = useCallback(() => {
    if (pendingRestoreFrameRef.current === null) return
    cancelAnimationFrame(pendingRestoreFrameRef.current)
    pendingRestoreFrameRef.current = null
  }, [])

  const captureThreadScrollForPanel = useCallback(() => {
    const el = threadRef.current
    if (!el) return

    cancelPendingRestoreFrame()

    pendingRestoreRef.current = {
      atBottom: isThreadAtBottom(el),
      runKey: activeRunKey,
      scrollTop: el.scrollTop,
    }
  }, [activeRunKey, cancelPendingRestoreFrame, isThreadAtBottom])

  const restoreThreadScrollForPanel = useCallback(
    (el: HTMLDivElement) => {
      const snapshot = pendingRestoreRef.current
      if (!snapshot || snapshot.runKey !== activeRunKey) return false

      const applyScroll = () => {
        el.style.scrollBehavior = "auto"
        el.scrollTop = snapshot.atBottom
          ? Math.max(0, el.scrollHeight - el.clientHeight)
          : Math.min(
              snapshot.scrollTop,
              Math.max(0, el.scrollHeight - el.clientHeight)
            )
        isAtBottomRef.current = snapshot.atBottom
      }

      cancelPendingRestoreFrame()

      applyScroll()
      pendingRestoreFrameRef.current = requestAnimationFrame(() => {
        applyScroll()
        pendingRestoreFrameRef.current = requestAnimationFrame(() => {
          applyScroll()
          if (pendingRestoreRef.current === snapshot) {
            pendingRestoreRef.current = null
          }
          pendingRestoreFrameRef.current = null
        })
      })

      return true
    },
    [activeRunKey, cancelPendingRestoreFrame]
  )

  const onThreadScroll = useCallback(
    (event: ReactUIEvent<HTMLDivElement>) => {
      const el = event.currentTarget
      isAtBottomRef.current = isThreadAtBottom(el)
    },
    [isThreadAtBottom]
  )

  const setThreadElement = useCallback(
    (el: HTMLDivElement | null) => {
      threadRef.current = el
      if (el) {
        if (!restoreThreadScrollForPanel(el)) {
          settleThreadAtBottom()
        }
      }
    },
    [restoreThreadScrollForPanel, settleThreadAtBottom]
  )

  const setPromptFocused = useCallback((focused: boolean) => {
    promptFocusedRef.current = focused
  }, [])

  useLayoutEffect(() => {
    if (isMobile && empty) return
    cancelPendingRestoreFrame()
    pendingRestoreRef.current = null
    onActiveThreadReset()
    settleThreadAtBottom()
  }, [
    activeRunKey,
    cancelPendingRestoreFrame,
    empty,
    isMobile,
    onActiveThreadReset,
    settleThreadAtBottom,
  ])

  useLayoutEffect(() => cancelPendingRestoreFrame, [cancelPendingRestoreFrame])

  useLayoutEffect(() => {
    if (isMobile && promptFocusedRef.current) return
    if (!isAtBottomRef.current) return
    settleThreadAtBottom()
  }, [isMobile, settleThreadAtBottom, threadBottomInset])

  useLayoutEffect(() => {
    if (isMobile && promptFocusedRef.current) return
    if (!isAtBottomRef.current) return
    scrollThreadToBottom()
  }, [isMobile, scrollThreadToBottom, threadContentVersion])

  return {
    captureThreadScrollForPanel,
    onThreadScroll,
    setPromptFocused,
    setThreadElement,
  }
}
