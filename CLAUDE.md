# agent-progress

A Bun + TypeScript CLI that tracks an AI orchestrator's work per repository (Gantt rows, stateful markdown tickets,
a log, and a self-contained `progress.html` regenerated on every command), and installs the skills, brief and
dispatcher its sessions run on.

## Verify

`bun run typecheck && bun test && bun run lint`: all three after any TypeScript change, before calling it done.
`typecheck` covers every project (see TypeScript and lint). Never ad-hoc `tsc` flags; never edit `package.json` to
make a check pass.

## Rules

These follow the owner's coding conventions; where this repository deliberately does otherwise, the table under
Deviations says so and why.

### Files and naming

- One purpose per file, explainable in two or three lines from its path and what it exports. Several exports serving
  that one purpose are fine. A file is `PascalCase.ts`, named after its main export; folders are lower case. No
  barrel files.
- A file earns its place. A util is pure and stateless, one frozen object (`TimeUtil.formatLocalIso(…)`) tested
  against its own contract, and it groups a domain: never a util holding one function. A one-line type or constant
  goes in its consumer's folder file, not a file of its own. An app-wide list is one global object, such as `LIMITS`.
- Code starts beside its only consumer and moves on a second one, generalised first; never in anticipation.
- Full, descriptive names, no abbreviations. Only a loop `i` and a comparator `(a, b)` are one letter; callbacks,
  destructured bindings and throwaway scripts are not exempt.
- Name a thing for what it is or does, never for its layer or its history, and never shadowing a global
  (`CorpusMap.ts`, not `Map.ts`). A question is named as the question (`sourceIsReachable`), a producer for its
  product (`fullTextOf`), a boolean as a predicate phrase (`cleanupHandlersAreInstalled`).
- Design constants are `SCREAMING_CASE`, named for what they bound, with the unit; no magic number inline.
  Arithmetic identities are exempt and stay inline: a percent of a whole, a radix, a division by two.
- Everything is English: identifiers, flags, messages, file names, comments. Example data is obviously synthetic:
  `Alex Example`, `Example Agency`.

### Imports (held by `src/ImportDirection.spec.ts`)

```
src/lib/  →  src/shared/  →  src/adapters/  →  src/services/ (render → tracker)  →  features (cli/, page/, dispatcher/)
```

- Imports run up only, with no cycles and no barrels. A feature (`cli/`, `page/`, `dispatcher/`) imports itself and
  `src/*`, never another feature, and `src/` never imports a feature. Inside `cli/` a command folder never imports a
  sibling command's folder: what two need is hoisted to the level above both (a set's own files, or `cli/`'s root and
  `cli/utils/`), or passed as a structurally typed parameter. `agent-progress.ts` imports only `cli/`.
- Nothing that ships imports a `testing/` folder: the guard's `TESTING_FOLDER_IMPORTERS` names whose specs may import
  each. Current code reaches a `legacy/` folder only through a seam its `LEGACY_SEAMS` lists. A new testing folder or
  seam is a new entry there, and an entry nothing uses any more fails.
- A `src/lib/` package imports only the other `src/lib/` packages its main module's header names in a
  "depends on" sentence, node builtins and external dependencies, and knows nothing about its callers: no agent-progress
  names, tracker file names, user-facing wording or exit codes. App values arrive as parameters; a refusal leaves as a
  verdict the caller turns into `OperationRefusal`, except that the tracker model's `Board`, a domain class, throws its
  typed `BoardRefusal` instead.
- `src/lib/tracker-model/` imports nothing outside its own folder and no builtin: the page's DOM-only project compiles
  it, so it stays DOM-safe.
- `src/shared/` holds app-specific code several parts use.

### Values and wording

- Internal values are string-literal unions, never display text.
- The command line is a boundary of its own: all its text (confirmations, usage lines, argument errors, the help's
  prose, which `cli/HelpText.spec.ts` holds) lives in `cli/`, beside the command that prints it. Command verbs are
  written as literals, so they grep.
- `src/adapters/` holds only the translations: a refusal's detail and its exit code to their output, and the domain
  model to an output format (status and label mapping, JSON shapes, the page's markup data).
- A display map exists only where the display word differs from the value: no identity entries.
- JSON output, stored files, a reason naming a stored file's values, and a command the output suggests running carry
  the values themselves, since the parser reads them back as values.

### Stored files

- A malformed stored file is a verdict and a report, never a throw that takes down `status` or `render`.
- `progress.json` keeps the keys the tool does not know, at the top level and on rows, in the file's order.
- An optional stored key is written only once somebody sets it, and a read never adds or rewrites one, so an older
  file stays byte-identical. The one exception is the legacy review bar, below.
- The Board logs through the logger with ids and values only; an adapter util words the records, and the log file
  sink writes them to `.agent-progress/log.jsonl`. The logger takes one `log(record)` call over a typed record union,
  and that union is the vocabulary; it has no method per record.

### Legacy

- Code that exists only to read what an older version stored, or to honour an older habit, lives in a `legacy/`
  folder of its boundary (`src/adapters/`, `src/services/tracker/`, `cli/`, and `src/shared/` for what two of those
  share). Current code reaches it only through one seam call per consumer; a legacy module may import current code.
- Its header says what older input it reads, when it can go, and what current code carries only for it (an
  older-format flag, a write only a legacy rewrite calls), which goes with it.
- Every case that reads an older input or habit sits in a spec inside a legacy folder: end-to-end ones in
  `cli/legacy/`, the page's drawing of a legacy bar in `page/legacy/`. Dropping a legacy module then deletes it, its
  specs and its seam calls (each seam becoming the current-format answer), and its sentences in the help,
  `docs/cli.md` and `skill/Reference.md`.
- A version 1 `progress.json` holds its own log as sentences. The legacy read turns them into notes; the next write
  moves them to `log.jsonl` and stores the file as version 2. A `log.jsonl` found beside a version 1 file is believed
  only as a migration cut short, and that takeover rule is legacy too.
- A legacy review bar is a row known only by its name, `Review <N> #<id>`. It is linked to its ticket, given
  `reviewOf` and `reviewBarRound`, in four places: by `cli/legacy/` when `task add` files it without `--review-of` or
  `--ticket` and when `task update --name` renames it, both stored at once; by `update`'s rewrite; and by the legacy
  read, in memory only, which also pads a stored `reviewOf` that reads as a whole number, stored on the next write.
  After `update`, the read still links only a row renamed by hand or named `Review 0 #<id>`; dropping the read drops
  that linking. All of them share one legacy name util. Nothing else links a row by its name.

### Errors and exit codes

- A decider returns a verdict, and fails closed: an answer the machine cannot give reads as the safe verdict.
- Code outside `cli/` throws `OperationRefusal` (`refused` or `unrepaired`), never writes to the terminal and never
  exits. A Board rule throws `BoardRefusal`, a reason code with its facts and no wording, and the tracker pipeline
  wraps it as a `refused` `OperationRefusal` carrying that detail.
- A refusal thrown from `src/` carries a `detail`, a reason code with its facts and no words: a Board refusal, an
  unreadable tracker, no tracker found, the held lock, or a template token count. The install-version mismatch is the
  one detail thrown from `cli/`. Only `cli/` builds a refusal from words.
- Every place the command line prints a refusal (the main loop, `release --json`'s `detail`, the hook's sentence)
  words it through the one refusal-wording util in `src/adapters/`; a service never imports it.
- Exit codes: 0 done or nothing to do; 1 a refusal the caller can act on (`refused`, or an unknown command); 2 a state
  the tool will not repair (`unrepaired`, or any other throw). The mapping is an adapter's translation, `cli/Main.ts`
  is the one place that applies it, and `agent-progress.ts` holds the only `process.exit`.
- Three cases exit 0 despite a failure, on purpose; see Deviations.

### Runtime

- `process.env` is read only in `src/shared/Environment.ts`, through getters, each with a docblock saying what it
  overrides and why. Specs set the environment in a child process, with one exception (see Deviations).
- No work at module load, except where Deviations says so.
- The render service keeps no module state: what one invocation builds, the page bundle and the configured Marked,
  lives in the render state the command context carries.
- Factories of closures over classes, except for state carried across calls, domain classes and ingestion classes.
  A constructor does no work.
- A record keyed by outside text is indexed through `Object.hasOwn`, never a bare lookup.
- A command takes everything from its `CommandContext` (directory, now, streams, standard input, prompt, platform,
  home directory), never from the process.
- Every write of a file a reader may hold open goes through the atomic-file package.
- A clock decides nothing: identity is a content hash, staleness a set difference or a version number, and
  timestamps are recorded and displayed. Each exception is stated in a comment at its site.

### Generated and installed files

- Generated files do not live in the repository. `init` and `update` generate the dispatcher from `dispatcher/` into
  `.agent-progress/agent-progress-dispatch.js`, and delete a `.claude/workflows/` copy an older version installed.
- Everything installed is versioned by one manifest, `.agent-progress/version.json`, holding `INSTALL_VERSION`; no
  installed file carries a stamp. `init` and `update` write the manifest last, after every other file is computed and
  written, so a run cut short leaves the old version and a rerun completes it. A fresh `init` writes the brief first,
  so one cut short reads as unversioned rather than as nothing installed.
- Bump `INSTALL_VERSION` by hand, in the same commit, when a file the previous version installed becomes wrong against
  the new CLI: a command, flag, JSON field, stored state or exit code an installed file names or reads changes meaning
  or is removed; the dispatcher's launch arguments change; or an installed file moves or a new one is installed. A
  template's wording or a `DISPATCH_PROTOCOL` number does not bump it.
- `cli/InstalledSurface.spec.ts` holds the bump: `cli/FrozenInstalledSurface.json` freezes, per `INSTALL_VERSION`, the
  commands, flags and `status --json` fields the installed files name. A version's surface only grows, and a frozen
  name the CLI no longer has fails until the bump and a new key.
- The version check reads only the manifest. `update` and `init` refuse a newer manifest rather than install an older
  version over it.

  | Manifest                                            | Verdict                                       |
  | --------------------------------------------------- | --------------------------------------------- |
  | equals `INSTALL_VERSION`                            | current                                       |
  | any other version                                   | mismatch                                      |
  | missing, brief installed (from before versioning)   | mismatch                                      |
  | missing, no brief installed                         | current: nothing installed can disagree       |
  | unreadable                                          | mismatch                                      |

### Comments

- The code explains itself; no comment walls. A file header (one to three sentences) only when path and export do
  not explain the file; a docblock only for a non-obvious contract edge; an inline comment only for a why.
- Never restate the code, narrate history or carry a measurement: those go in the commit message.
- Name files repo-rooted in backticks. No TODOs: agreed-and-not-done work lives in `docs/backlog.md`.

### TypeScript and lint

- Bun runs the TypeScript; `tsc` only type-checks, with the strict options `tsconfig.json` sets.
- Write for their consequences: `process.env['NAME']`, a written fallback instead of `!`, objects built
  conditionally instead of spreading `undefined`, `import type` for type-only imports.
- The page is its own DOM-only project, `page/tsconfig.json` (DOM lib, no Bun or Node types), which the root
  project does not reach. Its `include` list is the written-down surface of shared files the page reaches: a page
  module that imports a new file from outside the folder adds it there in the same change, and every file the page
  project reaches, in `src/` too, stays DOM-safe. The page's specs sit beside their modules and, with
  `page/testing/`, are checked by `page/tsconfig.spec.json`, the same program plus Bun types.
- `dispatcher/` is the Workflow-runtime project `dispatcher/tsconfig.json` (no Bun, Node or DOM types), with
  `dispatcher/tsconfig.spec.json` for its specs and `dispatcher/testing/`. Its `include` list is the `src/` files the
  dispatcher reaches, and a dispatcher module that imports a new `src/` file adds it there in the same change. Only
  `dispatcher/DispatchFromWorkflowGlobals.ts` names the Workflow globals.
- `src/ProjectIncludeLists.spec.ts` holds both `include` lists exactly, both ways, against what the project's shipping
  modules reach outside its folder, plus, for the page, every shipping module of `src/lib/tracker-model/`.
- `init`, `update` and the specs build the dispatcher from the one shared dispatcher build request and never import
  `dispatcher/`; see Deviations for how `cli/` and the render service reach the other features.
- ESLint 9 flat config through `@reliquary/eslint-config`: 2-space indent, single quotes, semicolons; line length
  180 for code, 155 for comments; aligned object values; aligned `from`; imports builtin → external → internal,
  alphabetised; builtins through the `node:` protocol (`import/enforce-node-protocol-usage`, turned on in
  `eslint.config.js`); local specifiers name the file with its `.ts` extension (`import/extensions`, turned on there
  as well); more than 3 named imports or 4+ properties one per line; arrow parameters parenthesised; no
  `any`; a blank line before a function declaration. `src/testing/`, `src/lib/tracker-model/testing/`, `cli/testing/`,
  `src/adapters/progress/testing/`, `src/adapters/legacy/testing/`, `src/services/tracker/testing/`, `dispatcher/testing/`
  and `page/testing/` may import devDependencies. Deliberately off: `no-plusplus`, `no-continue`, `no-await-in-loop`,
  `no-param-reassign`, `consistent-return`, `no-restricted-syntax`, `guard-for-in`, `class-methods-use-this`,
  `no-use-before-define`.

### Tests

- A spec sits beside its module as `<Module>.spec.ts`, a second suite as `<Module>.<aspect>.spec.ts`, never
  `.test.ts`. It opens with a docblock of which cases matter and why; test names are claims written as sentences. A
  frozen table of expected outputs comes from the previous implementation, except the two Deviations names, and says
  how to retake it.
- A test that needs a tool the machine may lack skips through one shared guard (`describeWhenGitIsPresent` or
  `testWhenGitIsPresent` in `src/testing/ToolGuard.ts`), never a bare `skipIf`, and its title says what is missing.
  Skips are counted, never silent: the preload `src/testing/TestRunReport.ts` (`bunfig.toml`) prints every one by
  name with the count after the run. `AGENT_PROGRESS_REQUIRE_EVERY_TOOL=1` turns each skip into a failure, for a run
  that must prove every claim. End-to-end suites that spawn the real binary sit at the layer root, named for what they pin.
- A guard proves its scan found something, and is watched failing on each form it claims to catch. An allowlist is
  exact in both directions.
- Tests never touch live data. Every spec works under the scratch root, and `src/testing/TrackerIsolation.ts` is
  checked by the captured context (`cli/testing/CapturedCommandContext.ts`), on a hook input's `cwd` and by
  `cli/testing/CliProcess.ts` before a command runs. A spec never creates the real process context, spawns the binary
  only through `cli/testing/CliProcess.ts`, and never calls `process.chdir`.
- Each dispatcher decision pinned by the `dispatcher/Dispatcher.*.spec.ts` claim suites runs against the built bundle of
  the TypeScript port, where it must hold, and against a SourceMutant of the module that holds that decision, which
  must fail. A mutant whose text is not in its module exactly once fails the build.

### Documentation and commits

- One CLAUDE.md, this one, holding only rules, boundaries and decisions; a change that invalidates a rule updates it
  in the same change. The block between its `agent-progress:managed` markers is written by `agent-progress update`
  from `resources/templates/ClaudeInstructionsBlock.md`: change the template, never the block.
- `docs/backlog.md` is what is agreed and not started, with the reason it waits; it is not a status page.
  `docs/cli.md` is the one reference for commands, flags, exit codes and file formats: one reference per fact.
- A commit is one plain, human-written subject line. No AI attribution, no `Co-Authored-By`, no generated-with
  footer.

### Deviations

What this repository deliberately does instead of a convention or of a rule above.

| Rule | Done instead | Why |
| --- | --- | --- |
| Ingestion reads, validates, migrates and maps in separate steps. | The ticket parse is one line-oriented pass. | A second walk over the lines would put at risk keeping every unowned line byte for byte. |
| No work at module load. | `agent-progress.ts` runs the command on import, the last statement of `page/PageStart.ts` starts the page, and the test preload `src/testing/TestRunReport.ts` registers its report. | They are entry points: the import is the invocation. |
| Specs never set the environment in-process. | `src/shared/Environment.spec.ts` assigns it once. | It tests the getters themselves. |
| A frozen table comes from the previous implementation. | `dispatcher/testing/FrozenDispatchTraces.json` is retaken from the port's bundle, only in a commit that means to change what the agents are told, and its diff shows prompt text or wire names and no decision. `cli/FrozenInstalledSurface.json` is taken from the installed files. | No previous implementation holds what they pin. |
| A `src/lib/` package leaves a refusal as a verdict. | The tracker model's `Board` throws its typed `BoardRefusal`. | It is a domain class, and a domain class throws a typed domain error. |
| A feature never reaches another feature. | `cli/` reaches `dispatcher/`, and the render service `page/`, by path, to bundle them. | They are bundled, never imported; dispatcher code runs in the CLI's process only while `init` or `update` bundle it. |
| One reference per fact. | `skill/Reference.md` copies three `docs/cli.md` sections word for word: the ticket file format, the ticket moves and the exit codes. `docs/cli.md` is the source, and a change to either changes both in the same commit. | Agents in other repositories cannot read `docs/cli.md`. |
| A failure exits non-zero. | `hook subagent-stop` exits 0 on every failure after its arguments are read; a store write that succeeded while the render failed exits 0, reported on standard error; `release` exits 0 when git declined the worktree removal or `branch -d` after the merge, reported. | The agent has already finished; the store holds the change; the release happened. |
| An optional stored key is never added by a read. | The legacy review-bar read gives an unlinked row its link in memory (see Legacy). | Rows from before `reviewOf` existed are otherwise unreadable as bars. |

## Local rules

### Command surface

- This checkout's tracker is live: it is the board this repository's own work runs on, through the linked binary and the
  managed block at the end of this file. Exercise the CLI under development only in a scratch repository: here nobody
  runs the checkout's own source (`bun run agent-progress.ts`), and only the owner runs `init`, `update` or `clear`.
- Help is one screen, with no per-command help: a second help surface is a second thing to keep in step with the
  command table. It goes to standard output when asked for and to standard error after an unknown command, so a typo
  never exits 0 or prints help into a parsed pipe.
- Every command but `init`, `update`, `help` and `status` checks the install version before it runs; `release` reports
  a mismatch as its `--json` refusal and `hook subagent-stop` at exit 0.
- Adding a command is an entry in `cli/CommandTable.ts`, a block in `cli/HelpText.ts` and a folder in its set;
  `cli/CommandTable.spec.ts` and `cli/HelpText.spec.ts` fail until all three exist.
- Every mutating command writes through one pipeline, `writeTracker` in `src/services/tracker/TrackerPipeline.ts`, and
  none repeats it: the lock, the read into a Board, the change through it, the writes in the order `docs/cli.md`
  (Locking) states and the render from disk, all under one lock hold. `init` creates a tracker and `update` and `init`
  rewrite older tracker files over the same read and write halves, the rewrite reached from `cli/legacy/`. `status`
  takes no lock and renders nothing.

### Tickets

- Tickets are edited by hand between runs. The frontmatter is a deliberate subset, stated in `docs/cli.md`; every
  line the CLI does not own is kept and written back.
- A ticket is its frontmatter `id`, never its file name. Ticket and task ids are never reused; gaps are never filled.
- Only a transition stamps `updated`. The named verbs enforce the legality matrix; `ticket status` skips it on purpose.
- The ticket parse stays one line-oriented pass, an agreed exception to read → validate → migrate → map: a second walk
  over the lines would put at risk keeping every unowned line byte for byte.
- A row's `history` holds only what the tool watched; nothing reconstructs phases.
- A review row belongs to its ticket by `reviewOf`; only the legacy linking (see Legacy) reads a name for it. The page
  reads which rows are bars from the Board facts, and reads a bar's name only to draw a ticket's bars latest named
  round first.

### The page

- `resources/template.html` is designer-owned, edited as HTML and never generated. Its placeholder markup is
  the contract with what the page modules emit: a change on one side only is a bug, and a new mark reuses a class
  the template already styles. Its header comment lists the tokens, the containers and the axis box, and stays in
  step with it.
- The page script clears every container it owns before filling it, so a failure never leaves placeholder rows
  beside the error banner. A failed page bundle renders an error banner instead of refusing.
- The template's bootstrap owns theme, tab selection and ticket open state; the page reaches them only through
  `window.agentProgressTemplate`.
- The page script reads and writes browser storage only in `page/preferences/ViewerPreferences.ts`, and a key
  string never changes.
- The render service writes the Board facts into the payload as `boardFacts`, from the same Board queries
  `status --json` prints; the page reads them and keeps no copy of the rules.
- The detail panel claims a log line when its `taskIds` or `ticketIds` hold the panel's row or ticket: every id its
  record concerns, never a number inside free text. A note carries none and is matched by its sentence.
- Every value passes `escapeHtml` once; a ticket's `bodyHtml`, already escaped by the render service's markdown
  renderer, is the one unescaped string. Stored stamps are sliced, never re-parsed, and shortened only through the
  page's `TimeUtil`.
- A visual change leaves the README screenshots stale: once it lands, run `.readme-graphics/regenerate.sh` in the
  main checkout.

### Skills

- `skill/` loads in every session in a tracked repository, implementing agents included, so orchestrator-only
  material goes in `skill-orchestrate/`, which one session loads.
- No skill file lists commands: `agent-progress help` is the reference, and `cli/HelpText.spec.ts` holds it.
  `skill/SKILL.md` names both the help and `skill/Reference.md`; the reference holds only what the help does not
  print.
- `skill/Reference.md` is the one allowed second copy of `docs/cli.md` sections (see Deviations). What else it says
  follows `docs/cli.md`, never leads it.
- A `SKILL.md` `description` is its trigger, so it names the words a user says. Skill files cite only commands, paths
  inside a tracked repository, or files beside them; never a file of this repository.
- `skill-orchestrate/` repeats nothing from `skill/`, writes rules as instructions, and never restates what the
  dispatcher decides in code. The call budgets and the rework threshold are `DISPATCH_PROTOCOL` in
  `src/shared/constants/DispatchProtocol.ts`, which the dispatcher's prompts state; the brief and the block carry them
  as placeholders `init` and `update` fill.
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
- A review is a clean agent following the review brief in `.agent-progress/agent-brief.md`. It starts
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
- Run `agent-progress open` once per session so the user has the dashboard; it reloads itself every
  5 minutes as the work moves.
<!-- agent-progress:managed:end -->
