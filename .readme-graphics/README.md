# README graphics

Everything that produces the screenshots and diagrams in `docs/images/`, kept in the repository, with only its
`build/` ignored by git. The Bridge images are **generated from this checkout's own CLI and Overseer**: a synthetic
board ("Example Storefront") is filed through the real commands in a scratch tracker, this checkout's `oversee` starts an
Overseer on it with the fake agent adapter, and headless Chrome photographs each view of the Bridge it serves. So
after a change to how the Bridge looks, one command redraws them all.

## After a UI change

```sh
.readme-graphics/regenerate.sh              # overwrites the Bridge images README.md shows in docs/images/
git status docs/images                      # the images whose pixels changed
.readme-graphics/preview-readme.sh          # README.md as github.com shows it → build/preview/README-light.png
.readme-graphics/preview-readme.sh README.md dark
```

`--no-copy` builds into `build/images/` without touching `docs/images/`; `--keep-demo` keeps the demo repository
and prints where it is. The tickets' filing stamps are pinned, but the Overseer runs on the real clock and its fake
agents race it, so jobs, states and times may differ between runs: look at the images before committing them.

## Requirements

Bun, git, Google Chrome or Chromium (`CHROME_BINARY` overrides the path), and `bun install` run in the checkout. The
preview also needs `marked` and fetches github-markdown-css from jsDelivr. Diagrams additionally need Python 3 with
Pillow and the `diagrams` skill's renderer at `~/.claude/skills/diagrams/scripts/render.py` (qlmanage on macOS).

## Files

| file | what it does |
|---|---|
| `regenerate.sh` | The one command: seed → Overseer and shots → copy the images the root README.md references into `docs/images/`; the rest stay in `build/images/`. |
| `seed-demo.sh` | Files the board through the CLI under a pinned clock in a throwaway repository with a home of its own: two epics, sixteen tickets whose dependencies make the waves (two chains meeting in the one-ticket wave of #012), one abandoned, two left as drafts for intake, the rest readied. |
| `bridge-demo.sh` | Starts `oversee --port 0 --detach` on the seeded board with the fake agent switch on, resumes it so it launches builders that keep working, records an intake, waits for the jobs to appear, shoots each view, and stops the Overseer. |
| `demo-bodies/` | The mock ticket bodies, `NNN.md` filed with each ticket. |
| `freeze-clock.js` | Preloaded into the CLI (`bun --preload`): every `Date` reads the story time in `STORY_CLOCK`. |
| `shoot.js` | Headless Chrome over the DevTools protocol, from a JSON job list of files (`html`) or live pages (`url`): frozen clock, colour scheme, time zone, pre-seeded `localStorage`, an in-page action, clips by selector, and element measurements. |
| `render-diagrams.py` | Re-renders `lifecycle`, `architecture`, `terminal-setup` and `terminal-init` from their SVGs in `docs/images/` and clears the corners outside each card. Only after editing an SVG. |
| `render-readme.js`, `preview-readme.sh` | A GitHub-like render of a README (GitHub's sanitiser imitated: no style, class or script) and a full-page screenshot of it. |
| `build/` | Everything a run writes. Safe to delete. |

## What is not generated

- **The two terminal windows** (`terminal-setup.svg`, `terminal-init.svg`) are the real output of
  `./setup.sh` and `agent-progress init` with home paths shortened, typed into the SVG by hand. When either
  command's output changes, edit the text in the SVG and run `python3 .readme-graphics/render-diagrams.py
  terminal-setup` (or `terminal-init`).
- **The lifecycle and architecture diagrams** describe the mechanism, not the Bridge; edit the SVG when the
  mechanism changes, then `render-diagrams.py`.
- **The icon** is `docs/images/icon.svg` with its raster `icon.png` beside it.
- **The words on the READMEs** are written by hand. Changing the story in `seed-demo.sh` means checking them.

## Safety

The demo repository is always built in a temporary folder outside this checkout — `seed-demo.sh` refuses a work
folder inside it — and the root override variables are unset for every command. Both scripts set `HOME` to a folder
inside the work folder for every CLI command and the Overseer, so the monitor registry, the Watcher sockets and the
agent transcripts they write stay there; only Chrome keeps the user's home. The Overseer runs with the fake agent
switch on, so it never launches a vendor's agent, and with its keeps-working switch on, so no session ends unreported
and no outage pauses the board. Never run `agent-progress` against this checkout to make graphics:
`init` there, with the variable pointing elsewhere, once replaced this repository's own board.

## The images and what each shows

| file | shows |
|---|---|
| `bridge-kanban.png` | The Kanban view, light: the header with the Overseer's controls and statistics, then the lanes. |
| `bridge-kanban-dark.png` | The same view in the dark theme. |
| `bridge-progress.png` | The Progress view: a Gantt row per ticket, then the waves. |
| `bridge-tickets.png` | The Tickets view with #012 open in the detail panel. |
| `bridge-agents.png` | The Agents view: every job the Overseer launched. |
| `bridge-merge-queue.png` | The Merge queue view, opened from the Kanban. |
| `bridge-questions.png` | The Questions view: open decisions and incidents. |
| `bridge-assistant.png` | The Assistant view: the Overseer's orchestrating session. |
| `bridge-intake.png` | The Intake view: the New request box and the product-owner session. |
| `icon.png` | Dark rounded square with four Gantt bars and a red now-line. |
| `lifecycle.png`, `architecture.png` | The two diagrams (SVG sources beside them). |
| `terminal-setup.png`, `terminal-init.png` | `./setup.sh` and `agent-progress init` in a terminal window. |
