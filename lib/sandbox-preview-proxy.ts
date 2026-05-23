import {
  createServer,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type Server,
} from "node:http"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import type { AddressInfo } from "node:net"
import type { Duplex } from "node:stream"

import {
  getDaytonaSandboxPreviewLink,
  getDaytonaSandboxPreviewSignedUrl,
  normalizeDaytonaSandboxPreviewTarget,
  type SandboxPreviewTarget,
} from "@/lib/daytona-sandbox"

const LOCAL_PROXY_HOST = "127.0.0.1"
const PORT_PROXY_PREFIX = "/__cloudcode_proxy_port/"
const PROXY_VERSION = "9"
const PREVIEW_LINK_TTL_MS = 10_000
const IDLE_CLOSE_MS = 30 * 60 * 1000
const SANDBOX_LOCAL_HOSTS = new Set([
  "0.0.0.0",
  "127.0.0.1",
  "::1",
  "[::1]",
  "localhost",
])

type PreviewLink = {
  expiresAt: number
  token: string
  url: string
}

type PreviewProxyState = {
  defaultPort: number
  idleTimer?: ReturnType<typeof setTimeout>
  links: Map<number, PreviewLink>
  port: number
  sandboxId: string
  server: Server
}

declare global {
  var __cloudcodePreviewProxyServers:
    | Map<string, Promise<PreviewProxyState>>
    | undefined
}

function proxyServers() {
  globalThis.__cloudcodePreviewProxyServers ??= new Map()
  return globalThis.__cloudcodePreviewProxyServers
}

export async function getSandboxPreviewProxyUrl({
  requestHost,
  sandboxId,
  targetUrl,
}: {
  requestHost?: string | null
  sandboxId: string
  targetUrl: string
}) {
  const target = normalizeDaytonaSandboxPreviewTarget(targetUrl)
  const state = await getPreviewProxyServer(sandboxId, target.port)
  await previewLink(state, target.port)
  const baseUrl = await browserProxyBaseUrl(requestHost, state.port)
  return targetToProxyUrl(baseUrl, target)
}

async function getPreviewProxyServer(sandboxId: string, defaultPort: number) {
  const key = `${PROXY_VERSION}:${sandboxId}:${defaultPort}`
  const servers = proxyServers()
  let existing = servers.get(key)
  if (!existing) {
    existing = startPreviewProxyServer(sandboxId, defaultPort, key)
    servers.set(key, existing)
  }
  return await existing
}

async function startPreviewProxyServer(
  sandboxId: string,
  defaultPort: number,
  key: string
) {
  const state: PreviewProxyState = {
    defaultPort,
    links: new Map(),
    port: 0,
    sandboxId,
    server: createServer(),
  }

  state.server.on("request", (request, response) => {
    void proxyRequest(state, request, response)
  })
  state.server.on("upgrade", (request, socket, head) => {
    void proxyUpgrade(state, request, socket, head)
  })
  state.server.on("error", () => {
    proxyServers().delete(key)
  })

  await new Promise<void>((resolve, reject) => {
    state.server.once("error", reject)
    state.server.listen(0, LOCAL_PROXY_HOST, () => {
      state.server.off("error", reject)
      resolve()
    })
  })

  const address = state.server.address() as AddressInfo | null
  if (!address) {
    state.server.close()
    proxyServers().delete(key)
    throw new Error("Failed to start sandbox preview proxy.")
  }

  state.port = address.port
  scheduleIdleClose(state, key)
  return state
}

function scheduleIdleClose(state: PreviewProxyState, key: string) {
  if (state.idleTimer) clearTimeout(state.idleTimer)
  state.idleTimer = setTimeout(() => {
    state.server.close()
    proxyServers().delete(key)
  }, IDLE_CLOSE_MS)
  state.idleTimer.unref?.()
}

function targetToProxyUrl(baseUrl: string, target: SandboxPreviewTarget) {
  const url = new URL(baseUrl)
  url.pathname = target.pathname || "/"
  url.search = target.search
  url.hash = target.hash
  return url.toString()
}

async function browserProxyBaseUrl(
  requestHost: string | null | undefined,
  port: number
) {
  const daytonaHost = parseDaytonaPreviewHost(requestHost)
  if (!daytonaHost) return `http://${LOCAL_PROXY_HOST}:${port}/`

  try {
    const signedUrl = await getDaytonaSandboxPreviewSignedUrl(
      daytonaHost.sandboxId,
      port
    )
    const url = new URL(signedUrl)
    url.pathname = "/"
    url.search = ""
    url.hash = ""
    return url.toString()
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Daytona error."
    throw new Error(
      `Failed to expose the sandbox preview proxy through Daytona for ${daytonaHost.sandboxId}: ${message}`
    )
  }
}

function parseDaytonaPreviewHost(hostHeader: string | null | undefined) {
  const host = firstHeaderValue(hostHeader)
  if (!host) return null

  let hostname: string
  try {
    hostname = new URL(`http://${host}`).hostname.toLowerCase()
  } catch {
    return null
  }

  if (!hostname.includes("daytonaproxy")) return null

  const firstLabel = hostname.split(".")[0]
  const match = firstLabel.match(/^[0-9]{1,5}-(.+)$/)
  if (!match?.[1]) return null

  return {
    sandboxId: match[1],
  }
}

function firstHeaderValue(value: string | null | undefined) {
  return value?.split(",")[0]?.trim() || null
}

function requestTarget(request: IncomingMessage, defaultPort: number) {
  const requestUrl = new URL(request.url || "/", "http://cloudcode.local")
  const match = requestUrl.pathname.match(
    /^\/__cloudcode_proxy_port\/([0-9]{1,5})(\/.*)?$/
  )
  if (!match) {
    return {
      pathname: requestUrl.pathname,
      port: defaultPort,
      search: requestUrl.search,
    }
  }

  const port = Number(match[1])
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Port must be between 1 and 65535.")
  }

  return {
    pathname: match[2] || "/",
    port,
    search: requestUrl.search,
  }
}

async function previewLink(state: PreviewProxyState, port: number) {
  const cached = state.links.get(port)
  if (cached && cached.expiresAt > Date.now()) return cached

  return await refreshPreviewLink(state, port)
}

async function refreshPreviewLink(state: PreviewProxyState, port: number) {
  const link = await getDaytonaSandboxPreviewLink(state.sandboxId, port)
  const preview = {
    expiresAt: Date.now() + PREVIEW_LINK_TTL_MS,
    token: link.token,
    url: link.url,
  }
  state.links.set(port, preview)
  return preview
}

function upstreamUrlFor(link: PreviewLink, pathname: string, search: string) {
  const url = new URL(link.url)
  const basePath = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "")
  url.pathname = `${basePath}${pathname.startsWith("/") ? pathname : `/${pathname}`}`

  const params = new URLSearchParams(url.search)
  const requestParams = new URLSearchParams(search)
  for (const [key, value] of requestParams) params.append(key, value)
  url.search = params.toString()

  return url
}

async function proxyRequest(
  state: PreviewProxyState,
  request: IncomingMessage,
  response: import("node:http").ServerResponse
) {
  scheduleIdleClose(
    state,
    `${PROXY_VERSION}:${state.sandboxId}:${state.defaultPort}`
  )

  try {
    const target = requestTarget(request, state.defaultPort)
    const body = await requestBody(request)
    let link = await previewLink(state, target.port)
    let upstreamResponse = await fetchPreviewRequest(
      request,
      link,
      target.pathname,
      target.search,
      body
    )

    if (isDaytonaAuthRedirect(upstreamResponse)) {
      link = await refreshPreviewLink(state, target.port)
      upstreamResponse = await fetchPreviewRequest(
        request,
        link,
        target.pathname,
        target.search,
        body
      )
    }

    const headers = responseHeaders(
      upstreamResponse.headers,
      target.port,
      link.url
    )
    const contentType = upstreamResponse.headers.get("content-type") || ""
    const status = upstreamResponse.status

    if (request.method === "HEAD") {
      response.writeHead(status, headers)
      response.end()
      return
    }

    if (isRewritableText(contentType)) {
      const body = rewritePreviewOrigins(
        await upstreamResponse.text(),
        target.port
      )
      const text = contentType.includes("text/html")
        ? injectPreviewBootstrap(body, state.defaultPort)
        : body
      headers["content-type"] = contentType
      response.writeHead(status, headers)
      response.end(text)
      return
    }

    response.writeHead(status, headers)
    response.end(Buffer.from(await upstreamResponse.arrayBuffer()))
  } catch (error) {
    writeProxyError(response, error)
  }
}

async function fetchPreviewRequest(
  request: IncomingMessage,
  link: PreviewLink,
  pathname: string,
  search: string,
  body: BodyInit | undefined
) {
  return await fetch(upstreamUrlFor(link, pathname, search), {
    body,
    headers: requestHeaders(request, link),
    method: request.method,
    redirect: "manual",
  })
}

function isDaytonaAuthRedirect(response: Response) {
  if (response.status < 300 || response.status >= 400) return false

  const location = response.headers.get("location")
  if (!location) return false

  return (
    location.includes("daytonaio.us.auth0.com/authorize") &&
    location.includes("daytonaproxy")
  )
}

function isRewritableText(contentType: string) {
  return (
    contentType.includes("text/html") ||
    contentType.includes("javascript") ||
    contentType.includes("text/css") ||
    contentType.includes("application/json")
  )
}

async function proxyUpgrade(
  state: PreviewProxyState,
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer
) {
  scheduleIdleClose(
    state,
    `${PROXY_VERSION}:${state.sandboxId}:${state.defaultPort}`
  )

  try {
    const target = requestTarget(request, state.defaultPort)
    const link = await previewLink(state, target.port)
    const upstreamUrl = upstreamUrlFor(link, target.pathname, target.search)
    const upstreamRequest = (
      upstreamUrl.protocol === "https:" ? httpsRequest : httpRequest
    )({
      headers: upgradeHeaders(request, upstreamUrl, link),
      hostname: upstreamUrl.hostname,
      method: "GET",
      path: `${upstreamUrl.pathname}${upstreamUrl.search}`,
      port: upstreamUrl.port || (upstreamUrl.protocol === "https:" ? 443 : 80),
      protocol: upstreamUrl.protocol,
    })

    upstreamRequest.on(
      "upgrade",
      (upstreamResponse, upstreamSocket, upstreamHead) => {
        socket.write(
          [
            `HTTP/${upstreamResponse.httpVersion} ${upstreamResponse.statusCode} ${upstreamResponse.statusMessage}`,
            ...Object.entries(upstreamResponse.headers).flatMap(
              ([name, value]) =>
                Array.isArray(value)
                  ? value.map((item) => `${name}: ${item}`)
                  : value === undefined
                    ? []
                    : [`${name}: ${value}`]
            ),
            "",
            "",
          ].join("\r\n")
        )

        if (upstreamHead.length) socket.write(upstreamHead)
        if (head.length) upstreamSocket.write(head)
        upstreamSocket.pipe(socket)
        socket.pipe(upstreamSocket)
      }
    )

    upstreamRequest.on("response", (upstreamResponse) => {
      socket.write(
        `HTTP/${upstreamResponse.httpVersion} ${upstreamResponse.statusCode} ${upstreamResponse.statusMessage}\r\n\r\n`
      )
      upstreamResponse.on("data", (chunk) => socket.write(chunk))
      upstreamResponse.on("end", () => socket.end())
    })

    upstreamRequest.on("error", (error) => {
      socket.end(proxySocketError(error))
    })

    upstreamRequest.end()
  } catch (error) {
    socket.end(proxySocketError(error))
  }
}

function requestHeaders(request: IncomingMessage, link: PreviewLink) {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    const lowerName = name.toLowerCase()
    if (
      lowerName === "accept-encoding" ||
      lowerName === "connection" ||
      lowerName === "content-length" ||
      lowerName === "host" ||
      lowerName === "transfer-encoding"
    ) {
      continue
    }

    if (Array.isArray(value)) {
      headers.set(name, value.join(", "))
    } else if (value !== undefined) {
      headers.set(name, value)
    }
  }
  headers.set("accept-encoding", "identity")
  headers.set("x-daytona-preview-token", link.token)
  headers.set("x-daytona-skip-preview-warning", "true")
  headers.set("x-daytona-disable-cors", "true")
  headers.set("x-forwarded-host", forwardedHost(request))
  return headers
}

function upgradeHeaders(
  request: IncomingMessage,
  upstreamUrl: URL,
  link: PreviewLink
) {
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(request.headers)) {
    const lowerName = name.toLowerCase()
    if (lowerName === "host") continue

    if (Array.isArray(value)) {
      headers[name] = value.join(", ")
    } else if (value !== undefined) {
      headers[name] = value
    }
  }
  headers.host = upstreamUrl.host
  headers["x-daytona-preview-token"] = link.token
  headers["x-daytona-skip-preview-warning"] = "true"
  headers["x-daytona-disable-cors"] = "true"
  headers["x-forwarded-host"] = forwardedHost(request)
  return headers
}

function forwardedHost(request: IncomingMessage) {
  return (
    firstHeaderValue(request.headers["x-forwarded-host"]?.toString()) ??
    firstHeaderValue(request.headers.host?.toString()) ??
    `${LOCAL_PROXY_HOST}:0`
  )
}

async function requestBody(request: IncomingMessage) {
  if (request.method === "GET" || request.method === "HEAD") return undefined

  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function responseHeaders(
  headers: Headers,
  targetPort: number,
  previewUrl: string
) {
  const result: OutgoingHttpHeaders = {}
  for (const [name, value] of headers) {
    const lowerName = name.toLowerCase()
    if (
      lowerName === "connection" ||
      lowerName === "content-encoding" ||
      lowerName === "content-length" ||
      lowerName === "content-security-policy" ||
      lowerName === "set-cookie" ||
      lowerName === "transfer-encoding"
    ) {
      continue
    }
    result[name] =
      lowerName === "location"
        ? rewriteLocation(value, targetPort, previewUrl)
        : value
  }

  const setCookie = (
    headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie?.()
  if (setCookie?.length) result["set-cookie"] = setCookie

  return result
}

function rewriteLocation(
  location: string,
  targetPort: number,
  previewUrl: string
) {
  try {
    const preview = new URL(previewUrl)
    const url = new URL(location, preview)
    const previewPort = daytonaPreviewPort(url.hostname)
    const isPreview = url.origin === preview.origin || previewPort !== null
    const isSandboxLocal = SANDBOX_LOCAL_HOSTS.has(url.hostname.toLowerCase())
    if (!isPreview && !isSandboxLocal) return location

    const port =
      previewPort ??
      (isPreview
        ? targetPort
        : Number(url.port || (url.protocol === "https:" ? "443" : "80")))
    const path = `${url.pathname}${url.search}${url.hash}`
    return port === targetPort ? path : `${PORT_PROXY_PREFIX}${port}${path}`
  } catch {
    return location
  }
}

function daytonaPreviewPort(hostname: string) {
  const normalized = hostname.toLowerCase()
  if (!normalized.includes("daytonaproxy")) return null

  const match = normalized.match(/^([0-9]{1,5})-/)
  if (!match) return null

  const port = Number(match[1])
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null
}

function rewritePreviewOrigins(text: string, targetPort: number) {
  return text
    .replace(
      /https?:\/\/([0-9]{1,5})-[A-Za-z0-9.-]*daytonaproxy[A-Za-z0-9.-]*/g,
      (_match, rawPort: string) => {
        const port = Number(rawPort)
        return port === targetPort ? "" : `${PORT_PROXY_PREFIX}${port}`
      }
    )
    .replace(
      /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::([0-9]{1,5}))?/g,
      (_match, rawPort: string | undefined) => {
        const port = rawPort ? Number(rawPort) : targetPort
        return port === targetPort ? "" : `${PORT_PROXY_PREFIX}${port}`
      }
    )
}

function injectPreviewBootstrap(html: string, defaultPort: number) {
  const bootstrap = `<script>${previewBootstrapScript(defaultPort)}</script>`
  if (html.includes("<head>"))
    return html.replace("<head>", `<head>${bootstrap}`)
  if (html.includes("<head ")) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${bootstrap}`)
  }
  return `${bootstrap}${html}`
}

function previewBootstrapScript(defaultPort: number) {
  return `
(() => {
  const defaultPort = ${JSON.stringify(defaultPort)};
  const portPrefix = ${JSON.stringify(PORT_PROXY_PREFIX)};
  const localHosts = new Set(["0.0.0.0", "127.0.0.1", "::1", "[::1]", "localhost"]);

  function daytonaPreviewPort(hostname) {
    const normalized = String(hostname).toLowerCase();
    if (!normalized.includes("daytonaproxy")) return null;
    const match = normalized.match(/^([0-9]{1,5})-/);
    if (!match) return null;
    const port = Number(match[1]);
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
  }

  function portFor(url) {
    if (url.port) return Number(url.port);
    if (url.protocol === "https:" || url.protocol === "wss:") return 443;
    return 80;
  }

  function localProxyPath(url) {
    const port = portFor(url);
    const path = url.pathname + url.search + url.hash;
    return port === defaultPort ? path : portPrefix + port + path;
  }

  function rewriteHttpUrl(value) {
    try {
      const url = new URL(String(value), window.location.href);
      const previewPort = daytonaPreviewPort(url.hostname);
      if (previewPort !== null) {
        return (previewPort === defaultPort ? "" : portPrefix + previewPort) +
          url.pathname + url.search + url.hash;
      }
      if (localHosts.has(url.hostname.toLowerCase())) return localProxyPath(url);
    } catch {}
    return value;
  }

  function rewriteWebSocketUrl(value) {
    try {
      const url = new URL(String(value), window.location.href);
      if (url.origin === window.location.origin) return value;
      const previewPort = daytonaPreviewPort(url.hostname);
      if (previewPort !== null) {
        const nextPath =
          (previewPort === defaultPort ? "" : portPrefix + previewPort) +
          url.pathname + url.search + url.hash;
        return window.location.origin.replace(/^http/, "ws") + nextPath;
      }
      if (localHosts.has(url.hostname.toLowerCase())) {
        const nextPath = localProxyPath(url);
        return window.location.origin.replace(/^http/, "ws") + nextPath;
      }
    } catch {}
    return value;
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (input instanceof Request) {
      const nextUrl = rewriteHttpUrl(input.url);
      return nativeFetch(
        nextUrl === input.url ? input : new Request(nextUrl, input),
        init
      );
    }
    return nativeFetch(rewriteHttpUrl(input), init);
  };

  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    return nativeOpen.call(this, method, rewriteHttpUrl(url), ...rest);
  };

  const NativeEventSource = window.EventSource;
  if (NativeEventSource) {
    window.EventSource = function(url, config) {
      return new NativeEventSource(rewriteHttpUrl(url), config);
    };
    window.EventSource.prototype = NativeEventSource.prototype;
  }

  const NativeWebSocket = window.WebSocket;
  if (NativeWebSocket) {
    window.WebSocket = function(url, protocols) {
      const nextUrl = rewriteWebSocketUrl(url);
      return protocols === undefined
        ? new NativeWebSocket(nextUrl)
        : new NativeWebSocket(nextUrl, protocols);
    };
    window.WebSocket.prototype = NativeWebSocket.prototype;
  }
})();
`
}

function writeProxyError(
  response: import("node:http").ServerResponse,
  error: unknown
) {
  const message =
    error instanceof Error ? error.message : "Failed to proxy sandbox preview."
  response.writeHead(502, {
    "content-type": "text/html; charset=utf-8",
  })
  response.end(`<!doctype html>
<html>
  <head>
    <title>Sandbox preview failed</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 48px; color: #202124; background: #fafafa; }
      main { max-width: 720px; }
      h1 { font-size: 24px; margin: 0 0 12px; }
      p { color: #5f6368; line-height: 1.5; }
      code { background: #f1f3f4; border-radius: 6px; padding: 2px 5px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Sandbox preview failed</h1>
      <p>${escapeHtml(message)}</p>
    </main>
  </body>
</html>`)
}

function proxySocketError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : "Failed to proxy sandbox websocket."
  return `HTTP/1.1 502 Bad Gateway\r\ncontent-type: text/plain; charset=utf-8\r\n\r\n${message}`
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
