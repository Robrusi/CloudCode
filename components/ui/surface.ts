/**
 * Shared surface treatments — the design language distilled from the context
 * menu and sandbox dropdown the user blessed as "perfect": generous rounding,
 * a hairline border, a calm neutral fill, and soft elevation only when a thing
 * actually floats.
 */

/** Floating surface: menus, dropdowns, popovers, dialogs. Soft drop shadow. */
export const popoverSurfaceClass =
  "rounded-2xl border border-black/[0.06] bg-popover text-popover-foreground shadow-[0_10px_30px_-12px_rgba(0,0,0,0.18)] dark:border-white/10"

/** Inline content card: same hairline border + rounding, no elevation. */
export const cardSurfaceClass =
  "rounded-2xl border border-black/[0.06] bg-background dark:border-white/10"
