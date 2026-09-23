# `lib/` — everything that is not a command

The command surface lives in `cli/`; everything it does lives here. A module under `lib/` never
knows which command called it, never writes to the terminal and never decides an exit code — it
returns a verdict or throws `OperationRefusal`, and `cli/Main.ts` turns that into 0, 1 or 2.

## Layering

Five levels, and imports run **up the tree only**:

```
lib/constants/  →  lib/utils/  →  lib/platform/  →  lib/progress/ lib/tickets/ lib/render/  →  cli/
```

- `lib/constants/` imports nothing outside itself. `lib/utils/` imports `lib/constants/` or nothing.
  `lib/platform/` may reach both. A feature folder may reach `lib/platform/`, `lib/utils/` and
  `lib/constants/`, and **never a sibling feature**: what two features both need is promoted to the
  level above both rather than imported across. Nothing under `lib/` imports `cli/`, and nothing that
  ships imports the test-only helpers. `lib/ImportDirection.spec.ts` fails the build on any of these,
  and asserts a floor on the edges it scanned so that a walk of the wrong directory cannot pass by
  finding nothing.
- **No barrel files.** A caller imports the one thing it wants from the file named after it, so an
  import block is a readable dependency list.
- **`process.env` is read in `lib/platform/Environment.ts` and nowhere else**, through getters rather
  than constants captured at import, so a spec can redirect a value in-process.
  `lib/EnvironmentReads.spec.ts` scans for both spellings of the accessor. Its scan covers specs too,
  which is why `lib/platform/Workspace.spec.ts` drives the override through a child process instead
  of setting it. The allowlist holds two names: the module itself, and
  `lib/platform/Environment.spec.ts`, which makes the repository's one in-process assignment —
  a child's environment is complete before its first import runs, so no child case can tell a getter
  apart from a value captured at load, and that is the only claim the getter shape exists to support.
- **No work at module load.** Importing a module runs nothing: no working directory is resolved, no
  file opened, no environment read. This is what lets a spec import the real thing instead of
  scraping source text.
- **A clock decides nothing**, with three stated exceptions, each comparing times the tool itself
  wrote: lock staleness in `lib/platform/Lock.ts` — including its fallback to the lock file's own
  mtime, which fails closed in both directions — ordering the log for display, which decides
  nothing but a print order, and the page hiding long-done work, which decides nothing but what is
  shown. Task timestamps are recorded and displayed, never compared.
- **Every file a reader may hold open goes through `lib/platform/AtomicFile.ts`.** The two deliberate
  exceptions are `.gitignore` and `CLAUDE.md`, edited in place so that a symlinked `CLAUDE.md` stays
  a symlink; each says so in its own docblock.

## Guards at this level

- `lib/ImportDirection.spec.ts` — imports run up the tree, no `lib` → `cli`, no shipped code into the
  test-only folder, no barrels.
- `lib/EnvironmentReads.spec.ts` — the environment is read in one module.
- `lib/TrackerIsolationBypasses.spec.ts` — no spec creates the real process context, and none
  spawns the binary except through `lib/tooling/dev/CliProcess.ts`: a spec that starts a process
  and names the entry point or the linked bin is judged by the pair.
- `lib/DocumentedPaths.spec.ts` — every backticked repository path in a `*.md` or a docblock exists.
  A module that no longer exists is named **without** its extension, deliberately.

## `lib/constants/`

Imports nothing; safe to compile alongside the browser page, which is why no value here may touch Bun
or Node.

- `lib/constants/Types.ts` — every shape the tracker stores or renders: `Task` (with its nullable
  `tokens` and its optional `history`, `agent` and `reviewOf`), `TaskPhase`, `LogEntry`, `ViewRange`, `ProgressFile` (with
  `nextTaskId` and the optional `concurrencyLimit` and `dispatcherState`), `DispatcherState`, `TicketFrontmatter` (with the optional `priority`,
  absent meaning normal), `TicketPriority`, `Ticket`. Types only, no values.
- `lib/constants/Limits.ts` — the tuning constants, each with its unit in its name: lock staleness and
  retries, the axis tick ladder and its bounds, ticket id width, how long done work stays visible,
  the timestamp slice bounds every human-facing reader shares, the JSON indent, and
  `OVERSIZED_CONTEXT_THRESHOLD_TOKENS`, the context above which an API call is counted as oversized, and
  `CONCURRENCY_LIMIT_CEILING_AGENTS`, the most agents a stored limit allows in flight.
- `lib/constants/Statuses.ts` — the task and ticket status tuples and the ticket type and priority
  tuples with their guards, `ticketPriorityOf` (the one place an absent priority becomes `normal`),
  the ticket-status → task-status table, and the on-disk names (`progress.json`,
  `progress.html`, `.agent-progress`, `tickets`, `.lock`) and the two managed-block markers.
- `lib/constants/CommentSyntaxes.ts` — how each file type writes a comment (line markers, block
  delimiters, docstrings, strings that could hide a marker, `<script>`/`<style>` inside HTML), keyed by
  extension and by whole file name, and what counts as documentation. An unlisted type has no entry.

## `lib/utils/`

Pure and stateless. Each file exports **one frozen object named after the file**, is unit-tested
against its own contract rather than through a caller, and touches no filesystem and no clock —
anything that needs "now" is handed it.

- `lib/utils/TimeUtil.ts` — the one answer to what a timestamp looks like: `formatLocalIso` (local
  offset written by hand, seconds precision), `parseIso` (returns `null`, never an `Invalid Date`),
  `resolveWhen` for `--at`, `parseDurationMinutes`, and `minutesBetween` in epoch milliseconds so it
  is right across a daylight-saving boundary.
- `lib/utils/HtmlEscapeUtil.ts` — `escapeHtml` for text and attributes, and `escapeJsonForScriptTag`
  for the JSON island, which are two different problems: an HTML parser ends a `<script>` at the
  first `</script`, inside a JSON string or not — so every `<` is escaped, which covers `<!--` too.
- `lib/utils/SlugUtil.ts` — `slugFromTitle`, the file-name half of a ticket's identity; lower-case
  ASCII with accents folded, capped, and never empty.
- `lib/utils/TicketIdUtil.ts` — `padTicketId` and `parseTicketReference`; a ticket id is a string
  (`"003"`) everywhere it is stored, and this is what keeps it one.
- `lib/utils/TokenCountUtil.ts` — `parseTokenCount` for what `--tokens` accepts (`12000`, `12k`,
  `12.3k`, `1.2m`; a bare decimal and a negative are refused) and `formatTokenCount` for what both
  readers show (`950`, `12.3k`, `1.2M`). One module, so the command surface and the page cannot
  drift on either half.
- `lib/utils/TranscriptUsageUtil.ts` — `summariseTranscriptUsage`, which sums a subagent transcript
  **per `message.id` and never per line** (one API call is several lines repeating the same input
  figures), and `composeUsageLine`, the log line `agent-progress hook subagent-stop` writes from it.
  The one export besides the frozen object is its `TranscriptUsageTotals` type, which the command
  names in passing the totals from the first function to the second. The totals also carry
  `oversizedContextTokens`, what was spent on calls made above `OVERSIZED_CONTEXT_THRESHOLD_TOKENS`,
  deduplicated per call like the rest. `profileTranscript` adds what
  explains those totals — the first timestamp, the model, the browser tool calls, the `Bash` commands
  that edited a file through the shell and the ones that ran the tests, the type checker or the linter,
  the characters the
  harness injected as `nested_memory` attachments and the first 80 characters of the brief — as the
  `TranscriptProfile` type `agent-progress usage` reports one agent by. `rowIdentifiersNamedInBrief`
  reads the `agent-progress row: 4, 7` line from **the first user turn with spoken text only** — the
  brief, found as the excerpt is — so a marker quoted later never counts; `ticketIdentifiersNamedInBrief`
  reads the `agent-progress ticket: 22, 20` line the same way and answers padded ids, leaving the
  lookup of each ticket's row to the hook; `reviewedTicketIdentifierNamedInBrief` reads the single-id
  `agent-progress review: 7` line the same way, a list naming nothing; `evenSharesOf` floors the
  split and gives the remainder to the first row; `totalInputTokensOf` is the one `input` figure the
  log line and the row share.
- `lib/utils/TranscriptCohortUtil.ts` — `summariseCohort` and `splitAt` over those profiles.
  **Calls and end context are medians, the token figures means**: one runaway agent must not move
  what a typical agent did, and must not be hidden in what the cohort cost. The oversized share is the
  mean of each agent's share of its own input, not of the cohort's pooled tokens. An empty cohort answers
  zero of everything, and a profile with no readable stamp falls on the `before` side of a split.
- `lib/utils/TicketDependencyUtil.ts` — `unsettledDependenciesOf` (which of a ticket's dependencies
  are not done or delivered yet), `dependencyLoopFrom` (the circle a new list would close, or
  `null`), `ticketsHoldingBackLowPriorityWork` (the normal and high tickets neither delivered nor
  abandoned) and `readyTicketIdsOf` (the open tickets with every dependency settled, high before
  normal, then lowest id first; low tickets only once nothing holds them back). Shared by
  `ticket depends`, `ticket claim`, `ticket start`'s warnings, `status --json` and the page's
  "waiting on" note.
- `lib/utils/NextLineUtil.ts` — `composeNextLine`, the `Next: …` line from the limit, the agents in
  flight, the free slots and the ready ids: `N of L slots free` or `no slot free (N agents in flight)`, then
  the ready ids as given (at most five, then `and N more`) or `nothing ready`, then the dispatcher's
  advice: `; launch the dispatcher` when it is `finished` and something is ready, `; dispatcher stopped:
  wait for the user's go` whenever it is `stopped`, nothing when it is `running`.
- `lib/utils/ReworkCountUtil.ts` — `readDiff` classifies every changed line of unified diff text as
  code, comment, blank or documentation, reading hunk lengths from each `@@` header so a removed
  `-- x` is content rather than a `---` header. **Each side of a hunk keeps its own comment state** (old:
  context and removed; new: context and added), and a hunk that begins inside a block comment is
  recognised only when a closing delimiter with no opener appears in it — otherwise its lines count as
  code. `addedLinesInOnlyOne` is the interdiff `--rebased-from` counts: per file, the multiset of
  added lines one patch holds and the other does not. Removed lines are left out, because they differ
  whenever main changed a line the branch replaced — the base moving, not rework. An unknown file type
  counts every non-blank line.

## `lib/platform/`

Everything that touches the machine: the filesystem, git, the environment, other processes. Knows
nothing about tasks or tickets — a caller supplies a path.

- `lib/platform/Environment.ts` — the one `process.env` reader; `agentProgressRootOverride()`.
- `lib/platform/OperationRefusal.ts` — the typed refusal library code throws instead of exiting.
  `refused` → exit 1 (the caller can act on it), `unrepaired` → exit 2 (the tool will not repair it).
- `lib/platform/AtomicFile.ts` — `writeFileAtomically`: temp file beside the target, `fsync`, rename.
  Synchronous, symlink- and mode-preserving, and it sweeps no old temporary files.
- `lib/platform/RepositoryRoot.ts` — `discoverRepositoryRoot`: one tracker per repository, shared by
  every worktree, via `git rev-parse --git-common-dir`, with a hand-parsed `.git` fallback and the
  plain directory last.
- `lib/platform/Workspace.ts` — the six paths a tracker owns, the walk up that finds one, and
  `requireWorkspace`, which is the single place the "run `agent-progress init`" refusal is written.
- `lib/platform/Lock.ts` — `withLock`: `openSync(…, 'wx')`, a `{ processId, acquiredAt }` payload, takeover
  of a stale lock by rename so exactly one waiter wins, release in a `finally`.
- `lib/platform/GitIgnore.ts` — `ensureIgnored`: `git check-ignore` decides, so a repository that
  already covers the tracker gets no diff. Written in place, CRLF-aware.
- `lib/platform/ReworkDiffs.ts` — the git half of `agent-progress rework`, as verdicts: the working
  tree's HEAD, the patch of `<since>..HEAD` (refusing a non-ancestor and naming any merge), and the
  branch's net patch against the main line before and after a rebase. Every diff spells out its
  options — prefixes, rename detection, algorithm, 25 lines of context — so a reviewer's git
  configuration cannot change the count.
- `lib/platform/BranchRelease.ts` — the git half of `agent-progress release`, as verdicts: the main
  checkout's current branch, whether a local branch descends from the main line, `merge --ff-only` of
  the checked commit (confirmed by reading HEAD back), and the two cleanups — `worktree remove`,
  never forced, naming the untracked and changed files a refused removal leaves, and `branch -d`.
- `lib/platform/ClaudeInstructions.ts` — `writeManagedBlock`: the block `init` owns inside a
  repository's `CLAUDE.md`. Written in place so a symlinked file stays a symlink; a start marker with
  no end marker is refused and the file is left alone.
- `lib/platform/ClaudeSettings.ts` — `claudeSettingsFilePathFor`, `claudeLocalSettingsFilePathFor`,
  `writeSubagentStopHook` and `refreshSubagentStopHook`: the `SubagentStop` entry `init` and `update`
  merge into a repository's `.claude/settings.local.json`, or keep current in `.claude/settings.json`
  where somebody already shares one. Every other key is kept, an identical command is never added
  twice, a refresh of an entry that already says what it should writes nothing at all, and a document
  that will not parse is refused rather than overwritten. Both file paths are just paths: the writer
  has one code path for the two files. The matcher, the command and the timeout come from the caller.
- `lib/platform/ClaudeTranscripts.ts` — `transcriptFolderFor` and `listSubagentTranscripts`: where the
  harness keeps a repository's transcripts (`<home>/.claude/projects/` plus the repository root's
  absolute path with **every character outside `[a-zA-Z0-9]`** turned into `-` — a dot and a space as
  much as a separator, so `/Users/alex/.claude/x` slugs to `-Users-alex--claude-x` — so every worktree
  resolves to one folder) and every
  subagent file under it: `<session>/subagents/agent-*.jsonl`, and a workflow's agents one level
  deeper at `<session>/subagents/workflows/<run>/agent-*.jsonl`, whose `journal.jsonl` and
  `agent-*.meta.json` neighbours are never read as transcripts. The home directory is `node:os`'s
  `homedir()` as a defaulted parameter, never `HOME`; a missing folder is an empty list, and
  main-session transcripts are left out.

## `lib/progress/`

- `lib/progress/ProgressStore.ts` — `progress.json`: read with a verdict and a reason naming the
  field, written atomically, and the mutators that add, find, transition and remove a task, set its
  token count or add to it (`addTaskTokens`, the hook's, where unset plus an amount is the amount) or
  append a log line. The transition rules — which status sets which timestamp — live
  here and nowhere else, as does the task id allocator: `nextTaskId` is stored, never wound back, and
  taken only by the `addTask` that files the row using it.

  **The concurrency limit is optional on disk.** A progress file without `concurrencyLimit` reads, and
  `concurrencyOf` answers `DEFAULT_CONCURRENCY_LIMIT` (2) for it; a present value that is not a whole
  number of at least 1 makes the file unreadable, while one above `CONCURRENCY_LIMIT_CEILING_AGENTS`
  reads as the ceiling and is never rewritten by a read. **The dispatcher state is optional the same way**:
  `dispatcherStateOf` answers `stopped` for a file without `dispatcherState`, and a present value that
  is not one of `DISPATCHER_STATES` makes the file unreadable. **A slot is an agent**: `concurrencyOf` answers
  `agentsInFlight`, the `running` rows grouped by their optional `agent` key (written by `ticket claim`,
  the claimed ids joined) with each group counted once and each keyless running row counted alone,
  and never answers negative free slots. `transitionTask` drops the key when a row starts running from
  anything but a pause, so a restarted row is an agent of its own until a claim keys it again.

  **A review row's `reviewOf` is optional too**: the padded id of the ticket it reviews, written by
  `task add --review-of`, validated as text when present, and never added by a read — a row filed
  before it existed is nested by its name on the page instead. `runningReviewRowsOf` finds the
  running rows linked to a set of tickets by this field alone, for `release` to deliver; the page's
  name match is a display fallback and never moves a row.

  **A row's `history` is the record of what happened to it.** `transitionTask` files a phase per move
  that really changed the status — `pending` included, so `ticket reopen` is on the record — plus one
  per `re-review` call, because a row stays in `re-review` between rounds and each round is an event of
  its own. `addTask` files the single phase the row begins on, and **the stamp follows the status**: a
  phase that opens the row's interval is stamped at `start`, a terminal one at `end`, and a `pending`
  row at the `filedAt` its caller supplies. That last one is why `filedAt` exists at all — how long a
  row sat in the queue before anybody picked it up is measurable only if the filing is a phase, so
  `task add` and `ensureTaskForTicket` both pass the moment they are filing at. A caller that supplies
  no stamp leaves the row with nothing to record. The field is optional: every row written before it
  existed has none, and `lib/render/page/TaskDetail.ts` says so rather than presenting a derivation as
  the record.

## `lib/tickets/`

Ticket files and the transitions that move their Gantt rows; see `lib/tickets/CLAUDE.md`.

## `lib/render/`

The generated page, pure from data; see `lib/render/CLAUDE.md`.

## `lib/tooling/dev/`

Test-only helpers — scratch directories, scratch git repositories, the spawnable entry point, and
`lib/tooling/dev/CapturedCommandContext.ts`, the `CommandContext` whose two streams are arrays that
every command spec drives `runCommandLine` with. That last one declares the context's shape rather
than importing `cli/CommandContext.ts`, because rule 1 forbids any import of `cli/` from under
`lib/`. Nothing that ships imports this folder, and `lib/ImportDirection.spec.ts` is what keeps that
true.

The dispatcher's harness lives here too, since `templates/workflows/AgentProgressDispatch.js` is plain
JavaScript no spec can sit beside:

- `lib/tooling/dev/DispatchScriptHarness.ts` — `runDispatchScript` compiles the script's body as the
  Workflow tool would and runs it against a fake `agent()` (the kind read from the prompt's token
  marker) and a fake board whose status block, dispatcher state and running rows included, every agent returns. A builder or
  reviewer is on that board only from its first command (`turnsBeforeFirstCommand` turns after the call) until it returns, as a
  real one is from its claim or its `task add --start`. It records each call, the most own agents running at once, the most agents
  in flight at once (others plus every own one, on the board yet or not) and the logs; `Date` and `Math` are handed in guarded.
  `lib/tooling/dev/DispatchScriptHarness.spec.ts` pins each decision **and runs it again against a
  mutant of the script that breaks exactly that decision**, which must fail; a mutant whose text left
  the script fails loudly. `lib/tooling/dev/DispatchScriptHarness.brief.spec.ts` holds the prompts'
  call budgets and rework threshold to the numbers `templates/AgentBrief.md` states.
- `lib/tooling/dev/WorkflowScriptSource.ts` — reads a Workflow script's syntax tree through
  `typescript`: `nondeterministicCallsIn` (`Date.now`, `Math.random`, argless `new Date()`, `Date()`)
  and `metaLiteralVerdictOf` (the first statement is an exported `const meta` of literals alone).
  `lib/tooling/dev/WorkflowScriptSource.spec.ts` constructs each form, plants it in the real script,
  and only then judges the real script clean.

**No spec reaches a tracker it did not create.** `lib/tooling/dev/TrackerIsolation.ts` refuses a
directory outside the scratch root (the OS temporary directory, where every scratch directory is made)
and one from which discovery — walk up, git common directory or `AGENT_PROGRESS_ROOT` — resolves a
tracker outside it. The captured context (which takes `currentDirectory` as required, with no
default), the `cwd` of a hook input piped into it, and `lib/tooling/dev/CliProcess.ts` all check before
a command runs, because a throw inside a command becomes an exit code a spec may not assert.
`lib/tooling/dev/TrackerIsolation.spec.ts` constructs each way out and checks the refusal.
