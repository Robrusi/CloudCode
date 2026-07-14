const AUTUMN_API_BASE_URL = "https://api.useautumn.com"
const AUTUMN_REQUEST_TIMEOUT_MS = 15_000

type JsonObject = Record<string, unknown>

export type AutumnCustomer = {
  balances?: Record<
    string,
    {
      granted?: number
      nextResetAt?: number | null
      remaining?: number
      unlimited?: boolean
    }
  >
  id?: string | null
  subscriptions?: Array<{
    addOn?: boolean
    autoEnable?: boolean
    canceledAt?: number | null
    currentPeriodEnd?: number | null
    id?: string
    planId: string
    status?: string
  }>
}

type CustomerParams = {
  customerId: string
  email?: string
  fingerprint: string
  metadata?: Record<string, unknown>
  name?: string
}

type AttachParams = {
  customerId: string
  planId: string
  redirectMode?: "always" | "if_required" | "never"
  successUrl?: string
}

type UpdateParams = {
  cancelAction?: "cancel_immediately" | "uncancel"
  customerId: string
  noBillingChanges?: boolean
  planId: string
  subscriptionId?: string
}

type CheckParams = {
  customerId: string
  featureId: string
  requiredBalance?: number
  withPreview?: boolean
}

type TrackParams = {
  customerId: string
  featureId: string
  properties?: Record<string, unknown>
  value: number
}

type RequestOptions = {
  headers?: Record<string, string>
}

export type AutumnClient = {
  billing: {
    attach: (params: AttachParams) => Promise<{ paymentUrl?: string | null }>
    update: (params: UpdateParams) => Promise<unknown>
  }
  check: (params: CheckParams) => Promise<{ allowed: boolean }>
  customers: {
    getOrCreate: (params: CustomerParams) => Promise<AutumnCustomer>
  }
  rewards: {
    redeemCode: (params: {
      code: string
      customerId: string
    }) => Promise<unknown>
  }
  track: (params: TrackParams, options?: RequestOptions) => Promise<unknown>
}

/** Lightweight equivalent of the SDK error shape used by redemption error
 * handling. Keeping the response body makes Autumn's stable error code
 * available without loading its generated schema bundle. */
export class AutumnApiError extends Error {
  readonly body?: string
  readonly code?: string
  readonly status: number

  constructor({
    body,
    code,
    message,
    status,
  }: {
    body?: string
    code?: string
    message: string
    status: number
  }) {
    super(message)
    this.name = "AutumnApiError"
    this.body = body
    this.code = code
    this.status = status
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function camelCaseKey(key: string) {
  return key.replace(/_([a-z0-9])/g, (_, character: string) =>
    character.toUpperCase()
  )
}

/** Autumn returns snake_case. Balance IDs are dynamic feature IDs, so their
 * dictionary keys must remain unchanged while each balance value is decoded. */
function camelCaseResponse(value: unknown, preserveKeys = false): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => camelCaseResponse(entry))
  }
  if (!isJsonObject(value)) return value

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      const responseKey = preserveKeys ? key : camelCaseKey(key)
      const preserveChildKeys = key === "balances" || key === "metadata"
      return [responseKey, camelCaseResponse(entry, preserveChildKeys)]
    })
  )
}

function errorDetails(body: string) {
  try {
    const parsed = JSON.parse(body) as unknown
    if (!isJsonObject(parsed)) return {}
    const code = typeof parsed.code === "string" ? parsed.code : undefined
    const detail =
      typeof parsed.message === "string"
        ? parsed.message
        : typeof parsed.error === "string"
          ? parsed.error
          : undefined
    return { code, detail }
  } catch {
    return {}
  }
}

async function requestAutumn<T>({
  body,
  headers,
  path,
  secretKey,
}: {
  body: JsonObject
  headers?: Record<string, string>
  path: string
  secretKey: string
}): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    AUTUMN_REQUEST_TIMEOUT_MS
  )

  let response: Response
  try {
    response = await fetch(`${AUTUMN_API_BASE_URL}${path}`, {
      body: JSON.stringify(body),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${secretKey}`,
        "content-type": "application/json",
        ...headers,
      },
      method: "POST",
      signal: controller.signal,
    })
  } catch {
    const timedOut = controller.signal.aborted
    throw new AutumnApiError({
      message: timedOut
        ? `Autumn API request timed out after ${AUTUMN_REQUEST_TIMEOUT_MS}ms.`
        : "Autumn API request failed.",
      status: 0,
    })
  } finally {
    clearTimeout(timeout)
  }

  const responseBody = await response.text()
  if (!response.ok) {
    const { code, detail } = errorDetails(responseBody)
    throw new AutumnApiError({
      body: responseBody || undefined,
      code,
      message: detail
        ? `Autumn API request failed (${response.status}): ${detail}`
        : `Autumn API request failed (${response.status}).`,
      status: response.status,
    })
  }

  if (!responseBody) return {} as T
  return camelCaseResponse(JSON.parse(responseBody)) as T
}

/** The generated Autumn SDK currently exceeds Convex's 64 MB action limit
 * during module initialization. This focused HTTP client implements only the
 * operations CloudCode uses and preserves their wire format and response
 * shape without carrying the generated runtime schemas. */
export function createAutumnClient(secretKey: string): AutumnClient {
  const request = <T>(
    path: string,
    body: JsonObject,
    options?: RequestOptions
  ) =>
    requestAutumn<T>({
      body,
      headers: options?.headers,
      path,
      secretKey,
    })

  return {
    billing: {
      attach: (params) =>
        request("/v1/billing.attach", {
          customer_id: params.customerId,
          plan_id: params.planId,
          ...(params.redirectMode
            ? { redirect_mode: params.redirectMode }
            : {}),
          ...(params.successUrl ? { success_url: params.successUrl } : {}),
        }),
      update: (params) =>
        request("/v1/billing.update", {
          ...(params.cancelAction
            ? { cancel_action: params.cancelAction }
            : {}),
          customer_id: params.customerId,
          ...(params.noBillingChanges === undefined
            ? {}
            : { no_billing_changes: params.noBillingChanges }),
          plan_id: params.planId,
          ...(params.subscriptionId
            ? { subscription_id: params.subscriptionId }
            : {}),
        }),
    },
    check: (params) =>
      request("/v1/balances.check", {
        customer_id: params.customerId,
        feature_id: params.featureId,
        ...(params.requiredBalance === undefined
          ? {}
          : { required_balance: params.requiredBalance }),
        ...(params.withPreview === undefined
          ? {}
          : { with_preview: params.withPreview }),
      }),
    customers: {
      getOrCreate: (params) =>
        request("/v1/customers.get_or_create", {
          customer_id: params.customerId,
          ...(params.email ? { email: params.email } : {}),
          fingerprint: params.fingerprint,
          ...(params.metadata ? { metadata: params.metadata } : {}),
          ...(params.name ? { name: params.name } : {}),
        }),
    },
    rewards: {
      redeemCode: (params) =>
        request("/v1/rewards.redeem", {
          code: params.code,
          customer_id: params.customerId,
        }),
    },
    track: (params, options) =>
      request(
        "/v1/balances.track",
        {
          customer_id: params.customerId,
          feature_id: params.featureId,
          ...(params.properties ? { properties: params.properties } : {}),
          value: params.value,
        },
        options
      ),
  }
}
