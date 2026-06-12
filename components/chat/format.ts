import { parseGitHubRepoUrl } from "@/lib/github/repo"

const DISPLAY_THREAD_TITLE_MAX_CHARS = 48

export function repoLabel(url: string) {
  if (!url) return "Untitled"
  const parsed = parseGitHubRepoUrl(url)
  if (parsed) return `${parsed.owner}/${parsed.repo}`
  return url
    .replace(/^https?:\/\/(www\.)?github\.com\//, "")
    .replace(/\.git$/, "")
}

export function limitThreadDisplayTitle(title: string) {
  const chars = Array.from(title)
  if (chars.length <= DISPLAY_THREAD_TITLE_MAX_CHARS) return title
  return `${chars.slice(0, DISPLAY_THREAD_TITLE_MAX_CHARS - 3).join("")}...`
}
