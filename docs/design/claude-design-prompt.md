# Prompt for Claude Design

Paste the text below into Claude Design and attach `docs/design/sample-dashboard.html` as a visual
reference of the current page (it predates the single state pill and the scrolling timeline; treat
it as "where we are", not as the markup to edit).

---

Design a static HTML template for a progress dashboard. A command-line tool called `agent-progress`
takes the template, injects two JSON datasets and a small layout script, and writes one
self-contained `progress.html` after every command while an AI orchestrator and its subagents work in
a code repository. One engineer keeps that page open on a second screen for hours and glances at it
for ten seconds at a time to answer "where are we". The page reloads itself every 30 seconds.

The template is the deliverable. It is one HTML file with its CSS inline and three placeholders:
`__PROGRESS__` (a JSON island: the tracker file with its tasks, log and time range),
`__TICKETS__` (a JSON island: every ticket's metadata plus its body already rendered to HTML),
`__PAGE_SCRIPT__` (the script that reads both islands and fills the containers). Everything visible is
built by that script from the two datasets, so the template holds the shell, the containers, the
styles and the states, not the content.

What the page contains:
- A header: project name, and a summary line built from the data: generated time, tasks finished,
  reviewed, delivered, and total tokens reported.
- Two tabs, Progress and Tickets.
- Progress: a range bar (presets Auto, 1h, 4h, 12h, 24h, 7d, All, a from/to pair and a tick-size
  choice) and a Gantt chart. Each row: a row number, the task name, a small `#003` badge when the
  task belongs to a ticket, an optional muted token count such as `12.3k tokens`, exactly one state
  pill, and a bar on a time axis with tick labels. A vertical "now" marker crosses all rows. The
  timeline scrolls horizontally inside the chart when the range is long; the name and pill columns
  stay pinned on the left; short ranges fill the width without scrolling. Below the chart, a log card,
  newest first, with a time and a line of text per entry.
- Tickets: a table (id, title, type, status, group, branch, task) and one card per ticket with a meta
  line (filed, started, finished, delivered, branch, commit, reason) and a rendered markdown body
  (headings, lists, code blocks, tables). Done, delivered and abandoned cards are collapsed by default
  and remember being opened across reloads.
- A "stale" banner when the page is older than 90 seconds, and an error banner when the layout
  script failed to build.

States, in order of progress. Each task row shows exactly one pill, all pills the same size, no
check marks: "WIP" unmarked (pending, not started), "WIP" coloured (running), "finished",
"reviewing" (its ticket is in review), "reviewed", "delivered", "abandoned". Bars use the same state
colours; a running bar is hatched; an abandoned row is muted with a struck-through name. Ticket
statuses: open, in-progress, in-review, done, delivered, abandoned.

What I want from the pass:
1. A clear hierarchy: the summary line reads as a status, the chart is the hero, log and tickets
   are secondary.
2. One coherent state colour system (six states plus "now") for pills, bars and badges, in light and
   dark mode, WCAG AA contrast. A legend is optional if the pills carry the meaning.
3. Density for long sessions: 20 to 40 rows stay scannable; long names truncate with the full
   name on hover; the pinned columns have a fixed width so bars align.
4. A range bar that belongs to the page instead of looking like native form controls.
5. Ticket cards that read well with real markdown inside, and a collapsed state that still shows
   status, title and dates.
6. A stale banner that is unmissable without making the page look alarmed.
7. System fonts only.

Hard constraints:
- One file, no network: no web fonts, no icon fonts, no external CSS or JS. System font stack.
- The script fills containers by id and sets classes for states; give every container and state a
  stable, descriptive id or class and list them in a comment at the top of the template so the
  script can be written against them. Colours as custom properties on `:root` (light) and under
  `prefers-color-scheme: dark`.
- No animation on load and no hover-only information: the page is replaced every 30 seconds and
  must look identical before and after a reload.
- Primary target is a 1280 to 1920 px desktop window; it must not break at 1024 px.
- State is never conveyed by colour alone; the pill text carries it.

Deliverables: the template as one HTML file with placeholder content in the containers so it can
be previewed on its own, the id/class contract as a comment at the top, and a short list of design
tokens (colour, spacing, radius, type scale).
