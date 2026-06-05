/**
 * Shared surface treatments — the design language distilled from the context
 * menu and sandbox dropdown the user blessed as "perfect": generous rounding,
 * a hairline border, a calm neutral fill, and soft elevation only when a thing
 * actually floats.
 */

/** Floating surface: menus, dropdowns, popovers, dialogs. Flat; hairline border defines the edge. */
export const popoverSurfaceClass =
  "rounded-2xl border border-black/10 bg-popover text-popover-foreground dark:border-white/10"

/** Inline content card: same hairline border + rounding, no elevation. */
export const cardSurfaceClass =
  "rounded-2xl border border-black/10 bg-background dark:border-white/10"
