# Working on agent-progress

This page is for changing the tool itself: getting a checkout running, the three checks every
TypeScript change must pass, the test helpers, the guard specs that fail the build on a structural
mistake, the page and the dispatcher script, the legacy folders, and the decisions that shape all of
it. Using the tool is covered in the [README](../README.md); every command and file format is in the
[CLI reference](cli.md). The rules themselves live in the root `CLAUDE.md`; this page points into it
rather than restating it.

- [Getting the code running](#getting-the-code-running)
- [Checks](#checks)
- [Layout and conventions](#layout-and-conventions)
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

The skills are **symlinks, never copies**: an edit reaches every session at once, a `git pull` needs
no install step, and a copy under `~/.claude` would be the one version nothing checks. The step is
idempotent: a link already pointing here is left alone (both sides are compared as resolved
physical paths, so `/tmp` against `/private/tmp` does not cause a relink on every run), a stale link is
replaced, and a real file or directory at the target is reported and left untouched, because the
only thing the script ever removes is a symlink.

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

- **`AGENT_PROGRESS_ROOT`** points every command but `init` at a scratch tracker.
- **`init --root <path>`** adopts a scratch directory, writing its `CLAUDE.md` block, hook, workflow and
  agent definition there.

What each refuses is in the CLI reference: [Conventions](cli.md#conventions) and
[Adopting a repository](cli.md#adopting-a-repository).

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
bun run typecheck   # tsc -p over every project the root CLAUDE.md names under TypeScript and lint
bun test            # bun:test, specs beside their modules
bun run lint        # eslint 9 flat config
```

When to run them is the root `CLAUDE.md`'s Verify rule. The type check matters because Bun executes
the TypeScript directly, so a type error is not a build failure; it is a runtime surprise on a path
nobody exercised.

## Layout and conventions

The repository map, the import rules and every convention are in the root `CLAUDE.md`: its Rules
section holds the conventions and its Local rules section what this repository adds for the command
surface, tickets, the page and the skills. There are no folder `CLAUDE.md` files.

## Tests and isolation

Spec naming, the test-only folders and their devDependency exemption are rules in the root
`CLAUDE.md` (Imports, TypeScript and lint, Tests). The test-only helpers sit beside their consumers,
and each file's header says what it is for:

- `src/testing/`: the scratch workspace, the tracker isolation guard, and the Board, tracker-file and
  progress fixtures several parts share.
- `cli/testing/`: the captured command context, the one sanctioned way to spawn the binary
  (`CliProcess.ts`), and readers of what a command left on disk.
- `src/adapters/progress/testing/` and `src/adapters/legacy/testing/`: the stored-format fixtures for
  their adapter specs.
- `src/services/tracker/testing/`: `failureOf`, what an action threw, for the tracker pipeline specs.
- `page/testing/`: the page specs' board and limits fixtures.
- `dispatcher/testing/`: the Workflow-script harness, its bundle and source mutants, the claims, and
  the frozen trace table with the catalogue and capture that retake it.

Where `TrackerIsolation` runs is a rule in the root `CLAUDE.md` (Tests). It refuses any directory
outside the scratch root, and refuses when discovery from a directory inside it (the walk up, the git
common directory, or `AGENT_PROGRESS_ROOT`) would resolve to a tracker outside it. It runs before the
command does, because a throw inside a command becomes an exit code a spec cannot tell apart from the
command's own. Its own spec, `src/testing/TrackerIsolation.spec.ts`, tries every escape.

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
| `dispatcher/testing/utils/WorkflowScriptSourceUtil.spec.ts` | Every form the guard catches, each watched failing. |
| `dispatcher/DispatchFromWorkflowGlobals.spec.ts` | The built script's meta is pure and equals the frozen table's, an impurity planted in it is caught, it has no clock or randomness, builds to the same text every time and has one `agent()` call. |
| `dispatcher/Dispatcher.decisions.spec.ts` and its `.holds`, `.resumption`, `.brief` and `.equivalence` suites | The dispatcher's decisions; see below. |

## The page

`progress.html` is built from `resources/template.html`, whose contract with the page modules is a
rule in the root `CLAUDE.md` (The page). `src/services/render/ProgressHtml.ts` replaces four tokens in
it, and `src/services/render/PageBundler.ts` bundles the TypeScript under `page/` into it from
`page/PageStart.ts`.

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

The dispatcher's source is `dispatcher/`, in TypeScript: `dispatcher/DispatchFromWorkflowGlobals.ts` is its entry
and `dispatcher/DispatchMeta.ts` its `meta`. `init` and `update` bundle it into one Workflow-tool script,
plain JavaScript run by the Workflow tool and never by Bun, and write it into a tracked repository as
`.agent-progress/agent-progress-dispatch.js`: `cli/adoption/InstalledFileGeneration.ts` hands
`src/lib/claude-code/WorkflowScriptBundle.ts` the two paths. It runs a builder per ready ticket and a
clean reviewer per built one within the board limit, and decides rounds and parking in code.

The frozen table `dispatcher/testing/FrozenDispatchTraces.json` holds the port to the behaviour of the
old committed script it replaced; when it is retaken is a rule in the root `CLAUDE.md` (Generated and
installed files), and the table names the command that retakes it.

`dispatcher/testing/DispatchScriptBundle.ts` bundles the port into one Workflow script through
`src/lib/claude-code/WorkflowScriptBundle.ts`, and
`dispatcher/testing/DispatchScriptHarness.ts` runs it against a fake `agent()` and a fake board, with the
clock and randomness refused as the Workflow tool refuses them. The specs:

| spec | pins |
|---|---|
| `dispatcher/Dispatcher.decisions.spec.ts` | Rounds, parking, concurrency, claims and restarts, each claim with its `SourceMutant` (root `CLAUDE.md`, Tests). |
| `dispatcher/Dispatcher.holds.spec.ts` | A held ticket gets no builder or reviewer until a status block shows the hold lifted, its running row gives up its slot, and the other tickets keep flowing. |
| `dispatcher/Dispatcher.resumption.spec.ts` | A build an earlier run left paused is resumed by a whole-board relaunch with one builder, never a held ticket's or a person's pause. |
| `dispatcher/Dispatcher.brief.spec.ts` | The call budgets, the rework threshold and the brief path the bundle sends, and the threshold its round decision applies, are `DISPATCH_PROTOCOL`'s; `cli/adoption/InstalledFileGeneration.spec.ts` pins that the installed brief states the same numbers. |
| `dispatcher/Dispatcher.equivalence.spec.ts` | The bundle reproduces the frozen table on every catalogued scenario. |
| `dispatcher/testing/DispatchTraceCapture.spec.ts` | The table names the bundle it was taken from and the command that retakes it. |
| `dispatcher/DispatchFromWorkflowGlobals.spec.ts` and `dispatcher/testing/utils/WorkflowScriptSourceUtil.spec.ts` | No nondeterministic call, and a literal `meta`. |

A change to the dispatcher's behaviour therefore comes with a claim and its mutant.

## Legacy folders

The rule for a `legacy/` folder, and what dropping one deletes, are in the root `CLAUDE.md` (Model and
boundaries). There are five:

| folder | what it answers |
|---|---|
| `src/shared/legacy/` | The retired status words, and the review-bar name util both folders below share. |
| `src/adapters/legacy/` | A version 1 `progress.json` with its own log, rows and tickets in the retired words, and review bars known only by name. |
| `src/services/tracker/legacy/` | The rewrite of older tracker files that `update` and `init` run, reached from `cli/legacy/`. |
| `cli/legacy/` | The retired verbs and words, refused with their replacement; the ignored `--hooks`; review-shaped names given their link at filing; the rewrite report; the dispatcher copy older versions installed under `.claude/workflows/`, removed by `init` and `update`. |
| `page/legacy/` | A spec only: how the page draws a review bar linked by its name. |

Current code reaches each through one seam call per consumer, marked at the call site by a `// The seam…` or
`// Dropping … makes this …` comment, as in `src/adapters/progress/ProgressFileIngestion.ts`,
`src/services/tracker/TrackerReader.ts`, `cli/tracking/task/TaskCommand.ts`,
`cli/adoption/update/UpdateCommand.ts` and `cli/adoption/TrackerRefresh.ts`. The `*.legacy.spec.ts` suites and every spec inside a legacy folder go
with it; the `*.legacySeam.spec.ts` suites beside current modules pin the current side of a seam and stay.

Each module header says when its folder can go: once every tracked repository has run
`agent-progress update` and agents no longer type the retired forms. `src/shared/legacy/` goes last,
once `src/adapters/legacy/` and `cli/legacy/` have gone.

## Architecture decisions

**One tracker per repository, shared by every worktree.** Discovery walks up from the current
directory to the nearest tracker and, when none is above, takes the root from
`git rev-parse --git-common-dir` resolved to the main checkout, never the worktree's own top. A
subagent working in `.claude/worktrees/some-branch` therefore writes into the same chart as the
orchestrator that spawned it, which is the case the tool exists for. The cost is that the tracker
cannot describe one worktree in isolation; the alternative was a tracker per checkout, where a
fan-out produces five charts and no picture.

**The page is rendered under the lock, from disk.** Every mutating command writes in the order the CLI
reference's [Locking](cli.md#conventions) paragraph states, then re-reads and rewrites `progress.html`,
all before releasing. Rendering afterwards would let two commands interleave and leave the page
describing a state the store never held. The lock is a directory of numbered generation records, each carrying a
pid, a timestamp and whether it is held or released, each created exclusively and never rewritten:
taking the lock creates the generation after the newest once that one is released, its process is
gone or it is stale, and holds only if no newer generation appeared meanwhile; releasing creates the
next one as released. A takeover therefore removes or renames nothing another process may have just
written, and exactly one waiter wins.

**Layout is computed in the browser, and the limits travel as data.** `progress.html` embeds the
progress file in a JSON island and `page/utils/GeometryUtil.ts` computes every bar, tick and
marker from it, which is what lets the in-page range presets re-lay-out without a regeneration, and
means there is exactly one implementation of the geometry rather than a server copy and a client
copy that disagree. The geometry's bounds are put into the island by `src/services/render/ProgressHtml.ts` and taken
as a parameter; `page/utils/GeometryUtil.ts` says why. The island's last key, `boardFacts`, carries the Board's answers
the render service computes through `src/services/render/utils/BoardFactsUtil.ts`: one fact per row at its
index, and one per ticket by id. The page reads every board fact from them and derives none itself.

## Backlog

What is agreed and not started is in [backlog.md](backlog.md), by the rule in the root `CLAUDE.md`
(Documentation and commits).
