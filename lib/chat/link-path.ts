export function normalizeLinkHref(href: string) {
  const trimmed = href.trim().replace(/^<(.+)>$/, "$1")
  if (/^(https?:\/\/|mailto:|\/|#)/i.test(trimmed)) return trimmed
  if (looksLikeFileHref(trimmed)) return trimmed
  return undefined
}

function looksLikeFileHref(href: string) {
  if (/^(file:\/\/|\.{1,2}\/|~\/)/.test(href)) return true
  if (/^[\w@.-]+\.[A-Za-z0-9]+(?::\d+(?::\d+)?)?(?:#L\d+)?$/.test(href)) {
    return true
  }
  if (/^[\w@.-]+(?:\/[\w@.-]+)+(?::\d+(?::\d+)?)?(?:#L\d+)?$/.test(href)) {
    return true
  }
  return false
}

export function getFilePathFromHref(href: string, repoName: string | null) {
  if (/^(https?:\/\/|mailto:|#)/i.test(href)) return null

  let path = href.trim()
  try {
    path = decodeURI(path)
  } catch {
    // Keep the raw href if it is not URI-encoded cleanly.
  }

  path = path.replace(/^file:\/\//i, "")
  path = path.replace(/#L\d+$/i, "")
  path = path.replace(/:\d+(?::\d+)?$/, "")
  path = path.replace(/^\.\/+/, "")

  const sandboxRepoRoots = [
    "/home/daytona/repo/",
    "/home/user/repo/",
    "/root/repo/",
  ]
  for (const repoRoot of sandboxRepoRoots) {
    if (path.startsWith(repoRoot)) {
      return sanitizeRelativeFilePath(path.slice(repoRoot.length))
    }
  }

  const repoRootIndex = path.indexOf("/repo/")
  if (repoRootIndex >= 0) {
    return sanitizeRelativeFilePath(path.slice(repoRootIndex + "/repo/".length))
  }

  if (repoName) {
    const repoMarker = `/${repoName}/`
    const repoIndex = path.lastIndexOf(repoMarker)
    if (repoIndex >= 0) {
      return sanitizeRelativeFilePath(path.slice(repoIndex + repoMarker.length))
    }
  }

  if (path.startsWith("/")) {
    return null
  }

  if (!looksLikeFileHref(path)) return null
  return sanitizeRelativeFilePath(path)
}

function sanitizeRelativeFilePath(path: string) {
  const cleaned = path.replace(/^\/+/, "")
  if (!cleaned || cleaned.split("/").includes("..")) return null
  return cleaned
}
