"use client"

export type SandboxFileEntry = { path: string; type: "file" | "dir" }
type ReadResponse = {
  content?: string
  error?: string
  modifiedTime?: string | null
  path?: string
  size?: number
}

export type CachedFileList = {
  entries: SandboxFileEntry[]
  sandboxId?: string
  truncated: boolean
  updatedAt: number
}

export type CachedTextFile = {
  content: string
  diffKey?: string
  modifiedTime: string | null
  sandboxId?: string
  size: number
  updatedAt: number
}

const DB_NAME = "cloudcode-sandbox-file-cache"
const DB_VERSION = 1
const FILE_STORE = "files"
const LIST_STORE = "lists"

const memoryFiles = new Map<string, CachedTextFile>()
const memoryLists = new Map<string, CachedFileList>()
const inFlightFileFetches = new Map<string, Promise<CachedTextFile>>()
let dbPromise: Promise<IDBDatabase | null> | null = null

function canUseIndexedDb() {
  return typeof window !== "undefined" && "indexedDB" in window
}

function openDb() {
  if (!canUseIndexedDb()) return Promise.resolve(null)
  if (dbPromise) return dbPromise

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(FILE_STORE)) {
        db.createObjectStore(FILE_STORE, { keyPath: "key" })
      }
      if (!db.objectStoreNames.contains(LIST_STORE)) {
        db.createObjectStore(LIST_STORE, { keyPath: "key" })
      }
    }

    request.onerror = () => resolve(null)
    request.onsuccess = () => resolve(request.result)
  })

  return dbPromise
}

function fileKey(scope: string, path: string) {
  return `${scope}\0${path}`
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

async function readRecord<T>(storeName: string, key: string) {
  const db = await openDb()
  if (!db) return null

  try {
    const tx = db.transaction(storeName, "readonly")
    const result = await requestToPromise<T | undefined>(
      tx.objectStore(storeName).get(key)
    )
    return result ?? null
  } catch {
    return null
  }
}

async function writeRecord<T extends { key: string }>(
  storeName: string,
  value: T
) {
  const db = await openDb()
  if (!db) return

  try {
    const tx = db.transaction(storeName, "readwrite")
    tx.objectStore(storeName).put(value)
  } catch {
    // The in-memory cache is still useful if IndexedDB is unavailable.
  }
}

function hashString(value?: string) {
  if (!value) return "empty"
  let hash = 5381
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i)
  }
  return `${value.length}:${(hash >>> 0).toString(36)}`
}

export function diffCacheKey(diff?: string) {
  return hashString(diff)
}

export async function readCachedFileList(scope: string) {
  const memory = memoryLists.get(scope)
  if (memory) return memory

  const stored = await readRecord<CachedFileList & { key: string }>(
    LIST_STORE,
    scope
  )
  if (!stored) return null

  const { key: _key, ...list } = stored
  void _key
  memoryLists.set(scope, list)
  return list
}

export async function writeCachedFileList(
  scope: string,
  list: Omit<CachedFileList, "updatedAt">
) {
  const value = { ...list, updatedAt: Date.now() }
  memoryLists.set(scope, value)
  await writeRecord(LIST_STORE, { key: scope, ...value })
}

export async function readCachedTextFile(scope: string, path: string) {
  const key = fileKey(scope, path)
  const memory = memoryFiles.get(key)
  if (memory) return memory

  const stored = await readRecord<CachedTextFile & { key: string }>(
    FILE_STORE,
    key
  )
  if (!stored) return null

  const { key: _key, ...file } = stored
  void _key
  memoryFiles.set(key, file)
  return file
}

export async function writeCachedTextFile(
  scope: string,
  path: string,
  file: Omit<CachedTextFile, "updatedAt">
) {
  const key = fileKey(scope, path)
  const value = { ...file, updatedAt: Date.now() }
  memoryFiles.set(key, value)
  await writeRecord(FILE_STORE, { key, ...value })
}

export async function fetchSandboxTextFileIntoCache({
  diffKey,
  force = false,
  path,
  sandboxId,
  scope,
}: {
  diffKey?: string
  force?: boolean
  path: string
  sandboxId: string
  scope: string
}) {
  const cached = await readCachedTextFile(scope, path)
  if (!force && cached && (!diffKey || cached.diffKey === diffKey)) {
    return cached
  }

  const key = `${scope}\0${path}\0${sandboxId}\0${diffKey ?? ""}\0${
    force ? "force" : "cached"
  }`
  const inFlight = inFlightFileFetches.get(key)
  if (inFlight) return await inFlight

  const promise = (async () => {
    const params = new URLSearchParams({ path, sandboxId })
    const res = await fetch(`/api/sandbox/files/read?${params}`, {
      cache: "no-store",
    })
    const data = (await res.json()) as ReadResponse
    if (!res.ok || typeof data.content !== "string") {
      throw new Error(data.error ?? `Request failed (${res.status})`)
    }

    const file = {
      content: data.content,
      diffKey,
      modifiedTime: data.modifiedTime ?? null,
      sandboxId,
      size: data.size ?? new Blob([data.content]).size,
    }
    await writeCachedTextFile(scope, path, file)
    return { ...file, updatedAt: Date.now() }
  })()

  inFlightFileFetches.set(key, promise)
  try {
    return await promise
  } finally {
    inFlightFileFetches.delete(key)
  }
}
