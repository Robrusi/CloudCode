const storageCache = new Map<string, string | null>()
let invalidationListenersAttached = false

function browserLocalStorage() {
  if (typeof window === "undefined") return null

  try {
    return window.localStorage
  } catch {
    return null
  }
}

function attachStorageInvalidation(storage: Storage) {
  if (invalidationListenersAttached) return
  invalidationListenersAttached = true

  window.addEventListener("storage", (event) => {
    if (event.storageArea && event.storageArea !== storage) return
    if (event.key) storageCache.delete(event.key)
    else storageCache.clear()
  })

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") storageCache.clear()
  })
}

export function readBrowserStorage(key: string) {
  const storage = browserLocalStorage()
  if (!storage) return null
  attachStorageInvalidation(storage)

  if (storageCache.has(key)) return storageCache.get(key) ?? null

  try {
    const value = storage.getItem(key)
    storageCache.set(key, value)
    return value
  } catch {
    storageCache.delete(key)
    return null
  }
}

export function hasBrowserStorageKey(key: string) {
  return readBrowserStorage(key) !== null
}

export function writeBrowserStorage(key: string, value: string) {
  const storage = browserLocalStorage()
  if (!storage) return
  attachStorageInvalidation(storage)

  try {
    storage.setItem(key, value)
    storageCache.set(key, value)
  } catch {
    storageCache.delete(key)
  }
}

export function removeBrowserStorage(key: string) {
  const storage = browserLocalStorage()
  if (!storage) return
  attachStorageInvalidation(storage)

  try {
    storage.removeItem(key)
    storageCache.set(key, null)
  } catch {
    storageCache.delete(key)
  }
}
