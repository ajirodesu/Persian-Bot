/**
 * Unified Header Design Tokens
 *
 * Single source of truth for every sizing, spacing, and typography value
 * shared across all four header regions:
 *
 *   1. Landing Page Header          (Layout.tsx)
 *   2. Main Dashboard Header        (DashboardLayout.tsx)
 *   3. Admin Dashboard Header       (AdminSidebarLayout.tsx — content strip)
 *   4. Admin Sidebar Header         (AdminSidebarLayout.tsx — sidebar strip)
 *
 * A single change here propagates atomically to every header surface.
 *
 * Desktop Responsiveness
 * ──────────────────────
 * Tokens that carry responsive Tailwind prefixes (xl:, 2xl:, 3xl:, 4xl:)
 * scale purely at desktop widths (≥ 1024 px). No mobile or tablet breakpoints
 * are introduced here. Tokens that reference CSS custom properties
 * (var(--layout-*)) derive their values from the @media blocks defined in
 * styles/tokens.css for fluid, continuous scaling across all desktop sizes.
 */

// ─── Structural ────────────────────────────────────────────────────────────

/**
 * Vertical footprint — 64 px baseline (56 px on mobile, < md, for a
 * trimmer header strip on small screens without touching desktop).
 * Scales up at ultra-wide viewports (3xl = 1920 px, 4xl = 2560 px).
 */
export const H_HEIGHT =
  'h-14 md:h-16 3xl:h-[4.5rem] 4xl:h-20' as const

/**
 * Horizontal padding on all nav / header containers. Tighter on mobile
 * (< md) so edge controls like the hamburger and profile icon sit closer
 * to the screen edges; unchanged on desktop.
 */
export const H_PX = 'px-3 md:px-6' as const

/**
 * Desktop sidebar width (admin).
 * Driven by the --layout-sidebar-w CSS custom property so the sidebar grows
 * continuously as the viewport widens, matching the content area's scaling.
 */
export const H_SIDEBAR_WIDTH = 'w-[var(--layout-sidebar-w)]' as const

// ─── Logo & Brand ──────────────────────────────────────────────────────────

/**
 * Cat logo icon dimensions — em-relative so the icon scales with the brand
 * text. Smaller on mobile (< md) to match the trimmer header; unchanged on
 * desktop.
 */
export const H_LOGO_ICON = 'h-8 w-8 md:h-10 md:w-10' as const

/**
 * Brand / page-title typography. One step down on mobile (< md) to match
 * the trimmer header; unchanged on desktop.
 */
export const H_BRAND_TEXT = 'text-title-md md:text-title-lg font-semibold' as const

// ─── Desktop Navigation Items ──────────────────────────────────────────────

/** Base classes for desktop horizontal nav links (colours applied per-component). */
export const H_NAV_ITEM =
  'inline-flex items-center gap-2 px-3 py-2 rounded-lg text-label-lg font-medium transition-colors duration-fast' as const

// ─── Mobile Navigation Items ───────────────────────────────────────────────

/** Base classes for mobile drawer nav links (full-width touch targets). */
export const H_NAV_ITEM_MOBILE =
  'flex items-center gap-3 w-full px-4 py-3 rounded-xl text-label-lg font-medium transition-colors duration-fast' as const

// ─── User / Admin Avatar ───────────────────────────────────────────────────

/**
 * Circular avatar dimensions. One notch smaller on mobile (< md) to match
 * the trimmer header; unchanged on desktop. Scales at ultra-wide viewports.
 */
export const H_AVATAR =
  'h-8 w-8 md:h-9 md:w-9 3xl:h-10 3xl:w-10 4xl:h-11 4xl:w-11' as const

/**
 * Typography inside avatar circle and dropdown header. One step down on
 * mobile (< md); unchanged on desktop.
 */
export const H_AVATAR_TEXT =
  'text-label-md md:text-label-lg font-semibold' as const

// ─── Mobile Header Icon-Button Sizing (Hamburger / Profile Triggers) ───────

/**
 * Shrinks the tap target and glyph of the header's edge `IconButton`s
 * (hamburger open/close) on mobile only, reverting to the standard
 * `size="md"` footprint (40px box / 20px icon) at md and above.
 *
 * Uses `!` (important) modifiers because `IconButton` appends its own
 * `size` classes via a plain string join (see `cn.util.ts`) — without
 * `!important` this override would be at the mercy of Tailwind's internal
 * stylesheet ordering rather than reliably winning.
 */
export const H_ICON_BTN_MOBILE =
  '!w-9 !h-9 md:!w-10 md:!h-10 [&>svg]:!w-[18px] [&>svg]:!h-[18px] md:[&>svg]:!w-5 md:[&>svg]:!h-5' as const

// ─── Dropdown Menu Trigger ─────────────────────────────────────────────────

/** User menu trigger button classes (layout + spacing only). */
export const H_MENU_TRIGGER =
  'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-label-lg font-medium' as const

/** Chevron icon in menu triggers. */
export const H_CHEVRON = 'h-4 w-4 3xl:h-5 3xl:w-5' as const

// ─── Sidebar Navigation (Admin) ────────────────────────────────────────────

/** Admin sidebar nav item classes. */
export const H_SIDEBAR_NAV =
  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-label-lg font-medium transition-colors duration-fast' as const

/** Icon size inside sidebar nav items. */
export const H_SIDEBAR_ICON = 'h-4 w-4 shrink-0 3xl:h-5 3xl:w-5' as const

// ─── Dropdown Panel ────────────────────────────────────────────────────────

/** Dropdown menu item row classes. */
export const H_DROPDOWN_ITEM =
  'w-full flex items-center gap-3 px-4 py-2.5 text-label-lg text-left transition-colors duration-fast' as const

/** Icon size inside dropdown rows. */
export const H_DROPDOWN_ICON = 'h-4 w-4 shrink-0' as const
