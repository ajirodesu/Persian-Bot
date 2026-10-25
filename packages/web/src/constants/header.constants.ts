/**
 * Shared Shell Tokens — "telemetry printout"
 *
 * Single source of truth for the geometry and typography of every shell
 * surface:
 *
 *   1. Public shell header        (components/layout/Layout.tsx)
 *   2. Dashboard rail + header    (features/users/components/DashboardLayout.tsx)
 *   3. Admin rail + header        (features/admin/components/AdminSidebarLayout.tsx)
 *   4. Shared rail footer         (components/layout/SidebarFooter.tsx)
 *
 * The shell reads as a printed technical document: flat ink fills, 1px
 * hairline rules, mono ordinals, and hierarchy carried by scale and weight —
 * never by shadow, blur, glow, or rounded boxes. One primary accent marks the
 * current page, keyboard focus, and the single primary action.
 *
 * Layout widths and insets are the fluid `--layout-*` clamp() values declared
 * in styles/tokens.css; this file only references them, it never re-declares
 * them per breakpoint.
 */

// ─── Structural ────────────────────────────────────────────────────────────

/**
 * Shell bar height — h-14 (56px), identical for the page header and the
 * sidebar identity row. Both carry the same 1px H_SEPARATOR line, so every
 * divider across rail and content sits on one horizontal plane.
 */
export const H_HEIGHT = 'h-14' as const

/**
 * Shell horizontal inset — 16px on phones, 24px from md up. Keeps the header
 * text aligned with the document body instead of floating inward.
 */
export const H_PX = 'px-4 md:px-6' as const

/**
 * Shell separator — the 1px line that divides a bar from its content, shared
 * by every header (public shell, dashboard, admin, chat room). Theme-aware:
 * each theme defines --color-separator in its own register.
 */
export const H_SEPARATOR = 'border-separator' as const

/**
 * Shell surface fill — the opaque header paint (--color-header-surface,
 * mapped to the `header-surface` Tailwind color). Every page header paints
 * this so the top bar and the navigation rail read as one continuous shell.
 */
export const H_SURFACE = 'bg-header-surface' as const

/**
 * Navigation rail width.
 * Driven by the --layout-sidebar-w CSS custom property so the rail grows
 * continuously as the viewport widens, matching the content area's scaling.
 */
export const H_SIDEBAR_WIDTH = 'w-[var(--layout-sidebar-w)]' as const

// ─── Logo & Brand ──────────────────────────────────────────────────────────

/**
 * Brand mark dimensions — 20px optical size, aligned to the cap height of the
 * adjacent wordmark.
 */
export const H_LOGO_ICON = 'h-5 w-5' as const

/**
 * Wordmark / page-label typography — condensed, uppercase, widely tracked.
 * Signage, not a paragraph title: it names the surface, it does not introduce
 * prose.
 */
export const H_BRAND_TEXT =
  'font-brand text-[15px] uppercase tracking-[0.16em] leading-none' as const

/** Mono scope tag ("/ DASH", "/ ADMIN", "OPERATIONS CONSOLE"). */
export const H_SHELL_SCOPE =
  'font-mono text-[10px] uppercase tracking-[0.2em] text-on-surface-variant/85 select-none' as const

// ─── User / Admin Avatar ───────────────────────────────────────────────────

/**
 * Square avatar plate — 24px. A printed stamp, never a circle.
 */
export const H_AVATAR = 'h-6 w-6' as const

/**
 * Typography inside the avatar plate and dropdown identity block — mono
 * initials, tracked so two letters read as a field code.
 */
export const H_AVATAR_TEXT =
  'font-mono text-[10px] font-semibold tracking-[0.04em]' as const

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
// 36px control target with 20px glyph; 44px hit-slop preserves touch
// ergonomics without growing the visual footprint.
export const H_ICON_BTN_MOBILE =
  'relative !w-9 !h-9 [&>svg]:!w-5 [&>svg]:!h-5 before:absolute before:left-1/2 before:top-1/2 before:h-[var(--touch-target-min)] before:w-[var(--touch-target-min)] before:-translate-x-1/2 before:-translate-y-1/2 before:content-[""]' as const

/** Chevron icon in menu triggers. */
export const H_CHEVRON = 'h-4 w-4 3xl:h-5 3xl:w-5' as const

// ─── Sidebar Navigation ────────────────────────────────────────────────────

/**
 * Ledger row — one line of the navigation table: a 2px left rule (transparent
 * until the row is current), a mono ordinal, an icon, and a label. No radius,
 * no floating background box: hover and active states are flat fills.
 *
 * Active rows add `border-l-primary bg-primary/[0.06] text-on-surface`; hover
 * adds `bg-surface-container-high text-on-surface`. The current-page rule
 * sets the left colour on its own (`border-l-*`) because `cn()` is a plain
 * string join and would otherwise let this token's `border-transparent` win
 * on stylesheet order.
 */
export const H_SIDEBAR_NAV =
  'group relative flex items-center gap-2.5 h-10 pl-2.5 pr-2 border-l-2 border-transparent text-body-sm transition-colors duration-fast' as const

/**
 * Ordinal column — two-digit mono index ("01", "02") right-aligned in a fixed
 * 20px gutter so every label in the rail starts on the same vertical line.
 */
export const H_SIDEBAR_INDEX =
  'w-5 shrink-0 text-right font-mono text-[10px] tabular-nums tracking-[0.08em]' as const

/**
 * Section label — a `.rule-label` field marker ("PAGES ──────────"), padded to
 * the rail's own inset so it aligns with the ledger rows below it.
 */
export const H_SECTION_LABEL = 'rule-label pl-2.5 pr-1 pt-4 pb-2' as const

// ─── Dropdown Panel ────────────────────────────────────────────────────────

/** Dropdown menu item row classes — compact mono ledger entries. */
export const H_DROPDOWN_ITEM =
  'w-full flex items-center gap-2.5 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.06em] text-left transition-colors duration-fast' as const

/** Icon size inside dropdown rows. */
export const H_DROPDOWN_ICON = 'h-4 w-4 shrink-0' as const
