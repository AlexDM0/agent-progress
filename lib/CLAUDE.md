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
- **A clock decides nothing**, with two stated exceptions, each comparing times the tool itself
  wrote: lock staleness in `lib/platform/Lock.ts` — including its fallback to the lock file's own
  mtime, which fails closed in both directions — and ordering the log for display, which decides
  nothing but a print order. Task timestamps are recorded and displayed, never compared.
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
  `tokens`), `LogEntry`, `ViewRange`, `ProgressFile` (with `nextTaskId`), `TicketFrontmatter`,
  `Ticket`. Types only, no values.
- `lib/constants/Limits.ts` — the tuning constants, each with its unit in its name: lock staleness and
  retries, the axis tick ladder and its bounds, ticket id width, the timestamp slice bounds every
  human-facing reader shares, and the JSON indent.
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

## `lib/progress/`

- `lib/progress/ProgressStore.ts` — `progress.json`: read with a verdict and a reason naming the
  field, written atomically, and the mutators that add, find, transition and remove a task, set its
  token count or append a log line. The transition rules — which status sets which timestamp — live
  here and nowhere else, as does the task id allocator: `nextTaskId` is stored, never wound back, and
  taken only by the `addTask` that files the row using it.

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
