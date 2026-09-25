# Working on agent-progress

This page is for changing the tool itself: getting a checkout running, the three checks every
TypeScript change must pass, where things live and which way imports may point, how the specs keep
away from real trackers, the guard specs that fail the build on a structural mistake, the page and
the dispatcher script, and the decisions that shape all of it. Using the tool is covered in the
[README](../README.md); every command and file format is in the [CLI reference](cli.md). The rules
themselves live in the root `CLAUDE.md` and each folder's own `CLAUDE.md`; this page points into them
rather than restating them.

- [Getting the code running](#getting-the-code-running)
- [Checks](#checks)
- [Repository layout](#repository-layout)
- [Conventions](#conventions)
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
bun run typecheck   # tsc over the Bun project and the DOM-only page project
bun test            # bun:test, specs beside their modules
bun run lint        # eslint 9 flat config
```

Run all three after any TypeScript change, before calling the change done. Bun executes the
TypeScript directly, so a type error is not a build failure; it is a runtime surprise on a path
nobody exercised. Never substitute an ad-hoc `tsc` invocation with hand-picked flags.

`typecheck` is two passes, `tsc -p tsconfig.json && tsc -p lib/render/page/tsconfig.json`. The root
project is the Bun program (`agent-progress.ts`, `cli/`, `lib/`) and excludes `lib/render/page/`. The
page project, `lib/render/page/tsconfig.json`, extends the root's strictness but compiles with the DOM
library and no Bun or Node types, so a page module reaching for `Bun.file` or `node:fs` fails to
compile instead of failing in a browser. Every shared file a page module imports is checked under
those DOM-only options too, which is what proves `lib/constants/Types.ts`,
`lib/utils/HtmlEscapeUtil.ts` and the other shared modules the page reaches stay environment-neutral.

`cli/HelpText.spec.ts` holds the help against the command table in both directions, and holds the
bundled skills to their shape: none of them may carry a command table of its own, and the one every
agent loads has a size ceiling. Every backticked path under `cli/`, `lib/`, `skill/`,
`skill-orchestrate/`, `templates/` or `docs/` in any markdown file, in a comment under `cli/` or `lib/`
or in `agent-progress.ts`, or anywhere in `setup.sh` is checked to exist by
`lib/DocumentedPaths.spec.ts`, so a rename that leaves a dead citation behind fails the build.

## Repository layout

```
agent-progress.ts    the bin shim; the only file that calls process.exit
cli/                 the command surface: dispatch, arguments, help, one folder per command
lib/                 everything the commands do, in five layers
skill/               the skill every session in a tracked repository loads
skill-orchestrate/   the skill for the one session running the board
templates/           what the tool writes into other repositories, and the dispatcher script
docs/                this page, the CLI reference, the backlog and the README images
```

Inside `lib/`, imports run up the tree only:

```
lib/constants/  →  lib/utils/  →  lib/platform/  →  lib/progress/ lib/tickets/ lib/render/  →  cli/
```

A feature folder (`lib/progress/`, `lib/tickets/`, `lib/render/`) never imports a sibling; what two
features need is promoted to the level above both, or passed as a structurally typed parameter.
Nothing under `lib/` imports `cli/`, and nothing that ships imports the test-only
`lib/tooling/dev/`. Exit codes are decided in `cli/` and nowhere else; a `lib/` module returns a
verdict or throws `OperationRefusal`.

Read the folder's own `CLAUDE.md` before changing anything in it, and update it in the same change
that adds, removes or renames a file there:

| folder | its map |
|---|---|
| `cli/` | `cli/CLAUDE.md` |
| `lib/` | `lib/CLAUDE.md` |
| `lib/tickets/` | `lib/tickets/CLAUDE.md` |
| `lib/render/` | `lib/render/CLAUDE.md` |
| `skill/` | `skill/CLAUDE.md` |
| `skill-orchestrate/` | `skill-orchestrate/CLAUDE.md` |

## Conventions

All of them are in the root `CLAUDE.md`; the sections to know by heart:

- **§1 Linter and type checker** — the strict `tsconfig.json` flags and what the shared ESLint config
  enforces (aligned values and imports, import order, multi-line objects), so code is written that way
  the first time.
- **§2 Naming** — full, descriptive names with no abbreviations; booleans as predicate phrases;
  design-decision constants in `SCREAMING_CASE` with the unit; synthetic example data.
- **§3 Module shape** — no barrels, imports up the tree, `util/` modules as one frozen object, no work
  at module load, `process.env` in one module, verdicts rather than throws, atomic writes, and the four
  stated places a clock may decide anything.
- **§4 Comments** — the code explains itself; comments only for a non-obvious why.
- **§5 Tests** — spec beside module, test names as claims, guards that prove their scan found
  something.
- **§6 Documentation beside the code** — folder `CLAUDE.md` files and `docs/backlog.md`; commit
  messages are one plain subject line.

## Tests and isolation

A spec is `<Module>.spec.ts` beside its module (a second suite on the same module is
`<Module>.<aspect>.spec.ts`; `.test.ts` is never used). The exception is `lib/render/page/`, which
holds no specs because a `bun:test` import would not resolve in the DOM-only project; its specs sit one
level up in `lib/render/` and import the page modules by relative path.

The test-only helpers live in `lib/tooling/dev/`, the one folder allowed to import devDependencies:

| helper | use |
|---|---|
| `lib/tooling/dev/ScratchWorkspace.ts` | Scratch directories, git repositories and worktrees under the OS temp directory. |
| `lib/tooling/dev/CapturedCommandContext.ts` | A command context whose two output streams are arrays, so a spec drives `runCommandLine` in-process and reads back what a user would have seen. |
| `lib/tooling/dev/CliProcess.ts` | The one sanctioned way to spawn the real binary. |
| `lib/tooling/dev/TrackerIsolation.ts` | The guard that keeps a spec away from any tracker it did not create. |
| `lib/tooling/dev/SourceComments.ts` | Finds comments in a source correctly, for the guards that scan text. |
| `lib/tooling/dev/DispatchScriptHarness.ts` | Runs the dispatcher script against a fake board. |
| `lib/tooling/dev/WorkflowScriptSource.ts` | Reads the dispatcher script's syntax tree for a clock, randomness or an impure `meta`. |

`TrackerIsolation` refuses any directory outside the scratch root, and refuses when discovery from a
directory inside it (the walk up, the git common directory, or `AGENT_PROGRESS_ROOT`) would resolve
to a tracker outside it. It runs in the captured command context, on a hook input's `cwd`, and in
`CliProcess.ts`, and it runs before the command does, because a throw inside a command becomes an exit
code a spec cannot tell apart from the command's own. Its own spec, `lib/tooling/dev/TrackerIsolation.spec.ts`,
tries every escape; `lib/TrackerIsolationBypasses.spec.ts` checks from the other end that no spec
builds the real process context or spawns the binary another way.

## The guard specs

Each fails the build on the violation it names. The ones that scan the tree also assert a floor on
what they scanned, so a walk of the wrong directory cannot pass by finding nothing.

| spec | what it pins |
|---|---|
| `lib/ImportDirection.spec.ts` | Imports run up the five layers; no `lib/` → `cli/`; nothing shipped imports `lib/tooling/dev/`; no barrels; no package or builtin import under `lib/constants/` or `lib/utils/`. |
| `lib/EnvironmentReads.spec.ts` | `process.env` is read only in `lib/platform/Environment.ts` (plus the one in-process override in its own spec), in every spelling of the access, specs included. |
| `lib/DocumentedPaths.spec.ts` | Every backticked path starting at one of the six documented folders, in a markdown file, a comment under `cli/` or `lib/`, `agent-progress.ts` or `setup.sh`, exists. A module that no longer exists is named without its extension. |
| `lib/TrackerIsolationBypasses.spec.ts` | No spec creates the real process context, and none spawns the binary except through `lib/tooling/dev/CliProcess.ts`. |
| `lib/tooling/dev/TrackerIsolation.spec.ts` | Every way a spec could reach a tracker outside the scratch root is refused. |
| `lib/tooling/dev/SourceComments.spec.ts` | A comment opener inside a string, template or regular expression opens nothing, and a real comment after one is still found; the text guards rely on both. |
| `cli/CommandTable.spec.ts` | Every command in `cli/CommandTable.ts` reaches a handler, and a word that is not a command, an inherited property included, is refused. |
| `cli/HelpText.spec.ts` | `cli/HelpText.ts` and the command table agree in both directions; no bundled skill carries its own command table; the skill every agent loads stays under its size ceiling. |
| `cli/BinarySmoke.spec.ts` | The real `agent-progress.ts` spawned end to end: the shebang, the argument slice and the exit status reaching the process. |
| `cli/InitRootOverride.spec.ts` | `init` beside `AGENT_PROGRESS_ROOT`, spawned because no spec may set the environment in-process: an override naming another directory refused with both progress files byte-identical, an agreeing one refreshing like `update`. |
| `lib/tooling/dev/WorkflowScriptSource.spec.ts` | The dispatcher script calls no clock and no randomness, and opens with a literal `meta` the Workflow tool can read without running it. |
| `lib/tooling/dev/DispatchScriptHarness.spec.ts` and its `.hold`, `.resume` and `.brief` suites | The dispatcher's decisions; see below. |

A new guard does not count until you have introduced each form of the violation it claims to catch and
watched it fail.

## The page

`progress.html` is built from `lib/render/page/template.html`, which is the designer's file: edited as
HTML, carried over rather than generated. Its placeholder content is the contract, so a change to what
`lib/render/page/PageMarkup.ts` emits that is not also made in the template is a bug, in whichever
direction it was made. `lib/render/Template.ts` replaces four tokens in it, which
`lib/render/CLAUDE.md` names along with the one layout invariant to protect (the axis box that keeps
bars, ticks and the now-marker aligned). The ids and classes the template exposes are listed in the
comment block at the top of the template itself.

The TypeScript under `lib/render/page/` runs in the browser and is compiled by its own DOM-only
project (see [Checks](#checks)). It is bundled into the page by `lib/render/PageBundle.ts`.

To see a change, render a scratch tracker (the one from the session above, before its `rm -rf`) and
open it:

```sh
AGENT_PROGRESS_ROOT="$SCRATCH" bun agent-progress.ts render
AGENT_PROGRESS_ROOT="$SCRATCH" bun agent-progress.ts open
```

`render` regenerates `progress.html` from the progress file and the tickets; `open` renders first
when the page is missing and opens it in the default browser. Reload the tab after each `render`.

## The dispatcher script and its harness

`templates/workflows/AgentProgressDispatch.js` is the dispatcher: a Workflow-tool script, plain
JavaScript, run by the Workflow tool and never by Bun. `init` and `update` copy it byte for byte into a
tracked repository as `.claude/workflows/agent-progress-dispatch.js`. It runs a builder per ready ticket
and a clean reviewer per built one within the board limit, and decides rounds and parking in code.

Because nothing executes it in this repository, `lib/tooling/dev/DispatchScriptHarness.ts` compiles its
body the way the Workflow tool would and runs it against a fake `agent()` and a fake board, with the
clock and randomness refused as the Workflow tool refuses them. The specs:

| spec | pins |
|---|---|
| `lib/tooling/dev/DispatchScriptHarness.spec.ts` | Rounds, parking, concurrency, claims and restarts. Each claim runs against the real script, where it must hold, and against a mutant that breaks exactly that decision, where it must fail; a mutant whose text has left the script fails loudly. |
| `lib/tooling/dev/DispatchScriptHarness.hold.spec.ts` | A held ticket gets no builder or reviewer until a status block shows the hold lifted, its running row gives up its slot, and the other tickets keep flowing. |
| `lib/tooling/dev/DispatchScriptHarness.resume.spec.ts` | A build an earlier run left paused is resumed by a whole-board relaunch with one builder, never a held ticket's or a person's pause. |
| `lib/tooling/dev/DispatchScriptHarness.brief.spec.ts` | The prompts' call budgets and rework threshold match what `templates/AgentBrief.md` states. |
| `lib/tooling/dev/WorkflowScriptSource.spec.ts` | No nondeterministic call in the script, and a literal `meta` first. |

A change to the script's behaviour therefore comes with a harness claim and its mutant.

## Architecture decisions

**One tracker per repository, shared by every worktree.** Discovery walks up from the current
directory to the nearest tracker and, when none is above, takes the root from
`git rev-parse --git-common-dir` resolved to the main checkout, never the worktree's own top. A
subagent working in `.claude/worktrees/some-branch` therefore writes into the same chart as the
orchestrator that spawned it, which is the case the tool exists for. The cost is that the tracker
cannot describe one worktree in isolation; the alternative was a tracker per checkout, where a
fan-out produces five charts and no picture.

**The page is rendered under the lock, from disk.** Every mutating command takes the lock, reads,
mutates, writes `progress.json` atomically, then re-reads and rewrites `progress.html`, all before
releasing. Rendering afterwards would let two commands interleave and leave the page describing a
state the store never held. The lock is a directory of numbered generation records, each carrying a
pid, a timestamp and whether it is held or released, each created exclusively and never rewritten:
taking the lock creates the generation after the newest once that one is released, its process is
gone or it is stale, and holds only if no newer generation appeared meanwhile; releasing creates the
next one as released. A takeover therefore removes or renames nothing another process may have just
written, and exactly one waiter wins.

**Layout is computed in the browser, and the limits travel as data.** `progress.html` embeds the
progress file in a JSON island and `lib/render/page/GanttGeometry.ts` computes every bar, tick and
marker from it, which is what lets the in-page range presets re-lay-out without a regeneration, and
means there is exactly one implementation of the geometry rather than a server copy and a client
copy that disagree. The geometry's bounds are put into the island by `lib/render/Template.ts` and taken
as a parameter rather than read from `lib/constants/Limits.ts`, so `lib/render/GanttGeometry.spec.ts`
can drive it with a constructed tick ladder; other page modules import `lib/constants/Limits.ts`
directly.

## Backlog

`docs/backlog.md` holds what is agreed and deliberately not started, each item with the reason it is
not done yet. It is not a status page, and it is where a TODO would otherwise go: there are none in
the code. Its first line states whether anything is in flight, with a date and branch when something
is.
