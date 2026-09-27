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
 * Page header content height — h-14 (56px), identical to the sidebar identity
 * row. Both bars carry the same 1px H_SEPARATOR line, so every header
 * separator across sidebar and content sits at exactly 57px and all divider
 * lines align on one horizontal plane.
 */
export const H_HEIGHT = 'h-14' as const

/**
 * Bot Manager horizontal inset: 20px on every viewport.
 */
export const H_PX = 'px-5' as const

/**
 * Header separator — the sidebar header's 1px line style, shared by every
 * page header (public shell, dashboard content bar, admin content bar,
 * chat-room bar) so all top bars divide from content with identical weight.
 * Theme-aware: each theme defines --color-separator in its own register.
 */
export const H_SEPARATOR = 'border-separator' as const

/**
 * Desktop sidebar width (admin).
 * Driven by the --layout-sidebar-w CSS custom property so the sidebar grows
 * continuously as the viewport widens, matching the content area's scaling.
 */
export const H_SIDEBAR_WIDTH = 'w-[var(--layout-sidebar-w)]' as const

// ─── Logo & Brand ──────────────────────────────────────────────────────────

/**
 * Cat logo icon dimensions — 20px Bot Manager optical size.
 */
export const H_LOGO_ICON = 'h-5 w-5' as const

/**
 * Brand / page-title typography — 16px semibold Bot Manager title.
 */
export const H_BRAND_TEXT = 'text-base font-semibold' as const

// ─── User / Admin Avatar ───────────────────────────────────────────────────

/**
 * Circular avatar dimensions. One notch smaller on mobile (< md) to match
 * the trimmer header; unchanged on desktop. Scales at ultra-wide viewports.
 */
export const H_AVATAR = 'h-7 w-7' as const

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
// 36px Bot Manager control target with 20px glyph; 44px hit-slop
// preserves touch ergonomics without growing the visual footprint.
export const H_ICON_BTN_MOBILE =
  'relative !w-9 !h-9 [&>svg]:!w-5 [&>svg]:!h-5 before:absolute before:left-1/2 before:top-1/2 before:h-[var(--touch-target-min)] before:w-[var(--touch-target-min)] before:-translate-x-1/2 before:-translate-y-1/2 before:content-[""]' as const

/** Chevron icon in menu triggers. */
export const H_CHEVRON = 'h-4 w-4 3xl:h-5 3xl:w-5' as const

// ─── Sidebar Navigation (Admin) ────────────────────────────────────────────

/** Sidebar nav item — compact standard scale: h-11 rows, 14px labels. */
export const H_SIDEBAR_NAV =
  'flex items-center gap-3 px-3 h-11 rounded-xl text-sm tracking-tight transition-colors duration-100' as const

/** Icon size inside sidebar nav items — 20px standard. */
export const H_SIDEBAR_ICON = 'h-5 w-5 shrink-0' as const

// ─── Dropdown Panel ────────────────────────────────────────────────────────

/** Dropdown menu item row classes. */
export const H_DROPDOWN_ITEM =
  'w-full flex items-center gap-3 px-4 py-2.5 text-label-lg text-left transition-colors duration-fast' as const

/** Icon size inside dropdown rows. */
export const H_DROPDOWN_ICON = 'h-4 w-4 shrink-0' as const
