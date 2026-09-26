# agent-progress

A Bun + TypeScript CLI that tracks an AI orchestrator's work per repository (Gantt rows, stateful markdown tickets,
a log, and a self-contained `progress.html` regenerated on every command), and installs the skills, brief and
dispatcher its sessions run on.

## In flight

The conventions migration is under way on branch `migration/conventions` per `docs/migration-plan.md`. The tree is
mid-move, so code may still sit where the plan moves it from, and the map below describes the tree as it is. Where
the plan is specific it wins; these rules decide the rest.

## Verify

`bun run typecheck && bun test && bun run lint`: all three after any TypeScript change, before calling it done.
`typecheck` covers every project: the Bun program, the DOM-only page program, the page's spec program, the
dispatcher's spec project and the Workflow-runtime dispatcher. Never ad-hoc `tsc` flags; never edit `package.json`
to make a check pass.

## Rules

### Files and naming

- One purpose per file, explainable in two or three lines from its path and export; usually one export plus a few
  types. A file is `PascalCase.ts`, named after its export; folders are lower case. No barrel files.
- A util is pure and stateless, one frozen object per file (`TimeUtil.formatLocalIso(…)`), tested against its own
  contract, not through a caller. An app-wide list is one global object: `LIMITS` in `src/shared/constants/Limits.ts`.
- Code starts beside its only consumer and moves on a second consumer, generalised first; never in anticipation.
- Full, descriptive names, no abbreviations. Only a loop `i` and a comparator `(a, b)` are one letter; callbacks,
  destructured bindings and throwaway scripts are not exempt.
- Name a thing for what it is or does, never for its layer or its history, and never with a name that shadows a
  global (`CorpusMap.ts`, not `Map.ts`).
- A function that answers a question is the question (`sourceIsReachable`); a producer is named for its product
  (`fullTextOf`); a boolean is a predicate phrase (`cleanupHandlersAreInstalled`).
- Design constants are `SCREAMING_CASE`, named for what they bound, with the unit. No magic number inline.
- Everything is English: identifiers, flags, messages, file names, comments. Example data is obviously synthetic:
  `Alex Example`, `Example Agency`.

### Imports (held by review)

```
src/lib/  →  src/shared/  →  src/adapters/  →  src/services/ (tracker → render)  →  features (cli/, page/, dispatcher/)
```

- Imports run up only, with no cycles. A feature (`cli/`, `page/`, `dispatcher/`) imports itself and `src/*`, never
  another feature. Inside `cli/` a command folder never imports a sibling command's folder: what two need is hoisted to
  the level above both (a set's own files, or `cli/`'s root and `cli/utils/`), or passed as a structurally typed
  parameter. Nothing that ships imports `src/testing/`, `cli/testing/`, `src/adapters/progress/testing/`,
  `src/adapters/legacy/testing/`, `dispatcher/testing/` or `page/testing/`, and `agent-progress.ts` imports only `cli/`.
- A `src/lib/` package imports only the other `src/lib/` packages its main module's header names, node builtins and
  external dependencies, and knows nothing about its callers: no agent-progress names, tracker file names, user-facing
  wording or exit codes. App values arrive as parameters; a refusal leaves as a verdict the caller turns into
  `OperationRefusal`, except that the tracker model's `Board`, a domain class, throws its typed `BoardRefusal` instead.
  A `src/lib/` spec may import `src/testing/`.
- `src/lib/tracker-model/` imports nothing outside its own folder and no builtin: the page's DOM-only project compiles
  it, so it stays DOM-safe.
- `cli/testing/` is imported only by `cli/` specs.
- `page/testing/` is imported only by `page/` specs.
- `src/adapters/` imports only `src/lib/` and `src/shared/`; a `src/adapters/` spec may also import `src/testing/`.
  `cli/` imports `src/adapters/` as a feature does.
- `src/services/tracker/` imports `src/lib/`, `src/shared/`, `src/adapters/` and `src/services/render/`;
  `src/services/render/` imports only `src/lib/`, `src/shared/` and `src/adapters/`; a `src/services/` spec may import
  `src/testing/`. `cli/` imports `src/services/` as a feature does.
- `src/shared/` holds app-specific code several parts use and imports only `src/lib/` and itself; `src/` never imports
  a feature.
- The target layout's import rules are in section 2 of `docs/migration-plan.md`.

### Model and boundaries

- Internal values are string-literal unions, never display text; wording is mapped in and out at the edge. Every
  status, ticket type and priority the page shows goes through `src/adapters/utils/HtmlLabelUtil.ts`, and every one
  the command line prints as text goes through `src/adapters/utils/StatusWordingUtil.ts`, so each display word has one
  home even where it equals the value today; JSON output, stored files and the reasons that name a stored file's
  values carry the values themselves, and the help screen is prose `cli/HelpText.spec.ts` holds.
- Code that exists only to read what an older version stored, or to answer an older habit, lives in a `legacy/` folder
  of its boundary (`src/adapters/legacy/`, `src/services/tracker/legacy/`, `cli/legacy/`, and `src/shared/legacy/`
  for what two legacy folders share) and is reached only through one seam call per consumer;
  current code imports nothing else from it, and a legacy module may import current code. Its header says what older
  input it reads and when it can go. Every case that reads an older input or an older habit sits in a spec inside a
  legacy folder, end-to-end ones in `cli/legacy/` and the page's drawing of a legacy bar in `page/legacy/`, so dropping
  it deletes the module, its specs and its seam calls, each seam line becoming the current-format answer, and the
  help, `docs/cli.md` and `skill/Reference.md` sentences on it.
- An optional stored key is written only once somebody sets it, and a read never adds or rewrites one, so an older
  file stays byte-identical. The one exception is a legacy review bar, read through `src/adapters/legacy/`: the read
  gives a row known only by its name `reviewOf` and `reviewBarRound`, and pads a stored `reviewOf` that reads as a
  whole number, in memory; the next write stores them.
- A version 1 `progress.json` owns its log: the read, through `src/adapters/legacy/`, turns its sentences into notes,
  and the next write moves them to log.jsonl and stores the file as version 2. The takeover rule for a log.jsonl
  beside it, believed only as a migration cut short, lives in `src/adapters/legacy/` too.
- `progress.json` keeps the keys the tool does not know, at the top level and on rows, in the file's order.
- A malformed stored file is a verdict and a report, never a throw that takes down `status` or `render`.
- The Board logs through the semantic Logger (`src/lib/tracker-model/Logger.ts`), with ids and values only;
  `src/adapters/utils/LogUtil.ts` words the records. The records go to `.agent-progress/log.jsonl` through
  `src/adapters/log/LogFileSink.ts`.

### Errors and exit codes

- A decider returns a verdict, and fails closed: an answer the machine cannot give reads as the safe verdict. Library
  code throws `OperationRefusal` (`src/shared/OperationRefusal.ts`: `refused` or `unrepaired`), never writes to the
  terminal and never exits.
- A Board rule throws `BoardRefusal` (`src/lib/tracker-model/BoardRefusal.ts`): a reason code with its facts and no
  wording. The tracker service's pipeline (`src/services/tracker/TrackerPipeline.ts`) wraps it as a `refused`
  `OperationRefusal` carrying its detail.
- A refusal thrown from `src/` carries a `detail`, a reason code with its facts and no words: a Board refusal, an
  unreadable tracker, no tracker found, the held lock, or a template token count. Only `cli/` builds a refusal from
  words. Wherever the command line prints a refusal (`cli/Main.ts`, `release --json`'s `detail`, the hook's sentence),
  it words it through `src/adapters/utils/OperationRefusalWordingUtil.ts`; a service never imports a wording util.
- Exit codes are decided only in `cli/Main.ts`: 0 done or nothing to do; 1 a refusal the caller can act on
  (`refused`, or an unknown command); 2 a state the tool will not repair (`unrepaired`, or any other throw).
  `agent-progress.ts` is the only `process.exit`.
- Three deliberate exit-0 cases: `hook subagent-stop` on every failure, because the agent has already finished; a
  store write that succeeded while the render failed, reported on standard error; and a `release` whose worktree
  removal or `branch -d` git declined after the merge, reported and never failed, because the release happened.

### Runtime

- `process.env` is read only in `src/shared/Environment.ts`, through getters, each with a docblock saying what it
  overrides and why. The one in-process assignment is in `src/shared/Environment.spec.ts`; other specs set the
  environment in a child process.
- No work at module load. The one exception is the last statement of `page/PageStart.ts`, which starts the page.
- The render service keeps no module state: the page bundle and the configured Marked live in the `RenderState`
  (`src/services/render/RenderState.ts`) that `createProcessContext` creates once per invocation and the command context
  carries.
- Factories of closures over classes, except for state carried across calls, domain classes and ingestion classes.
  A constructor does no work.
- A record keyed by outside text is indexed through `Object.hasOwn`, never a bare lookup.
- A command takes everything from its `CommandContext` (directory, now, streams, standard input, prompt, platform),
  never from the process.
- Every write of a file a reader may hold open goes through `src/lib/atomic-file/AtomicFile.ts`.
- A clock decides nothing: identity is a content hash, staleness a set difference or a version number, and
  timestamps are recorded and displayed. Each exception is stated in a comment at its site.

### Generated and installed files

- Generated files do not live in the repository, and everything installed elsewhere is to carry one install
  version. Until plan step 8, nothing is stamped or refused on a mismatch, and `init` and `update` still install the
  committed `templates/workflows/AgentProgressDispatch.js`. Its policy is ported to `dispatcher/` in TypeScript until
  step 8 generates the installed script from the port and deletes the old one.
- The frozen table `dispatcher/testing/FrozenDispatchTraces.json` was taken from that script and is since retaken from
  the port's bundle only in a commit that means to change what the agents are told, whose table diff shows prompt text
  or wire names and no decision: the one exception to a frozen table coming from the previous implementation.

### Comments

- The code explains itself; no comment walls. A file header (one to three sentences) only when path and export do
  not explain the file; a docblock only for a non-obvious contract edge; an inline comment only for a why.
- Never restate the code, narrate history or carry a measurement: those go in the commit message.
- Name files repo-rooted in backticks. No TODOs: agreed-and-not-done work lives in `docs/backlog.md`.

### TypeScript and lint

- Bun runs the TypeScript; `tsc` only type-checks. `tsconfig.json`: `noEmit`, `target` and `lib` `ESNext`,
  `module` `Preserve`, `moduleResolution` `bundler`, `moduleDetection` `force`, `allowImportingTsExtensions`,
  `verbatimModuleSyntax`, `types: ["bun"]`, `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`, `exactOptionalPropertyTypes`,
  `noUnusedLocals`, `noUnusedParameters`, `forceConsistentCasingInFileNames`, `skipLibCheck`.
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
  `dispatcher/DispatchScript.ts` names the Workflow globals; specs build it by path and never import it.
- ESLint 9 flat config through `@reliquary/eslint-config`: 2-space indent, single quotes, semicolons; line length
  180 for code, 155 for comments; aligned object values; aligned `from`; imports builtin → external → internal,
  alphabetised; builtins through the `node:` protocol (`import/enforce-node-protocol-usage`, turned on in
  `eslint.config.js`); more than 3 named imports or 4+ properties one per line; arrow parameters parenthesised; no
  `any`; a blank line before a function declaration. `src/testing/`, `cli/testing/`, `src/adapters/progress/testing/`,
  `dispatcher/testing/` and `page/testing/` may import devDependencies. Deliberately off: `no-plusplus`, `no-continue`, `no-await-in-loop`, `no-param-reassign`,
  `consistent-return`, `no-restricted-syntax`, `guard-for-in`, `class-methods-use-this`, `no-use-before-define`.

### Tests

- A spec sits beside its module as `<Module>.spec.ts`, a second suite as `<Module>.<aspect>.spec.ts`, never
  `.test.ts`. It opens with a docblock of which cases matter and why; test names are claims written as sentences. A
  frozen table of expected outputs comes from the previous implementation and says how to retake it.
- A test that needs a tool the machine may lack skips through one shared guard (`gitIsAvailable` in
  `src/testing/ScratchWorkspace.ts`) and says what is missing; skips are counted, never silent. An environment
  variable is meant to turn that skip into a failure on a machine that has the tool; it is not built yet
  (`docs/backlog.md`). End-to-end suites that spawn the real binary sit at the layer root, named for what they pin.
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
  in the same change.
- `docs/backlog.md` is what is agreed and not started, with the reason it waits; it is not a status page.
  `docs/cli.md` is the one reference for commands, flags, exit codes and file formats: one reference per fact.
- A commit is one plain, human-written subject line. No AI attribution, no `Co-Authored-By`, no generated-with
  footer.

## Local rules

### Command surface

- Never run `agent-progress` in this checkout: it has a live tracker. Exercise it in a scratch repository.
- Help is one screen, with no per-command help: a second help surface is a second thing to keep in step with the
  command table. It goes to standard output when asked for and to standard error after an unknown command, so a typo
  never exits 0 or prints help into a parsed pipe.
- Adding a command is an entry in `cli/CommandTable.ts`, a block in `cli/HelpText.ts` and a folder in its set;
  `cli/CommandTable.spec.ts` and `cli/HelpText.spec.ts` fail until all three exist.
- Every mutating command writes through `writeTracker` in `src/services/tracker/TrackerPipeline.ts`, reached through
  `openTrackerForWriting` in `cli/TrackerWriting.ts`, and none repeats it:
  lock; read the progress file, its log and the tickets into a Board; change them through it; write the progress file,
  then the tickets the Board changed, then log.jsonl; then render from disk, all under the lock. Ticket files follow
  the progress file so it is never behind them, and the log comes last so a line never describes an unstored change;
  a log taken over from a version 1 progress file, by the rule in `src/adapters/legacy/`, also has its notes copied
  first. `init` creates a tracker through
  `createTracker` in `src/services/tracker/TrackerCreation.ts`; `update` and `init` rewrite older tracker files through
  `src/services/tracker/legacy/OlderTrackerFilesRewrite.ts`, reached from `cli/legacy/`, over the same two halves.
  `status` takes no lock and renders nothing.

### Tickets

- Tickets are edited by hand between runs. The frontmatter is a deliberate subset, stated in `docs/cli.md`; every
  line the CLI does not own is kept and written back.
- A ticket is its frontmatter `id`, never its file name. Ticket and task ids are never reused; gaps are never filled.
- Only a transition stamps `updated`. The named verbs enforce the legality matrix; `ticket status` skips it on purpose.
- The ticket parse stays one line-oriented pass, an agreed exception to read → validate → migrate → map: a second walk
  over the lines would put at risk keeping every unowned line byte for byte.
- A row's `history` holds only what the tool watched; nothing reconstructs phases. A review row belongs to its
  ticket by `reviewOf`; a free-standing row known only by its `Review <N> #<id>` name is given `reviewOf` and
  `reviewBarRound` by `src/adapters/legacy/` when progress.json is read. Nothing else matches a name: the page reads which rows are bars from
  the Board facts.

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
- The render service computes the Board facts through `src/services/render/utils/BoardFactsUtil.ts` and writes them
  as the payload's last key, `boardFacts`; the concurrency figures come from `board.concurrency()`, which
  `status --json` prints too. The page reads them, zipped onto its rows and tickets by `page/utils/IslandUtil.ts`,
  and keeps no copy of the rules.
- The detail panel claims a log line when its `taskIds` or `ticketIds` hold the panel's row or ticket: every id its
  record concerns, never a number inside free text. A note carries none and is matched by its sentence through
  `page/utils/NoteSentenceMatchUtil.ts`.
- Every value passes `escapeHtml` once; a ticket's `bodyHtml`, already escaped by `src/services/render/Markdown.ts`,
  is the one unescaped string. Stored stamps are sliced, never re-parsed, and shortened only through
  `page/utils/TimeUtil.ts`.
- A visual change leaves the README screenshots stale: once it lands, run `.readme-graphics/regenerate.sh` in the
  main checkout.

### Skills

- `skill/` loads in every session in a tracked repository, implementing agents included, so orchestrator-only
  material goes in `skill-orchestrate/`, which one session loads.
- No skill file lists commands: `agent-progress help` is the reference, and `cli/HelpText.spec.ts` holds it.
  `skill/SKILL.md` names both the help and `skill/Reference.md`; the reference holds only what the help does not
  print.
- A `SKILL.md` `description` is its trigger, so it names the words a user says. Skill files cite only commands, paths
  inside a tracked repository, or files beside them; never a file of this repository.
- `skill-orchestrate/` repeats nothing from `skill/`, writes rules as instructions, and never restates what the
  dispatcher decides in code. The call budgets and the rework threshold are `DISPATCH_PROTOCOL` in
  `src/shared/constants/DispatchProtocol.ts`; `templates/AgentBrief.md` states them in prose until plan step 8
  generates them, and the dispatcher's brief spec holds the two together.
- `setup.sh` symlinks both into `~/.claude/skills/`, and `~/development/claude/skills.json` must list them under
  `ignore`.

## Repository map

```
agent-progress.ts           the bin shim: runs the command line and exits with its number
package.json                the bin entry, the scripts and the one runtime dependency, marked
tsconfig.json               the strict Bun project
eslint.config.js            the shared ESLint config, the node: protocol rule, and the devDependency exemption for the five
                            test-only folders: src/testing/, cli/testing/, src/adapters/progress/testing/, dispatcher/testing/
                            and page/testing/
bun.lock                    the lockfile, committed
.gitignore                  node_modules/, .agent-progress/, .DS_Store, .readme-graphics/, .idea/
.idea/                      git-ignored IDE settings
.readme-graphics/           git-ignored, owner's checkout only: the demo board that redraws docs/images/
CLAUDE.md                   this file
README.md                   the GitHub landing page
README-keynote.md           the same page in a keynote layout, kept for comparison
README-day-on-the-board.md  the same page told as one day on a board, kept for comparison
setup.sh                    machine setup: Bun, bun install and bun link, and the skill symlinks
cli/                        the command surface: dispatch, arguments, help, and the commands grouped into sets: tracking/,
                            tickets/, dispatch/, adoption/ and measurement/; cli/utils/ holds the Next line, the printing
                            and the option values; cli/testing/ is test-only
dispatcher/                 the dispatcher policy in TypeScript, bundled into a Workflow script; dispatcher/testing/ is
                            test-only: the harness, the bundle builder, the frozen table
page/                       the browser page: its sets, its own DOM-only tsconfig and spec tsconfig; page/testing/ is
                            test-only: the Board fixture its specs read
resources/                  files read at runtime: the page's HTML template
src/                        the target layout's code, filled step by step as the migration plan moves it
  src/lib/                  package-grade building blocks, one folder each, the package's description in its main module's header:
                            atomic-file (AtomicFile.ts), git (GitProcess.ts), claude-code (ClaudeTranscripts.ts),
                            tracker-model (@types/Task.ts; Board.ts is its aggregate), utils
  src/adapters/             the boundary, one folder per stored format (progress, tickets and log) plus the shared utils:
                            reading, writing and mapping what the tracker stores, the ticket JSON document, and the wording of
                            log records and refusals; legacy/ reads the older progress.json shapes
  src/services/             tracker (discovery, the lock, reading, the write pipeline, creation; legacy/ rewrites older tracker
                            files) and render (the page document and the render state one invocation holds)
  src/shared/               app-specific code several parts use: the environment reader, the refusal, LIMITS,
                            the page payload types
  src/testing/              test-only helpers several parts use: the scratch workspace, the tracker isolation check, the Board fixtures
skill/                      the skill every session in a tracked repository loads
skill-orchestrate/          the skill for the one session running the board
templates/                  what init and update install into a tracked repository, the dispatcher included
docs/                       the CLI reference, development notes, the backlog, the migration plan, README images
node_modules/               git-ignored dependencies
```
