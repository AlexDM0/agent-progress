# Plan: `agent-progress` — a Bun CLI progress tracker with tickets and a Gantt UI

## Context

`company-builder/progress/` is a one-off, per-session tracker: a hand-edited `progress.json`
(categories with `pending|running|finished|reviewed`, ISO timestamps, owner, note, plus a log)
and a 74-line `render.py` that writes a self-contained `progress.html` Gantt. It works, but it is
not installable, agents have no instructions for it, and tickets live elsewhere (`docs/tickets/*.md`)
with no link to the chart.

Goal: a standalone, globally linked Bun CLI, `agent-progress`, that any repo can adopt with
`agent-progress init`. An AI orchestrator drives it purely through CLI commands. Tickets are
stateful markdown files inside `.agent-progress/tickets/`; every ticket has a Gantt row, and ticket
state changes move that row automatically. Every mutating command regenerates the HTML, which
auto-refreshes every 30 s in the browser. A bundled Claude Code skill is auto-linked by `setup.sh`
(vkb pattern), and the claude config repo is told the skill is externally managed.

New project lives in the empty `~/development/progress-tracker` (git init, no commit).

## Decisions taken with Alex

- Every ticket gets a Gantt row when filed (pending); `ticket start/review/done/abandon` move it.
  Non-ticket tasks (planning, review passes, ticket groups) still exist via `task` commands.
- `init` writes a managed block into the target repo's `CLAUDE.md`, so "tell a repo to use
  agent-progress" = the agent runs `agent-progress init`.
- `clear` wipes tasks + log and resets `startedAt`; ticket files survive and their rows are
  re-seeded from ticket frontmatter. `clear --all` also deletes tickets (ids restart at 001).
- The Gantt time range is modifiable: a stored default via `agent-progress range`, and in-page
  presets/inputs that survive the refresh.
- `setup.sh` modelled on vkb's. `~/development/claude/skills.json` `ignore`
  list gets `"agent-progress"` so that repo's `install.sh` never adopts/clobbers the symlink.
- Identifiers fully spelled out, English only, no AI attribution anywhere.

## Decisions taken after the adversarial review

- **One tracker per repository, shared by every worktree.** Root = `git rev-parse --git-common-dir`
  resolved to the main checkout (fallback: parse a `.git` *file*'s `gitdir:` up to `/.git/worktrees/`);
  no git → cwd, or `--root <path>`. `realpath` cwd first. Subagents in `.claude/worktrees/*` therefore
  write to the same `.agent-progress/`.
- **Render happens under the lock**, from disk, and `progress.html` is written tmp + rename too.
- **Lock** file holds `pid` + timestamp; a waiter that sees a stale lock (older than 30 s, or its pid
  dead) `rename`s it to a unique name and only the successful renamer proceeds.
- **Ticket frontmatter records its own timeline** (`started`, `finished`, `abandonedAt`), set by the
  transitions, so `clear` can re-seed real bars, and unknown frontmatter keys agents add by hand are
  preserved in order.
- **Timestamp backfill** with `--at <iso|-5m>` on every state-changing command and `log`.
- `clear` without `--yes` on a non-TTY stdin exits 1 with a message instead of hanging.

## Coding conventions (mandatory, verbatim from Alex)

The project adopts the `vkb` repository's conventions in full. The authoritative text is the guideline
block Alex supplied (stored in memory as `coding-conventions-from-vkb`); step 1 of the implementation
writes it, unabridged, into the project root `CLAUDE.md`. The consequences that shape this plan:

- **Layering**: `lib/constants/` (imports nothing) → `lib/utils/` (imports constants only; each util is a
  pure module exporting one frozen object named after the file, e.g. `TimeUtil.formatLocalIso`) →
  `lib/platform/` → feature folders (`lib/progress/`, `lib/tickets/`, `lib/render/`) → `cli/`. Imports run
  up the tree only, never sideways between features, nothing in `lib/` imports `cli/`. No barrel files.
  Enforced by `lib/ImportDirection.spec.ts` (asserts a floor on edges scanned).
- **No work at module load**; `process.env` read only in `lib/platform/Environment.ts` through getters
  (`lib/EnvironmentReads.spec.ts` guards it).
- **Library code never calls `process.exit`**: refusals are `OperationRefusal` (typed, with a status) and
  `cli/Main.ts` maps them to exit codes — 0 done or nothing to do, 1 a refusal the caller can act on,
  2 a state the tool will not repair. The argument parser therefore throws `OperationRefusal` for a
  valueless option instead of exiting (the one deliberate divergence from vkb's parser).
- **Every file a reader may hold open is written through `lib/platform/AtomicFile.ts`** (temp beside the
  target, fsync, rename): `progress.json`, `progress.html`, ticket files. `CLAUDE.md` and `.gitignore` are
  edited in place on purpose (a symlinked CLAUDE.md must stay a symlink) and the docblock says so.
- **A clock decides nothing**, with two stated exceptions, each comparing times the tool itself wrote:
  lock staleness (lock payload timestamp vs now) and ordering the log for display.
  Gantt geometry only *displays* recorded timestamps.
- **Design-decision constants** live in `lib/constants/` with units in their names
  (`LOCK_STALE_MILLISECONDS`, `LOCK_RETRY_COUNT`, `LOCK_RETRY_INTERVAL_MILLISECONDS`, `PAGE_REFRESH_SECONDS`,
  `STALE_PAGE_BANNER_MILLISECONDS`, `TICK_STEP_LADDER_MINUTES`, `MAXIMUM_TICKS_PER_AXIS`,
  `AXIS_MINIMUM_SPAN_MINUTES`, `AXIS_PADDING_MINUTES`, `MINIMUM_BAR_WIDTH_PERCENT`, `TICKET_ID_DIGITS`).
- **Comments** carry rationale, measurement and the rejected alternative; every module and export has a
  docblock; no TODOs (agreed-not-started work goes to `docs/backlog.md`, rejected ideas with their reason
  to `docs/decisions.md`).
- **Docs beside the code**: root `CLAUDE.md` (map + rules) and one `CLAUDE.md` per substantial folder
  (`cli/`, `lib/`, `lib/tickets/`, `lib/render/`, `skill/`) with per-file one-liners, updated in the same
  change that adds or renames a file. A docs guard spec checks every backticked repo path exists.
- **Tests**: `bun:test`, sentence-claim names, docblock naming the load-bearing cases, guards assert a floor
  and are proven by introducing the violation first, example data is obviously synthetic (`Alex Example`).
- Commit messages: one plain subject line, no AI attribution (commits only when Alex asks).

## File tree

```
agent-progress.ts                       bin shim: runCommandLine(Bun.argv.slice(2), createProcessContext()); the only file that touches process.exit
package.json                            name agent-progress, "bin": {"agent-progress": "agent-progress.ts"}, type module,
                                        scripts: typecheck (tsc -p tsconfig.json && tsc -p lib/render/page/tsconfig.json),
                                        test (bun test), lint, lint:fix, setup (bash setup.sh)
                                        deps: marked (pinned major, current stable); devDeps: typescript, @types/bun, eslint, @reliquary/eslint-config
tsconfig.json                           vkb's strict config verbatim (noEmit, types ["bun"]), excludes lib/render/page/**
eslint.config.js                        the config from the guidelines (ignores **/*.js, node_modules/**, .claude/**; devDependency exemption for lib/tooling/dev/**)
.gitignore                              node_modules/, .agent-progress/
CLAUDE.md                               the mandatory conventions (verbatim) + the repo map
docs/decisions.md                       rejected alternatives with reasons (seeded from this plan's review)
docs/backlog.md                         agreed, not started ("nothing in flight" stated with a date)
setup.sh                                1/3 Bun ≥ 1.2 · 2/3 bun install + bun link + PATH hint · 3/3 symlink skill/ → ~/.claude/skills/agent-progress
                                        (+ warn when ~/development/claude/skills.json exists without "agent-progress" in "ignore")
README.md                               install, command surface, file formats
skill/SKILL.md                          agent instructions (see below)
skill/CLAUDE.md                         one-liners for the skill folder
templates/ClaudeInstructionsBlock.md    the managed CLAUDE.md block init writes
templates/TicketBody.md                 default ticket body (## Report / ## Wanted / ## Acceptance)
cli/CLAUDE.md                           per-file one-liners
cli/Main.ts                             runCommandLine(argv, context): dispatch, help on unknown, OperationRefusal → exit code
cli/CommandContext.ts                   { currentDirectory, now: () => Date, standardOutput, standardError, standardInputIsTerminal } handed to every handler
cli/CommandTable.ts                     name → lazy loader; CommandTable.spec.ts loads every entry (nothing may build at module scope)
cli/HelpText.ts                         the help text; HelpText.spec.ts pins it against table keys and skill/SKILL.md's command reference
cli/arguments/ArgumentParser.ts         closure factory (vkb port, trimmed): flag, option (both spellings, refuses empty value), positionals, rejectUnknownOptions, rawArguments
cli/init/InitCommand.ts                 init
cli/task/TaskCommand.ts                 task add|start|finish|review|update|remove
cli/ticket/TicketCommand.ts             ticket add|list|show|start|review|done|abandon|reopen|status|link
cli/log/LogCommand.ts                   log "<text>" [--at]
cli/status/StatusCommand.ts             status [--json]
cli/range/RangeCommand.ts               range
cli/render/RenderCommand.ts             render
cli/open/OpenCommand.ts                 open (Bun.spawn(['open', html]) on darwin, xdg-open otherwise)
cli/clear/ClearCommand.ts               clear [--all] [--yes]
cli/BinarySmoke.spec.ts                 spawns the real binary once: help, unknown command exit 1 (cross-cutting suite at the layer root)
lib/CLAUDE.md                           layering rules + per-file one-liners
lib/ImportDirection.spec.ts             guard: imports only up the tree, no lib→cli, no shipped→lib/tooling/dev, no barrels; asserts an edge floor
lib/EnvironmentReads.spec.ts            guard: process.env appears only in lib/platform/Environment.ts
lib/DocumentedPaths.spec.ts             guard: every backticked repo path in *.md and docblocks exists
lib/constants/Limits.ts                 the SCREAMING_CASE design constants listed above
lib/constants/Statuses.ts               TASK_STATUSES, TICKET_STATUSES, TICKET_TYPES as readonly tuples + the ticket→task mapping table
lib/constants/Types.ts                  Task, LogEntry, ViewRange, ProgressFile, TicketFrontmatter, Ticket (types only, imports nothing)
lib/utils/TimeUtil.ts                   formatLocalIso (manual ±HH:MM offset), parseIso, parseRelative("-2h"|"+30m"|"now"|"start"), minutesBetween (epoch maths, DST-safe)
lib/utils/HtmlEscapeUtil.ts             escapeHtml, escapeJsonForScriptTag (`</` → `<\/`)
lib/utils/SlugUtil.ts                   slugFromTitle
lib/utils/TicketIdUtil.ts               padTicketId, parseTicketReference ("3" | "003" | "#003")
lib/platform/Environment.ts             the one process.env reader (e.g. AGENT_PROGRESS_ROOT override), getters with docblocks
lib/platform/AtomicFile.ts              writeFileAtomically(path, contents): temp beside target, fsync, rename
lib/platform/OperationRefusal.ts        the typed refusal error (status: 'refused' | 'unrepaired') library code throws instead of exiting
lib/platform/RepositoryRoot.ts          discoverRepositoryRoot(currentDirectory): realpath, `git rev-parse --git-common-dir`, `.git` file fallback, else cwd
lib/platform/Workspace.ts               findWorkspace (walk up for .agent-progress/), workspace paths
lib/platform/Lock.ts                    withLock(workspace, fn): openSync 'wx', pid+timestamp payload, retries from constants, stale takeover by rename
lib/platform/GitIgnore.ts               ensureIgnored(root): `git check-ignore -q` when git exists, else exact-line match; newline-safe, CRLF-aware; in-place edit
lib/platform/ClaudeInstructions.ts      managed block in CLAUDE.md, in-place write (symlink-safe), vkb inspectManagedRegion semantics
lib/progress/ProgressStore.ts           read + validate progress.json (version guard, verdict not throw), mutators, next task id from a stored counter that is never wound back
lib/tickets/CLAUDE.md
lib/tickets/Frontmatter.ts              YAML-subset parse/serialize (spec below), body preserved byte-for-byte
lib/tickets/TicketStore.ts              ids, unique slug (suffix -2 on collision), read/write/list, resolve reference
lib/tickets/TicketTransitions.ts        ticket status → task + timestamps + log line (table below)
lib/render/CLAUDE.md
lib/render/Markdown.ts                  marked wrapper: gfm, custom renderer escaping raw html tokens, drops javascript:/data: hrefs
lib/render/page/GanttGeometry.ts        pure geometry, no DOM: computeTimeline(progress, viewRange, now) → { fromEpochMilliseconds, toEpochMilliseconds, stepMinutes, ticks, bars, nowPercent }
lib/render/page/GanttPage.ts            browser script: embedded JSON + localStorage override → layout, tabs, range bar
lib/render/page/tsconfig.json           DOM-only project (lib ["DOM","ESNext"], no Bun types) for the two files above
lib/render/PageBundle.ts                bundlePageScript(): Bun.build of GanttPage.ts resolved from import.meta.dir, target browser, minify, throw:false, memoised per process
lib/render/page/template.html           the designer-owned page: CSS, the state system and the id/class contract
lib/render/Template.ts                  the injection of the two JSON islands and the page script into that template
lib/render/Rerender.ts                  rerender(workspace): read store from disk, bundle, write html atomically; called inside withLock by every mutating command
lib/tooling/dev/ScratchWorkspace.ts     test-only: mkdtemp workspace + git init (+ optional worktree) helpers; nothing shipped imports it
```

Specs co-located (`*.spec.ts`, `bun:test`, each in a `ScratchWorkspace` passed via `CommandContext`,
never `process.chdir`): ArgumentParser, CommandTable, HelpText, TimeUtil (offset formatting, relative
parsing, DST), RepositoryRoot (plain repo, worktree `.git` file, no git), Lock (two concurrent writers,
stale takeover), ProgressStore, GitIgnore, ClaudeInstructions (absent, symlink, one pair, two pairs,
start-only), Frontmatter (round trip, unknown keys kept, `---` in body, CRLF/BOM, `title: Fix: x`),
TicketStore, TicketTransitions, GanttGeometry (bar %, clipping, tick ladder, labels, all-null timestamps),
Template (smoke: tabs, ticket body rendered, escaping of `<b>`, `</script>` in a title, no `</script` inside
the JSON island), InitCommand, ClearCommand (re-seed from frontmatter), plus the three guard specs and the
binary smoke suite. Each guard is proven by introducing its violation first and watching it fail.

## Types (`lib/constants/Types.ts`)

```ts
export type TaskStatus   = 'pending' | 'running' | 'finished' | 'reviewed' | 'delivered' | 'abandoned';
export interface Task    { id: number; name: string; status: TaskStatus; start: string | null;
                           end: string | null; owner: string; note: string; ticket: string | null }
export interface LogEntry { at: string; text: string }
export type ViewRange =
  | { kind: 'auto' }
  | { kind: 'absolute'; from: string; to: string; tickMinutes: number | null }
  | { kind: 'relative'; from: string /* "-2h" | "start" */; to: string /* "now" | "+30m" */; tickMinutes: number | null };
export interface ProgressFile { version: 1; trackerId: string; project: string; startedAt: string;
                                view: ViewRange; tasks: Task[]; log: LogEntry[] }

export type TicketType   = 'bug' | 'change' | 'feature';
export type TicketStatus = 'open' | 'in-progress' | 'in-review' | 'done' | 'delivered' | 'abandoned';
export interface TicketFrontmatter { id: string /* "003" */; title: string; type: TicketType; status: TicketStatus;
  filed: string; updated: string; started: string | null; finished: string | null; abandonedAt: string | null;
  group?: string; branch?: string; commit?: string; reason?: string; task: number | null;
  extra: Array<[key: string, rawValue: string]> /* unknown keys, preserved in order */ }
export interface Ticket { frontmatter: TicketFrontmatter; body: string; filePath: string }
```

`trackerId` is a random id written by `init`; it namespaces the page's localStorage (file:// is one
origin in Chrome). `version: 1` guards future migrations.

## Ticket files

`.agent-progress/tickets/003-double-click-role-to-edit.md`:

```
---
id: "003"
title: "Double-click a role to edit it"
type: change
status: in-progress
filed: 2026-09-18T20:11:03+02:00
updated: 2026-09-18T20:40:00+02:00
started: 2026-09-18T20:40:00+02:00
finished: null
abandonedAt: null
group: role-editor
branch: ticket/role-editor
task: 17
---
# 003 — Double-click a role to edit it

## Report
...
```

Frontmatter subset (`lib/tickets/Frontmatter.ts`): strip BOM, accept CRLF; opening fence is line 1
`---`, closing fence is the first following line equal to `---` (bodies may contain `---` rules);
one `key: value` per line split at the first `: `; values: unquoted scalar, double-quoted JSON string
(all CLI-written strings use `JSON.stringify`), `null`, integer; `#` comment lines and blank lines
inside the frontmatter are kept in `extra` so a rewrite does not eat them; no nested structures. The
CLI owns known keys only; the body is written once (template, `--body`, or `--body-file <path|->`)
and afterwards preserved byte-for-byte so agents edit it freely. Missing or malformed frontmatter →
error naming the file and the line.

## Ticket → task transitions (`lib/tickets/TicketTransitions.ts`)

| command | ticket status | linked task | timestamps (ticket + task) | log line |
|---|---|---|---|---|
| `ticket add` | open | created `pending`, `ticket: "003"` | `filed` | `Ticket #003 filed: <title>` |
| `ticket start` | in-progress | `running` | `started` = at if null; `end` cleared | `Ticket #003 started` |
| `ticket review` | in-review | `finished` | `finished` = at if null | `Ticket #003 in review` |
| `ticket done [--commit]` | done | `reviewed` | `finished` = at if null | `Ticket #003 done` |
| `ticket deliver` | delivered | `delivered` | `delivered` = at if null | `Ticket #003 delivered` |
| `ticket abandon --reason` | abandoned | `abandoned` | `abandonedAt` = at; task `end` = at if started | `Ticket #003 abandoned: <reason>` |
| `ticket reopen` | open | `pending` | all three cleared | `Ticket #003 reopened` |
| `ticket status <id> <status>` | any | same mapping | same | same |

`abandoned` is a fifth task status (grey hatched bar, struck-through label, its own chip) rather
than a removal, so ids and history stay stable. Link integrity rules: a task is linked to at most one
ticket; `ticket link` and `task add --ticket` refuse a task already owned by another ticket unless
`--force`, and clear `task.ticket` on the ticket's previous task; `task remove` on a linked task
clears `ticket.task`; a transition whose task is missing recreates it. Task ids come from a stored counter that is never wound back, never
reused within a tracker; ticket ids = max existing file id + 1 (gaps tolerated).

## Commands

```
agent-progress init [--project <name>] [--root <path>] [--no-claude-md]
agent-progress status [--json]
agent-progress task add "<name>" [--owner <who>] [--note <text>] [--ticket <id>] [--start] [--at <when>]
agent-progress task start|finish|review|deliver <id> [--owner] [--note] [--at <when>]
agent-progress task update <id> [--name] [--owner] [--note] [--status <status>]
agent-progress task remove <id>
agent-progress log "<text>" [--at <when>]
agent-progress ticket add "<title>" [--type bug|change|feature] [--group <g>] [--body <md> | --body-file <path|->] [--at <when>]
agent-progress ticket list [--status <s>] [--json]
agent-progress ticket show <id> [--json]            (always prints the file path)
agent-progress ticket start|review|done|deliver|abandon|reopen <id> [--branch] [--commit] [--reason] [--at <when>]
agent-progress ticket status <id> <status> [...same options]
agent-progress ticket link <ticketId> <taskId> [--force]
agent-progress range --from <iso|-2h|start> --to <iso|now|+30m> [--tick 15m|1h|1d] | --auto
agent-progress render
agent-progress open
agent-progress clear [--all] [--yes]
agent-progress help
```

`<when>` = ISO 8601, or relative to now (`-5m`, `-2h`), or `now`. Every mutating command:
`withLock` → load → mutate → atomic write → `rerender()` (re-reads from disk, writes html tmp+rename)
→ release → one confirmation line on stdout (`--json` prints the affected entity, e.g. `task add`
prints `{ "id": 18, ... }`). Store mutation succeeding but the page bundle failing is reported on
stderr, the page is still written with an error banner, exit code 0.

`init`: root discovery as above; refuse if an ancestor already has `.agent-progress/`; create
`.agent-progress/{progress.json,tickets/}`; `ensureIgnored`; managed CLAUDE.md block (create the file
if absent; write in place so a symlinked CLAUDE.md stays a symlink; first marker pair replaced, extra
pairs warned, start-without-end refused); render; print html path. Re-running init only refreshes the
block.

`clear`: confirmation on a TTY unless `--yes` (non-TTY without `--yes` → exit 1). Resets `tasks`,
`log`, `startedAt = now`, `view = auto`, keeps `trackerId`, then re-seeds one row per surviving ticket
from its frontmatter (`status` → task status, `started`/`finished`/`abandonedAt` → `start`/`end`) and
rewrites each ticket's `task` id. `--all` additionally deletes `tickets/`; ids restart at 001.

## Modifiable Gantt time range

- Stored default in `progress.json` (`view`, see types) via `agent-progress range`; relative forms are
  stored raw and resolved by `GanttGeometry` against an explicit `now`, so `-2h` keeps meaning "the
  last two hours" on every refresh. `--auto` resets.
- In-page override: a range bar above the chart with presets (Auto · 1h · 4h · 12h · 24h · 7d · All),
  from/to `datetime-local` inputs (interpreted in the browser's local zone, converted to epoch ms)
  and a tick selector, kept in `localStorage` under `agent-progress:<trackerId>` in try/catch
  (Safari private mode throws). "Auto" clears the override and falls back to the stored default.
- Layout is client-side so there is one geometry implementation: `Html.ts` embeds the progress JSON
  in `<script type="application/json">` (with `</` escaped), and `GanttPage.ts` computes bars and
  ticks from it. `PageBundle.ts` bundles `GanttPage.ts` once per process with `Bun.build`, entry
  resolved from `import.meta.dir` (works for the `bun link`ed binary from any cwd), `throw: false`;
  the spec asserts the minified output contains no `</script`.
- Automatic axis: span = max(now, latest end) − startedAt, floored at 60 min + 15 min padding; when
  every timestamp is null the axis is startedAt → now. Step = first of `[5,10,15,30,60,120,180,360,720,1440]`
  min with span/step ≤ 12 (else multiples of 1440); labels `HH:MM` (≤ 24 h), `Tue HH:MM` (≤ 7 d),
  `MM-DD` beyond. Bars outside the visible range are clipped, with ◂/▸ markers on the row.

## HTML (the page, now `lib/render/`)

Self-contained, no CDN. Reproduces render.py's look (same colours, grid `360px 250px 1fr`, chips,
hatched running bar, dashed red now-marker, reversed log). Additions:

- `<meta http-equiv="refresh" content="30">`: the page follows the orchestrator. `generatedAt` is
  embedded; the page shows a "stale since HH:MM" banner when `Date.now() − generatedAt > 90 s`
  (throttled tab, file moved).
- Tab bar **Progress | Tickets**; the active tab is kept in `location.hash` (`#tickets`) so the
  refresh lands on the same tab. Task rows show a `#003` badge linking to `#ticket-003`.
- Tickets tab: summary table (id, title, type, status badge, group, branch, task) then one card per
  ticket with the body rendered by `marked` at generation time (`done`/`abandoned` collapsed in
  `<details>`). Every string from JSON/frontmatter passes `escapeHtml`; raw HTML tokens in markdown
  are escaped via a custom renderer (`html({ text })`, marked ≥ 13 token signature), `javascript:` and
  `data:` hrefs dropped.

## Skill (`skill/SKILL.md`)

Frontmatter `name: agent-progress`, description triggering on progress tracking, Gantt, tickets,
"track this work", orchestrating subagents. Body: run `init` when asked to adopt the tracker;
`status --json` at session start; register a task before spawning each subagent and `finish` it when
the result arrives; file a ticket for every bug/change/feature the user reports and move it with
`ticket start/review/done`; `log` milestones; use `--at` to backfill; never edit `progress.json` by
hand, edit ticket bodies only below the frontmatter (path printed by `ticket show`); run
`agent-progress open` once so the user has the dashboard; every command regenerates the html and all
worktrees share one tracker. Includes the command reference; `HelpText.spec.ts` fails if it drifts.

## Managed CLAUDE.md block (`templates/ClaudeInstructionsBlock.md`)

Short: this repo tracks work with `agent-progress` (`.agent-progress/`, git-ignored, shared by all
worktrees); load the `agent-progress` skill; track every task and ticket through the CLI; open the
dashboard for the user. Between `<!-- agent-progress:managed:start -->` / `end` markers.

## Outside this repo

- Edit `~/development/claude/skills.json`: add `"agent-progress"` to `ignore`.
- Run `./setup.sh` once so `agent-progress` is on PATH and the skill is linked.

## Execution model: Opus implements, Fable orchestrates

The main session (Fable) does no bulk coding. It spawns `opus` subagents (`effort: high`, the
conventions and the relevant plan section pasted into each prompt, explicit file ownership so two
agents never touch one file), runs independent steps in parallel (e.g. step 2's platform modules
alongside step 3's geometry, step 5's frontmatter alongside step 4's commands), and after each
step runs `bun run typecheck && bun test && bun run lint` itself and reads the diff for convention
drift (abbreviations, restating comments, missing docblocks, magic numbers) before the next step
starts. Every step ends green; a guard spec that is not proven by a deliberate violation is not done.

## Implementation sequence

1. Scaffold: `git init`; root `CLAUDE.md` with the conventions verbatim; package.json, both tsconfigs,
   eslint, .gitignore, `docs/decisions.md`, `docs/backlog.md`; bin shim, Main/CommandContext/CommandTable/
   HelpText/ArgumentParser + specs; `bun install`, `bun link`; the three guard specs with their floors,
   each proven by a deliberate violation.
2. `lib/constants/*`, `lib/utils/*`, `lib/platform/*` (Environment, AtomicFile, OperationRefusal,
   RepositoryRoot, Workspace, Lock, GitIgnore, ClaudeInstructions), `lib/progress/ProgressStore` + specs.
3. `GanttGeometry` (+ spec) → `GanttPage`, `PageBundle`, `Styles`, `Html`, `Rerender`; `init`, `render`, `open`.
4. `task *`, `log`, `status`, `range`, `clear` + specs.
5. `Frontmatter`, `TicketStore`, `ticket add/list/show/link`, Tickets tab + `marked`.
6. `TicketTransitions` + `ticket start/review/done/abandon/reopen/status`; `clear` re-seed.
7. `skill/SKILL.md`, `templates/`, `setup.sh`, README, per-folder `CLAUDE.md` files, skills.json edit;
   `bun run typecheck && bun test && bun run lint`.

## Verification

- `bun run typecheck`, `bun test`, `bun run lint` all green.
- End-to-end in a scratch git repo with a worktree: `agent-progress init` → `.agent-progress/`,
  `.gitignore` and CLAUDE.md block present; from inside the worktree `ticket add "Fix X" --type bug`
  → `001-fix-x.md` + pending row in the main repo's tracker; `ticket start 1`, `task add "Review pass"
  --start`, `log "…" --at -5m`, `ticket review 1`, `ticket done 1`; `status` shows the expected states;
  two `task add` commands run concurrently both land; `clear --yes` keeps the ticket and re-seeds its
  bar from `started`/`finished`; `clear --all --yes` removes tickets.
- Open `progress.html` with the `verify-html-page` skill: no console errors, both tabs switch,
  bars positioned, ticket markdown rendered, no unescaped HTML from a ticket titled `<b>x</b>`,
  range presets re-lay-out the bars and survive a reload; `agent-progress range --from -1h` changes
  the default axis and `--auto` restores it.
- `ls -la ~/.claude/skills/agent-progress` points at the repo's `skill/`; `agent-progress help`
  works from another directory; `claude` repo's `skills.json` lists `agent-progress` under `ignore`.
