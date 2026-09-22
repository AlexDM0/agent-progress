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
- `lib/DocumentedPaths.spec.ts` — every backticked repository path in a `*.md` or a docblock exists.
  A module that no longer exists is named **without** its extension, deliberately.

## `lib/constants/`

Imports nothing; safe to compile alongside the browser page, which is why no value here may touch Bun
or Node.

- `lib/constants/Types.ts` — every shape the tracker stores or renders: `Task` (with its nullable
  `tokens` and its optional `history`), `TaskPhase`, `LogEntry`, `ViewRange`, `ProgressFile` (with
  `nextTaskId`), `TicketFrontmatter`, `Ticket`. Types only, no values.
- `lib/constants/Limits.ts` — the tuning constants, each with its unit in its name: lock staleness and
  retries, the axis tick ladder and its bounds, ticket id width, how long done work stays visible,
  the timestamp slice bounds every human-facing reader shares, the JSON indent, and
  `OVERSIZED_CONTEXT_THRESHOLD_TOKENS`, the context above which an API call is counted as oversized.
- `lib/constants/Statuses.ts` — the task and ticket status tuples and the ticket type tuple with their
  guards, the ticket-status → task-status table, and the on-disk names (`progress.json`,
  `progress.html`, `.agent-progress`, `tickets`, `.lock`) and the two managed-block markers.

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
  `TranscriptProfile` type `agent-progress usage` reports one agent by.
- `lib/utils/TranscriptCohortUtil.ts` — `summariseCohort` and `splitAt` over those profiles.
  **Calls and end context are medians, the token figures means**: one runaway agent must not move
  what a typical agent did, and must not be hidden in what the cohort cost. The oversized share is the
  mean of each agent's share of its own input, not of the cohort's pooled tokens. An empty cohort answers
  zero of everything, and a profile with no readable stamp falls on the `before` side of a split.
- `lib/utils/TicketDependencyUtil.ts` — `unsettledDependenciesOf` (which of a ticket's dependencies
  are not done or delivered yet) and `dependencyLoopFrom` (the circle a new list would close, or
  `null`). Shared by `ticket depends` and the page's "waiting on" note.

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
  subagent file under it. The home directory is `node:os`'s `homedir()` as a defaulted parameter,
  never `HOME`; a missing folder is an empty list, and main-session transcripts are left out.

## `lib/progress/`

- `lib/progress/ProgressStore.ts` — `progress.json`: read with a verdict and a reason naming the
  field, written atomically, and the mutators that add, find, transition and remove a task, set its
  token count or append a log line. The transition rules — which status sets which timestamp — live
  here and nowhere else, as does the task id allocator: `nextTaskId` is stored, never wound back, and
  taken only by the `addTask` that files the row using it.

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
