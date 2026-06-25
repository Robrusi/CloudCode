"use client"

type JsonErrorBody = {
  error?: unknown
}

type JsonRequestOptions = {
  fallbackError?: string
}

type JsonMutationMethod = "DELETE" | "PATCH" | "POST" | "PUT"

type JsonMutationOptions = JsonRequestOptions & {
  init?: Omit<RequestInit, "body" | "method">
}

export class JsonRequestError extends Error {
  body: unknown
  status: number

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = "JsonRequestError"
    this.body = body
    this.status = status
  }
}

function jsonErrorMessage(data: unknown) {
  const body = data as JsonErrorBody
  return typeof body?.error === "string" && body.error.trim()
    ? body.error
    : undefined
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  options: JsonRequestOptions = {}
): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  })
  const data = (await response.json().catch(() => ({}))) as unknown

  if (!response.ok) {
    throw new JsonRequestError(
      jsonErrorMessage(data) ??
        options.fallbackError ??
        `Request failed (${response.status}).`,
      response.status,
      data
    )
  }

  return data as T
}

export function requestJson<T>(
  url: string,
  method: JsonMutationMethod,
  body: unknown,
  options: JsonMutationOptions = {}
) {
  const { init = {}, ...requestOptions } = options
  return fetchJson<T>(
    url,
    {
      ...init,
      body: JSON.stringify(body),
      method,
    },
    requestOptions
  )
}

function isTransientRequestError(error: unknown) {
  // Network failures reject before a response arrives (e.g. TypeError) and 5xx
  // responses are server-side blips — both are worth retrying. Deterministic
  // 4xx failures (auth, validation, same-origin) will never succeed on retry.
  if (error instanceof JsonRequestError) {
    return error.status >= 500
  }
  return true
}

/**
 * Runs a JSON request with bounded retries on transient failures. Deterministic
 * client errors (4xx) are surfaced immediately without retrying.
 */
export async function retryJsonRequest<T>(
  request: () => Promise<T>,
  {
    attempts = 3,
    baseDelayMs = 250,
  }: { attempts?: number; baseDelayMs?: number } = {}
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await request()
    } catch (error) {
      lastError = error
      if (attempt >= attempts || !isTransientRequestError(error)) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt))
    }
  }
  throw lastError
}

export function postJson<T>(
  url: string,
  body: unknown,
  init: Omit<RequestInit, "body" | "method"> = {},
  options?: JsonRequestOptions
) {
  return requestJson<T>(url, "POST", body, { ...options, init })
}
