# README graphics

Everything that produced the screenshots, store panels, animation and diagrams in `docs/images/`, kept
in the repository, with only its `build/` ignored by git. The dashboard images are **generated from this checkout's own
CLI and page**: a synthetic board ("Example Storefront") is replayed through the real `agent-progress`
commands with a pinned clock, and headless Chrome photographs the page it renders. So after a change to
how the page looks, one command redraws them all with the new UI.

## After a UI change

```sh
.readme-graphics/regenerate.sh              # about 35 seconds; overwrites the dashboard images in docs/images/
git status docs/images                      # the images whose pixels changed
.readme-graphics/preview-readme.sh          # README.md as github.com shows it → build/preview/README-light.png
.readme-graphics/preview-readme.sh README.md dark
```

`--no-copy` builds into `build/images/` without touching `docs/images/`; `--keep-demo` keeps the demo
repository and prints where it is, so you can `agent-progress open` it (run from inside that folder). Look
at `build/contact-sheet.png` for every generated image on one page. A run is deterministic — the clock,
the time zone, the demo's commits (unsigned, with fixed dates) and the PNG encoding are all pinned — so
with no UI change `git status` shows nothing, and after one it shows exactly the images it affected.

The crops follow the page, not fixed pixels: the hero stops under the chart's last row, the Tickets shot
opens ticket #004 in the side panel with one click and runs from the tab row down to the panel, the Kanban
shot stops under the board (taken at a short viewport, since the lanes stretch with it), the detail shot
clicks task #2 once and is framed around the side panel. If an id or class the jobs rely on is renamed
(`#ap-rows`, `.ap-row`, `#ap-chart`, `.ap-range`, `.ap-tab-bar`, `#ap-ticket-rows`, `#ap-ticket-table`,
`#ap-kanban-frame`, `#ap-detail`, `#ap-task-2`), update the selectors in `compose.py` (`base_jobs`, `pages`).

## Requirements

Bun, git, Python 3 with Pillow, Google Chrome or Chromium (`CHROME_BINARY` overrides the path), and
`bun install` run in the checkout (the preview uses its `marked`). The preview also fetches
github-markdown-css from jsDelivr. Diagrams additionally need the `diagrams` skill's renderer at
`~/.claude/skills/diagrams/scripts/render.py` (qlmanage on macOS).

## Files

| file | what it does |
|---|---|
| `regenerate.sh` | The one command: seed → base screenshots with measurements → panels, frames, icon, story strips, animation frames → the two GIFs → copy the images the root README.md references into `docs/images/`; the rest stay in `build/images/`. |
| `seed-demo.sh` | The synthetic day, 08:58–13:36, as real CLI commands run under a pinned clock: ten tickets, real git branches, commits and `release`s in a throwaway repository, `task update --tokens` and the hook's log lines. Snapshots `progress.html` after every step. Edit the story here. |
| `demo-bodies/` | The mock ticket bodies. `NNN.md` is filed with the ticket; `NNN.handoff.md` and `NNN.reviewN.md` are appended when the builder and each reviewer would write them, which is what numbers the review rows. |
| `freeze-clock.js` | Preloaded into the CLI (`bun --preload`): every `Date` reads the story time in `STORY_CLOCK`. |
| `shoot.js` | Headless Chrome over the DevTools protocol, from a JSON job list: frozen clock, colour scheme, time zone, pre-seeded `localStorage` (theme, tab), an in-page action (the click that opens the side panel), clips by selector, and element measurements written to `build/measurements.json`. |
| `compose.py` | The layout: which screenshots to take (`base-jobs`), the store panels, window frames, icon, story strips and GIF frames (`pages`), the board-day GIF (`gif`), the animated hero `panel-watch.gif` (`hero-gif`), the contact sheet (`sheet`). Panel headlines and subheads live here. |
| `render-diagrams.py` | Re-renders `lifecycle`, `architecture`, `terminal-setup` and `terminal-init` from their SVGs in `docs/images/` and clears the corners outside each card. Only after editing an SVG. |
| `render-readme.js`, `preview-readme.sh` | A GitHub-like render of a README (GitHub's sanitiser imitated: no style, class or script) and a full-page screenshot of it. |
| `build/` | Everything a run writes: snapshots, jobs, shots, pages, frames, images, previews. Safe to delete. |

## What is not generated

- **The two terminal windows** (`terminal-setup.svg`, `terminal-init.svg`) are the real output of
  `./setup.sh` and `agent-progress init` with home paths shortened, typed into the SVG by hand. When either
  command's output changes, edit the text in the SVG and run `python3 .readme-graphics/render-diagrams.py
  terminal-setup` (or `terminal-init`).
- **The lifecycle and architecture diagrams** describe the dispatcher and the CLI, not the page; edit the
  SVG when the mechanism changes, then `render-diagrams.py`.
- **The icon** is `docs/images/icon.svg`; `regenerate.sh` only rasterises it.
- **The words on the READMEs** — including the numbers they quote from the demo (16.3M tokens, 912
  reworked lines, 7 of 13 settled) — are written by hand. Changing the story in `seed-demo.sh` means
  checking those sentences.

## Safety

The demo repository is always built in a temporary folder outside this checkout — `seed-demo.sh`
refuses a work folder inside it — and `AGENT_PROGRESS_ROOT` is unset for every command. Never run
`agent-progress` against this checkout to make graphics: `init` there, with the variable pointing
elsewhere, once replaced this repository's own board.

## The images and what each shows

| file | shows | used by |
|---|---|---|
| `icon.png` | Dark rounded square with four Gantt bars in the pill colours and a red now-line. | every README |
| `board-day.gif` | The board through the day, 09:10 → 13:40, 29 frames (mostly ten-minute steps), light theme, a 10-second loop. | README.md ("See it in action"), keynote, day on the board |
| `panel-watch.gif` | Store panel "Watch your agents work." with the Progress tab replayed 09:10 → 13:40 inside its window, 91 frames at 100 ms, transparent corners. | README.md (hero) |
| `panel-watch.png` | The same panel, still: the base the GIF is laid into. | — |
| `panel-kanban.png` | "Every ticket on one board." — the Kanban tab, light. | README.md |
| `panel-story.png` | "Click for the whole story." — the detail panel of #002 with its six phases. | README.md |
| `panel-tickets.png` | "Tickets an agent can build unasked." — the Tickets tab with #004's body in the side panel. | README.md |
| `panel-themes.png` | "Light or dark. Your call." — the Progress tab split diagonally, light and dark. | README.md, keynote, day on the board |
| `panel-cost.png` | "Know what every agent cost." — the token column, dark. | README.md, keynote |
| `frame-hero-*.png` | The Progress tab in a macOS window, light or dark. | keynote, day on the board |
| `frame-tickets-*.png` | The Tickets tab and #004 in the side panel, in a window. | keynote, day on the board |
| `frame-kanban-*.png` | The Kanban tab in a window. | — |
| `frame-detail-*.png` | The detail panel of #002 in a window. | keynote |
| `story-0916.png` … `story-1340.png` | The chart alone at 09:16, 10:25, 11:36, 12:12 and 13:40. | day on the board |
| `lifecycle.png`, `architecture.png` | The two diagrams (SVG sources beside them). | every README |
| `terminal-setup.png`, `terminal-init.png` | `./setup.sh` and `agent-progress init` in a terminal window. | every README |
