# `lib/render/` — turning the tracker's data into `progress.html`

A progress file, its tickets and an explicit `generatedAt` go in; one self-contained document comes
out. Nothing here reads a clock, a working directory or the environment, which is why a spec can pin
the output.

The one file that touches disk for a *write* is `lib/render/Rerender.ts`, and it takes its two reads
as a **parameter** rather than importing `lib/progress/` or `lib/tickets/`, because those are sibling
features and `lib/ImportDirection.spec.ts` rule 5 refuses that edge. `cli/CommandSupport.ts` passes
the real store functions in. Every mutating command calls it **inside its lock**.

## Files

| File | What it is |
|---|---|
| `lib/render/Template.ts` | `renderProgressHtml(input)`: reads the template, writes the two islands, the page script and the title into it. |
| `lib/render/Template.spec.ts` | The tokens, the title, both islands round-tripping, hostile values neutralised, the missing-token refusal. |
| `lib/render/Markdown.ts` | `renderMarkdown(markdown)`: marked 17 with GFM, raw HTML escaped, only an allowlisted href scheme surviving. |
| `lib/render/Markdown.spec.ts` | The departures from marked's defaults, which are the reason this wrapper exists. |
| `lib/render/PageBundle.ts` | `bundlePageScript()`: `Bun.build` of the page entry, memoised per process, failure returned as a verdict. |
| `lib/render/PageBundle.spec.ts` | That it builds, that its output can neither close a `<script>` element nor open an HTML comment, and that the memoisation is real. |
| `lib/render/Rerender.ts` | `rerenderDashboard(input)`: read through the supplied `TrackerReads`, bundle, render, write atomically. |
| `lib/render/Rerender.spec.ts` | The three verdicts against a scratch workspace, with the reads supplied as literals. |
| `lib/render/GanttGeometry.spec.ts` | The geometry's spec — see below for why it is not beside its module. |
| `lib/render/PageData.spec.ts` | The island checks, the stored range and `effectiveRangeFor`. |
| `lib/render/WorkVisibility.spec.ts` | Which tasks and tickets count as long done, and what the hidden note says. |
| `lib/render/PageMarkup.spec.ts` | Every state's pill, the token figure, the log's sort, which ticket cards collapse, and the escaping. |
| `lib/render/page/template.html` | The designer's template: the styles, the state system, the containers and the bootstrap. Not generated. |
| `lib/render/page/GanttGeometry.ts` | `computeTimeline(input)`: the axis, the ticks, every bar and the now marker as percentages. Pure, no DOM. |
| `lib/render/page/PageData.ts` | The island shapes, the checks that establish them, and the stored range. DOM-free. |
| `lib/render/page/PageMarkup.ts` | Every string of HTML the page emits, as pure functions. DOM-free. |
| `lib/render/page/WorkVisibility.ts` | Whether a task or ticket has been done for longer than the window, the stored visibility and the hidden note. DOM-free. |
| `lib/render/page/GanttPage.ts` | The browser entry: DOM wiring only — find the container, call a builder, assign. |
| `lib/render/page/tsconfig.json` | The page's own project: `lib` `DOM`, `types` `[]`. |

## The template is the design, and the page fills it

`lib/render/page/template.html` is the designer's file, carried over rather than generated. It ships
placeholder content inside every container so it can be opened on its own, and **that placeholder
markup is the contract**: a change to what `lib/render/page/PageMarkup.ts` emits that is not also a
change there is a bug, in whichever direction it was made. The id and class list, the state table and
the script hooks are in the comment block at the top of the template and must stay in sync with it.

`lib/render/Template.ts` replaces four things in it — `__PROGRESS__`, `__TICKETS__`,
`__PAGE_SCRIPT__` and the `<title>` — by splitting on all four at once, so injected content is never
searched again and a task named `__TICKETS__` cannot be found by a later replacement. Each must occur
exactly once or the render refuses as `unrepaired`. The bootstrap's `window["__PAGE" + "_SCRIPT__"]`
is split on purpose and must stay split.

**The axis box is the invariant to protect.** `.ap-cell-track`, `#ap-ticks` and `#ap-overlay` all span
exactly the third grid column, edge to edge, with no padding or margin, so a percentage means the same
x in bars, tick labels, grid lines and the now marker; 0% is `range.from` and 100% is `range.to`.
Adding horizontal padding to any of the three silently misaligns the whole chart.

## What the template owns and what the page owns

The template's own bootstrap owns **theme, tab selection and ticket open state**, all restored from
`localStorage` before first paint so a reload looks identical. It exposes
`window.agentProgressTemplate` with `selectTab` and `restoreTicketOpenState`; those are the only two
things `lib/render/page/GanttPage.ts` may reach, and it calls the second one after replacing the
ticket cards the bootstrap had already applied the open set to.

Everything data-driven belongs to the page: the project name, the summary, the generated stamp, the
range bar's state, the ticks, the rows, the overlay, the log, the ticket table and the ticket cards.
It clears every one of those containers before parsing the islands, so a failure cannot leave the
template's convincing placeholder rows standing beside an error banner.

The page also decides `--timeline-w` on `#ap-chart`, which is the one thing the generator cannot know
because it depends on the window: `1fr` when the ticks fit, a px width when they need to scroll.

**Long-done work is hidden by default.** A task that is `reviewed`, `delivered` or `abandoned` and
ended more than `DONE_WORK_VISIBLE_MILLISECONDS` ago, and a ticket that is `done`, `delivered` or
`abandoned` and was last `updated` that long ago, are left out of the chart, the ticket table and the
cards until the viewer picks "Show all" (`#ap-visibility`, stored per tracker). The axis is computed
from the visible rows only. This is the page's one clock comparison, and it only decides what is shown.

**There is no stale banner** — it was cut from the design. Nothing on this side compares a clock
against `generatedAt`, and `lib/constants/Limits.ts` no longer needs
`STALE_PAGE_BANNER_MILLISECONDS`, `PAGE_SELF_CHECK_INTERVAL_MILLISECONDS` or `TICK_CHOICES_MINUTES`
(the tick menu is the template's own buttons now).

## `lib/render/page/` is DOM-only, and holds no spec

`lib/render/page/tsconfig.json` compiles that folder with the DOM library and **no Bun or Node
types**, so a page module reaching for `Bun.file` or `node:fs` fails to compile rather than failing in
a browser. The root project excludes the folder for the same reason in reverse. It additionally
compiles `lib/constants/Types.ts`, `lib/constants/Statuses.ts`, `lib/utils/HtmlEscapeUtil.ts`,
`lib/utils/TokenCountUtil.ts` and `lib/utils/TicketDependencyUtil.ts`, named one by one: none imports
anything beyond `lib/constants/`, and compiling them here is what proves they stay
environment-neutral. That is also what keeps the page from growing a second escaper, a second token
formatter and a second idea of when a ticket stops waiting.

The consequence: **no `*.spec.ts` may sit in `lib/render/page/`** — a spec's `bun:test` import would
not resolve there. A page module's spec goes one level up and reaches it by a relative import, which
is how `lib/render/GanttGeometry.spec.ts`, `lib/render/PageData.spec.ts`,
`lib/render/PageMarkup.spec.ts` and `lib/render/WorkVisibility.spec.ts` are placed. It is also why
`lib/render/page/GanttPage.ts` holds no logic worth testing: everything that could be was moved into
the DOM-free modules beside it.

## The limits travel as data

The page cannot import `lib/constants/Limits.ts`, so `lib/render/Template.ts` builds a `limits` object
from those constants into the progress island and `computeTimeline` takes it as a parameter.
`lib/render/Template.spec.ts` asserts that what reaches the browser is the constants themselves. The
five timestamp slice positions travel the same way, so no page module restates them.

## Local rules worth knowing

- **One pill per row, naming the state, no marks.** The only state a task status cannot name on its
  own is a `finished` row whose ticket is `in-review`, which reads `reviewing` — the one reason a row
  is handed its ticket's status at all. The other is the ✓ beside a `delivered` pill: the row's
  `reviewed` stamp, or, for rows older than that stamp, a ticket that is `delivered` (only legal from
  `done`).
- **Timestamps stored by the CLI are sliced, never re-parsed**; each carries the offset of the machine
  that recorded it. Instants the page computed (the axis, the now marker, the generated stamp) are
  formatted, because they have no written-down wall clock to preserve.
- **A ticket body is the one unescaped string on the page**, because `lib/render/Markdown.ts` has
  already escaped its raw HTML and dropped every href outside the scheme allowlist.
- **A failed page bundle is rendered, not refused**: the reason travels in the island and as a
  banner-only script, so a command that has already written `progress.json` still writes a page.
- The one exception to "no work at module load" is the last statement of
  `lib/render/page/GanttPage.ts`, which starts the page; a browser entry has no caller.
