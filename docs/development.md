# Working on agent-progress

This page is for changing the tool itself: getting a checkout running, the three checks every
TypeScript change must pass, the test helpers, the guard specs that fail the build on a structural
mistake, the page and the dispatcher script, and the decisions that shape all of
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
- [Architecture decisions](#architecture-decisions)
- [Backlog](#backlog)

## Getting the code running

```sh
git clone https://github.com/AlexDM0/agent-progress.git
cd agent-progress
./setup.sh
```

`setup.sh` changes nothing in any tracked repository but this one's git config; per-repository setup is
`agent-progress init`'s job. It runs four steps:

| step | what it does |
|---|---|
| 1/4 Bun | Puts `~/.bun/bin` on the `PATH` for its own run and checks for Bun. Below 1.2 it warns and suggests `bun upgrade`; when Bun is missing it offers the official installer and exits if you decline. |
| 2/4 Dependencies and the global command | Runs `bun install` on every run, not only the first, because every command that rewrites the page needs `marked`. Then `bun link`, so `agent-progress` works from any directory. When `agent-progress` is still not found on the `PATH` and the rc file does not already mention `~/.bun/bin`, it offers to add one export line to `~/.zshrc` (or `~/.bashrc` under bash). |
| 3/4 Retire the global skills | Removes `~/.claude/skills/agent-progress` and `~/.claude/skills/agent-progress-orchestrate` when each is a symlink resolving into this checkout, the links earlier versions made; links nothing. |
| 4/4 The pre-commit hook | Sets `core.hooksPath` to `.githooks` unless it already is, so `.githooks/pre-commit` refuses a commit that fails `bun run lint` or `bun run typecheck`, in this checkout and every worktree of it. |

`.claude/settings.json` adds a `PostToolUse` hook, `.claude/hooks/fix-lint-on-edit.sh`, that runs
`eslint --fix` on a `.ts` file after each Edit or Write, with the ESLint of the checkout holding it.

The skills are installed per repository, not per machine: `agent-progress init` and `update` copy this
checkout's `skills/agent-po/` (loaded by any session asked to file a ticket) and
`skills/agent-progress-orchestrate/` (the session running the board, which loads `agent-po` for intake)
into the tracked repository's git-ignored `.claude/skills/`, so a session loads them only where a
tracker is, and install `resources/templates/Reference.md` as `.agent-progress/reference.md`, the
formats and exit codes the briefs cite. No builder or reviewer loads a skill. After a
`git pull` here, `agent-progress update` in each tracked repository brings its copies up to date and
removes the files of a skill folder an earlier version installed and this one retired. Step
3/4 only cleans up after the old global install: both sides are compared as resolved physical paths
(`/tmp` against `/private/tmp`), and a symlink pointing elsewhere or a real file or directory at either
path is reported and left untouched, because the only thing the script ever removes is a symlink into
this checkout.

`./setup.sh --instruct-only` declines every offer and reports `bun install`, `bun link`, each retired
skill link it would remove and the `core.hooksPath` change as what it would do.

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
bun agent-progress.ts ticket add "Fix the example header" --type bug
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
- `src/lib/tracker-model/testing/`: `TupleCoversTheUnion`, the type check that a constant tuple lists
  every member of its union, for the model's constants specs.
- `cli/testing/`: the captured command context, the one sanctioned way to spawn the binary
  (`CliProcess.ts`), and readers of what a command left on disk.
- `src/adapters/progress/testing/`: the stored-format fixtures for the adapter specs.
- `src/services/tracker/testing/`: `thrownFailureOf`, what an action threw, for the tracker pipeline specs.
- `page/testing/`: the page specs' board and limits fixtures.
- `dispatcher/testing/`: the Workflow-script harness, its bundle and source mutants, the claims, and
  the frozen trace table with the catalogue and capture that retake it.

Where `TrackerIsolation` runs is a rule in the root `CLAUDE.md` (Tests). It refuses any directory
outside the scratch root, and refuses when discovery from a directory inside it (the walk up, the git
common directory, or `AGENT_PROGRESS_ROOT`) would resolve to a tracker outside it. It runs before the
command does, because a throw inside a command becomes an exit code a spec cannot tell apart from the
command's own. Its own spec, `src/testing/TrackerIsolation.spec.ts`, tries every escape.

## The guard specs

Each fails the build on the violation it names. The one environment reader is held by review, not
by a spec.

| spec | what it pins |
|---|---|
| `src/ImportDirection.spec.ts` | The import rules the root `CLAUDE.md` lists under Imports, each planted in memory and watched failing. |
| `src/ProjectIncludeLists.spec.ts` | The page and dispatcher projects' `include` lists name exactly the files each project reaches. |
| `src/testing/TrackerIsolation.spec.ts` | Every way a spec could reach a tracker outside the scratch root is refused. |
| `src/services/render/TemplateColourTokens.spec.ts` | No colour literal in `resources/template.html` outside its token blocks, nor in the page modules' markup. |
| `cli/OlderTrackerRefusal.spec.ts` | A tracker in an older stored format is refused with the update advice and left as it was. |
| `cli/InstallVersionVerdict.spec.ts` | The install-version verdicts: current, older, newer, unversioned and unreadable. |
| `cli/InstalledSurface.spec.ts` | Every command, flag and status field an installed file names is in `cli/FrozenInstalledSurface.json` under the current `INSTALL_VERSION`, and still in the CLI. |
| `cli/CommandTable.spec.ts` | Every command in `cli/CommandTable.ts` reaches a handler, and a word that is not a command, an inherited property included, is refused. |
| `cli/HelpText.spec.ts` | `cli/HelpText.ts` and the command table agree in both directions; no bundled skill carries its own command table; the filing skill stays under its size ceiling, and the orchestrator skill loads it rather than restating it. |
| `cli/BinarySmoke.spec.ts` | The real `agent-progress.ts` spawned end to end: the shebang, the argument slice and the exit status reaching the process. |
| `cli/InitRootOverride.spec.ts` | `init` beside `AGENT_PROGRESS_ROOT`, spawned because no spec may set the environment in-process: an override naming another directory refused with both progress files byte-identical, an agreeing one refreshing like `update`. |
| `dispatcher/testing/utils/WorkflowScriptSourceUtil.spec.ts` | Every form the guard catches, each watched failing. |
| `dispatcher/DispatchFromWorkflowGlobals.spec.ts` | The built script's meta is pure and equals the frozen table's, an impurity planted in it is caught, it has no clock or randomness, builds to the same text every time and has one `agent()` call. |
| `dispatcher/Dispatcher.decisions.spec.ts` and its `.holds`, `.resumption`, `.group`, `.brief` and `.equivalence` suites | The dispatcher's decisions; see below. |

## The page

`progress.html` is built from `resources/template.html`, whose contract with the page modules is a
rule in the root `CLAUDE.md` (The page). `src/services/render/PageTemplateFill.ts` replaces five tokens in
it, and `src/services/render/PageBundler.ts` bundles the TypeScript under `page/` into it from
`page/PageStart.ts`.

`view-spec` builds a second page, `progress-spec.html`, the same way from `resources/spec-template.html` and the
entry `page/spec/SpecPageStart.ts`, everything it alone draws under `page/spec/`. The two pages share their shell
(the JSON island, the error banner, fragment routing) in `page/shell/` and their filter chips in `page/chips/`.
What it reads and shows is [the spec-kit page](cli.md#the-spec-kit-page).

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
| `dispatcher/Dispatcher.group.spec.ts` | A group run moves the main line once, at its release ticket's release, runs one builder and one reviewer at a time in pipeline order, and resumes from the board alone. |
| `dispatcher/Dispatcher.brief.spec.ts` | The call budgets, the rework threshold and the brief path the bundle sends, and the threshold its round decision applies, are `DISPATCH_PROTOCOL`'s; `cli/adoption/InstalledFileGeneration.spec.ts` pins that the installed brief states the same numbers. |
| `dispatcher/Dispatcher.equivalence.spec.ts` | The bundle reproduces the frozen table on every catalogued scenario. |
| `dispatcher/testing/DispatchTraceCapture.spec.ts` | The table names the bundle it was taken from and the command that retakes it. |
| `dispatcher/DispatchFromWorkflowGlobals.spec.ts` and `dispatcher/testing/utils/WorkflowScriptSourceUtil.spec.ts` | No nondeterministic call, and a literal `meta`. |

A change to the dispatcher's behaviour therefore comes with a claim and its mutant.

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
copy that disagree. The geometry's bounds are put into the island by `src/services/render/PageTemplateFill.ts` and taken
as a parameter; `page/utils/GeometryUtil.ts` says why. The island's last key, `boardFacts`, carries the Board's answers
the render service computes through `src/services/render/BoardFacts.ts`: one fact per row at its
index, and one per ticket by id. The page reads every board fact from them and derives none itself.

## Backlog

What is agreed and not started is in [backlog.md](backlog.md), by the rule in the root `CLAUDE.md`
(Documentation and commits).
