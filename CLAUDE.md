# agent-progress

A Bun + TypeScript CLI that tracks an AI orchestrator's work per repository (Gantt rows, stateful markdown tickets,
a log, and a self-contained `progress.html` regenerated on every command), and installs into each tracked repository
the skills and briefs its sessions run on.

## Verify

`bun run verify` (typecheck, `bun test` and lint) after any TypeScript change, before calling it done.
Never ad-hoc `tsc` flags; never edit `package.json` to make a check pass.
`.githooks/pre-commit` (wired by `setup.sh`) refuses a commit failing lint or typecheck; never bypass it with
`--no-verify`.

## Rules

The owner's coding conventions; where this repository deliberately differs, Deviations says so and why. A rule a
guard spec holds is one line naming the guard: the spec is the full statement.

### Files and naming

- One purpose per file, explainable from its path and exports. A file is `PascalCase.ts`, named after its main
  export; folders are lower case. No barrel files.
- A util is one pure, frozen object grouping a domain (`LocalTimeUtil.formatLocalIso(…)`), tested against its own
  contract. A one-line type or constant lives in its consumer's folder file. An app-wide list is one global object,
  such as `LIMITS`.
- `src/UtilShape.spec.ts` holds that no exported `*Util` has fewer than two members.
- Code starts beside its only consumer and moves, generalised, on a second one; never in anticipation.
- Full, descriptive names, no abbreviations. Name a thing for what it is or does, never its layer or history, never
  shadowing a global (`CorpusMap.ts`, not `Map.ts`): a question as the question (`sourceIsReachable`), a producer
  for its product (`fullTextOf`), a boolean as a predicate phrase.
- Design constants are `SCREAMING_CASE`, named for what they bound, with the unit.
- `eslint.config.js` holds one-letter names (`id-length`: only `i`, `a`, `b`) and inline magic numbers
  (`@typescript-eslint/no-magic-numbers`, its ignore list the arithmetic identities, off in specs, `testing/` and
  `constants/` folders); `src/LintRules.spec.ts` plants each mechanised rule's forms and exceptions.
- Everything is English. Example data is obviously synthetic: `Alex Example`, `Example Agency`.

### Imports

```
src/lib/  →  src/shared/  →  src/adapters/  →  src/services/ (render → tracker → lifecycle → control → Overseer)  →  features (cli/, bridge/)
```

- `src/ImportDirection.spec.ts` holds the direction, cycles, barrels, feature and sibling-command isolation, the bin
  shim, the `testing/` allowlist (`TESTING_FOLDER_IMPORTERS`), a lib package's declared "depends on" packages and
  the tracker model's isolation. What two commands share is hoisted to the level above both, or passed as a
  structurally typed parameter.
- A `src/lib/` package knows nothing about its callers: no agent-progress names, file names, wording or exit codes.
  App values arrive as parameters; a refusal leaves as a verdict (except the `Board`, see Deviations).
- `src/lib/tracker-model/` stays DOM-safe: the Bridge project compiles it.

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
- A malformed stored file is a verdict and a report, never a throw that takes down `status`.
- `progress.json` keeps unknown keys, top level and on rows, in order. An optional key is written only once set, and
  a read never adds or rewrites one, so a file stays byte-identical.
- An epic is `.agent-progress/epics/<key>.md`, known by its file name, its description kept byte for byte like a
  ticket body; the folder exists only once an epic was added. Its colour `slot` is stored at `epic add`, never derived.
- The Board logs ids and values through one `log(record)` over a typed record union (the vocabulary, no method per
  record); an adapter util words the records, the collector gathers them, the writer stores
  `.agent-progress/log.jsonl`.
- Every name the product goes by on a machine (program, data, worktrees and monitor folders, skills, storage and
  environment prefixes, login item, Overseer port) is `PRODUCT_NAMES` in `src/shared/constants/ProductNames.ts`; every
  folder, marker, key and removal derives from it. The build is `agent-progress-v2` beside the released program, and
  `init` and `update` refuse `older-program-present` where the released program's data folder exists.

### Errors and exit codes

- A decider returns a verdict and fails closed.
- Library code throws `OperationRefusal` (`refused` or `unrepaired`), never writes to the terminal, never exits. A
  Board rule throws `BoardRefusal` (a reason code and facts), which the tracker pipeline wraps as `refused`.
- A refusal thrown from `src/` carries a wordless `detail`; only `cli/` builds one from words (the install-version
  mismatch is its one detail). Every printed refusal is worded by the one refusal-wording util in `src/adapters/`,
  which no service imports.
- Exit codes: 0 done or nothing to do; 1 an actionable refusal or unknown command; 2 `unrepaired` or any other
  throw. An adapter maps them, `cli/Main.ts` applies the mapping, `agent-progress.ts` exits. Six deliberate exit-0
  failures are under Deviations.

### Runtime

- `eslint.config.js` (`CONFINED_REACHES`, the clock selectors) holds `process.env` to `src/shared/Environment.ts`,
  `process.exit` to `agent-progress.ts` and `watcher.ts` (Deviations), `process.cwd`, `homedir()` and the clock
  in `src/` and `cli/` to `cli/CommandContext.ts`, and `process.chdir` to nowhere. The environment is read through
  documented getters; specs set it in a child process (one exception, Deviations). The product's own variables are
  named from `PRODUCT_NAMES.ENVIRONMENT_PREFIX`, never as literals.
- No work at module load (entry points excepted, Deviations). The render service keeps no module state: the
  configured Marked lives in the render state the command context carries.
- Factories of closures over classes, except for state carried across calls, domain and ingestion classes. A
  constructor does no work.
- A record keyed by outside text is indexed through `Object.hasOwn`.
- A command takes everything (directory, now, streams, stdin, prompt, platform, home) from its `CommandContext`.
- Every write of a file a reader may hold open goes through the atomic-file package.
- A clock decides nothing: identity is a content hash, staleness a set difference or version; timestamps are only
  recorded and shown. Each exception says so in a comment at its site.

### Generated and installed files

- Generated files stay out of the repository; `init` and `update` install no generated file, only filled templates
  and the skills.
- One manifest, `.agent-progress/version.json` holding `INSTALL_VERSION`, versions everything installed; no file
  carries a stamp. It is written last, so a cut-short run leaves the old version; a fresh `init` writes
  `session-instructions.md` first, so a cut-short one reads as unversioned.
- Bump `INSTALL_VERSION` by hand, in the same commit, when an installed file becomes wrong against the new CLI: a
  command, flag, JSON field, stored state or exit code it names changes meaning or goes, the SessionStart hook's
  command changes, or an installed file moves or is added; worker command lines are runtime and never installed.
  Wording and `DISPATCH_PROTOCOL` numbers do not bump it.
  `cli/InstalledSurface.spec.ts` holds the surface side against `cli/FrozenInstalledSurface.json`.
- The version check reads only the manifest; `update` and `init` refuse a newer one. `cli/InstallVersionVerdict.spec.ts`
  holds the verdicts: equal is current; anything else, a missing manifest beside `session-instructions.md` or a version
  16 board's `agent-brief.md`, or an unreadable one is a mismatch; missing with neither is current.
- `init` and `update` never write CLAUDE.md: it holds a repository's conventions only. They remove install version 16's
  managed block once, through `removeManagedBlock`, and the hook entries, files and briefs it installed, whose names
  live in the unscanned `cli/adoption/constants/RetiredClaudeInstall.ts`.

### Comments

- The code explains itself. A file header (one to three sentences) only when path and export do not; a docblock only
  for a non-obvious contract edge; an inline comment only for a why.
- `src/CommentRuns.spec.ts` holds that no inline comment outside a docblock runs past two lines.
- Never restate code, narrate history or carry a measurement: those go in the commit message. Name files
  repo-rooted in backticks. Agreed-and-not-done work lives in `docs/backlog.md`; `no-warning-comments` in
  `eslint.config.js` holds that no TODO does.

### TypeScript and lint

- Bun runs the TypeScript; `tsc` only type-checks, under `tsconfig.json`'s strict options. Write for them:
  `process.env['NAME']`, a written fallback, conditional objects instead of spreading `undefined`.
- `eslint.config.js` holds no `!` non-null assertion and type-only imports as `type`.
- `bridge/` is its own DOM-only React project (`bridge/tsconfig.json` with `jsx: react-jsx` and `types: []`, specs
  under `bridge/tsconfig.spec.json`). Its `include` list, the whole tracker model among it, is held both ways by
  `src/ProjectIncludeLists.spec.ts`; everything the Bridge reaches stays DOM-safe.
- ESLint 9 through `@reliquary/eslint-config`, extended in `eslint.config.js`; `bun run lint` is its statement. The
  testing folders may import devDependencies.

### Tests

- A spec sits beside its module as `<Module>.spec.ts` (a second suite `<Module>.<aspect>.spec.ts`), opening with a
  docblock of which cases matter and why; test names are claims. A frozen expected-output table comes from the
  previous implementation (two exceptions, Deviations) and says how to retake it.
- A test needing a tool the machine may lack skips through `src/testing/ToolGuard.ts`, its title saying what is
  missing; the preload `src/testing/TestRunReport.ts` counts and names every skip, and
  `AGENT_PROGRESS_REQUIRE_EVERY_TOOL=1` fails them. End-to-end suites spawning the binary sit at the layer root.
- A guard proves its scan found something and is watched failing on each form it claims; an allowlist is exact both
  ways.
- Tests never touch live data: every spec works under the scratch root, checked by `src/testing/TrackerIsolation.ts`;
  the binary is spawned only through `cli/testing/CliProcess.ts`.
- No spec starts a real agent session: the preload `src/testing/ClaudeLaunchGuard.ts` puts a recording `claude` first on
  the run's and every spawned binary's `PATH` and fails the run naming the spec that reached it.
- `src/TestFileConventions.spec.ts` holds that no `.test.ts` or `.spec.tsx` file exists, a component spec is a
  `<Component>.dom.tsx` under `bridge/` alone, and no spec or test helper creates the real process context.
- `bun test` never runs a DOM spec: `bridge/testing/RunDomSpecs.ts` runs each `.dom.tsx` with the skip report and the
  happy-dom preload, `bun run verify` runs it after `bun test`, and it fails when it finds none.

### Documentation and commits

- One CLAUDE.md, holding only rules, boundaries and decisions; a change that invalidates a rule updates it in the
  same change. agent-progress's instructions are not in it: they are `.agent-progress/session-instructions.md`,
  installed from `resources/templates/SessionInstructions.md` and printed by the SessionStart hook. The
  `agent-progress:managed` block below is this checkout's own install of the released program, never edited by hand.
- `docs/backlog.md` is agreed and not started, with why it waits. `docs/cli.md` is the one reference for commands,
  flags, exit codes and file formats.
- `src/ProseWrap.spec.ts` holds the 120-column wrap of this file, `docs/cli.md`, `docs/backlog.md`, the skills and the
  templates under `resources/templates/`.
- A commit is one plain, human-written subject line, with no AI attribution.

### Deviations

| Rule | Done instead | Why |
| --- | --- | --- |
| Ingestion reads, validates and maps in separate steps. | The ticket parse is one line-oriented pass. | A second walk would risk the unowned lines kept byte for byte. |
| No work at module load. | `agent-progress.ts` runs the command on import, `watcher.ts` runs its Watcher, the preload `src/testing/TestRunReport.ts` registers its report, the preload `src/testing/ClaudeLaunchGuard.ts` installs its `claude` trap, the preload `cli/testing/OtherProductNamesPreload.ts` registers its name swap, the fake agent `src/testing/fake-agent/FakeAgentChild.ts` plays its scenario, `bridge/Main.tsx` mounts the Bridge, `bridge/testing/RunDomSpecs.ts` runs the DOM specs, the preload `bridge/testing/HappyDom.ts` registers the DOM. | They are entry points. |
| Specs never set the environment in-process. | `src/shared/Environment.spec.ts` does, once; the preload `src/testing/ClaudeLaunchGuard.ts` prepends its trap to `PATH`. | It tests the getters themselves; the trap must lead every spawn's `PATH`. |
| A frozen table comes from the previous implementation. | `cli/FrozenInstalledSurface.json` is taken from the installed files. | No previous implementation holds them. |
| Only the current stored format is read. | A ticket stored with `type` `change` or `feature` reads as `ticket` everywhere, and every write keeps its stored `type` line. | Stored tickets are never rewritten; both are older names for `ticket`. |
| Only the current stored format is read. | A stored `dispatcherState` `finished` reads as `stopped`. | Stored files are never rewritten; reading it as stopped fails closed. |
| Only the current stored format is read. | A Watcher's `watcher-<instance>.json` and event log are read in that Watcher's own `EVENT_LOG_FORMAT_VERSION` until it ends, one below `WATCHER_PROTOCOL_OLDEST_SUPPORTED` as a watch-only legacy Watcher (`src/services/overseer/LegacyWatcherReader.spec.ts`, a fixture per version). | An Overseer update must never kill or strand a running agent. |
| Only `agent-progress.ts` exits. | `watcher.ts`, the Watcher binary, exits with the code `runWatcher` in `src/lib/watcher/` returns, and imports nothing else, held by `src/ImportDirection.spec.ts` and `src/lib/watcher/WatcherBundleClosure.spec.ts`. | It is a second entry point: the Overseer bundles and spawns it, detached, once per job instance. |
| Every write of a file a reader may hold open goes through the atomic-file package. | A Watcher appends its `events-<instance>.ndjson` in place, fsynced before its `end` is written. | An append-only log is never replaced; a reader ignores an unterminated last line. |
| Every write of a file a reader may hold open goes through the atomic-file package. | The Overseer appends `overseer.log` in place, one line per write. | A log someone tails is never replaced; an atomic rewrite would break the tail. |
| A `src/lib/` package leaves a refusal as a verdict. | The tracker model's `Board` throws `BoardRefusal`. | A domain class throws a typed domain error. |
| A feature never reaches another. | `cli/overseer/routes/OverseerRoutes.ts` imports `bridge/index.html`, the one entry of `FEATURE_REACHES_BY_PATH` in `src/ImportDirection.spec.ts`. | Bundled, never imported: Bun bundles the HTML import. |
| One reference per fact. | `resources/templates/Reference.md`, installed as `.agent-progress/reference.md`, copies three `docs/cli.md` sections verbatim (ticket format, ticket moves, exit codes); a change to either changes both, held by `cli/ReferenceCopies.spec.ts`. | Agents elsewhere cannot read `docs/cli.md`. |
| A failure exits non-zero. | `hook session-start` exits 0 whatever happens, printing nothing on failure and skipping the install check. | A failing SessionStart hook would reach every session in the repository. |
| A failure exits non-zero. | `hook bash-domains` exits 0 whatever happens, skipping the install check and answering deny through its JSON on any failure. | A hook that errors lets the call through; the deny is what keeps the network inside the ticket's line. |
| A clock decides nothing. | No launch, resume or orchestrator delivery happens before the usage marker's `resetsAt`, and the Overseer wakes a DrivePass at it (`src/lib/tracker-model/Playbook.ts`, `src/services/overseer/DrivePass.ts`). | The vendor names its reset as a time, and only a clock can honour it. |
| A failure exits non-zero. | A verb relayed under a job whose reply does not come within `HATCH_REPLY_TRIES` × `HATCH_REPLY_INTERVAL_MILLISECONDS` prints `queued <requestId>` and exits 0. | The request is written; the Overseer applies it later, and the id is what a filed finding cites. |
| A clock decides nothing. | A running build or review whose event log stands still for `QUIET_JOB_SWEEPS` Overseer sweeps opens `quiet-job` (`src/services/overseer/IncidentRouter.ts`). | A hung session makes no calls, so no count of its own bounds it; sweeps come at an interval, and the incident only asks. |
| A failure exits non-zero. | A monitor registry (`~/.agent-progress-monitor/projects.json`) that cannot be read or written, a newer version or a malformed one is reported on stderr and the command keeps its exit code. | The command's own work is done; the registry is only a pointer for a monitor. |

## Local rules

### Command surface

- This checkout's tracker is live, the board this repository's work runs on. Exercise the CLI under development only
  in a scratch repository: nobody runs the checkout's source here, and only the owner runs `init`, `update` or
  `clear`.
- Help is one screen, no per-command help; to stdout when asked, to stderr after an unknown command.
- Every command but `init`, `update`, `help`, `status` and `version` checks the install version first
  (`cli/Main.spec.ts`); `hook session-start` and `hook bash-domains` skip it; `run status` and `run stop` skip
  it, so an Overseer whose install changed can still be inspected and stopped.
- `src/TestFileConventions.spec.ts` holds that no spec starts an Overseer without `--port 0`.
- A new command is an entry in `cli/CommandTable.ts`, a block in `cli/HelpText.ts` and a folder in its set, held by
  `cli/CommandTable.spec.ts` and `cli/HelpText.spec.ts`.
- Every mutating command writes through `writeTracker` in `src/services/tracker/TrackerPipeline.ts` (lock, read into
  a Board, change, writes in `docs/cli.md`'s order, one lock hold; nothing renders), and `cli/RegisterWrittenTracker.ts`
  registers the tracker with the monitor after every write and at the Overseer's start. `init` creates a tracker;
  `update`, and `init` on an existing one, never touch its files but the `progress.html` stub. `status` takes no
  lock.

### Tickets

- Tickets are hand-edited between runs; the CLI owns a frontmatter subset (`docs/cli.md`) and writes back every
  other line.
- A ticket is its frontmatter `id`, never its file name. Ticket and task ids are never reused or gap-filled.
- Only a transition stamps `updated`. The named verbs enforce the legality matrix; `ticket status` skips it on purpose.
- `ticket add` files a draft ticket, `draft`, with no row at any priority; only `ticket ready`, after the readiness
  reading the landing shares (`TicketAcceptanceUtil`), moves it to `pending` and files its row, and no move returns a
  ticket to `draft`, not even `ticket status`. The filing cabinet's drafts are "filing drafts" in help and wording.
- A ticket's `epics` is an ordered list, the first its primary epic, written only when non-empty. An epic has no
  lifecycle: its progress is a Board roll-up over its tickets, and it never touches dispatch, claiming, concurrency or
  release, which stay `group`'s.
- A row's `history` holds only what the tool watched.
- An Overseer build job's `## Handoff` is code's: written from the builder's verified report only after its gate passes,
  replacing the section the filing template left; a builder never edits its ticket file (`docs/cli.md`, "A build job").
- A review row belongs to its ticket by `reviewOf` alone. The Bridge reads which rows are bars from the Board facts,
  and a bar's name only to order a ticket's bars.

### The Bridge

- The Bridge is the board's one page: the React live UI the Overseer serves at `GET /` from `bridge/index.html`, an
  HTML import in `cli/overseer/routes/OverseerRoutes.ts` that `src/services/overseer/OverseerServer.ts` builds with
  `Bun.build` for production and serves through `fetch`, never Bun's HTML route, which takes no headers: every file
  carries the page CSP's `frame-ancestors`. It reads the Overseer's API and nothing else, and keeps no copy of the
  rules: what it shows arrives as facts. Nothing renders a static page: `open` opens the live Overseer's URL or is
  refused `overseer-down`, and `progress.html` is a stub that `init`, `update` and `run` write, naming that URL or
  saying the Overseer is down.
- The render service builds the payload from the same Board queries `status --json` prints (`BoardFacts`,
  `PagePayloadAssembly`, `MarkdownRenderer`); a ticket's `bodyHtml` and an epic's `descriptionHtml` are its only HTML.
- The detail panel claims a log line by its `taskIds` or `ticketIds`, never a number in free text; a note is matched
  by its sentence. Stamps are sliced, never re-parsed.
- A view model reads a structural type of exactly the fields it uses; tracker types satisfy it unchanged.
- A visual change leaves the README screenshots stale: once it lands, run `.readme-graphics/regenerate.sh` in the
  main checkout.
- `bridge/styles/tokens.css` holds every colour, state token and theme value; `bridge/styles/board.css` holds every
  class. Both are designer-owned. `bridge/StyleContract.spec.ts` holds both ways that every class a component emits is
  styled and every styled class is emitted; a `className` is a literal the scan can read.
- React's escaping is the one escape for a value: no value is escaped by hand, and a pre-escaped one would show its
  entities. `eslint.config.js` bans
  `dangerouslySetInnerHTML` and assigning `innerHTML` or `outerHTML` in `bridge/`; agent-written HTML reaches the DOM
  only as a sandboxed iframe's `srcdoc`, whose fixed markup is the one place `escapeHtml` is used, for its title.
- A view is `bridge/views/<view>/`: its component, and its logic in a pure `<View>Model.ts` beside it, specced as a
  plain `.spec.ts` in the main run; its behaviour is held by `.dom.tsx` specs, never a frozen markup table. A pure
  util several views use lives in `bridge/utils/` (chip parts in `bridge/chips/`), with its spec.
- `bridge/shell/` holds what the entry starts with: the hash router, the theme bootstrap, the embedded channel (theme in
  and Esc out by `postMessage`, only with the framing parent's origin), the banners and the error boundary.
  `bridge/api/` holds the clients of the Overseer's API. Every control is a `CommandButton` posting a
  `ControlCommand`, disabled while the event stream is down or launches are held, its refusal shown verbatim.
- `eslint.config.js` holds the Bridge's browser storage to `bridge/preferences/PreferenceStore.ts`, keys under
  `<STORAGE_PREFIX>:<trackerId>` and the theme under `<STORAGE_PREFIX>:theme`.
- `bridge/HeadlessBridge.spec.ts` loads the Bridge from a real Overseer in headless Chrome and fails on a console error,
  an exception or a failed request; it skips through `src/testing/ToolGuard.ts` without Chrome.

### Skills

- Two skills, split by audience. `skills/agent-po/` is PO intake: it loads in any session asked to file a ticket and
  as an Overseer product-owner job's first line, holds the whole filing procedure, files every ticket as a draft with a
  numbered Acceptance and a `## Brief`, and readies drafts only on User's yes in User's own session (under the Overseer
  it closes intake instead); it loads no other skill. `skills/agent-progress-orchestrate/` is the interactive wrapper
  around a running Overseer (`run`): it reads its state, starts it on User's go, turns User's intent into verbs,
  loads `agent-po` for intake and may wait on `await`; it never drives the lifecycle or handles an incident, which
  are the Overseer's and its Assistant's.
- No agent preloads a skill, and nothing installs a brief or worker definition: an Overseer's roles read their runtime
  prompts under `resources/prompts/`, and the Assistant its installed `.agent-progress/assistant-brief.md`.
- No skill file lists commands: `agent-progress help` is the reference. Both skills name it and
  `.agent-progress/reference.md`, installed from `resources/templates/Reference.md`, which holds only what help does
  not print and follows `docs/cli.md`.
- A `SKILL.md` `description` is its trigger, naming the words a user says. Skill files cite only commands, paths in
  a tracked repository, or files beside them; naming a skill the host may offer, such as `grill-me`, is no citation.
- `skills/agent-progress-orchestrate/` repeats nothing from `skills/agent-po/`, writes rules as instructions,
  and never restates what the Overseer decides. Call budgets and the rework threshold are `DISPATCH_PROTOCOL`
  (`src/shared/constants/DispatchProtocol.ts`), stated by the Overseer's job prompts and never by an installed file.
  Neither skill nor the installed guidance names a by-hand lifecycle verb but `ticket deliver --by-hand`, held by
  `cli/HelpText.spec.ts`.
- `init` and `update` copy both into the tracked repository's git-ignored `.claude/skills/`, never globally, and
  remove the files a retired skill folder installed there with its `.gitignore` entry; `setup.sh` only removes the
  `~/.claude/skills/` symlinks into this checkout that earlier versions made.

## Repository map

```
agent-progress.ts    the bin shim: runs the command line and exits with its number
watcher.ts        the Watcher shim: runs one job instance's Watcher from src/lib/watcher/ and exits with its number
cli/                 feature: the command surface, its commands grouped into sets
bridge/              feature: the Bridge, the React live UI the Overseer serves, one DOM-only project: its entry,
                     the shell under bridge/shell/, the API clients under bridge/api/ and the stylesheets
resources/           files read at runtime: the markdown init, update and ticket add fill
src/lib/             package-grade building blocks, one folder each
src/adapters/        the boundary: every stored format read, written and mapped, and the wording
src/services/        the tracker and render services, and the Overseer's: overseer/ (`run`, its DrivePass and its
                     API), lifecycle/ (gates, verification, merges, landings) and control/ (the control contract)
src/shared/          app-specific code several parts use
src/testing/         test-only helpers several parts use
skills/              the two skills, one folder each, named after the skill: agent-po/, PO intake, which a
                     session asked to file a ticket and an Overseer's product-owner job load, and
                     agent-progress-orchestrate/, the interactive wrapper around a running Overseer
docs/                the CLI reference, development notes, the backlog, the migration plan, README images
.readme-graphics/    the scripts and demo board that retake the README images; its build/ is git-ignored
```

<!-- agent-progress:managed:start -->
## Progress tracking with agent-progress

This repository tracks its work with the `agent-progress` CLI. The tracker lives in the git-ignored
`.agent-progress/` folder at the repository root and is shared by every worktree of it, so subagents
in separate checkouts all write to the same chart.

- Run `agent-progress status --json` at the start of a session to find out what was already in
  flight. When the user asks to file, report or track a ticket, bug or research question, load the
  `agent-po` skill. Only when the user asks this session to run the board — orchestrate, work through
  the tickets, take tickets from them — load `agent-progress-orchestrate`; it loads `agent-po` itself.
  Filing or editing a ticket does not make a session the orchestrator and is never a reason to load
  that skill. `.agent-progress/reference.md` holds the ticket format, the moves and the exit codes.
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
- File every bug, change, feature or research question the user reports as a ticket (`agent-progress ticket add
  "<title>" --type ticket|bug|research`) and move it with `agent-progress ticket start|finish|approve|deliver <id>`.
- Record milestones with `agent-progress log "<what happened>"`; `--at -5m` backfills a stamp nobody
  registered at the time.
- Never edit `.agent-progress/progress.json` by hand, and edit a ticket only below its frontmatter —
  `agent-progress ticket show <id>` prints the file path to edit.
- Run `agent-progress open` once per session so the user has the dashboard; it reloads itself within
  a minute of new data when idle as the work moves.
<!-- agent-progress:managed:end -->
