# agent-progress

A Bun + TypeScript CLI that tracks an AI orchestrator's work per repository: tasks on a Gantt chart,
stateful markdown tickets, a log, and a self-contained `progress.html` regenerated on every command.
The repo map lives in the "Repository map" section at the end of this file; each substantial folder
has its own `CLAUDE.md` with per-file one-liners.

# Coding conventions for this project (adopted from the `vkb` repository)

Apply these to every file you write or edit here. They are not preferences to weigh against
others; where a rule has a linter or a spec behind it, the build fails, and where it does not, it
is written down here so that it can be checked in review rather than argued about.

## 1. Linter and type checker — the mechanical part

Bun runs the TypeScript directly; `tsc` is a type checker only. ESLint 9 flat config through
`@reliquary/eslint-config` (plus `@reliquary/eslint-config-react` only when there is a React
surface). Verify with `bun run typecheck`, `bun run lint`, `bun test`, and run all three after any
TypeScript change; never invent ad-hoc `tsc` flags.

`eslint.config.js`:

```js
import base from '@reliquary/eslint-config';

export default [
  ...base,
  { ignores: ['**/*.js', 'node_modules/**', '.claude/**'] },
  {
    // Test-only helpers may import devDependencies; a guard spec asserts nothing shipped imports
    // this folder, which is what keeps the exemption honest.
    files: ['lib/tooling/dev/**/*.ts'],
    rules: { 'import/no-extraneous-dependencies': ['error', { devDependencies: true }] },
  },
];
```

`tsconfig.json` compiler options, all of them: `noEmit`, `target` and `lib` `ESNext`,
`module: "Preserve"`, `moduleResolution: "bundler"`, `moduleDetection: "force"`,
`allowImportingTsExtensions`, `verbatimModuleSyntax`, `types: ["bun"]`, `strict`,
`noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`,
`noPropertyAccessFromIndexSignature`, `exactOptionalPropertyTypes`, `noUnusedLocals`,
`noUnusedParameters`, `forceConsistentCasingInFileNames`, `skipLibCheck`.

What the shared config enforces, so you write it that way the first time rather than after
`lint:fix`:

- 2-space indent, single quotes, semicolons always, Unix line endings, max 2 blank lines and none
  at end of file.
- Line length 180 for code, 155 for comments.
- **Value-aligned object keys** (`key-spacing` strict, `align: 'value'`): in a multi-line object
  literal the values start in one column.
- **Aligned imports** (`align-import`): the `from` keywords of consecutive import lines line up in
  one column. Imports are ordered builtin → external → internal and alphabetised within a group.
  An import with more than 3 named bindings breaks one per line (`import-newlines`, items 3).
  Unused imports are an error. `import type { X }` for type-only imports (`verbatimModuleSyntax`).
- Object literals and destructuring patterns with 4 or more properties go multi-line, one property
  per line; fewer may stay on one line. Object shorthand always. Arrow functions always take
  parentheses around their parameters. A blank line before every `function` declaration.
- `prefer-destructuring` for objects (not arrays). `no-explicit-any` is an error. Up to 5 classes
  per file, though see §4 on when a class is the right shape at all.
- The `off` list is deliberate and you may rely on it: `no-plusplus`, `no-continue`,
  `no-await-in-loop`, `no-param-reassign`, `consistent-return`, `no-restricted-syntax`,
  `guard-for-in`, `class-methods-use-this`, `no-use-before-define`. A `for … of` with `continue`
  and an awaited call inside is normal here.

Consequences of the strict flags that show up in every file: an environment variable is read as
`process.env['NAME']` (bracket access, index signature); an indexed lookup yields `T | undefined`,
so write the fallback (`variables[key] ?? …`) rather than a `!`; an optional property is either
present with its type or absent, never explicitly `undefined`, so build objects conditionally
rather than spreading `undefined` in.

## 2. Naming

- **Every identifier gets a full, descriptive name. No abbreviations, ever.** `temporaryPath` not
  `tmp`, `statistics` not `stats`, `remainingArguments` not `args`, `commandArguments` not
  `cmdArgs`. The only one-letter names are loop iterators (`i`) and sort-comparator pairs
  (`(a, b)`). Callback parameters, destructured bindings and throwaway scripts are not exempt.
- Identifiers, CLI flags, messages, file names and comments are English, even in a project whose
  domain content is in another language.
- Name a thing for **what it is or does**, not for what it was or which layer it sits in:
  `CorpusMap.ts` rather than `Map.ts` (which shadows a global), `Template.ts` rather than
  `Render.ts` when another module is already the renderer. A function that answers a question is
  named as the question: `sourceIsReachable`, `cardHoldsAuthoredProse`, `deletedContentStillInTheWorkingCopy`.
  A function that produces something is named for the product: `extractionFolderFor`,
  `fullTextOf`, `createArgumentParser`.
- A boolean is a predicate phrase (`cleanupHandlersAreInstalled`, `reliabilityIsInUse`), never a
  bare noun or an `is`-prefixed noun where a sentence reads better.
- Constants that are design decisions are `SCREAMING_CASE` and named for what they bound, with the
  unit in the name where one applies: `STARTING_CLAIM_BOUND_MILLISECONDS`,
  `EMBEDDED_PACKET_LIMIT_BYTES`, `PICTURE_CROP_MIN_WIDTH`. A magic number never appears inline.
- Files are `PascalCase.ts` named after the one thing they export or govern; folders are lower
  case, kebab-case only when two words are unavoidable. A test is `<Module>.spec.ts` beside its
  module; a second suite on the same module is `<Module>.<aspect>.spec.ts`. `.test.ts` is never
  used, because the env-bridge guard recognises a test by `.spec`.
- Example data in code, tests, templates and docs is obviously synthetic: `Alex Example`,
  `Example Agency` (`EXA`). Never invent a plausible-looking real name.

## 3. Module shape

- **No barrel files.** A caller imports the one thing it wants from the file named after it, so
  the import block is the dependency list.
- **Imports run up the folder tree only.** A feature reaches its layer's flat level, the layers
  below it, `lib/constants/` and `lib/utils/`. Sideways only into the feature's own `util/` leaf;
  never into a sibling feature. What two features need is promoted to the level above both, never
  imported across. `lib/constants/` imports nothing; `lib/utils/` imports `lib/constants/` or
  nothing. Nothing under `lib/` imports `cli/`; nothing that ships imports the test-only folder.
- **A `util/` module is pure and stateless, exports one frozen object named after the file, and is
  unit-tested beside itself against its own contract**, not through a caller:

  ```ts
  function substituteTemplate(template: string, variables: Record<string, string>): string { … }

  export const TemplateUtil = { substituteTemplate } as const;
  ```

  Callers write `TemplateUtil.substituteTemplate(…)` so a util is greppable as one name.
- **No work at module load.** Nothing resolves a working directory, reads the environment, reads
  `argv` or opens a file at import time. Importing a module runs nothing; this is what lets a spec
  import the real command table instead of scraping source text.
- **`process.env` is read in exactly one module**, through getters (never a snapshot, so a test can
  redirect a value in-process), each with a docblock saying what it overrides and why. A guard spec
  fails on a read anywhere else.
- **Prefer a factory of closures over a class.** A class cannot be destructured, and a module
  singleton with `initialize()` is temporal coupling the type checker cannot see. A class is for
  state carried across a sequence of calls, and then its constructor does no work.
- A shape two modules must agree on that neither may import from the other is a **structurally
  typed parameter**, not a shared import.
- Index a `Record<string, …>` by text that came from outside through `Object.hasOwn`, never a
  bare lookup: a plain index walks the prototype chain, and `constructor` is truthy and callable.
- A function that decides for a caller **returns a verdict, not a throw**: `'readable' | 'absent'
  | 'unreadable'`, `'identity' | 'nothing' | 'unreadable'`, `failed` with the reason on the result.
  Throwing is for the caller who cannot continue. Library code never calls `process.exit`; a
  refusal is a typed error (`OperationRefusal` with a status) the command surface turns into an
  exit code, so the same function can answer a route.
- Exit codes mean one thing each and are stated on the command: 0 done or nothing to do, 1 a
  refusal the caller can act on, 2 a state the tool will not repair on its own.
- Fail closed. An answer the machine cannot give (a `stat` that errors) reads as the safe verdict,
  uniformly, never as the lexical fallback that let the destructive path run.
- Every write of a file a reader may hold open goes through the atomic writer (temp file beside
  the target, fsync, rename). Never truncate-then-write.
- A clock decides nothing. Identity is a content hash; staleness is a set difference or a version
  number; timestamps are recorded and displayed, never compared. Four exceptions are stated; the first
  three compare times the tool itself wrote, the fourth times the harness wrote:
  - **lock staleness** in `lib/platform/Lock.ts`. Its one comparison against a time the tool did not
    write is the fallback to the generation record's own mtime, reached only when that record is
    missing, unparseable or holds an unparseable time — and it fails closed in both directions: an
    unreadable record is not free on that ground alone, and a `stat` that errors reads as "not
    stale", so the waiter waits.
  - **ordering the log for display** in `cli/status/StatusCommand.ts` and in the page, because `--at`
    backfills and the array order is then not the chronological one. It decides nothing but the order
    lines are printed in.
  - **hiding long-done work on the page** in `lib/render/page/WorkVisibility.ts`: a task or ticket
    done for more than `DONE_WORK_VISIBLE_MILLISECONDS` is hidden until the viewer picks "Show all".
    It decides only what is displayed, never what is stored.
  - **the `usage --since` cohort split** in `lib/utils/TranscriptCohortUtil.ts` (`splitAt`), which
    compares each transcript's first harness-written timestamp to the given instant. It decides only
    which cohort a transcript is summarised in, never what is stored.

## 4. Comments — the code explains itself

Code is self-explanatory: logically named functions, classes and variables carry the meaning, and
comments are the exception, not the rule. No comment walls.

- A module has at most a short header (one to three sentences) when its place or purpose is not
  obvious from its name and folder. Most modules need none.
- An exported function has no docblock unless its contract has a non-obvious edge (a load-bearing
  direction, a stated limit, a deliberate refusal). Then one or two sentences, not a paragraph.
- An inline comment appears only where the code is genuinely complex or a decision cannot be seen
  from the code (why this order, why this fallback, what was rejected and why). One sentence.
- A comment never restates what the next line does, never narrates history, and never carries a
  measurement or an alternative unless a reader would otherwise reintroduce the wrong choice.
- Name files repo-rooted with backticks when a comment or doc names one (the documented-path guard
  checks every named path exists).
- No TODOs; agreed-and-not-done work lives in `docs/backlog.md`.

Enforced by review; the guard specs check paths, not prose.

## 5. Tests

- A spec sits beside its module, imports `describe`, `expect`, `test` from `bun:test`, opens with
  a docblock saying which cases matter and why (the ones callers rely on, not the happy path), and
  destructures the util object once at the top.
- **Test names are claims, written as sentences**: `'leaves an unknown variable standing verbatim'`,
  `'rule 3 has no members left, so the classifier is checked directly instead'`. A comment above a
  test states why that case is load-bearing.
- **A guard proves its scan found something before it judges anything**: assert a floor on files
  opened or edges seen, so a guard walking the wrong directory cannot pass by finding nothing. An
  empty category cannot prove itself by counting offences, so hand the classifier a constructed
  case of each shape and check the verdicts.
- **A guard does not count until you have introduced the specific violation it claims to catch
  and watched it fail, per form.** Do that before reporting the guard done.
- An allowlist of tolerated exceptions is exact in both directions: a listed exception that no
  longer exists fails as loudly as a new offence.
- A frozen table of expected outputs is taken from the *previous* implementation, never from the
  current run, and its comment says how to retake it.
- A test that needs a tool the machine may lack **skips** through one shared guard and says what
  is missing; an environment variable can turn that skip into a failure on a machine that has the
  tool. A skip is never silent in the summary — assert the skip count after a run.
- Pure functions are tested against their own contract; a stateful mechanism the outside cannot
  hold still (a live temporary path) exports its bookkeeping as an object so the spec can drive it.
- Anything that spawns the real binary is a cross-cutting suite at the layer root, named for what
  it pins, not for a module.

## 6. Documentation beside the code

- The root `CLAUDE.md` is the map and the rules; each substantial subfolder has its own carrying
  per-file one-liners and only the rules that matter there, never a paragraph duplicated from the
  root. **A change that adds, removes or renames a file, moves an entry point or invalidates a
  stated rule updates that folder's CLAUDE.md in the same change.**
- `docs/backlog.md` holds what is agreed and not started. It is not a status page; "nothing is in
  flight" is stated explicitly, with a date and branch when that stops being true.
- Commit messages are one plain, human-written subject line. No AI attribution of any kind, no
  `Co-Authored-By` trailer, no generated-with footer.

# Repository map

Every top-level entry, one line each. Per-file detail lives in the folder's own `CLAUDE.md`, which
is the file to read before changing anything inside it — and the file to update in the same change
that adds, removes or renames something there.

```
agent-progress.ts        The bin shim, and the only file in the repository that calls process.exit:
                         it exits with the number `runCommandLine` returned.
package.json             Name, the `agent-progress` bin entry, the scripts (typecheck, test, lint,
                         lint:fix, setup) and the one runtime dependency, `marked`.
tsconfig.json            The strict Bun project. Excludes `lib/render/page/`, which has its own.
eslint.config.js         ESLint 9 flat config: the shared rules, plus the devDependency exemption
                         for the test-only helpers.
bun.lock                 The lockfile. Committed, as a tool installed by `git clone` needs it.
.gitignore               `node_modules/`, `.agent-progress/`, `.DS_Store`.
CLAUDE.md                This file: the conventions, and this map.
README.md                For a person: install, adopting a repository, the dashboard, the command
                         reference, the file formats, and the three decisions worth knowing.
setup.sh                 Machine setup in three steps — Bun ≥ 1.2, `bun install` + `bun link`, and
                         a symlink under `~/.claude/skills/` for each bundled skill folder.

cli/                     The command surface: dispatch, the argument parser, the help, one folder
                         per command. Exit codes are decided here and nowhere else → `cli/CLAUDE.md`.
lib/                     Everything the commands do, in five layers that import upwards only →
                         `lib/CLAUDE.md`, and `lib/tickets/CLAUDE.md`. The page is in `lib/render/`
                         — see `lib/render/CLAUDE.md`; its `lib/render/page/template.html` is
                         designer-owned and edited as HTML, not generated.
skill/                   The Claude Code skill every session in a tracked repository loads: the
                         model, what to do in a session, and `skill/Reference.md` beside it holding
                         what `agent-progress help` does not print → `skill/CLAUDE.md`.
skill-orchestrate/       The skill for the one session running the board: intake, starting,
                         relaunching and stopping the dispatcher, and what it keeps in context →
                         `skill-orchestrate/CLAUDE.md`. Split from `skill/` by audience, because
                         that one is injected into every implementing agent as well.
templates/               The markdown this tool writes into somebody else's repository — the managed
                         CLAUDE.md block, the default ticket body, and `templates/AgentBrief.md`, the
                         brief `init` copies to `.agent-progress/agent-brief.md` on every run. Kept
                         as files, not string literals, so a change to the wording is a readable diff.
                         `templates/AgentProgressWorker.md` is the Claude Code agent definition
                         `init` and `update` install as `.claude/agents/agent-progress-worker.md`,
                         its `{{model}}` and `{{effort}}` filled with the default pair.
                         `templates/workflows/AgentProgressDispatch.js` is the dispatcher: a Workflow
                         script (plain JavaScript, run by the Workflow tool, never by Bun) that runs a
                         builder per ready ticket and a clean reviewer per built one within the board
                         limit, and decides rounds and parking in code. Its decisions are pinned by
                         `lib/tooling/dev/DispatchScriptHarness.spec.ts`.
docs/                    `docs/backlog.md`: what is agreed and not started, with the reason it is
                         not done yet. Not a status page.
node_modules/            Git-ignored dependencies.
```

## One rule that lives at the root

- **Run `bun run typecheck && bun test && bun run lint` after any TypeScript change**, all three,
  before reporting the change done. Bun executes the TypeScript directly, so a type error is not a
  build failure — it is a runtime surprise on a path nobody exercised. `typecheck` covers both
  projects (the Bun one and the DOM-only page one); never substitute an ad-hoc `tsc` invocation
  with hand-picked flags for either.
