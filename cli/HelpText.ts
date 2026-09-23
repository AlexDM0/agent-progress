/**
 * The whole command reference, which `cli/HelpText.spec.ts` holds against `COMMAND_NAMES` and `skill/SKILL.md`.
 * The layout is load-bearing: an entry begins at column 2 and every continuation line is indented past it.
 */

export function helpText(): string {
  return `agent-progress — tasks, tickets and a Gantt dashboard for one repository

Usage: agent-progress <command> [options]

The tracker lives in \`.agent-progress/\` at the repository root and is shared by every worktree of
it. Every mutating command takes the lock, writes the progress file atomically and regenerates
\`progress.html\`, which reloads itself every 5 minutes. \`<when>\` is an ISO 8601 timestamp, \`now\`,
or an offset from now: \`-5m\`, \`-2h\`, \`-1d\`, \`+30m\`. \`<n>\` on --tokens is a whole number or a
decimal with a \`k\`/\`m\` suffix: \`12000\`, \`12k\`, \`12.3k\`, \`1.2m\`.

\`--help\` works after a command word as well as on its own, and AGENT_PROGRESS_ROOT names the
repository to use instead of walking up from the current directory.

\`status\`, \`ticket add\` and every ticket or task move end their output with one line read from the
board after the change: \`Next: 1 of 2 slots free; ready: #003, #005\`, \`Next: no slot free (2
running); ready: #003\` or \`Next: 2 of 2 slots free; nothing ready\` — at most five ready ids, then
\`and N more\`. --json output never carries it.

  init                        Create the tracker here: \`.agent-progress/\` with an empty progress
      [--project <name>]      file, a \`tickets/\` folder and \`agent-brief.md\` — the brief to fill in
      [--root <path>]         before spawning an implementing agent — a \`.gitignore\` entry for it,
      [--no-claude-md]        a managed block in the repository's CLAUDE.md telling an agent to track
      [--no-hooks]            its work through this tool, and the SubagentStop hook below. Refused
                              when an ancestor already holds a tracker, when --root is not an
                              existing directory, and inside a bare repository, which has no working
                              tree to track. Re-running only refreshes what \`update\` refreshes, and
                              \`update\` is the command to reach for there. --project names the
                              project shown on the page, --root tracks that directory instead of the
                              discovered repository root, --no-claude-md leaves CLAUDE.md alone, and
                              --no-hooks writes no hook. --hooks is still accepted and does nothing:
                              the hook it used to ask for is now written by default.

  update                      Refresh what the tool wrote into a repository it already tracks: the
      [--no-claude-md]        managed CLAUDE.md block, \`agent-brief.md\` — guidance shipped with the
      [--no-hooks]            tool rather than a file a project edits — and the SubagentStop hook. It
                              creates no tracker and touches neither the progress file, the tickets
                              nor the log, so it takes no --project and no --root, and it is refused
                              with exit 1 where there is none — \`agent-progress init\` makes one.
                              Each line says whether that file changed, so a session that read the
                              brief at its start learns that its copy is now stale. It takes the same
                              --no-claude-md, --no-hooks and no-op --hooks as \`init\`.

  status [--json] [--full]    The project, the counts, the rows that are not delivered or
                              abandoned, and the last log entries newest first. --json prints the
                              same working view for an agent: the unsettled rows and tickets, the
                              last 10 log entries and counts of what was left out. --full lists
                              everything, and with --json prints the whole progress file plus
                              every ticket's frontmatter. Both --json documents carry
                              \`concurrency\`: the limit, the rows in flight, the free slots and
                              the ids of the ready tickets — open, every dependency settled —
                              high priority first, then normal, each lowest id first. A low ticket
                              is ready only once no normal or high ticket is left that is not
                              delivered or abandoned.

  task add "<name>"           Add a Gantt row. --start marks it running at --at (default now),
      [--owner <who>]         --ticket links it to a ticket that has no row of its own, --note is
      [--note <text>]         the detail shown beside the bar, and --tokens records what the work
      [--ticket <id>]         cost. --force moves --ticket's link off the row that holds it.
      [--start] [--tokens <n>]
      [--at <when>] [--force]

  task start|pause|finish|review|rereview|deliver <id> [--owner <who>] [--note <text>]
      [--tokens <n>] [--at <when>] [--force]
                              Move one row and stamp it: \`start\` sets its start and resumes a
                              paused row, \`pause\` records that the work is waiting without closing
                              the bar, \`finish\` and \`review\` set its end, \`rereview\` sends a row
                              whose review found too much into its next review pass — round 2, then
                              3 — without reopening the bar, and \`deliver\` records that the work
                              reached its destination. A stamp already recorded is kept, so --at
                              backfills a row nobody registered at the time. A row a ticket owns is
                              refused, naming the \`ticket\` verb that moves both; --force moves only
                              the row.

  task update <id>            Change a row without moving its clock: --name, --owner, --note,
      [--name <text>]         --tokens, or --status for a correction the transitions cannot
      [--owner <who>]         express. At least one of them is required, and --status on a row a
      [--note <text>]         ticket owns is refused unless --force.
      [--status <status>]
      [--tokens <n>] [--force]

  task remove <id>            Delete a row. A ticket pointing at it is unlinked rather than
                              deleted. The id is never given to another row.

  log "<text>" [--at <when>]  Append one line to the log shown under the chart. --at backfills it.

  hook subagent-stop          Record what a finished subagent cost, as one log line: the hook JSON
                              arrives on standard input, and the agent's transcript is summed per
                              API call rather than per line. When the agent's first message — its
                              brief — holds a line \`agent-progress row: <id>\`, or several ids
                              separated by commas, the log line's \`input\` total is also added to
                              those rows' tokens, divided evenly. This is the command \`init\` and
                              \`update\` wire into \`.claude/settings.local.json\`; nobody types it.
                              It exits 0 whatever goes wrong — no input, an unreadable transcript,
                              no tracker at the hook's own working directory, a row that does not
                              exist — and writes the reason to standard error. Its exit code
                              prevents nothing, since the agent has already finished; exiting 0 is
                              what keeps a failure here from becoming an error the orchestrator must
                              read, or a delay before it is told.

  usage [--since <when>]      What this repository's subagents cost, read out of the transcripts the
      [--transcripts <folder>] harness wrote for them, a workflow's agents under
      [--json]                \`subagents/workflows/<run>/\` included: one row per agent, oldest
                              first, with its start, its API calls, its end context, its input and
                              output, its browser calls, the characters the harness injected into
                              it and the first line of its brief; then the cohort summary — median
                              calls and end context, mean input and output, and the mean of each
                              figure below. Three of the columns are there to catch a brief being
                              breached: "over 200k" is the share of an agent's input that was sent
                              at a context past 200,000 tokens, "bash edits" counts the edits it
                              made through a shell command instead of the editing tools, and
                              "checks" counts the full test, type-check and lint runs it made per
                              edit instead of per batch. --since splits the cohort on an
                              instant and summarises both sides, which is how a change in the way
                              agents are briefed is measured. --transcripts reads a folder other
                              than the one this repository's path resolves to. It writes nothing,
                              takes no lock and regenerates no page, and a repository with no
                              transcripts is one sentence at exit 0.

  rework [--since <commit>]   How many lines of code a review reworked on a branch: added plus
      [--rebased-from <old tip>] removed lines, never blank lines, comments or documentation (*.md,
      [--main <branch>]       *.mdx, *.rst, *.txt and anything under the repository's docs/). It
      [--worktree <path>]     counts; no threshold is built in. --since counts every commit in
      [--files] [--json]      <commit>..HEAD, and is refused when <commit> is not an ancestor of HEAD
                              or a merge lies in between: work is rebased, not merged. --rebased-from
                              counts what a rebase changed in the branch's own work — the hand
                              resolution — as the added lines in which the branch's patch against
                              --main (default \`main\`) differs before and after, so a line resolved
                              by hand counts 2 and main's own change none; a rebase without
                              conflicts counts 0. It is measured up to HEAD, so run it right after the rebase.
                              A rebase rewrites the commits after <commit>, so either count --since
                              before rebasing and --rebased-from ORIG_HEAD after it, or rebase first
                              and take <commit> from the rebased tip: both in one call then measure
                              the rebase up to <commit> and print one total and the two parts,
                              counting nothing twice. Comments are read per file
                              type (// and /* */, #, <!-- -->, docstrings, a <script> or <style> in
                              HTML); a line of code with a trailing comment is code, and a file type
                              it does not know counts every non-blank line. --worktree names the
                              working tree to read instead of the current directory; --files adds
                              the per-file breakdown. It needs no tracker and writes nothing.

  release <id> --branch <b>   Release a reviewed branch: fast-forward the main checkout — the
      [--worktree <path>]     tracker's root, wherever this runs from — to <b>, then move the
      [--main <line>]         ticket done and deliver it with --branch <b> and --commit set to the
      [--json]                merged tip. More ids after <id> release every ticket of a bundle,
                              which share <b>. All of it happens in one lock hold, so two releases
                              never race. Refused at exit 1, with nothing changed, when a ticket
                              is not in-progress or in-review, when the main checkout is not on
                              --main (default \`main\`), when <b> is not a local branch, when <b>
                              does not descend from --main — reason \`main-moved\`: rebase <b> onto
                              it, re-run the checks and release again — and when git will not
                              fast-forward. Afterwards \`git worktree remove\` on --worktree, never
                              forced, and \`git branch -d <b>\`; what git declines is named with
                              its reason, the files a worktree still holds among it, at exit 0.
                              --json prints {released, reason?, commit?, cleanup}; reason is one
                              of invalid-request, unknown-ticket, ticket-not-releasable,
                              unknown-branch, not-on-main-line, main-moved, merge-refused,
                              git-failed and tracker-failed. Allowing this command is the release
                              permission: a reviewer never runs \`git merge\` itself.

  ticket add "<title>"        File a ticket: a markdown file under \`.agent-progress/tickets/\` with
      [--type bug|change|feature]
      [--priority low|normal|high]
      [--group <name>]        its own frontmatter, plus a pending Gantt row. The body comes from
      [--depends-on <ids>]    the template, from --body, or from --body-file (\`-\` reads standard
      [--body <markdown>]     input); an empty body falls back to the template, and afterwards the
      [--body-file <path|->]  body is preserved byte for byte, so an agent may edit everything
      [--at <when>]           below the frontmatter freely. --depends-on files it already waiting
                              on other tickets (\`3,4\`), as \`ticket depends\` does. --priority
                              defaults to normal; a low ticket is filed with no row and takes no
                              task id until it is started.

  ticket list [--status <s>]  The tickets with their status, priority, type and row id. --status
      [--priority <p>]        and --priority narrow the listing. --json carries no bodies; use
      [--json]                \`ticket show\` for one ticket's prose.

  ticket show <id> [--json]   One ticket: its frontmatter, its priority, its body, and always its
                              file path — which is what an agent needs in order to edit that body.

  ticket priority <id> low|normal|high [--at <when>]
                              Change a ticket's priority, with one log line. Lowering to low is
                              refused unless the ticket is open, and removes its row; raising a
                              low ticket that has no row gives it one at once. A low ticket gets
                              its row when \`ticket start\` or \`ticket claim\` starts it, and keeps
                              it; abandoning a low ticket that has none creates none.

  ticket start|review|done|deliver|abandon|reopen <id> [--branch <b>] [--commit <sha>]
      [--reason <text>] [--tokens <n>] [--at <when>]
                              Move a ticket and its Gantt row together, stamping both. Each verb
                              moves a ticket that is in a status it makes sense from: start from
                              open or in-review, review from in-progress, done from in-progress or
                              in-review, deliver from done, abandon from anything not already
                              delivered or abandoned, reopen from anything but open. Moving a
                              ticket to the status it already has is refused and logs nothing —
                              \`ticket rereview\` below is the one exception.
                              \`abandon\` requires --reason; \`reopen\` clears the stamps and returns
                              the row to pending. --branch and --commit record where the work
                              landed, and --tokens what it cost.

  ticket claim <id>           \`ticket start\` and the row's --owner and --note in one write, refused
      [--owner <who>]         at exit 1 with nothing written when the ticket is not open or
      [--note <text>]         in-review, when a ticket it waits on is not done or delivered, or when
      [--at <when>]           the running rows already number the concurrency limit, or when the
                              ticket is low and a normal or high ticket is not yet delivered or
                              abandoned — \`ticket start\` only warns about that. The count and
                              the move share one lock hold, so two claims racing for the last slot
                              cannot both succeed. The first command an implementing agent runs.

  ticket rereview <id>        Send a ticket already in review round again, for a fresh reviewer: the
      [--at <when>]           ticket stays in-review and only its \`updated\` moves, while its row
                              goes one review round up, from 2, and the log says which round it is.
                              It is the one verb that may be run on the status the ticket already
                              has, and it is refused from every other status. It takes no --tokens:
                              the row's figure is the builder's, and a review pass has its own row.

  ticket status <id> <status> The same move, naming the target status directly: open, in-progress,
                              in-review, done, delivered or abandoned. It takes the same options
                              and is the documented way to make a move the verbs above refuse.

  ticket link <ticketId> <taskId> [--force]
                              Point a ticket at an existing row instead of the one it filed.
                              Refused when that row already belongs to another ticket, unless
                              --force, which unlinks it there first.

  ticket depends <id> [<id>...]
                              Set the tickets this one waits on, replacing its list; no ids clears
                              it. Refused for a ticket that does not exist and for a list that
                              would make tickets wait on each other in a circle. Until every one
                              of them is done or delivered, the ticket's row, table entry and card
                              read "waiting on #003", \`ticket list\` says so too, and \`ticket start\`
                              warns on standard error but still moves it.

  concurrency [<n>] [--json]  Print the concurrency limit: how many rows may be running at once,
                              a ticket's and a free-standing review bar's alike. With <n>, store a
                              new one (a whole number, 1 or more) for every worktree. A tracker that
                              never set one reads 2; a limit below the rows already running is
                              accepted and simply leaves no free slot. \`status --json\` carries it
                              beside the rows in flight, the free slots and the ready tickets.

  range --from <when>         The stored default axis of the chart. A relative bound is stored as
        --to <when>           written, so \`--from -2h\` keeps meaning "the last two hours" on every
        [--tick <15m|1h|1d>]  refresh. The page's own range bar overrides this per browser.
  range --auto                Reset the axis to the automatic span.

  render                      Regenerate \`progress.html\` from the progress file and the tickets,
                              changing nothing else. For a page lost to a crash, or after a ticket
                              body was edited by hand.

  open                        Open \`progress.html\` in the default browser.

  clear [--all] [--yes]       Throw away every task row and the log and restart the clock, keeping
                              the tickets: each surviving ticket is given a fresh row seeded from
                              its own frontmatter, except a low one with no row. Row ids are not reused. --all deletes the
                              tickets too and restarts their ids at 001. --yes skips the
                              confirmation, and is required when standard input is not a terminal.

  help                        This command reference.
`;
}
