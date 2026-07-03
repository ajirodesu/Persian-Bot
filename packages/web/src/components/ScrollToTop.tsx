import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * ScrollToTop
 *
 * React Router's client-side navigation swaps route elements in place —
 * it never triggers a real page load, so the browser has no reason to
 * reset scroll position the way it would for a normal <a> navigation.
 * Left alone, a page can mount already scrolled to wherever the previous
 * page happened to be left (e.g. open Settings, scroll down, navigate to
 * Bot Manager → it opens mid-scroll instead of at the top).
 *
 * Mount one instance near the root of each independent route subtree
 * (public shell, dashboard shell, admin shell) — it has no visual output,
 * it just watches the pathname and snaps the window back to (0, 0) on
 * every route change.
 */
export default function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}
