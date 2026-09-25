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
`typecheck` covers both projects, the Bun one and the DOM-only page. Never ad-hoc `tsc` flags; never edit
`package.json` to make a check pass.

## Rules

### Files and naming

- One purpose per file, explainable in two or three lines from its path and export; usually one export plus a few
  types. A file is `PascalCase.ts`, named after its export; folders are lower case. No barrel files.
- A util is pure and stateless, one frozen object per file (`TimeUtil.formatLocalIso(…)`), tested against its own
  contract, not through a caller. An app-wide list is one global object: `LIMITS` in `lib/constants/Limits.ts`.
- Code starts beside its only consumer and moves on a second consumer, generalised first; never in anticipation.
- Full, descriptive names, no abbreviations. Only a loop `i` and a comparator `(a, b)` are one letter; callbacks,
  destructured bindings and throwaway scripts are not exempt. Never a name that shadows a global.
- A function that answers a question is the question (`sourceIsReachable`); a producer is named for its product
  (`fullTextOf`); a boolean is a predicate phrase (`cleanupHandlersAreInstalled`).
- Design constants are `SCREAMING_CASE`, named for what they bound, with the unit. No magic number inline.
- Everything is English: identifiers, flags, messages, file names, comments. Example data is obviously synthetic:
  `Alex Example`, `Example Agency`.

### Imports (today's tree, held by review)

```
lib/constants/  →  lib/utils/  →  lib/platform/  →  lib/progress/, lib/tickets/, lib/render/  →  cli/
```

- Imports run up only, with no cycles. `lib/constants/` imports nothing; `lib/utils/` imports only `lib/constants/`;
  neither imports a package or a builtin. Nothing under `lib/` imports `cli/`, nothing that ships imports
  `lib/tooling/dev/`, and `agent-progress.ts` imports only `cli/`.
- A feature folder never imports a sibling: hoist what both need, or pass a structurally typed parameter.
- The target layout's import rules are in section 2 of `docs/migration-plan.md`.

### Model and boundaries

- Internal values are string-literal unions, never display text; wording is mapped in and out at the edge.
- An optional stored key is written only once somebody sets it, and a read never adds or rewrites one, so an older
  file stays byte-identical.
- A malformed stored file is a verdict and a report, never a throw that takes down `status` or `render`.

### Errors and exit codes

- A decider returns a verdict, and fails closed: an answer the machine cannot give reads as the safe verdict. Library
  code throws `OperationRefusal` (`refused` or `unrepaired`), never writes to the terminal and never exits.
- Exit codes are decided only in `cli/Main.ts`: 0 done or nothing to do; 1 a refusal the caller can act on
  (`refused`, or an unknown command); 2 a state the tool will not repair (`unrepaired`, or any other throw).
  `agent-progress.ts` is the only `process.exit`.
- Two deliberate exit-0 cases: `hook subagent-stop` on every failure, because the agent has already finished; and a
  store write that succeeded while the render failed, reported on standard error.

### Runtime

- `process.env` is read only in `lib/platform/Environment.ts`, through getters, each with a docblock saying what it
  overrides and why. The one in-process assignment is in `lib/platform/Environment.spec.ts`; other specs set the
  environment in a child process.
- No work at module load. The one exception is the last statement of `lib/render/page/GanttPage.ts`, which starts
  the page.
- Factories of closures over classes, except for state carried across calls, domain classes and ingestion classes.
  A constructor does no work.
- A record keyed by outside text is indexed through `Object.hasOwn`, never a bare lookup.
- A command takes everything from its `CommandContext` (directory, now, streams, standard input, prompt, platform),
  never from the process.
- Every write of a file a reader may hold open goes through `lib/platform/AtomicFile.ts`. Today's two in-place
  exceptions, `.gitignore` and `CLAUDE.md`, say so at their site.
- A clock decides nothing: identity is a content hash, staleness a set difference or a version number, and
  timestamps are recorded and displayed. Each exception is stated in a comment at its site.

### Generated and installed files

- Generated files do not live in the repository, and everything installed elsewhere carries one install version.
  The committed dispatcher under `templates/workflows/` is the exception until plan step 8.

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
- The page is its own DOM-only project, `lib/render/page/tsconfig.json` (DOM lib, no Bun or Node types), and the
  root project excludes it. Its `include` list is the written-down surface of shared files the page reaches: a page
  module that imports a new file from outside the folder adds it there in the same change. No spec sits in
  `lib/render/page/`; page specs sit in `lib/render/`.
- ESLint 9 flat config through `@reliquary/eslint-config`: 2-space indent, single quotes, semicolons; line length
  180 for code, 155 for comments; aligned object values; aligned `from`; imports builtin → external → internal,
  alphabetised; more than 3 named imports or 4+ properties one per line; arrow parameters parenthesised; no `any`; a
  blank line before a function declaration. `lib/tooling/dev/` may import devDependencies. Deliberately off:
  `no-plusplus`, `no-continue`, `no-await-in-loop`, `no-param-reassign`, `consistent-return`, `no-restricted-syntax`,
  `guard-for-in`, `class-methods-use-this`, `no-use-before-define`.

### Tests

- A spec sits beside its module as `<Module>.spec.ts`, a second suite as `<Module>.<aspect>.spec.ts`, never
  `.test.ts`. It opens with a docblock of which cases matter and why; test names are claims written as sentences. A
  frozen table of expected outputs comes from the previous implementation and says how to retake it.
- A test that needs a tool the machine may lack skips through one shared guard (`gitIsAvailable`) and says what is
  missing; skips are counted, never silent. End-to-end suites that spawn the real binary sit at the layer root,
  named for what they pin.
- A guard proves its scan found something, and is watched failing on each form it claims to catch. An allowlist is
  exact in both directions.
- Tests never touch live data. Every spec works under the scratch root, and `lib/tooling/dev/TrackerIsolation.ts`
  is checked by the captured context, on a hook input's `cwd` and by `lib/tooling/dev/CliProcess.ts` before a
  command runs. A spec never creates the real process context, spawns the binary only through
  `lib/tooling/dev/CliProcess.ts`, and never calls `process.chdir`.
- Each dispatcher decision pinned by the `lib/tooling/dev/DispatchScriptHarness.spec.ts` suites also runs against a
  mutant of the script that breaks exactly that decision, which must fail.

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
- Help is one screen, with no per-command help. `--help` anywhere before a bare `--`, and `-h` as or straight after
  the command word, print it; an option's value is never a help request, and a later `-h` is refused at 1. Help goes
  to standard output when asked for, and to standard error after an unknown command.
- Adding a command is an entry in `cli/CommandTable.ts`, a block in `cli/HelpText.ts` and a folder;
  `cli/CommandTable.spec.ts` and `cli/HelpText.spec.ts` fail until all three exist.
- Every mutating command writes through `openTrackerForWriting` in `cli/CommandSupport.ts`, and none repeats it:
  lock, read, mutate, write the progress file, then the tickets, then render from disk, all under the lock. Ticket
  files follow the progress file so it is never behind them. `status` takes no lock and renders nothing.

### Tickets

- Tickets are edited by hand between runs. The frontmatter is a deliberate subset, stated in `docs/cli.md`; every
  line the CLI does not own is kept and written back.
- A ticket is its frontmatter `id`, never its file name. Ticket and task ids are never reused; gaps are never filled.
- Only a transition stamps `updated`. The named verbs enforce the legality matrix; `ticket status` skips it on purpose.
- A row's `history` holds only what the tool watched; nothing reconstructs phases. A review row belongs to its
  ticket by `reviewOf`; the page's match on its name is a display fallback that never moves a row.

### The page

- `lib/render/page/template.html` is designer-owned, edited as HTML and never generated. Its placeholder markup is
  the contract with what the page modules emit: a change on one side only is a bug, and a new mark reuses a class
  the template already styles. Its header comment lists the tokens, the containers and the axis box, and stays in
  step with it.
- The page script clears every container it owns before filling it, so a failure never leaves placeholder rows
  beside the error banner. A failed page bundle renders an error banner instead of refusing.
- The template's bootstrap owns theme, tab selection and ticket open state; the page reaches them only through
  `window.agentProgressTemplate`.
- Board facts such as the agents in flight arrive in the payload, computed by what `status --json` uses; the page
  never recounts them.
- Every value passes `escapeHtml` once; a ticket's `bodyHtml`, already escaped by `lib/render/Markdown.ts`, is the
  one unescaped string. Stored stamps are sliced, never re-parsed, and shortened only through
  `lib/render/page/StampText.ts`.
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
  dispatcher decides in code. The call-budget numbers stay in `templates/AgentBrief.md`.
- `setup.sh` symlinks both into `~/.claude/skills/`, and `~/development/claude/skills.json` must list them under
  `ignore`.

## Repository map

```
agent-progress.ts           the bin shim: runs the command line and exits with its number
package.json                the bin entry, the scripts and the one runtime dependency, marked
tsconfig.json               the strict Bun project; excludes lib/render/page/
eslint.config.js            the shared ESLint config, plus the devDependency exemption for lib/tooling/dev/
bun.lock                    the lockfile, committed
.gitignore                  node_modules/, .agent-progress/, .DS_Store, .readme-graphics/
.idea/                      tracked IDE settings; untracked in plan step 2
.readme-graphics/           git-ignored, owner's checkout only: the demo board that redraws docs/images/
CLAUDE.md                   this file
README.md                   the GitHub landing page
README-keynote.md           the same page in a keynote layout, kept for comparison
README-day-on-the-board.md  the same page told as one day on a board, kept for comparison
setup.sh                    machine setup: Bun, bun install and bun link, and the skill symlinks
cli/                        the command surface: dispatch, arguments, help, one folder per command
lib/                        everything the commands do, in the layers above; lib/tooling/dev/ is test-only
skill/                      the skill every session in a tracked repository loads
skill-orchestrate/          the skill for the one session running the board
templates/                  what init and update install into a tracked repository, the dispatcher included
docs/                       the CLI reference, development notes, the backlog, the migration plan, README images
node_modules/               git-ignored dependencies
```
