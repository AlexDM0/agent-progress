# agent-progress

A Bun + TypeScript CLI that tracks an AI orchestrator's work per repository (Gantt rows, stateful markdown tickets,
a log, and a self-contained `progress.html` regenerated on every command), and installs the skills, brief and
dispatcher its sessions run on.

## Verify

`bun run typecheck && bun test && bun run lint`: all three after any TypeScript change, before calling it done.
Never ad-hoc `tsc` flags; never edit `package.json` to make a check pass.

## Rules

The owner's coding conventions; where this repository deliberately differs, Deviations says so and why. A rule a
guard spec holds is one line naming the guard: the spec is the full statement.

### Files and naming

- One purpose per file, explainable from its path and exports. A file is `PascalCase.ts`, named after its main
  export; folders are lower case. No barrel files.
- A util is one pure, frozen object grouping a domain (`LocalTimeUtil.formatLocalIso(…)`), tested against its own
  contract; never a util holding one function. A one-line type or constant lives in its consumer's folder file. An
  app-wide list is one global object, such as `LIMITS`.
- Code starts beside its only consumer and moves, generalised, on a second one; never in anticipation.
- Full, descriptive names, no abbreviations; only a loop `i` and a comparator `(a, b)` are one letter. Name a thing
  for what it is or does, never its layer or history, never shadowing a global (`CorpusMap.ts`, not `Map.ts`): a
  question as the question (`sourceIsReachable`), a producer for its product (`fullTextOf`), a boolean as a
  predicate phrase.
- Design constants are `SCREAMING_CASE`, named for what they bound, with the unit, no magic number inline;
  arithmetic identities (a percent, a radix, halving) stay inline.
- Everything is English. Example data is obviously synthetic: `Alex Example`, `Example Agency`.

### Imports

```
src/lib/  →  src/shared/  →  src/adapters/  →  src/services/ (render → tracker)  →  features (cli/, page/, dispatcher/)
```

- `src/ImportDirection.spec.ts` holds the direction, cycles, barrels, feature and sibling-command isolation, the bin
  shim, the `testing/` allowlist (`TESTING_FOLDER_IMPORTERS`), a lib package's declared "depends on" packages and
  the tracker model's isolation. What two commands share is hoisted to the level above both, or passed as a
  structurally typed parameter.
- A `src/lib/` package knows nothing about its callers: no agent-progress names, file names, wording or exit codes.
  App values arrive as parameters; a refusal leaves as a verdict (except the `Board`, see Deviations).
- `src/lib/tracker-model/` stays DOM-safe: the page project compiles it.

### Values and wording

- Internal values are string-literal unions, never display text. A display map exists only where the word differs
  from the value.
- All command-line text (confirmations, usage, argument errors, help prose) lives in `cli/`, beside the command that
  prints it; command verbs are literals, so they grep.
- `src/adapters/` holds only translations: a refusal's detail and exit code to output, the domain model to an output
  format.
- JSON output, stored files, a reason naming stored values, and a command the output suggests carry the values
  themselves, since the parser reads them back.

### Stored files

- Only the current stored format and command surface are read or answered. An older file is refused with
  `OLDER_FORMAT_ADVICE` (`src/adapters/constants/OlderFormatAdvice.ts`), held by `cli/OlderTrackerRefusal.spec.ts`.
  Nothing migrates; a retired verb, word or flag is unknown.
- A malformed stored file is a verdict and a report, never a throw that takes down `status` or `render`.
- `progress.json` keeps unknown keys, top level and on rows, in order. An optional key is written only once set, and
  a read never adds or rewrites one, so a file stays byte-identical.
- An epic is `.agent-progress/epics/<key>.md`, known by its file name, its description kept byte for byte like a
  ticket body; the folder exists only once an epic was added. Its colour `slot` is stored at `epic add`, never derived.
- The Board logs ids and values through one `log(record)` over a typed record union (the vocabulary, no method per
  record); an adapter util words the records, the collector gathers them, the writer stores
  `.agent-progress/log.jsonl`.

### Errors and exit codes

- A decider returns a verdict and fails closed.
- Library code throws `OperationRefusal` (`refused` or `unrepaired`), never writes to the terminal, never exits. A
  Board rule throws `BoardRefusal` (a reason code and facts), which the tracker pipeline wraps as `refused`.
- A refusal thrown from `src/` carries a wordless `detail`; only `cli/` builds one from words (the install-version
  mismatch is its one detail). Every printed refusal is worded by the one refusal-wording util in `src/adapters/`,
  which no service imports.
- Exit codes: 0 done or nothing to do; 1 an actionable refusal or unknown command; 2 `unrepaired` or any other
  throw. An adapter maps them, `cli/Main.ts` applies the mapping, `agent-progress.ts` holds the only `process.exit`.
  Three deliberate exit-0 failures are under Deviations.

### Runtime

- `process.env` is read only in `src/shared/Environment.ts`, through documented getters; specs set it in a child
  process (one exception, Deviations).
- No work at module load (entry points excepted, Deviations). The render service keeps no module state: the page
  bundle and configured Marked live in the render state the command context carries.
- Factories of closures over classes, except for state carried across calls, domain and ingestion classes. A
  constructor does no work.
- A record keyed by outside text is indexed through `Object.hasOwn`.
- A command takes everything (directory, now, streams, stdin, prompt, platform, home) from its `CommandContext`.
- Every write of a file a reader may hold open goes through the atomic-file package.
- A clock decides nothing: identity is a content hash, staleness a set difference or version; timestamps are only
  recorded and shown. Each exception says so in a comment at its site.

### Generated and installed files

- Generated files stay out of the repository: `init` and `update` build the dispatcher from `dispatcher/` into
  `.agent-progress/agent-progress-dispatch.js`.
- One manifest, `.agent-progress/version.json` holding `INSTALL_VERSION`, versions everything installed; no file
  carries a stamp. It is written last, so a cut-short run leaves the old version; a fresh `init` writes the brief
  first, so a cut-short one reads as unversioned.
- Bump `INSTALL_VERSION` by hand, in the same commit, when an installed file becomes wrong against the new CLI: a
  command, flag, JSON field, stored state or exit code it names changes meaning or goes, the dispatcher's launch
  arguments change, or an installed file moves or is added. Wording and `DISPATCH_PROTOCOL` numbers do not bump it.
  `cli/InstalledSurface.spec.ts` holds the surface side against `cli/FrozenInstalledSurface.json`.
- The version check reads only the manifest; `update` and `init` refuse a newer one. `cli/InstallVersionVerdict.spec.ts`
  holds the verdicts: equal is current; anything else, a missing manifest beside an installed brief, or an unreadable
  one is a mismatch; missing with no brief is current.

### Comments

- The code explains itself. A file header (one to three sentences) only when path and export do not; a docblock only
  for a non-obvious contract edge; an inline comment only for a why.
- Never restate code, narrate history or carry a measurement: those go in the commit message. Name files
  repo-rooted in backticks. No TODOs: agreed-and-not-done work lives in `docs/backlog.md`.

### TypeScript and lint

- Bun runs the TypeScript; `tsc` only type-checks, under `tsconfig.json`'s strict options. Write for them:
  `process.env['NAME']`, a written fallback instead of `!`, conditional objects instead of spreading `undefined`,
  `import type` for types.
- The page is its own DOM-only project (`page/tsconfig.json`, specs under `page/tsconfig.spec.json`); `dispatcher/`
  is the Workflow-runtime project (`dispatcher/tsconfig.json`, specs under `dispatcher/tsconfig.spec.json`), and only
  `dispatcher/DispatchFromWorkflowGlobals.ts` names the Workflow globals. Their `include` lists are held both ways by
  `src/ProjectIncludeLists.spec.ts`; everything the page reaches stays DOM-safe.
- `init`, `update` and the specs build the dispatcher from the one shared build request, never importing
  `dispatcher/`.
- ESLint 9 through `@reliquary/eslint-config`, extended in `eslint.config.js`; `bun run lint` is its statement. The
  testing folders may import devDependencies.

### Tests

- A spec sits beside its module as `<Module>.spec.ts` (a second suite `<Module>.<aspect>.spec.ts`, never `.test.ts`), opening
  with a docblock of which cases matter and why; test names are claims. A frozen expected-output table comes from the
  previous implementation (two exceptions, Deviations) and says how to retake it.
- A test needing a tool the machine may lack skips through `src/testing/ToolGuard.ts`, its title saying what is
  missing; the preload `src/testing/TestRunReport.ts` counts and names every skip, and
  `AGENT_PROGRESS_REQUIRE_EVERY_TOOL=1` fails them. End-to-end suites spawning the binary sit at the layer root.
- A guard proves its scan found something and is watched failing on each form it claims; an allowlist is exact both
  ways.
- Tests never touch live data: every spec works under the scratch root, checked by `src/testing/TrackerIsolation.ts`;
  no spec creates the real process context; the binary is spawned only through `cli/testing/CliProcess.ts`; never
  `process.chdir`.
- Each dispatcher decision in the `dispatcher/Dispatcher.*.spec.ts` suites must hold on the built bundle and fail on
  a SourceMutant of its module; a mutant whose text is not in its module exactly once fails the build.

### Documentation and commits

- One CLAUDE.md, holding only rules, boundaries and decisions; a change that invalidates a rule updates it in the
  same change. Its `agent-progress:managed` block comes from `resources/templates/ClaudeInstructionsBlock.md`:
  change the template, never the block.
- `docs/backlog.md` is agreed and not started, with why it waits. `docs/cli.md` is the one reference for commands,
  flags, exit codes and file formats.
- A commit is one plain, human-written subject line, with no AI attribution.

### Deviations

| Rule | Done instead | Why |
| --- | --- | --- |
| Ingestion reads, validates and maps in separate steps. | The ticket parse is one line-oriented pass. | A second walk would risk the unowned lines kept byte for byte. |
| No work at module load. | `agent-progress.ts` runs the command on import, `page/PageStart.ts` starts the page, the preload `src/testing/TestRunReport.ts` registers its report. | They are entry points. |
| Specs never set the environment in-process. | `src/shared/Environment.spec.ts` does, once. | It tests the getters themselves. |
| A frozen table comes from the previous implementation. | `dispatcher/testing/FrozenDispatchTraces.json` is retaken from the bundle, only in a commit meant to change what agents are told, its diff showing prompt text or wire names and no decision; `cli/FrozenInstalledSurface.json` is taken from the installed files. | No previous implementation holds them. |
| A `src/lib/` package leaves a refusal as a verdict. | The tracker model's `Board` throws `BoardRefusal`. | A domain class throws a typed domain error. |
| A feature never reaches another. | `cli/` reaches `dispatcher/`, the render service `page/`, by path, to bundle them. | Bundled, never imported. |
| One reference per fact. | `skill/Reference.md` copies three `docs/cli.md` sections verbatim (ticket format, ticket moves, exit codes); a change to either changes both. | Agents elsewhere cannot read `docs/cli.md`. |
| A failure exits non-zero. | Exit 0 for: `hook subagent-stop` after its arguments are read; a store write whose render failed (reported on stderr); `release` when git declined the worktree removal or `branch -d` after the merge (reported). | The agent finished; the store holds the change; the release happened. |

## Local rules

### Command surface

- This checkout's tracker is live, the board this repository's work runs on. Exercise the CLI under development only
  in a scratch repository: nobody runs the checkout's source here, and only the owner runs `init`, `update` or
  `clear`.
- Help is one screen, no per-command help; to stdout when asked, to stderr after an unknown command.
- Every command but `init`, `update`, `help` and `status` checks the install version first (`cli/Main.spec.ts`);
  `release` reports a mismatch as its `--json` refusal, `hook subagent-stop` at exit 0.
- A new command is an entry in `cli/CommandTable.ts`, a block in `cli/HelpText.ts` and a folder in its set, held by
  `cli/CommandTable.spec.ts` and `cli/HelpText.spec.ts`.
- Every mutating command writes through `writeTracker` in `src/services/tracker/TrackerPipeline.ts` (lock, read into
  a Board, change, writes in `docs/cli.md`'s order, render from disk, one lock hold). `init` creates a tracker;
  `update`, and `init` on an existing one, never touch its files. `status` takes no lock and renders nothing.

### Tickets

- Tickets are hand-edited between runs; the CLI owns a frontmatter subset (`docs/cli.md`) and writes back every
  other line.
- A ticket is its frontmatter `id`, never its file name. Ticket and task ids are never reused or gap-filled.
- Only a transition stamps `updated`. The named verbs enforce the legality matrix; `ticket status` skips it on purpose.
- A ticket's `epics` is an ordered list, the first its primary epic, written only when non-empty. An epic has no
  lifecycle: its progress is a Board roll-up over its tickets, and it never touches dispatch, claiming, concurrency or
  release, which stay `group`'s.
- A row's `history` holds only what the tool watched.
- A review row belongs to its ticket by `reviewOf` alone. The page reads which rows are bars from the Board facts,
  and a bar's name only to order a ticket's bars.

### The page

- `resources/template.html` is designer-owned, never generated. Its placeholder markup is the contract with the page
  modules: a one-sided change is a bug, a new mark reuses a styled class, and its header comment (tokens, containers,
  axis box) stays in step.
- The page script clears every container it owns before filling it; a failed bundle renders an error banner.
- The template's bootstrap owns theme and tab selection, reached only through `window.agentProgressTemplate`. No ticket
  open state is kept: `agent-progress:open-tickets` is retired, and a ticket body shows only in the detail panel.
- Browser storage is touched only in `page/preferences/ViewerPreferences.ts`, and a key string never changes.
- The render service writes `boardFacts` from the same Board queries `status --json` prints; the page keeps no copy
  of the rules.
- The detail panel claims a log line by its `taskIds` or `ticketIds`, never a number in free text; a note is matched
  by its sentence.
- Every value passes `escapeHtml` once; a ticket's `bodyHtml` and an epic's `descriptionHtml`, both from the Markdown
  renderer, are the two unescaped strings. Stamps are sliced, never re-parsed, and shortened only through the page's
  `TimeUtil`.
- A visual change leaves the README screenshots stale: once it lands, run `.readme-graphics/regenerate.sh` in the
  main checkout.

### Skills

- `skill/` loads in every tracked session, so orchestrator-only material goes in `skill-orchestrate/`.
- No skill file lists commands: `agent-progress help` is the reference. `skill/SKILL.md` names it and
  `skill/Reference.md`, which holds only what help does not print and follows `docs/cli.md`.
- A `SKILL.md` `description` is its trigger, naming the words a user says. Skill files cite only commands, paths in
  a tracked repository, or files beside them.
- `skill-orchestrate/` repeats nothing from `skill/`, writes rules as instructions, and never restates what the
  dispatcher decides. Call budgets and the rework threshold are `DISPATCH_PROTOCOL`
  (`src/shared/constants/DispatchProtocol.ts`), filled into the brief and block by `init` and `update`.
- `setup.sh` symlinks both into `~/.claude/skills/`, and `~/development/claude/skills.json` must list them under
  `ignore`.

## Repository map

```
agent-progress.ts    the bin shim: runs the command line and exits with its number
cli/                 feature: the command surface, its commands grouped into sets
page/                feature: the browser page, its own DOM-only project
dispatcher/          feature: the dispatcher policy, which init and update bundle into a Workflow script
resources/           files read at runtime: the page template and the markdown init, update and ticket add fill
src/lib/             package-grade building blocks, one folder each
src/adapters/        the boundary: every stored format read, written and mapped, and the wording
src/services/        the tracker and render services
src/shared/          app-specific code several parts use
src/testing/         test-only helpers several parts use
skill/               the skill every session in a tracked repository loads
skill-orchestrate/   the skill for the one session running the board
docs/                the CLI reference, development notes, the backlog, the migration plan, README images
.readme-graphics/    the scripts and demo board that retake the README images; its build/ is git-ignored
```

<!-- agent-progress:managed:start -->
## Progress tracking with agent-progress

This repository tracks its work with the `agent-progress` CLI. The tracker lives in the git-ignored
`.agent-progress/` folder at the repository root and is shared by every worktree of it, so subagents
in separate checkouts all write to the same chart.

- Load the `agent-progress` skill before working here, and run `agent-progress status --json` at the
  start of a session to find out what was already in flight. If this session is running the board —
  taking ticket requests and dispatching agents for them — load `agent-progress-orchestrate`
  instead; it loads the other one itself.
- Only the orchestrator runs agents for tickets, and it runs them through the dispatcher workflow,
  `.agent-progress/agent-progress-dispatch.js`, started only on the user's go. Any other session or
  agent files a ticket when it is asked to and stops there: it never dispatches an agent to handle
  one, its own or anybody else's.
- Every agent's prompt names its row, its ticket or its review on a line of its own, and the
  `SubagentStop` hook adds every token the agent processed to that row when it stops, so where the
  hook is installed pass no `--tokens`: it would replace the sum.
- A ticket is picked up on a worktree of its own, never in the main checkout, by a builder or by a
  reviewer. The ticket's `## Brief` section, when it has one, is its builder's brief. A builder fixes
  the defects it finds beside its work when it can prove the fix, and ends by committing on its
  branch, rebasing it onto the main line and filling in its ticket's `## Handoff`: every agent leaves
  its branch ready to fast-forward into main. Nobody continues a finished agent with a follow-up
  message — a fresh agent for the remainder costs less than the one holding the whole transcript.
- A review is a clean agent following the review brief in `.agent-progress/review-brief.md`. It starts
  from the Handoff rather than redoing the work, fixes what it finds in the branch's change and the
  ticket's Acceptance, settles its own doubts, rebases onto the main line again, and releases the
  branch itself with `agent-progress release`, which lets one branch into main at a time. Anything
  outside that, however small, is filed unfixed as a low-priority ticket. A second review is only for
  a pass that reworked over 750 lines of code (comments and documentation not counted) in its fixes
  and rebase, and is asked for, never scheduled by the reviewer.
- File every bug, change or feature the user reports as a ticket (`agent-progress ticket add
  "<title>" --type bug|change|feature`) and move it with `agent-progress ticket start|finish|approve|deliver <id>`.
- Record milestones with `agent-progress log "<what happened>"`; `--at -5m` backfills a stamp nobody
  registered at the time.
- Never edit `.agent-progress/progress.json` by hand, and edit a ticket only below its frontmatter —
  `agent-progress ticket show <id>` prints the file path to edit.
- Run `agent-progress open` once per session so the user has the dashboard; it reloads itself within
  a minute of new data when idle as the work moves.
<!-- agent-progress:managed:end -->
