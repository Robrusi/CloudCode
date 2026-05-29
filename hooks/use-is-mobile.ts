"use client"

import { useEffect, useState } from "react"

/** Viewport below Tailwind's `md` breakpoint — phones and small tablets. */
export const MOBILE_MEDIA_QUERY = "(max-width: 767px)"

/**
 * Tracks whether the viewport is in mobile (sub-`md`) range. SSR-safe: returns
 * `false` (desktop) until mounted, then syncs to the real viewport and updates
 * on change. Pair lazy state initializers with {@link MOBILE_MEDIA_QUERY} when
 * a correct first-paint value is needed before this effect runs.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_MEDIA_QUERY)
    const update = () => setIsMobile(mql.matches)
    update()
    mql.addEventListener("change", update)
    return () => mql.removeEventListener("change", update)
  }, [])

  return isMobile
}
