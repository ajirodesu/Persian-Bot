---
name: dark-ui
description: Build dark-mode-only user interfaces. Use for any web or app UI, CSS, Tailwind, or component styling task.
compatibility: opencode
metadata:
  author: AjiroDesu
---

- Dark mode only: no light theme, no theme toggle, no `prefers-color-scheme` branching.
- Define colors as CSS variables on `:root` (background, surface, border, text, muted, accent).
- Background near-black (not pure #000), text at least 4.5:1 contrast, one accent color.
- Layered surfaces via slightly lighter backgrounds, not heavy shadows.
- Set `color-scheme: dark` and style scrollbars, inputs, and focus rings to match.
- Mobile first, 44px minimum touch targets.
