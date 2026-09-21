# Decisions: what was rejected, and why

What this repository deliberately does **not** do. Each entry names the alternative, the reason it
lost, and the measurement where there was one — so the next reader does not rebuild it, and so a
proposal to revisit one starts from the evidence rather than from first principles.

This is not a status page. Work that is agreed and not started is in `docs/backlog.md`.

---

## Computing the Gantt geometry on the server

**Rejected 2026-09-18.** The obvious shape: `lib/render/Html` computes every bar's left and width
and emits them as inline styles, and the page is a static document.

It cannot survive the in-page range bar. A viewer who picks "last 4 hours" needs the bars laid out
again, and a page with no geometry can only ask the CLI to regenerate — which it cannot do from a
`file://` document. Keeping *both* — server geometry for the first paint, client geometry for the
presets — means two implementations of the same maths in two projects that cannot import each other,
and the failure mode is not a crash but a chart that is subtly wrong after the first click.

So the layout runs in one place, in the browser (`lib/render/page/GanttGeometry.ts`), and the server
renders every string. The cost is accepted and bounded: with scripting off the page shows its rows,
labels, chips, ticket cards and log, and only the bars are unpositioned.

## `:target` or hidden-radio tabs instead of a script

**Rejected 2026-09-18.** The CSS-only tab idioms would have made the Progress/Tickets switch work
without JavaScript, which is attractive for a page that must survive being mailed around.

Both fight the 30-second refresh, which is the feature the page exists for. `:target` puts the tab
in the URL fragment — fine — but a `<meta http-equiv="refresh">` reload with a fragment re-triggers
scroll-into-view on every refresh, so the page jumps. The radio idiom keeps no state across a reload
at all: every refresh returns the reader to the first tab. The page already carries a script for the
geometry, so a tab switch costs nothing extra; the fragment is written by that script and read back
after the reload, which is what makes the refresh land where the reader was.

## A YAML library for ticket frontmatter

**Rejected 2026-09-18.** `js-yaml` would have parsed the frontmatter in one line.

Three reasons, in order of weight. A general parser accepts nested maps, lists, anchors and block
scalars, so an agent editing a ticket by hand can write a structure the CLI then has to serialise
back — and round-tripping arbitrary YAML while preserving an author's formatting is a problem nobody
solves. It cannot preserve unknown keys, comments and blank lines in their original order, which is
the property that lets an agent add `owner:` to a ticket and keep it. And a dependency in the render
path of a tool that writes into other people's repositories is a supply-chain surface for a format
this tool fully controls. `lib/tickets/Frontmatter.ts` implements the stated subset instead, and
`lib/tickets/CLAUDE.md` documents it as a contract rather than as an implementation detail.

## A lock file without a pid

**Rejected 2026-09-18.** The simplest lock is a file with a timestamp: create it with `wx`, treat it
as stale past a threshold, unlink it and create your own.

The unlink is the bug. Two waiters can read the same stale lock in the same millisecond, both
unlink — the second unlink removing the *first waiter's fresh lock* — and both then create
successfully. Both proceed, and the tracker has the lost-update problem the lock was for, now with
no trace. `lib/platform/Lock.ts` therefore takes a stale lock over by `rename`, which is atomic and
consumes the path: exactly one renamer succeeds and the loser goes back to waiting. The pid is the
other half — a lock whose pid is no longer a live process is stale *now*, which makes a machine
usable immediately after a `SIGKILL` instead of 30 seconds later, and the age check is the fallback
for a reused pid or a tracker on a network share.

## Rendering the page after the lock is released

**Rejected 2026-09-18.** Releasing the lock as soon as `progress.json` is written, and regenerating
the HTML outside it, would shorten the critical section by the whole bundle-and-render step.

It lets two commands interleave: A writes the store, B writes the store, B renders, A renders — and
the page now shows a state that existed for a moment and has since been superseded, with nothing to
correct it until the next command. The page would be *behind the store and unaware of it*, which is
the one failure a dashboard cannot have. `lib/render/Rerender.ts` therefore re-reads from disk
inside the lock, and the page script bundle is memoised per process so the added time is a build
once and a file write thereafter.

## `git check-ignore` without the trailing slash

**Rejected 2026-09-18, with a measurement.** Probing `git check-ignore -q .agent-progress` reads
naturally and is what the first implementation did.

Without the slash, git has to guess whether the path is a directory, and it guesses from the
filesystem — so a repository whose rule is the directory form (`.agent-progress/`, in a parent
`.gitignore` or in `.git/info/exclude`) answers "not ignored" whenever the directory does not exist
yet. That is exactly the moment `init` asks, before it has created anything, so the tool would
append a redundant line to a `.gitignore` in somebody else's repository every single time.
**Measured on git 2.51: the same repository exits 1 for `.agent-progress` and 0 for
`.agent-progress/`.** `lib/platform/GitIgnore.ts` probes with the slash.

## A 250px indicator column

**Rejected 2026-09-18, with a measurement.** The Python predecessor's grid was `360px 250px 1fr`,
and carrying it over unchanged was the default.

The chip row grew from three chips to five when `delivered` and `abandoned` joined the statuses.
**Measured by screenshot: at both 250px and 300px the abandoned chip wrapped on to a second line**,
which made that one row taller than every other and pulled its bar out of horizontal alignment with
the rest of the chart — a chart that reads as misaligned is worse than one that is a little wider.
360px was measured against the widest chip row the tool can produce. The design handoff later set
the pair to 336px and 112px and narrows both below 1180px, so the widths are custom properties
(`--col-name`, `--col-pill`) in `lib/render/page/template.html`, and `lib/render/page/GanttPage.ts`
measures the rendered header cells rather than restating numbers it would then have to keep in
step to place the now-marker across the whole grid.

## Loading libraries from a CDN at runtime

**Rejected 2026-09-18, after Alex asked.** A `<script src="https://cdn…">` for a charting or
date library would have removed code from this repository.

Three reasons, and any one of them is sufficient. The page is a `file://` document that must work on
a laptop with no network, in a mailbox, and in six months — a CDN reference is a page that breaks
for reasons the reader cannot diagnose. It is a third party executing in a document that displays a
repository's internal work. And nothing here needs a library: the geometry is arithmetic on epoch
milliseconds, the markdown is rendered at generation time by `lib/render/Markdown.ts` on the Bun
side, and the page's own script is a few hundred lines. `lib/render/PageBundle.ts` inlines
everything, and `lib/render/PageBundle.spec.ts` asserts the output cannot close a `<script>`.

## Treating `abandoned` as a removal

**Rejected 2026-09-18.** Abandoning a ticket could simply delete its row, which keeps the chart free
of work nobody did.

It makes ids unstable and history unreadable. A task id is referenced by a ticket's `task` key and by
log lines already written; removing the row leaves those pointing at nothing, and a reader comparing
this morning's screenshot with this afternoon's finds a row that has silently vanished with no
record of why. `abandoned` is therefore a sixth task status with its own rendering — a grey hatched
bar and a struck-through label — and `ticket abandon` requires `--reason`, which goes into the log
line. Nothing in this tool deletes a row except `task remove`, which a person asks for explicitly.

## Server-rendering the page's content, now that the design template exists

**Rejected 2026-09-19.** `lib/render/Html` wrote every row, pill, log line and ticket card into the
document and the page only positioned what was already there, which kept the page readable with
scripting off and every string escaped in exactly one place.

The design handoff moved the line: `lib/render/page/template.html` ships placeholder content inside
every container so the template opens on its own, and states that the placeholder markup is the
shape the script must emit. Keeping the server renderer would have meant two implementations of that
markup — the designer's and ours — with no mechanism to keep them in step. So the page now builds all
of it, and the escaping property is preserved by moving every builder into
`lib/render/page/PageMarkup.ts`, a DOM-free module the root project compiles and
`lib/render/PageMarkup.spec.ts` drives directly.

## Duplicating the template's tab and ticket-open behaviour in the page script

**Rejected 2026-09-19.** The page script could own tab selection and the restore of expanded ticket
cards, which would leave the template a pure stylesheet.

Both are restored from `localStorage` before first paint by the template's own head and bootstrap
scripts, which is what stops a reload flashing. A second implementation would race the first. The
template instead exposes `window.agentProgressTemplate` with `selectTab` and
`restoreTicketOpenState`; the page script calls the latter after replacing the placeholder cards the
bootstrap had already applied the open set to, and the former when a `#ap-ticket-003` fragment has to
switch tabs.

## Replacing the template's four tokens one at a time

**Rejected 2026-09-19.** `document.replaceAll('__TICKETS__', …)` for each token in turn is the
obvious shape and is what the handoff's "a global literal replace is safe" suggests.

It is safe only against the pristine template. After the first replacement the document carries the
progress island, and a task named `__TICKETS__` would then be found by the second — a refusal an
agent could trigger by naming a task. `lib/render/Template.ts` splits on all four tokens at once and
joins with the values, so injected content is never searched again.

## Escaping `<!--` inside the bundled page script

**Rejected 2026-09-19.** `</script` is neutralised in the bundle by rewriting it to `<\/script`, and
the same trick was considered for the HTML comment opener that puts the tokenizer into its
double-escaped state.

There is no escape that is inert in every position: `<\!--` is the same string inside a JavaScript
string literal and a syntax error outside one, and the bundler's output gives no way to tell the two
apart. `lib/render/PageBundle.ts` therefore fails the bundle when its output contains one, which
becomes a visible banner rather than a page whose script was silently swallowed.

## Deriving the next task id from the rows

**Rejected 2026-09-18, after the final review.** `max(id) + 1` needs no stored counter and cannot get
out of step with the rows, which is why it was the first implementation.

It reuses ids in two ordinary situations. Removing the highest-numbered row frees its number for the
next one, and `clear` empties the rows and restarts at 1 while the log it has just written, the
ticket files on disk and any chart the person screenshotted all still name the old ones — so a log
line saying "task #4 finished" comes to describe two different pieces of work. The README and the
skill both promise ids are unique within a tracker. `ProgressFile.nextTaskId` is that promise: stored,
validated on read as a positive integer, allocated in `addTask` and nowhere else, and never wound
back. The known cost is a field a hand-repaired file can get wrong, and the allocator answers it by
raising the counter past any higher id already on a row.

## Letting the `task` verbs move a row a ticket owns

**Rejected 2026-09-18.** `agent-progress task finish 4` on a ticket's row exited 0 and put the row in
`finished` while the ticket file still said `in-progress`. Nothing reconciles the two afterwards: the
chart and the Tickets tab disagree, and the next `ticket review` re-stamps a row it is already in.

The verbs now refuse a ticket-owned row and name the `ticket` verb that moves both, with `--force` for
the case where the row is deliberately being left behind. Two exemptions, because a refusal there
would leave an agent with nothing to say: `task pause` is always allowed, since no ticket status can
express "waiting", and `task start` may resume a paused row, since that restores the status the
ticket already implies.

## A ticket transition table with no legality

**Rejected 2026-09-18.** Every move from every status used to succeed. It is the smallest possible
rule and it makes the status claim nothing: `ticket start` run twice appended a second, identical log
line, and `ticket deliver` on a ticket nobody had reviewed recorded a delivery of work the pipeline
says had not been done.

`LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS` is the matrix the six named verbs enforce; a move to the
status a ticket already has is refused under every spelling, with no log line. A strict matrix is
only affordable because `ticket status <id> <status>` skips it — a table worth having will eventually
refuse a move somebody genuinely needs, and without the override the verbs would be a cage. A ticket
taken straight to a closing status that way, having never started, gets a row whose start is stamped
along with its end, because an end without a start draws a bar from the origin of the chart.

## A `paused` ticket status to match the task one

**Rejected 2026-09-19, with the design.** `paused` was added to `TaskStatus` between `running` and
`finished`, and the symmetrical move would have been a sixth ticket status beside it.

A ticket says where a piece of work stands in the pipeline, and that does not change while nobody is
touching it: a paused ticket is still in progress. The pause is a fact about the *row* — which agent
is waiting, and since when — so `task pause <id>` records it, `task start <id>` resumes it, and
`TASK_STATUS_FOR_TICKET_STATUS` has no entry that reaches the state. The design gives the row its own
pill and a vertically striped bar, in a low-chroma slate that cannot be mistaken for `running`.

## Measuring token usage inside the tool

**Rejected 2026-09-19, when `--tokens` was added.** The obvious reading of "show tokens on the chart"
is that `agent-progress` should find out what a subagent cost.

It has no view of a model's usage and acquiring one would make a repository-local CLI depend on an
API, a key and a provider's accounting. So the number is one the orchestrator reports and this tool
stores and shows back — which is why `Task.tokens` is nullable rather than defaulting to zero: `null`
is "nobody said" and `0` is "it used none", and every reader keeps them apart. `--tokens` is accepted
by every command that files or moves a row, because the figure is almost never known when the row is
registered.

## Building the page's markup on the server

**Rejected 2026-09-19, replaced by the designer's template.** A server-side markup builder built
every element of the dashboard as a string, with the CSS in a module beside it.

The design handoff arrived as a single high-fidelity HTML file whose CSS, state system and id/class
contract are the deliverable rather than a picture of one. Re-expressing that as string concatenation
in TypeScript meant maintaining the same contract twice, in a form the designer could not open — and
every visual change would have arrived as a diff nobody could review against the original. So
`lib/render/page/template.html` is designer-owned and edited as HTML; the CLI injects two JSON islands
(`__PROGRESS__`, `__TICKETS__`) and the page script (`__PAGE_SCRIPT__`) into it, and the script builds
every row, log line, ticket row and ticket card from the data at runtime. The placeholder markup in
the template is the spec that script emits against.

The **stale banner** went with it. It was the page's one comparison of a clock — `generatedAt` against
`Date.now()` — and the design cut it: the generated time is in the header, a page that stopped being
regenerated is a session that ended, and a banner that fires on a throttled background tab teaches a
reader to ignore banners. `STALE_PAGE_BANNER_MILLISECONDS` and `PAGE_SELF_CHECK_INTERVAL_MILLISECONDS`
were deleted with it, which leaves lock staleness as the only place in the tool where a clock decides
anything.

## Refusing an empty ticket body

**Rejected 2026-09-19.** `ticket add --body-file -` with a pipe nobody wrote to files a ticket whose
body says nothing, and refusing it is the strict answer.

The title and the type are already good information, and throwing them away to punish an empty pipe —
a heredoc whose command failed, a subagent that produced nothing — helps nobody. An empty or
whitespace-only body falls back to `templates/TicketBody.md`, so the ticket carries the headings
somebody still has to fill in. Empty *titles* and empty log lines are refused, because neither has
anything to fall back to.

## Creating the directory `--root` names

**Rejected 2026-09-19.** `init --root ../new-project` could reasonably create the directory it is
asked to track, the way `mkdir -p` would.

A mistyped `--root ../projekt` then silently makes an empty directory beside the real one and
initialises a tracker nobody will ever look at. `--root` is refused unless it names an existing
directory, which is also what turns the raw `ENOTDIR` a file at that path used to produce into an exit
1 the caller fixes in one move. A **bare repository** is refused on the same principle: it has no
working tree, and `dirname` of its common directory is whatever happened to hold it.

## One skill for both audiences

**Rejected 2026-09-20, when the orchestrator skill was added.** `skill/SKILL.md` already carried the
session protocol, how to brief a subagent and what one costs, so the orchestration playbook could
simply have been added to it — one file, one load, and nothing to keep in step between two.

Its trigger fires in **every** session in a repository that holds a `.agent-progress/` directory,
including every implementing subagent, and each of their API calls re-reads whatever is in context.
A tool whose own brief is built on that arithmetic cannot inject the orchestrator's material into
the agents it is telling to stay short. So the split is by audience: `skill/SKILL.md` is what a
session needs in order to file and move a ticket, and `skill-orchestrate/SKILL.md` is loaded by the
one session running the board. The command reference — the bulk of the old file — went nowhere at
all: `agent-progress help` prints it, so the skill points there, and `skill/Reference.md` keeps only
the ticket file format, the transition matrix, the time axis and the exit codes, which the help does
not print. `cli/HelpText.spec.ts` holds the split: a ceiling on the file everyone loads, and no
command table in any of them.

## The orchestrator reviewing the work it dispatched

**Rejected 2026-09-20, with the orchestrator skill.** The orchestrator has the ticket, the brief and
the Handoff in front of it already, so reviewing the result itself looks free.

It is the worst available reader of that work — it wrote the brief the agent followed, so the gap
between what was asked and what was meant is the one thing it cannot see — and the review is what
finally drags the diff into the context the whole skill is built to keep small. A review is
therefore a fresh agent on the strongest model, with its own row on the chart, reporting a verdict
in under 150 words and changing no code. It holds a slot like any other agent, which is what keeps
the two-agent limit honest.

## Smaller rejected alternatives

One line each, kept because a reader who does not know the reason would reintroduce the choice.

**The command surface**

- **A `switch` for command dispatch** — a table makes the command list derivable, so `cli/HelpText.spec.ts` holds the help against `COMMAND_NAMES` in `cli/CommandTable.ts` instead of scraping `cli/Main.ts`.
- **A `Map` or `Object.create(null)` for that table** — the object literal plus an `Object.hasOwn` guard closes the same prototype hole in `cli/CommandTable.ts`, and one guard shape beats a second equally correct one.
- **Per-command help** — `cli/HelpText.ts` is one screen, and a second help surface is another thing to keep in step with the table.
- **A parser class, or a module singleton with `initialize(argv)`** — a class cannot be destructured and a singleton would read arguments at module load, which `lib/CLAUDE.md` forbids; `cli/arguments/ArgumentParser.ts` is a factory of closures.
- **`process.exit(1)` on a parse failure** — library code never exits here: `cli/arguments/ArgumentParser.ts` throws `OperationRefusal` and `cli/Main.ts` alone maps it to a status.
- **One set of value-taking options per command** — no two commands spell the same option differently, so `cli/arguments/OptionsWithValues.ts` stays one truth with no place to disagree.
- **Rendering unconditionally in `cli/open/OpenCommand.ts`** — it runs mid-session, would queue behind whatever holds the lock, and would produce a page byte for byte identical to the one on disk.
- **Replacing the progress file with an empty one on `clear`** — `trackerId`, `project` and `version` have to survive, so `cli/clear/ClearCommand.ts` writes back the object it read.

**The library**

- **A structural duck-type check for a refusal** — Bun caches one class per process, so `instanceof` is exact in `lib/platform/OperationRefusal.ts`, while a `status`-field test would turn an unrelated library error into exit 1.
- **`dirname` of `--git-common-dir` unconditionally** — a submodule's is `<superproject>/.git/modules/<name>` and a bare repository's is the repository itself, so `lib/platform/RepositoryRoot.ts` checks the shape before taking the parent.
- **An async atomic writer with exit handlers sweeping leftover temporaries** — every caller of `lib/platform/AtomicFile.ts` is already inside `withLock`, and a leftover lives in a git-ignored directory where nothing reads it.
- **Naming the working directory in the "no tracker" refusal when the root override is set** — the directory had nothing to do with the answer, and saying so hid the misspelled override that caused it (`lib/platform/Workspace.ts`).
- **Deriving the next task id as `max(id) + 1`** — a removed row's id would be reused and one log line naming task #4 could describe two pieces of work, so `lib/progress/ProgressStore.ts` stores the counter.
- **Defaulting a task's `tokens` to `0`** — "nobody reported a figure" and "it used none" are different answers, and `lib/constants/Types.ts` keeps them apart as `null` and `0`.
- **A single constants module** — the tunable bounds of `lib/constants/Limits.ts` and the on-disk vocabulary of `lib/constants/Statuses.ts` change for different reasons and different people.
- **Restoring unknown frontmatter lines to their original position between known keys** — a merge problem whose failure is a silently reordered file on every transition, so in `lib/tickets/Frontmatter.ts` the CLI owns the block of known keys and agents own everything below it.
- **A result type threaded through every frontmatter validator** — a branch at each of fourteen failure points; `lib/tickets/Frontmatter.ts` throws internally and reports the reason once.
- **Refusing a ticket file that repeats a known key** — it would strand a ticket an agent can still read, so the last value wins.
- **Stamping `updated` inside the ticket writer** — it would also stamp `clear`'s re-link rewrite, so only `lib/tickets/TicketTransitions.ts` records that a ticket changed.
- **Closing a task's bar on `paused`** — it would draw the work as over and then draw a second bar on resume; a pause shows in the row's striping, not in the bar's length.
- **Throwing on an unreadable tracker** — a verdict spares every caller of `lib/progress/ProgressStore.ts` from catching an exception and re-classifying it.

**The page**

- **Escaping a list of dangerous spellings (`<!--`, `<script`, `</script`) in the JSON island** — a list to keep adding to that an attacker has to out-think only once, so `lib/utils/HtmlEscapeUtil.ts` escapes every `<` for three bytes per occurrence.
- **The `<\/` escape for that island** — it covers the closing tag but not the `<!--` comment opener, which is what puts the tokenizer into its double-escaped state.
- **A `javascript:`/`data:` denylist matched with `startsWith`** — an entity anywhere in the scheme walks straight past it, so `lib/render/Markdown.ts` allowlists schemes instead.
- **A second token-count formatter inside the page project** — it cannot import `lib/constants/Limits.ts`, so it would restate the thresholds and drift from `lib/utils/TokenCountUtil.ts` (999,999 as `1000k` against `1M`).
- **A numeric ticket id** — it would need re-padding at every point of use, and the one place somebody forgot would write `ticket: 3` that no lookup against `"003"` matches; `lib/utils/TicketIdUtil.ts` keeps the padded string.
- **Refusing a non-integer scaled token count** — `1.1 * 1000` is `1100.0000000000002` in IEEE 754, so `lib/utils/TokenCountUtil.ts` rounds the product rather than rejecting `1.1k` for a reason no caller can see.
- **Anchoring the automatic axis at the tracker's start alone** — `clear` resets it and re-seeded rows carry older timestamps, which all fell off the left edge of the range `lib/render/page/GanttGeometry.ts` computes.
- **Aligning axis ticks on UTC minutes** — it puts every label on `:15` and `:45` in a half-hour zone, so the ticks follow the wall clock the viewer reads.
- **Weekday tick labels from `toLocaleDateString`** — the label would then depend on the viewer's locale rather than on the data.
- **Refusing an explicit tick step that is too dense** — a crowded axis is cosmetic and a page that stops responding is not, so the tick list is truncated at the bound in `lib/constants/Limits.ts`.
- **Pinning the now-marker to an edge when the present moment is outside the range** — it would claim work at a boundary the viewer scrolled away from, so `lib/render/page/GanttGeometry.ts` answers `null` and the marker is hidden.
- **Splitting the template on one token at a time** — injected content would be searched by the next replacement, so `lib/render/Template.ts` splits on all of them at once.

**The suite**

- **A copy of the command reference in the skill** — `agent-progress help` prints 10.8k characters of it from `cli/HelpText.ts`, which `cli/HelpText.spec.ts` already holds against `cli/CommandTable.ts`, so a second copy was drift with a guard bolted on; `skill/Reference.md` now carries only what the help does not print, and the spec fails a skill file that grows a command table.
- **A hand-written list of documented `ticket` subcommands** — a fourth copy of the command surface and the first to go stale; `cli/HelpText.spec.ts` reads them off the help's own lines.
- **Exercising `--body-file -` in a spec** — it reads the standard input the test runner owns, so the spec would test Bun rather than `cli/ticket/TicketCommand.ts`.
- **Reaching the `'unrepaired'` exit through a real placeholder command** — every command now does something, so `cli/Main.spec.ts` stubs `cli/render/RenderCommand.ts` for it.
- **Running `git --version` to detect git** — `Bun.which` answers the same question at module scope in `lib/tooling/dev/ScratchWorkspace.ts` without paying process startup in every skip guard.
- **Redirecting the tracker root through the environment in the binary smoke test** — `cli/BinarySmoke.spec.ts` lets the spawn inherit the environment untouched and points its working directory at a scratch workspace, which is what a person actually does.
- **Importing the captured command context from another spec file** — that re-registers the other file's tests, so it was promoted into `lib/tooling/dev/CapturedCommandContext.ts` instead.
- **Helpers for the submodule and bare-repository shapes in `lib/tooling/dev/ScratchWorkspace.ts`** — two exports with one caller each, so `lib/platform/RepositoryRoot.spec.ts` builds those repositories itself.
- **Deleting to the end of the file, or appending a second block, when `CLAUDE.md` carries a start marker with no end** — both lose somebody's content, so `lib/platform/ClaudeInstructions.ts` refuses the write.
- **Falling back to the directory walk when the root override names a directory with no tracker** — a misspelled override would silently write into whichever tracker sat above the working directory (`lib/platform/Workspace.ts`).
- **Reading the timezone variable in the time suite** — the environment is read in one module, so `lib/utils/TimeUtil.spec.ts` is written to hold in any zone.
- **Re-aligning every axis tick to the wall clock after the first** — stepping in epoch milliseconds from the first aligned tick is what keeps an axis that crosses a daylight-saving change evenly spaced (`lib/render/page/GanttGeometry.ts`).
- **A second spelling of the synthetic identity** — `Alex Example <alex.example@example.com>` is the one example person in `templates/`, in the specs and in the docs, and a second spelling is something a reader has to stop and check.
