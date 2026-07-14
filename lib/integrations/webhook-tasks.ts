type WebhookTaskErrorHandler = (error: unknown) => void

/**
 * Keeps every promise registered by a webhook adapter under one request-level
 * background task. Some adapters register more work while an earlier task is
 * already running; calling the platform's waitUntil/after API again from that
 * background callback is too late and can leave the nested work unfinished.
 */
export function createWebhookTaskTracker(onError: WebhookTaskErrorHandler) {
  let pending = 0
  let sealed = false
  let resolveCompletion: (() => void) | undefined

  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve
  })

  const completeIfReady = () => {
    if (sealed && pending === 0) resolveCompletion?.()
  }

  return {
    finish() {
      sealed = true
      completeIfReady()
      return completion
    },
    waitUntil(task: Promise<unknown>) {
      pending += 1
      void Promise.resolve(task)
        .catch(onError)
        .finally(() => {
          pending -= 1
          completeIfReady()
        })
    },
  }
}
