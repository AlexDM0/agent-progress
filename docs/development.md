# Working on agent-progress

This page is for changing the tool itself: getting a checkout running, the three checks every
TypeScript change must pass, where things live and which way imports may point, how the specs keep
away from real trackers, the guard specs that fail the build on a structural mistake, the page and
the dispatcher script, the legacy folders, and the decisions that shape all of it. Using the tool is covered in the
[README](../README.md); every command and file format is in the [CLI reference](cli.md). The rules
themselves live in the root `CLAUDE.md`; this page points into it rather than restating it.

- [Getting the code running](#getting-the-code-running)
- [Checks](#checks)
- [Repository layout](#repository-layout)
- [Conventions](#conventions)
- [Tests and isolation](#tests-and-isolation)
- [The guard specs](#the-guard-specs)
- [The page](#the-page)
- [The dispatcher script and its harness](#the-dispatcher-script-and-its-harness)
- [Legacy folders](#legacy-folders)
- [Architecture decisions](#architecture-decisions)
- [Backlog](#backlog)

## Getting the code running

```sh
git clone https://github.com/AlexDM0/agent-progress.git
cd agent-progress
./setup.sh
```

`setup.sh` changes nothing in any tracked repository; per-repository setup is `agent-progress init`'s
job. It runs three steps:

| step | what it does |
|---|---|
| 1/3 Bun | Puts `~/.bun/bin` on the `PATH` for its own run and checks for Bun. Below 1.2 it warns and suggests `bun upgrade`; when Bun is missing it offers the official installer and exits if you decline. |
| 2/3 Dependencies and the global command | Runs `bun install` on every run, not only the first, because every command that rewrites the page needs `marked`. Then `bun link`, so `agent-progress` works from any directory. When `agent-progress` is still not found on the `PATH` and the rc file does not already mention `~/.bun/bin`, it offers to add one export line to `~/.zshrc` (or `~/.bashrc` under bash). |
| 3/3 The skills | Symlinks `~/.claude/skills/agent-progress` to this checkout's `skill/` and `~/.claude/skills/agent-progress-orchestrate` to its `skill-orchestrate/`. |

The skills are **symlinks, never copies**. `cli/HelpText.spec.ts` holds the bundled skills against the
command table of this checkout; a copy under `~/.claude` would be the one version nothing checks. A
symlink also means an edit reaches every session at once and a `git pull` needs no install step. The
step is idempotent: a link already pointing here is left alone (both sides are compared as resolved
physical paths, so `/tmp` against `/private/tmp` does not cause a relink on every run), a stale link is
replaced, and a real file or directory at the target is reported and left untouched, because the
only thing the script ever removes is a symlink.

Two skills rather than one because they have two audiences: `skill/` is loaded by every session in a
tracked repository, including every implementing agent; `skill-orchestrate/` only by the session
running the board.

If you keep a separate skills-installer repository that adopts every skill it finds under
`~/.claude/skills/` unless its `skills.json` ignore list names it, that installer can replace the
symlinks with stale copies. `setup.sh` checks for such a `skills.json` at its expected location and
warns when either skill name is missing from it; it never edits that file, since it belongs to
another repository.

`./setup.sh --instruct-only` declines every offer and reports each skill link as what it would do.
It still runs `bun install` and `bun link`, which have no instruct-only branch.

### Running from source

The linked `agent-progress` runs this checkout's `agent-progress.ts` directly, so an edit is live on
the next command. Without the link, run the entry point with Bun:

```sh
bun agent-progress.ts help
bun /path/to/agent-progress/agent-progress.ts status
```

### Trying a change on a scratch repository

Do not try changes against this checkout: it has a tracker of its own in `.agent-progress/`, and
`init` run here writes its managed block into this repository's `CLAUDE.md`. Use a throwaway
repository instead. There are two ways to point the tool at one:

- **`AGENT_PROGRESS_ROOT`** names the repository to use instead of walking up from the current
  directory. It wins outright, and it is refused when the directory holds no tracker. `init` does
  not choose its directory by it, since it creates a tracker rather than finding one: set to a
  directory other than the one `init` targets (the discovered repository, or `--root`), `init` is
  refused at exit 1 with a message naming both and writes nothing. And `init` never replaces an
  existing `progress.json`: the store is created with an exclusive create, so a tracker already
  there is refreshed as `update` refreshes it instead.
- **`init --root <path>`** tracks that directory instead of the discovered repository root, and writes
  its `CLAUDE.md` block, hook, workflow and agent definition there. It is refused when the path is not
  an existing directory.

A complete session, from this checkout's root:

```sh
CHECKOUT="$PWD"
SCRATCH="$(mktemp -d)"
git -C "$SCRATCH" init -q

bun agent-progress.ts init --root "$SCRATCH" --project "Example Agency"
export AGENT_PROGRESS_ROOT="$SCRATCH"

bun agent-progress.ts task add "Draft the example page" --start
bun agent-progress.ts ticket add "Fix the example header"
bun agent-progress.ts log "Scratch session started"
bun agent-progress.ts task finish 1
bun agent-progress.ts status
bun agent-progress.ts open

unset AGENT_PROGRESS_ROOT
rm -rf "$SCRATCH"
```

`init` without `--root` also works when run from inside the scratch folder
(`cd "$SCRATCH" && bun "$CHECKOUT/agent-progress.ts" init`), since discovery then finds the scratch
repository.

## Checks

```sh
bun run typecheck   # tsc over five projects: the Bun program, the page and its specs, the dispatcher and its specs
bun test            # bun:test, specs beside their modules
bun run lint        # eslint 9 flat config
```

Run all three after any TypeScript change, before calling the change done. Bun executes the
TypeScript directly, so a type error is not a build failure; it is a runtime surprise on a path
nobody exercised. Never substitute an ad-hoc `tsc` invocation with hand-picked flags.

`typecheck` is five passes, `tsc -p` over `tsconfig.json`, `page/tsconfig.json`, `page/tsconfig.spec.json`,
`dispatcher/tsconfig.spec.json` and `dispatcher/tsconfig.json`. The root project is the Bun program
(`agent-progress.ts`, `cli/`, `src/`) and reaches neither `page/` nor `dispatcher/`. The
page project, `page/tsconfig.json`, extends the root's strictness but compiles with the DOM
library and no Bun or Node types, so a page module reaching for `Bun.file` or `node:fs` fails to
compile instead of failing in a browser. Every shared file a page module imports is checked under
those DOM-only options too, which is what proves `src/lib/tracker-model/`,
`src/lib/utils/HtmlEscapeUtil.ts` and the other shared modules the page reaches stay environment-neutral.
The spec project, `page/tsconfig.spec.json`, is the same program plus Bun types, so the page's specs compile.
`dispatcher/tsconfig.json` is the Workflow-runtime project, with no Bun, Node or DOM types. Its `include`
list names the `src/` files the dispatcher reaches, so a module reaching for a runtime API fails to
compile. `dispatcher/tsconfig.spec.json` checks the dispatcher's specs and `dispatcher/testing/` with Bun
types.

`cli/HelpText.spec.ts` holds the help against the command table in both directions, and holds the
bundled skills to their shape: none of them may carry a command table of its own, and the one every
agent loads has a size ceiling.

## Repository layout

```
agent-progress.ts    the bin shim and composition root: the only process.exit; imports cli/ only
cli/                 feature: the command surface, its commands grouped into tracking/, tickets/, dispatch/,
                     adoption/ and measurement/, beside arguments/, utils/, constants/ and legacy/
page/                feature: the browser page, with its own DOM-only project and spec project
dispatcher/          feature: the dispatcher's policy in TypeScript, which init and update bundle into
                     .agent-progress/agent-progress-dispatch.js
resources/           files read at runtime: template.html, and under templates/ the markdown init, update and
                     ticket add fill
src/
  adapters/          an ingestion class and a writer per stored format (progress/, tickets/, log/, install/), the
                     wording, JSON and HTML-label mappers in utils/, and legacy/
  services/          tracker/ (discovery, the lock, reading, the write pipeline, creation, legacy/) and render/
                     (the page document and the per-invocation RenderState)
  lib/               package-grade building blocks: atomic-file, git, claude-code, tracker-model, utils
  shared/            Environment, OperationRefusal, LIMITS, DISPATCH_PROTOCOL, the page payload and the other
                     shared @types, and legacy/
  testing/           test-only helpers several parts use
skill/               the skill every session in a tracked repository loads
skill-orchestrate/   the skill for the one session running the board
docs/                this page, the CLI reference, the backlog, the migration plan and the README images
```

Imports run up only, with no cycles:

```
src/lib/  →  src/shared/  →  src/adapters/  →  src/services/ (tracker → render)  →  features (cli/, page/, dispatcher/)
```

A feature (`cli/`, `page/`, `dispatcher/`) imports itself and `src/*`, never another feature. Inside
`cli/` a command folder never imports a sibling command's folder: what two need is hoisted to the
level above both (a set's own files, or `cli/`'s root and `cli/utils/`), or passed as a structurally
typed parameter. A service imports one other service, one way only (tracker → render). `src/` never
imports a feature, and `agent-progress.ts` imports only `cli/`.
Nothing that ships imports the six test-only folders: `src/testing/`, `cli/testing/`,
`src/adapters/progress/testing/`, `src/adapters/legacy/testing/`, `dispatcher/testing/` and `page/testing/`.
Exit codes are decided in `cli/` and nowhere else; a service returns a
verdict or throws `OperationRefusal`.

The rules are in the root `CLAUDE.md`; there are no folder `CLAUDE.md` files.

## Conventions

All of them are in the root `CLAUDE.md`: its Rules section holds the conventions (files and naming,
imports, the model and its boundaries, errors and exit codes, runtime, comments, TypeScript and lint,
tests, documentation and commits), and its Local rules section holds what this repository adds for
the command surface, tickets, the page and the skills.

## Tests and isolation

A spec is `<Module>.spec.ts` beside its module (a second suite on the same module is
`<Module>.<aspect>.spec.ts`; `.test.ts` is never used). That holds in `page/` too: the DOM-only project
excludes the specs, and `page/tsconfig.spec.json` checks them with Bun types.

The test-only helpers live in six folders: `src/testing/`, `cli/testing/`, `src/adapters/progress/testing/`,
`src/adapters/legacy/testing/`, `dispatcher/testing/` and `page/testing/`. The devDependency exemption in
`eslint.config.js` covers the five that need one, all but `src/adapters/legacy/testing/`; no other folder may
import a devDependency.

| helper | use |
|---|---|
| `src/testing/ScratchWorkspace.ts` | Scratch directories, git repositories and worktrees under the OS temp directory. |
| `cli/testing/CapturedCommandContext.ts` | A command context whose two output streams are arrays, so a spec drives `runCommandLine` in-process and reads back what a user would have seen. |
| `cli/testing/CliProcess.ts` | The one sanctioned way to spawn the real binary. |
| `cli/testing/RepositoryFileContents.ts` | Every file of a scratch repository outside `.git/`, so a spec shows a refused command wrote nothing. |
| `cli/testing/StoredLogEntries.ts` | The tracker's `log.jsonl` as people read it, each record worded through `LogUtil`, so a command spec checks what a command logged. |
| `cli/testing/StoredLogText.ts` | The tracker's `log.jsonl` exactly as stored, so a command spec checks that a refused command left the log byte-identical. |
| `src/testing/TrackerIsolation.ts` | The guard that keeps a spec away from any tracker it did not create. |
| `src/testing/BoardFixtures.ts` | A `Board` over synthetic records (`boardFixture`, `taskFixture`, `ticketFixture`) whose logger keeps every record in a list, so the Board specs assert reason codes, records and changed tickets. |
| `src/adapters/progress/testing/ProgressFileFixtures.ts` | Progress documents for the `progress.json` adapter specs: a new tracker, a row filed the way the Board files one, and the tracker as the current format stores it. |
| `src/adapters/legacy/testing/LegacyProgressFileFixtures.ts` | The older progress documents the legacy specs read: a version 1 file with its own log, and one in the retired task words. It goes with `src/adapters/legacy/`. |
| `page/testing/PageBoardFixture.ts` | The page's rows and tickets with the Board facts built the way the render service builds them, so a page spec never restates a board rule. |
| `dispatcher/testing/DispatchScriptHarness.ts` | Runs a dispatcher Workflow script's text against a fake `agent()` and a fake board. |
| `dispatcher/testing/DispatchScriptBundle.ts` | Hands `src/lib/claude-code/WorkflowScriptBundle.ts` the port's entry and meta module, or a `SourceMutant` of one of its modules, and memoises the unmutated build per process. |
| `dispatcher/testing/WorkflowScriptSource.ts` | Reads a dispatcher script's syntax tree for a clock, randomness, an impure `meta` or a shadowed Workflow global. |
| `dispatcher/testing/SourceMutant.ts` | A one-occurrence rewrite of one dispatcher module, applied as the bundle is built, so a claim can be watched failing without the decision it pins. |
| `dispatcher/testing/DispatchTrace.ts` | A dispatch run reduced to what two implementations of the dispatcher must agree on, in a form a frozen table can hold and compare. |
| `dispatcher/testing/DispatchTraceCapture.ts` | Runs every catalogue entry through the harness, reduced to its trace; run as a script, it prints the frozen table. |
| `dispatcher/testing/DispatchTraceCatalogue.ts` | Every scenario the frozen table holds: the claim suites' scenarios, a builder × reviewer grid, the argument refusals and fallbacks, and one lever per reply shape the dispatcher guards against. |
| `dispatcher/testing/FrozenDispatchTraces.json` | The frozen trace table, naming the bundle it was taken from and the command that retakes it. |
| `dispatcher/testing/claims/` | The dispatcher's decisions, holds and resumptions as claims: each a scenario, what must hold after it, and the mutant that breaks exactly that decision. |
| `dispatcher/testing/utils/` | Readings of a recorded dispatch run that the claims share, such as its returned summary. |

`TrackerIsolation` refuses any directory outside the scratch root, and refuses when discovery from a
directory inside it (the walk up, the git common directory, or `AGENT_PROGRESS_ROOT`) would resolve
to a tracker outside it. It runs in the captured command context, on a hook input's `cwd`, and in
`CliProcess.ts`, and it runs before the command does, because a throw inside a command becomes an exit
code a spec cannot tell apart from the command's own. Its own spec, `src/testing/TrackerIsolation.spec.ts`,
tries every escape. No spec builds the real process context, and none spawns the binary except
through `cli/testing/CliProcess.ts`.

## The guard specs

Each fails the build on the violation it names. Import direction and the one environment reader are
held by review, not by a spec.

| spec | what it pins |
|---|---|
| `src/testing/TrackerIsolation.spec.ts` | Every way a spec could reach a tracker outside the scratch root is refused. |
| `cli/CommandTable.spec.ts` | Every command in `cli/CommandTable.ts` reaches a handler, and a word that is not a command, an inherited property included, is refused. |
| `cli/HelpText.spec.ts` | `cli/HelpText.ts` and the command table agree in both directions; no bundled skill carries its own command table; the skill every agent loads stays under its size ceiling. |
| `cli/BinarySmoke.spec.ts` | The real `agent-progress.ts` spawned end to end: the shebang, the argument slice and the exit status reaching the process. |
| `cli/InitRootOverride.spec.ts` | `init` beside `AGENT_PROGRESS_ROOT`, spawned because no spec may set the environment in-process: an override naming another directory refused with both progress files byte-identical, an agreeing one refreshing like `update`. |
| `dispatcher/testing/WorkflowScriptSource.spec.ts` | Every form the guard catches, each watched failing. |
| `dispatcher/DispatchScript.spec.ts` | The built script's meta is pure and equals the frozen table's, an impurity planted in it is caught, it has no clock or randomness, builds to the same text every time and has one `agent()` call. |
| `dispatcher/Dispatcher.decisions.spec.ts` and its `.holds`, `.resumption`, `.brief` and `.equivalence` suites | The dispatcher's decisions; see below. |

A new guard does not count until you have introduced each form of the violation it claims to catch and
watched it fail.

## The page

`progress.html` is built from `resources/template.html`, which is the designer's file: edited as
HTML, carried over rather than generated. Its placeholder content is the contract, so a change to what
the page modules under `page/` emit that is not also made in the template is a bug, in whichever
direction it was made. `src/services/render/Template.ts` replaces four tokens in it. The comment block at the top of the template
names those tokens, the ids and classes the template exposes, and the one layout invariant to protect
(the axis box that keeps bars, ticks and the now-marker aligned).

The TypeScript under `page/` runs in the browser and is compiled by its own DOM-only
project (see [Checks](#checks)). It is bundled into the page from `page/PageStart.ts` by `src/services/render/PageBundle.ts`.

To see a change, render a scratch tracker (the one from the session above, before its `rm -rf`) and
open it:

```sh
AGENT_PROGRESS_ROOT="$SCRATCH" bun agent-progress.ts render
AGENT_PROGRESS_ROOT="$SCRATCH" bun agent-progress.ts open
```

`render` regenerates `progress.html` from the progress file, `log.jsonl` and the tickets; `open`
renders first when the page is missing and opens it in the default browser. Reload the tab after each
`render`.

## The dispatcher script and its harness

The dispatcher's source is `dispatcher/`, in TypeScript: `dispatcher/DispatchScript.ts` is its entry
and `dispatcher/DispatchMeta.ts` its `meta`. `init` and `update` bundle it into one Workflow-tool script,
plain JavaScript run by the Workflow tool and never by Bun, and write it into a tracked repository as
`.agent-progress/agent-progress-dispatch.js`: `cli/adoption/InstalledFileGeneration.ts` hands
`src/lib/claude-code/WorkflowScriptBundle.ts` the two paths. It runs a builder per ready ticket and a
clean reviewer per built one within the board limit, and decides rounds and parking in code.

The frozen table `dispatcher/testing/FrozenDispatchTraces.json` holds the port to the behaviour of the
old committed script it replaced: it was taken from that script at bc42604, and is now retaken from the port's bundle by the command it states, only in a commit
meant to change what the agents are told, whose diff of the table is that commit's review.

`dispatcher/testing/DispatchScriptBundle.ts` bundles the port into one Workflow script through
`src/lib/claude-code/WorkflowScriptBundle.ts`, and
`dispatcher/testing/DispatchScriptHarness.ts` runs it against a fake `agent()` and a fake board, with the
clock and randomness refused as the Workflow tool refuses them. The specs:

| spec | pins |
|---|---|
| `dispatcher/Dispatcher.decisions.spec.ts` | Rounds, parking, concurrency, claims and restarts. Each claim runs against the bundle, where it must hold, and against a `SourceMutant` of the module that holds the decision, where it must fail. A mutant whose text is not in its module exactly once fails. |
| `dispatcher/Dispatcher.holds.spec.ts` | A held ticket gets no builder or reviewer until a status block shows the hold lifted, its running row gives up its slot, and the other tickets keep flowing. |
| `dispatcher/Dispatcher.resumption.spec.ts` | A build an earlier run left paused is resumed by a whole-board relaunch with one builder, never a held ticket's or a person's pause. |
| `dispatcher/Dispatcher.brief.spec.ts` | The call budgets, the rework threshold and the brief path the bundle sends, and the threshold its round decision applies, are `DISPATCH_PROTOCOL`'s; `cli/adoption/InstalledFileGeneration.spec.ts` pins that the installed brief states the same numbers. |
| `dispatcher/Dispatcher.equivalence.spec.ts` | The bundle reproduces the frozen table on every catalogued scenario. |
| `dispatcher/testing/DispatchTraceCapture.spec.ts` | The table names the bundle it was taken from and the command that retakes it. |
| `dispatcher/DispatchScript.spec.ts` and `dispatcher/testing/WorkflowScriptSource.spec.ts` | No nondeterministic call, and a literal `meta`. |

A change to the dispatcher's behaviour therefore comes with a claim and its mutant.

## Legacy folders

Code that only reads what an older version stored, or answers an older habit, lives in a `legacy/` folder by
the rule in the root `CLAUDE.md` (Model and boundaries). There are five:

| folder | what it answers |
|---|---|
| `src/shared/legacy/` | The retired status words, and the review-bar name util both folders below share. |
| `src/adapters/legacy/` | A version 1 `progress.json` with its own log, rows in the retired words, and review bars known only by name. |
| `src/services/tracker/legacy/` | The rewrite of older tracker files that `update` and `init` run, reached from `cli/legacy/`. |
| `cli/legacy/` | The retired verbs and words, refused with their replacement; the ignored `--hooks`; review-shaped names given their link at filing; the rewrite report. |
| `page/legacy/` | A spec only: how the page draws a review bar linked by its name. |

Current code reaches each through one seam call per consumer, marked at the call site by a `// The seam…` or
`// Dropping … makes this …` comment, as in `src/adapters/progress/ProgressFileIngestion.ts`,
`src/services/tracker/TrackerReader.ts`, `cli/tracking/task/TaskCommand.ts` and
`cli/adoption/update/UpdateCommand.ts`. The `*.legacy.spec.ts` suites and every spec inside a legacy folder go
with it; the `*.legacySeam.spec.ts` suites beside current modules pin the current side of a seam and stay.

To drop a folder, delete it with its specs, turn each seam line into the current-format answer its comment
names, and delete the sentences on it in `cli/HelpText.ts`, `docs/cli.md` and `skill/Reference.md`. Each
header says when: once every tracked repository has run `agent-progress update` and agents no longer type the
retired forms. `src/shared/legacy/` goes last, once `src/adapters/legacy/` and `cli/legacy/` have gone.

## Architecture decisions

**One tracker per repository, shared by every worktree.** Discovery walks up from the current
directory to the nearest tracker and, when none is above, takes the root from
`git rev-parse --git-common-dir` resolved to the main checkout, never the worktree's own top. A
subagent working in `.claude/worktrees/some-branch` therefore writes into the same chart as the
orchestrator that spawned it, which is the case the tool exists for. The cost is that the tracker
cannot describe one worktree in isolation; the alternative was a tracker per checkout, where a
fan-out produces five charts and no picture.

**The page is rendered under the lock, from disk.** Every mutating command takes the lock, reads,
mutates, writes `progress.json` atomically, then the tickets, then `log.jsonl` (and first a copy of the notes,
when it takes the log over from a version 1 `progress.json`), then re-reads and rewrites `progress.html`, all
before releasing. Rendering afterwards would let two commands interleave and leave the page describing a
state the store never held. The lock is a directory of numbered generation records, each carrying a
pid, a timestamp and whether it is held or released, each created exclusively and never rewritten:
taking the lock creates the generation after the newest once that one is released, its process is
gone or it is stale, and holds only if no newer generation appeared meanwhile; releasing creates the
next one as released. A takeover therefore removes or renames nothing another process may have just
written, and exactly one waiter wins.

**Layout is computed in the browser, and the limits travel as data.** `progress.html` embeds the
progress file in a JSON island and `page/utils/GeometryUtil.ts` computes every bar, tick and
marker from it, which is what lets the in-page range presets re-lay-out without a regeneration, and
means there is exactly one implementation of the geometry rather than a server copy and a client
copy that disagree. The geometry's bounds are put into the island by `src/services/render/Template.ts` and taken
as a parameter rather than read from `src/shared/constants/Limits.ts`, so `page/utils/GeometryUtil.spec.ts`
can drive it with a constructed tick ladder. The island's last key, `boardFacts`, carries the Board's answers
the render service computes through `src/services/render/utils/BoardFactsUtil.ts`: one fact per row at its
index, and one per ticket by id. The page reads every board fact from them and derives none itself.

## Backlog

`docs/backlog.md` holds what is agreed and deliberately not started, each item with the reason it is
not done yet. It is not a status page, and it is where a TODO would otherwise go: there are none in
the code. Its first line states whether anything is in flight, with a date and branch when something
is.
