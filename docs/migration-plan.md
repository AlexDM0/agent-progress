# Migration plan: the conventions refactor

**Status (2026-09-26): in flight on `migration/conventions`; steps 0 to 3 and 4a to 4c are done, 5 is next.**
Two parts of step 7 run on sub-branches of it: the page split (`migration/page`, merged in 7058c2a; 7b's
payload facts remain) and the dispatcher port (`migration/dispatcher`, in review, merged before step 8).
The kanban-board feature has landed on main (9654720 through 5c6b0ad) and is mapped into this plan.
This file is the single source for the plan; `agent-progress-architecture.html` (untracked, repo
root) is the evidence it was built from: the file map, the diagnosis and the measurements, taken at
c5bbc30, before the kanban. Its two-option proposal is superseded by this plan.

The target conventions are the owner's generalized ones in `~/coding-conventions.md`. This plan
applies them to this repository.

## 1. How the migration runs

- One long-lived branch in its own worktree, merged into main in one go. Main keeps working
  meanwhile, because this checkout is the live binary for every tracked repository (the `bun link`
  points at it).
- Every commit on the branch leaves `bun run typecheck`, `bun test` and `bun run lint` green.
- Nothing runs the `agent-progress` CLI in this checkout; behaviour is exercised in scratch
  repositories only.
- Merge only while no dispatcher run is live and no `dispatcherRunId` is stored on any board. After
  the merge, run `agent-progress update` in every tracked repository.

## 2. What was decided

### Layout

```
cli/                  feature: the command surface, grouped into sets
page/                 feature: the DOM-only browser page (own tsconfig + spec tsconfig)
dispatcher/           feature: the dispatcher policy in TypeScript (own tsconfig + spec tsconfig)
resources/            files read at runtime: the markdown templates, the page's HTML template
src/
  adapters/           every boundary: file ingestion classes, writers, CLI wording, HTML labels
  services/           tracker (the store pipeline) and render (page generation)
  lib/                building blocks, package grade: atomic-file, git, claude-code, tracker-model, utils
  shared/             app-specific code with two or more consumers that is not package grade
agent-progress.ts     the bin shim and composition root; imports cli/ only
```

`skill/`, `skill-orchestrate/` and `docs/` stay at the root: they are read by Claude Code or by people,
not by the application.

### Rules

- A feature (`cli/`, `page/`, `dispatcher/`) imports itself and `src/*`, never another feature.
- Services import `src/lib`, `src/shared` and `src/adapters`, and one other service one way only
  (tracker → render). `src/shared` imports `src/lib`. A `src/lib` package imports only the packages
  it declares.
- Code starts beside its only consumer. It is hoisted on a second consumer, to `src/lib` if generic
  and package grade, to `src/shared` if app-specific. The same holds for utils, `@types` and
  constants. Folders inside a feature (`utils/`, `@types/`, `constants/`) are split by domain.
- One purpose per file, explainable in two or three lines from path and export name; usually one
  export plus a few types. Utils are frozen objects of pure functions (`TimeUtil`). No comment walls.
- `lib/constants/Limits.ts` becomes one global export, `LIMITS = { … } as const`.
- Enforcement is by review. The four whole-tree guard specs go. The runtime tracker-isolation check
  in the test helpers stays.
- One CLAUDE.md, at the root. The six folder CLAUDE.md files go.

### The model and its boundaries

- Records (Task, Ticket, log entries) are plain typed data: interfaces and string-literal unions.
- A `Board` domain class (in src/lib/tracker-model, no I/O) owns the compound changes that are
  written out by hand in several commands today: linking a ticket and a row, claiming, ticket
  transitions that move the row, opening and closing review bars (with the stored bar round), token
  crediting, and the board queries (ready tickets, review bars of a ticket, settled checks).
- A `Board` is mutable within one CLI invocation: ingest → mutate → write → render → exit. Its
  refusals throw a typed domain error carrying an internal reason. The tracker service wraps domain
  errors into the one app-level error (refused / unrepaired, today's `OperationRefusal`), and the
  CLI words it.
- Stored files, the CLI and the HTML are external boundaries: map in at the edge, map out at the
  edge. Internal values never carry display wording.
- Each stored format has an ingestion class (read → validate → migrate → map; small steps as
  utils) and a separate writer. Old formats migrate on ingestion and are written in the current
  format on the next write; `update` also rewrites them.
- The `Board` calls a semantic `Logger` (for example `logger.ticketDone(ticketId)`). The logger
  appends structured entries (at, kind, task and ticket ids, fields) to .agent-progress/log.jsonl,
  its own file because no chart data is derived from the log. A `LogUtil` in src/adapters words
  entries for `status` and the page. The page's detail panel filters entries by id, not by
  matching sentences. Old sentence entries are ingested as note entries.
- Task and ticket statuses keep two ladders, but equal meanings share one word. The exact words
  are decided in step 0 (see §6).

### The page

The kanban made the page the largest part of the tool: 13 modules, 3,342 lines of TypeScript and a
1,320-line template. Several board rules are now written out again inside it, so these decisions
follow from the model above:

- **The payload carries board facts; the page does layout and viewer choices only.** The render
  service fills the payload from Board queries: each ticket's own row, each ticket's review bars,
  each row's and ticket's display state (the `reviewing` state), and whether a delivered row counts
  as reviewed. The page stops deriving these itself (today `ownRowOf`, `cardStateFor`,
  `rowStateFor`, `deliveredAfterReview`, and `reviewedTicketNumberOf`, which parses the review
  bar's name). The Kanban and the Progress chart then agree because they read the same fact, not
  because two copies of a rule do.
- **Legacy fallbacks are resolved once, at ingestion.** A review bar known only by its name gets its
  `reviewOf` and round there (`src/adapters/utils/LegacyReviewBarUtil.ts`, called from the reader
  today). A delivered row without a review stamp is not resolved at ingestion, because ingestion
  cannot invent the stamp. The Board query `deliveredRowCountsAsReviewed` answers it. Nothing
  downstream parses a name.
- **The row states and the Kanban lanes are page vocabularies**: string-literal unions local to
  page/, like the pill labels and lane titles that word them.
- **Viewer preferences are a stored boundary.** The browser's storage is read and written in one
  place in page/: one preferences module owning the keys, the parsing with defaults and the writes.
  Today five modules each own a key, and `lib/render/page/GanttPage.ts` does the reads and writes.
  The key strings stay byte-identical so viewers keep their choices.
- **Clock exceptions are stated where they apply.** The five in today's root CLAUDE.md (two added
  by the kanban: the closed lanes' order in `lib/render/page/KanbanBoard.ts` and stamp shortening in
  `lib/render/page/StampText.ts`) become one-line comments at their sites. The root CLAUDE.md keeps
  the rule, not the list.

### Generated and installed files

- No generated file lives in this repository. `update` (and `init`) generate the dispatcher script
  from dispatcher/ into the target project's `.agent-progress/`, alongside the other installed files.
- Everything the tool installs carries one install version, a protocol version that changes only
  when the CLI ↔ installed-files contract changes.
- On a mismatch every command refuses and asks for `agent-progress update`, except `init`, `update`,
  `help` and read-only `status`. The SubagentStop hook therefore stops crediting tokens until
  `update` runs; it keeps exiting 0 with a warning.
- The page script is still compiled at render time, by path, from page/ (measured at 2–4 ms).

## 3. Where every current file goes

Specs follow their module and sit beside it. Destinations are named without backticks because most
do not exist yet.

| Today | After |
|---|---|
| `agent-progress.ts` | stays; composition root |
| `cli/Main.ts`, `cli/CommandTable.ts`, `cli/HelpText.ts`, `cli/arguments/ArgumentParser.ts`, `cli/arguments/OptionsWithValues.ts`, `cli/CommandContext.ts` | stay in cli/ |
| `cli/CommandSupport.ts` | dissolves: the lock → write → render pipeline → src/services/tracker; printing and --at/--tokens parsing → cli/utils (OutputUtil, OptionValueUtil); board reads → Board queries |
| `lib/utils/NextLineUtil.ts` | cli/utils/NextLineUtil (only cli uses it) |
| `cli/TrackerRefresh.ts` | cli/adoption (only init and update use it); installs generated files with the version stamp |
| command folders | grouped into sets: cli/tracking (task, log, status, range, clear, render, open), cli/tickets (ticket), cli/dispatch (dispatcher, concurrency, release), cli/adoption (init, update), cli/measurement (usage, rework, hook). Each command parses, calls the tracker service or the Board, and prints through src/adapters |
| `cli/ticket/TicketCommand.ts` | split by subcommand group inside cli/tickets; its rules move to the Board |
| `lib/constants/Types.ts` | src/lib/tracker-model/@types (Task, Ticket, ProgressFile, log entry) |
| `lib/constants/Statuses.ts` | status unions and subsets → src/lib/tracker-model/constants; tracker file names → src/services/tracker/constants; CLAUDE.md markers → beside their only consumer, cli/TrackerRefresh.ts (since step 3 src/lib/claude-code takes them as parameters) |
| `lib/constants/AgentSettings.ts` | src/lib/tracker-model (model and effort are ticket fields) |
| `lib/constants/Limits.ts` | src/shared/constants/Limits.ts exporting LIMITS |
| `lib/constants/CommentSyntaxes.ts`, `lib/utils/ReworkCountUtil.ts` | cli/measurement/utils (only rework uses them) |
| `lib/utils/TimeUtil.ts`, `lib/utils/TokenCountUtil.ts`, `lib/utils/HtmlEscapeUtil.ts` | src/lib/utils |
| `lib/utils/SlugUtil.ts` | src/services/tracker/utils (only ticket file naming uses it) |
| `lib/utils/TicketIdUtil.ts`, `lib/utils/TicketDependencyUtil.ts` | src/lib/tracker-model/utils |
| `lib/utils/TranscriptUsageUtil.ts`, `lib/utils/TranscriptCohortUtil.ts` | src/lib/claude-code/utils |
| `lib/platform/AtomicFile.ts` | src/lib/atomic-file |
| `lib/platform/Lock.ts`, `lib/platform/Workspace.ts` | src/services/tracker (its only consumer) |
| `lib/platform/RepositoryRoot.ts`, `lib/platform/GitIgnore.ts`, `lib/platform/BranchRelease.ts`, `lib/platform/ReworkDiffs.ts` | src/lib/git, behind one new GitProcess runner (removes the verbatim duplicate plumbing) |
| `lib/platform/ClaudeSettings.ts`, `lib/platform/ClaudeInstructions.ts`, `lib/platform/ClaudeTranscripts.ts` | src/lib/claude-code |
| `lib/platform/Environment.ts`, `lib/platform/OperationRefusal.ts` | src/shared |
| `lib/progress/ProgressStore.ts` | split: ingestion class + writer → src/adapters; mutations and queries → Board; store orchestration → src/services/tracker |
| `lib/tickets/Frontmatter.ts`, `lib/tickets/TicketStore.ts` | src/adapters (ticket markdown ingestion class and writer); listing → src/services/tracker |
| `lib/tickets/TicketTransitions.ts` | the legality table → src/lib/tracker-model/constants; applying a move → Board methods |
| `lib/render/Template.ts`, `lib/render/Markdown.ts`, `lib/render/PageBundle.ts` | src/services/render |
| `lib/render/Rerender.ts` | dissolves into the tracker pipeline calling src/services/render |
| `lib/render/page/GanttPage.ts` (804 lines) | page/PageStart (read the data islands, render, wire) plus one controller per surface, each in its set: page/progress (range bar, rows, now scroll), page/kanban (board, overflow, following a waiting-on link), page/tickets, page/log, page/detail-dialog (task and ticket bodies, covered tick labels); the element helpers → page/utils/DomUtil; storage reads and writes → page/preferences |
| `lib/render/page/PageMarkup.ts` (440 lines, 20 exports) | split by purpose: markup primitives used by several sets (`attribute`, shortened text, stamp markup, ticket links, priority mark) → page/utils/MarkupUtil; row state and pill label → page/constants (the union and its labels) with the state itself from the payload; task rows, ticks, overlay, axis fit, generated stamp, range note → page/progress; summary stats → page/progress; log items → page/log; ticket table, cards, count, latest milestone → page/tickets; `reviewedTicketNumberOf`, `deliveredAfterReview`, `rowStateFor` → Board queries via the payload |
| `lib/render/page/KanbanBoard.ts` | page/kanban: lane rules and order (KanbanLanes), the capped lanes' paging → page/kanban/utils/LanePagingUtil, overflow directions → page/kanban/utils; the storage keys → page/preferences; `ownRowOf` and the review-bar lookup → payload facts |
| `lib/render/page/KanbanMarkup.ts` | page/kanban |
| `lib/render/page/TicketDetail.ts`, `lib/render/page/TicketTimeline.ts` (533 lines) | page/detail-dialog; the timeline splits into its data (TicketTimeline) and its markup (TicketTimelineMarkup); `tickLabelIsCovered` (also used by the page controller) → page/utils/GeometryUtil |
| `lib/render/page/TaskDetail.ts` | page/detail-dialog; `formatDuration` (used by three sets) → page/utils/TimeUtil |
| `lib/render/page/StampText.ts` | page/utils/TimeUtil (every set prints stamps) |
| `lib/render/page/GanttGeometry.ts` | page/utils/GeometryUtil (the Progress chart and the ticket timeline share the axis and ticks) |
| `lib/render/page/PageData.ts` | payload types → src/shared/@types (render and page both need them); reading the islands → page/PageStart; range presets and the stored override → page/progress, its key → page/preferences |
| `lib/render/page/LogVisibility.ts`, `lib/render/page/NameColumnWidth.ts`, `lib/render/page/WorkVisibility.ts` | parse, default and toggle → page/preferences; the note texts → their surfaces (page/log, page/progress); `taskIsLongDone`, `ticketIsLongDone` → page/utils/VisibilityUtil |
| page specs in `lib/render/` (12, five from the kanban) | beside their modules under page/, under the spec tsconfig; the specs that match the template's placeholder text read it from resources/ |
| `lib/render/page/template.html` | resources/ |
| `lib/render/page/tsconfig.json` | page/tsconfig.json, listing the src/ files the page reaches (the payload types, the model's types, LIMITS, HtmlEscapeUtil, TokenCountUtil) |
| `cli/hook/HookCommand.ts` | cli/measurement; its import of `reviewedTicketNumberOf` from the page (a feature reaching into another) becomes the Board query for a ticket's review bars |
| `templates/*.md` | resources/templates |
| `templates/workflows/AgentProgressDispatch.js` | removed; its policy is ported to dispatcher/ in TypeScript and generated into target projects |
| `lib/tooling/dev/*` | test-only helpers, beside their only consumer (§6): the dispatch script harness and the workflow script source reader → dispatcher/ (replaced by the TypeScript port's own specs where they only read the old script); the captured command context and the CLI process runner → cli/testing if only cli/ uses them; the scratch workspace and the tracker isolation check → src/testing. `lib/tooling/dev/SourceComments.ts` goes with the guards if nothing else uses it |
| `lib/ImportDirection.spec.ts`, `lib/EnvironmentReads.spec.ts`, `lib/DocumentedPaths.spec.ts`, `lib/TrackerIsolationBypasses.spec.ts` | deleted |
| `cli/CLAUDE.md`, `lib/CLAUDE.md`, `lib/render/CLAUDE.md`, `lib/tickets/CLAUDE.md`, `skill/CLAUDE.md`, `skill-orchestrate/CLAUDE.md` | deleted; any rule the code cannot show moves to the root CLAUDE.md first |
| `.idea/` | untracked and ignored |

## 4. Steps

Each step is one or more commits on the branch; each commit is green.

0. **Prepare.** Create the branch and worktree from main. Diff main against 5c6b0ad (the commit §3
   was mapped at) and extend the table for anything added since. Settle the open questions in §6.
1. **Conventions.** Rewrite the root CLAUDE.md from `~/coding-conventions.md` plus this repository's
   map and local rules. Delete the six folder CLAUDE.md files after moving any rule the code cannot
   show. From `lib/render/CLAUDE.md`, that means the template contract: the template is
   designer-owned and edited as HTML; the script clears the containers it owns before filling them.
   Move the clock-exception list to one-line comments at the five sites. Delete the four guard specs.
   Convert `lib/constants/Limits.ts` to `LIMITS`.
2. **Hygiene.** Untrack `.idea/`. Use the `node:` protocol for every builtin (lint rule). Route the
   CLAUDE.md and .gitignore writes in `lib/platform/ClaudeInstructions.ts` and
   `lib/platform/GitIgnore.ts` through the atomic writer.
3. **Building blocks.** Create src/lib/atomic-file, src/lib/git (GitProcess first, with new specs
   for the release and rework git modules), src/lib/claude-code and src/lib/utils. Create
   src/shared (Environment, OperationRefusal, LIMITS). Move the callers.
4. **Tracker model.** Move the types into src/lib/tracker-model, rename the task statuses (§6), and
   build the `Board` class with its compound methods and queries, the domain error and the semantic
   `Logger` interface. Store the review bar's round on the bar instead of parsing it from the bar's
   name. Add the queries the page and the hook need: a ticket's own row, a ticket's review bars
   (by `reviewOf`), a row's and a ticket's display state, and whether a delivered row counts as
   reviewed. Every rule gets a spec beside the Board. It runs as 4a (types, constants, status words and
   verbs), 4b (the Board) and 4c (the page and hook queries, the stored review round).
5. **Adapters.** Ingestion classes and writers for progress.json, ticket markdown and log.jsonl,
   including the migrations: old status words, old log sentences to notes, and legacy review bars
   given their `reviewOf` and round (move `src/adapters/utils/LegacyReviewBarUtil.ts`'s call out of
   `lib/progress/ProgressStore.ts` into the ingestion class). A delivered row without a review stamp
   stays the Board query `deliveredRowCountsAsReviewed`, so ingestion has no migration for it. The
   CLI wording and HTML label mappers, and the refusal-reason wording.
6. **Services.** src/services/tracker (workspace discovery, lock, the ingest → mutate → write →
   render pipeline) and src/services/render (template, markdown, compiling page/ by path, reading
   resources/). The render service writes the Board facts from step 4 into the payload.
7. **Features.** Regroup cli/ into its sets; every command becomes parse → service or Board →
   adapter output; split the ticket command; the hook reads review bars from the Board. Move the
   page to page/ per §3, in this order, each commit green: (a) the utils and the preferences module;
   (b) the page reads the new payload facts and its copies of the board rules go; (c) the page is
   split into its sets and GanttPage into PageStart and the controllers. The spec tsconfig lets the
   page specs sit beside their modules. The detail panel filters the log by id. The Kanban and
   ticket-dialog specs are the regression net for (b) and (c): they change only in their imports.
   Port the dispatcher to dispatcher/ in
   TypeScript, checked against a frozen table of the old script's behaviour, and add the JSON fields
   the prompts now make agents derive (running ticket ids, running review-of ids, ready and
   review-waiting tickets, paused builds, a ticket's row and review bars, the combined rework
   total).
8. **Installation and versioning.** Move templates to resources/. `init` and `update` generate the
   dispatcher and every installed file into the target with the protocol version. Add the mismatch
   refusal with its exemptions. Update skill-orchestrate/SKILL.md to launch the dispatcher from
   `.agent-progress/` and to run `update` after pulling.
9. **Documentation.** Keep `README.md` and delete the other two READMEs, bring `docs/cli.md` and
   `docs/development.md` in line, and update `docs/backlog.md`. The owner retakes `docs/images/`
   with `.readme-graphics/regenerate.sh` (their checkout only): the ticket badges in
   `docs/images/panel-tickets.png` and `docs/images/panel-watch.gif` still show the pre-4a words `open` and `done`.
10. **Verify and merge.** Full suite; exercise init, update, a ticket's lifecycle, a release and
    a dispatcher run in scratch repositories, including one created by the old version so
    migration on ingestion is tested on real old files. Merge per §1, then run `update`
    everywhere.

## 5. What carries over from the earlier proposal

These foundation items from `agent-progress-architecture.html` still apply, with the destinations
above: one git runner (F4), one Claude Code home (F7), status subsets declared once (F5), the review
bar's stored round and the end of the name fallback (F8), the dispatcher in TypeScript plus the CLI
JSON contract (F9, now generated into the target instead of committed), docs consolidation (F10),
the pre-work shapes (F11) and atomic writes (F12). F2 (guard hardening) and F6's committed-artifact
parts are dropped.

## 6. Settled in step 0 (2026-09-25)

- **The shared status words** are `pending`, `in-progress`, `in-review`, `reviewed`, `delivered`,
  `abandoned`. Tasks also keep `paused` and `re-review`. So the task words `running` → `in-progress`
  and `finished` → `in-review`; the ticket words `open` → `pending` and `done` → `reviewed`. The
  words change everywhere: the model, the CLI arguments, the stored files (old words are migrated on
  ingestion), the skills and the page. Dispatcher run states (`running`, `finished`, `stopped`) are a
  different vocabulary and keep their words. The page's display vocabularies (the row state
  `reviewing` and the Kanban lanes) are checked against the new words in step 7 and dropped where
  they have become redundant.
- **The CLI verbs are aligned with the words** (decided when step 4 began): one verb per target
  status, the same for tasks and tickets where both have it. `start` → `in-progress`, `pause` →
  `paused` (tasks), `finish` → `in-review`, `rereview` → `re-review`, `approve` → `reviewed`,
  `deliver` → `delivered`, `abandon` → `abandoned` (tickets), `reopen` → `pending` (tickets).
  `ticket review|rereview --start-review` becomes `ticket finish|rereview --start-review`. No verb
  keeps its spelling with a new meaning, so the verb `review` goes: `task review` and `ticket done`
  are refused naming `approve`, `ticket review` is refused naming `finish`, and an old status word
  given as a value is refused naming its new word. The skills, the brief, the dispatcher, the help
  and `docs/cli.md` change in the same step.
- **Test-only helpers** go beside their only consumer, like any other code: the dispatcher harness
  beside dispatcher/, the captured command context and CLI process runner beside cli/ if only cli/
  uses them. Helpers used by several parts (the scratch workspace, the tracker isolation check) go
  in src/testing/, the one place in src/ that never ships. The lint devDependency exemption covers
  exactly those folders.
- **The install version is stamped in each installed file**, in that file's own comment syntax. The
  check reads each installed file's stamp. A missing or different stamp on any of them is a
  mismatch.
- **The dispatch protocol constants** (call budgets, rework threshold, claim-note format, release
  refusal reasons) have two consumers, cli/ and dispatcher/, so they go to src/shared by the
  hoisting rule.
- **The README** kept is `README.md`. `README-keynote.md` and `README-day-on-the-board.md` are
  deleted in step 9.
- **The page payload carries the board facts** (§2 "The page"). The alternative, running the Board
  in the browser, was not chosen.

## 7. Risks

- **The branch lives long while main moves.** Merge main into it regularly. The page is where
  conflicts will concentrate: it is the most active area (the kanban added five modules there and changed most of the rest)
  and step 7 splits every file in it. Do the page split late and in one short stretch, after
  merging main.
- **Viewers lose their page choices** if a storage key string changes during the preferences move.
  The preferences spec pins every key as a frozen table.
- **Stored-format changes** (statuses, log file, installed versions) make a rolled-back CLI refuse
  newer trackers. Test the migration on copies of real trackers before merging.
- **Old installed dispatchers run against the new CLI until `update`.** The mismatch refusal makes
  that loud instead of silent.
- **Removing the guard specs** makes review the only net for import direction; the review checklist
  in `~/coding-conventions.md` §16 is the list to use.
