# Admin editor and dashboard performance report

Author: AjiroDesu

No measurement here is "zero latency" — that is not physically achievable.
These are wall-clock numbers from the built production bundle with a mocked
network/API, so they isolate UI + local processing from real Discord/Telegram
or network latency.

## 1. What was wrong

The admin code editor rendered **every** source line as a gutter + code row on
every keystroke, and syntax-highlighted the whole document each time. A stale
`dist` was not the issue here; the DOM was:

| Initial working tree (dev server) | 510 lines | 5,100 lines | 25,500 lines |
| --- | ---: | ---: | ---: |
| Typing ms/char | 38.2 | 282.6 | 1301.5 |
| Editor DOM nodes | 2,255 | 15,309 | 76,509 |
| JS heap | 58 MB | 111 MB | 497 MB |
| Long-task total while typing 31 chars | 415 ms | 8,941 ms | 45,545 ms |

Additional stability gaps:

- a second `Ctrl+S` in the same render tick could issue a second write;
- a save that resolved after switching files could overwrite the new file's state;
- load/refresh completions could write into a different path after a route change;
- read failures bounced straight back to Files with no recovery;
- externally modified files were overwritten silently;
- only file **content** was prefetched — the editor chunk itself still loaded on click;
- every admin route chunk loaded on click, with no hover/idle warming.

## 2. Editor redesign

`CodeEditor` keeps the native textarea (IME, selection, undo, accessibility) but
the visual layer is now virtualized:

- one visual row per logical line, fixed 24 px, **no wrapping**, horizontal scroll;
- only viewport rows + 12 overscan rows are mounted (~143 editor nodes at any
  file size instead of 76k);
- rows are memoized, so caret-only changes update at most two rows;
- syntax highlighting is computed only under `CODE_HIGHLIGHT_MAX_CHARS`
  (80k); larger files edit as plain text with the same editor, gutter and save;
- the textarea is uncontrolled internally (the browser owns typing) and only
  re-synced when external content changes, avoiding a full value reassignment
  per keystroke;
- caret line/column uses a precomputed line-start index (binary search), not an
  O(n) scan;
- editor-driven selections (Tab/Enter) are restored after the controlled value
  commit; native undo is preserved via `execCommand` with a deterministic
  fallback;
- horizontal extents use the measured monospace advance (font-load aware), so
  the caret and text stay aligned; the gutter is sticky while scrolling.

Large files above 80k characters are plain text by design: tokenizing 25k lines
per keystroke is slower than the browser's textarea input floor. The status bar
says “Plain-text mode — large file”.

## 3. Stability fixes

- **Double-submit:** synchronous `saveLock` ref; two `Ctrl+S` presses produce
  exactly one PUT (covered by an E2E check).
- **Path switch race:** the latest path is captured in a render-time ref; a save
  or load that resolves after navigation is ignored by the old page. The save
  still persists to its original path, but cannot mutate the new editor.
- **Read race:** `AbortController` + cancellation flag; stale responses ignored.
  Multi-caller reads are shared, and aborting one waiter does not cancel the
  shared request.
- **Read failure:** in-place error panel with Retry/Back instead of a silent
  redirect.
- **Explicit reload:** bypasses the TTL cache, does not blank the editor, and is
  cancelled by path changes.
- **Save conflicts:** reads return a sha; saves send `expectedSha`; the server
  returns 409 if the file changed on disk, and the editor offers
  Reload-from-disk / Overwrite / Keep editing. No silent overwrite.
- **Cache seeding:** after a successful save the read cache is updated with the
  saved content + new sha, so reopening the file needs no read round-trip.
- **Chunk prefetch:** file hover/focus warms both content and the editor chunk;
  the Files page also warms the editor chunk on idle. Admin nav rows and the
  admin shell idle-warm every admin route chunk.

## 4. Measured results

### Production editor (1440×900, mocked API, 100 typed chars)

| File size | Open | Typing ms/char | Editor DOM nodes | JS heap | Long tasks while typing |
| --- | ---: | ---: | ---: | ---: | ---: |
| 510 lines | 440 ms | **4.8 ms** | 208 | 10 MB | 0 (0 ms) |
| 5,100 lines | 467 ms | **10.7 ms** | 143 | 10 MB | 1 (52 ms) |
| 25,500 lines | 638 ms | **48.9 ms** | 143 | 14 MB | 2 (238 ms) |

Same-harness dev-server before → after (the initial working tree vs final
source): typing **38.2 → 14.5 ms/char**, **282.6 → 19.1**, **1301.5 → 59.2**;
DOM **76,509 → 143** at 25.5k lines; heap **497 → 58 MB**; long-task time
**45,545 → 649 ms**. In production the same final source is faster again.

The 25k-line result is close to the browser's native-control floor: a bare
`<textarea>` with 25.5k lines measured **~80 ms/char** in the same headless
browser. The editor is below that because it avoids per-line layout, but it
cannot honestly reach a 16 ms frame for a 25k-line native input. Files that
size are rare; 5k lines is comfortably under one 60 Hz frame.

### Pinned editor chrome

The editor header (admin shell) and the status footer are outside the scroll
container. The page exactly cancels the admin main's padding (`-my-6 md:-my-8`)
and fills `100dvh − header`, so the editor begins flush below the header and the
footer ends flush at the viewport edge — no blank strips above or below. Only
the code surface scrolls. Header and footer are filled with real file state:
filename + directory + language chip in the header; language, UTF-8, LF, size
and dirty state in the footer (compact on mobile). The footer is always rendered (including while loading), so
the editor never changes height when a file finishes reading.

| Viewport | Document scroll | Header top | Footer bottom | Editor scroll |
| --- | ---: | ---: | ---: | ---: |
| 1440×900 | 900 = 900 | 0 | 900 (37 px bar) | 800 internal |
| 375×812 | 812 = 812 | 0 | 812 (37 px) | 800 internal |
| 667×375 | 375 = 375 | 0 | 375 (37 px) | 800 internal |
| 320×480 | 480 = 480 | 0 | 480 (37 px) | 800 internal |
| 390×360 (keyboard-sized) | 360 = 360 | 0 | 360 (37 px) | internal |

Scrolling the editor to 800 px leaves `window.scrollY = 0` and both bars in the
same position. The editor scroller uses `overscroll-contain`, and the shell
uses `overscroll-none`, so wheel/touch momentum cannot chain to the page.

### Dashboard navigation (production, mocked API)

| Transition | Time to usable content |
| --- | ---: |
| Cold `/dashboard` | 418 ms |
| Cold `/admin/dashboard` | 406 ms |
| Admin Overview → Users (in-app) | **30 ms** |
| Users → Files (in-app) | **33 ms** |
| Files → Editor (hover prefetch) | **28 ms** |

Cold loads include the shell + lazy page chunk; in-app transitions resolve
from already-warmed chunks and the persistent query cache. Public LCP measured
with the same mobile viewport: `/` **397 ms**, `/login` **95 ms**, CLS 0/0.004.

## 5. Validation

- `npm run test -w packages/web` — **62/62 pass** (includes new line-index tests).
- `npm test -w packages/cat-bot` — **74/74 pass**.
- `npm run lint --workspaces --if-present` — pass.
- `tsc` for web, cat-bot and database — **0 errors**.
- `npm run build` and `npm run build -w packages/web` — pass.
- `node scripts/editor-bench.mjs` — final numbers above.
- `node scripts/editor-resilience.mjs` — **14/14**: double save, path-switch
  race, read failure + retry, reload, external-change 409 + overwrite.
- `node scripts/dashboard-bench.mjs` — final numbers above.
- No page/console errors in the editor scenarios.

## 6. Remaining limitations

- **25k-line files still cost ~50 ms per keypress.** This is the native
  textarea/browser floor, not React or highlighting (highlighting is off).
  Going below it would require a fully custom canvas/contenteditable editor
  with custom IME, selection and undo — a large correctness risk for this
  admin panel. The editor stays fully usable and 25× faster than before.
- Cold route loads are ~400 ms locally because they include JS shell + chunk;
  in-app navigation is 28–33 ms. True “no loading” on a first visit would need
  a smaller critical bundle or streaming SSR, neither of which this SPA uses.
- Benchmarks use a mocked API on a local production preview; real file reads
  depend on disk/Git and are excluded from typing/open numbers (open includes
  the mocked read).
- Save-conflict handling is validated end-to-end against a mocked server with
  the same contract; the real server route types and 409 path are compiled but
  not integration-tested against a live checkout in this environment.
- No Lighthouse re-run was possible in this workspace after the previous
  cleanup removed the Lighthouse dev dependency; public LCP/CLS were measured
  directly with Chrome performance entries instead.
- Changes are intentionally **not committed** (the request did not ask for a
  commit), and the pre-existing uncommitted editor work was preserved and
  extended.
