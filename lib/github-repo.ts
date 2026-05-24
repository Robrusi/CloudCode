export type GitHubRepo = {
  owner: string
  repo: string
}

export function parseGitHubRepoUrl(input: string): GitHubRepo | null {
  const value = input.trim().replace(/\.git$/, "")

  const sshShorthand = value.match(
    /^git@github\.com:([^/\s]+)\/([^/\s]+?)\/?$/i
  )
  if (sshShorthand) return { owner: sshShorthand[1], repo: sshShorthand[2] }

  const ownerRepo = value.match(/^([^/\s:@]+)\/([^/\s:@]+?)\/?$/)
  if (ownerRepo) return { owner: ownerRepo[1], repo: ownerRepo[2] }

  try {
    const url = new URL(value)
    if (
      url.protocol !== "https:" &&
      url.protocol !== "http:" &&
      url.protocol !== "ssh:"
    ) {
      return null
    }
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
      return null
    }

    const match = url.pathname
      .replace(/\/+$/, "")
      .match(/^\/(?:git@)?([^/\s]+)\/([^/\s]+?)$/)

    return match ? { owner: match[1], repo: match[2] } : null
  } catch {
    return null
  }
}

export function canonicalGitHubRepoUrl(input: string) {
  const parsed = parseGitHubRepoUrl(input)
  return parsed ? `https://github.com/${parsed.owner}/${parsed.repo}.git` : null
}
