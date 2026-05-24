import { NextResponse } from "next/server"

function firstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() || null
}

function normalizeOrigin(value: string | null) {
  if (!value) return null

  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

function requestOrigins(request: Request) {
  const url = new URL(request.url)
  const origins = new Set<string>([url.origin])
  const requestProtocol = url.protocol.replace(/:$/, "")
  const forwardedProtocol =
    firstHeaderValue(request.headers.get("x-forwarded-proto")) ??
    requestProtocol
  const hosts = [
    firstHeaderValue(request.headers.get("host")),
    firstHeaderValue(request.headers.get("x-forwarded-host")),
  ].filter((host): host is string => Boolean(host))

  for (const host of hosts) {
    origins.add(`${requestProtocol}://${host}`)
    origins.add(`${forwardedProtocol}://${host}`)
  }

  return origins
}

export function sameOriginRequest(request: Request) {
  const origin = normalizeOrigin(request.headers.get("origin"))
  if (origin) return requestOrigins(request).has(origin)

  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase()
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return false
  }

  return true
}

export function requireSameOrigin(request: Request) {
  if (sameOriginRequest(request)) return null

  return NextResponse.json(
    { error: "Cross-origin request blocked." },
    { status: 403 }
  )
}
