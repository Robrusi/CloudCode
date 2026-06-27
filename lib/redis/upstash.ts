type UpstashResponse<T> = {
  error?: string
  result?: T
}

const DEFAULT_REDIS_COMMAND_TIMEOUT_MS = 5_000

export type UpstashRedisConfig = {
  token: string
  url: string
}

export function upstashRedisConfig(): UpstashRedisConfig | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  return url && token ? { token, url: url.replace(/\/+$/, "") } : null
}

export function isUpstashRedisConfigured() {
  return Boolean(upstashRedisConfig())
}

export async function upstashRedisCommand<T>(
  command: Array<string | number>,
  config = upstashRedisConfig(),
  options: { timeoutMs?: number } = {}
): Promise<T> {
  if (!config) {
    throw new Error(
      "Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to enable run streaming."
    )
  }

  const abort = new AbortController()
  const timeout = setTimeout(
    () => abort.abort(),
    options.timeoutMs ?? DEFAULT_REDIS_COMMAND_TIMEOUT_MS
  )

  const response = await fetch(config.url, {
    body: JSON.stringify(command),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
    signal: abort.signal,
  })
    .catch((error) => {
      throw error instanceof Error ? error : new Error("Redis command failed.")
    })
    .finally(() => clearTimeout(timeout))

  let payload: UpstashResponse<T>
  try {
    payload = (await response.json()) as UpstashResponse<T>
  } catch {
    throw new Error(`Redis command failed with HTTP ${response.status}.`)
  }

  if (!response.ok || payload.error) {
    throw new Error(
      payload.error || `Redis command failed with HTTP ${response.status}.`
    )
  }

  return payload.result as T
}
