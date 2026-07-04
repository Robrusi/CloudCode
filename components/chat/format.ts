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

export function formatWorkedDuration(durationMs: number) {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  if (minutes > 0)
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
  return `${seconds}s`
}

export function limitThreadDisplayTitle(title: string) {
  const chars = Array.from(title)
  if (chars.length <= DISPLAY_THREAD_TITLE_MAX_CHARS) return title
  return `${chars.slice(0, DISPLAY_THREAD_TITLE_MAX_CHARS - 3).join("")}...`
}

const RUN_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  month: "short",
})

/** "Jul 3, 14:32" style local timestamp for run history rows. */
export function formatRunTime(ms: number) {
  return RUN_TIME_FORMAT.format(ms)
}

const RELATIVE_FORMAT = new Intl.RelativeTimeFormat(undefined, {
  numeric: "always",
  style: "narrow",
})

/** "in 3 hr" / "5 min ago" style compact relative time. */
export function formatRelative(ms: number, nowMs: number) {
  const deltaSeconds = Math.round((ms - nowMs) / 1000)
  const abs = Math.abs(deltaSeconds)
  if (abs < 60) return RELATIVE_FORMAT.format(deltaSeconds, "second")
  if (abs < 3600) {
    return RELATIVE_FORMAT.format(Math.round(deltaSeconds / 60), "minute")
  }
  if (abs < 86_400) {
    return RELATIVE_FORMAT.format(Math.round(deltaSeconds / 3600), "hour")
  }
  return RELATIVE_FORMAT.format(Math.round(deltaSeconds / 86_400), "day")
}
