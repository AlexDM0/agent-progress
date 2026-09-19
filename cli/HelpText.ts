/**
 * The whole command reference, which `cli/HelpText.spec.ts` holds against `COMMAND_NAMES` and `skill/SKILL.md`.
 * The layout is load-bearing: an entry begins at column 2 and every continuation line is indented past it.
 */

export function helpText(): string {
  return `agent-progress — tasks, tickets and a Gantt dashboard for one repository

Usage: agent-progress <command> [options]

The tracker lives in \`.agent-progress/\` at the repository root and is shared by every worktree of
it. Every mutating command takes the lock, writes the progress file atomically and regenerates
\`progress.html\`, which reloads itself every 30 seconds. \`<when>\` is an ISO 8601 timestamp, \`now\`,
or an offset from now: \`-5m\`, \`-2h\`, \`-1d\`, \`+30m\`. \`<n>\` on --tokens is a whole number or a
decimal with a \`k\`/\`m\` suffix: \`12000\`, \`12k\`, \`12.3k\`, \`1.2m\`.

\`--help\` works after a command word as well as on its own, and AGENT_PROGRESS_ROOT names the
repository to use instead of walking up from the current directory.

  init                        Create the tracker here: \`.agent-progress/\` with an empty progress
      [--project <name>]      file and a \`tickets/\` folder, a \`.gitignore\` entry for it, and a
      [--root <path>]         managed block in the repository's CLAUDE.md telling an agent to track
      [--no-claude-md]        its work through this tool. Refused when an ancestor already holds a
                              tracker, when --root is not an existing directory, and inside a bare
                              repository, which has no working tree to track. Re-running only
                              refreshes the managed block. --project names the project shown on the
                              page, --root tracks that directory instead of the discovered
                              repository root, and --no-claude-md leaves CLAUDE.md alone.

  status [--json] [--full]    The project, the counts, the rows that are not delivered or
                              abandoned, and the last log entries newest first. --json prints the
                              same working view for an agent: the unsettled rows and tickets, the
                              last 10 log entries and counts of what was left out. --full lists
                              everything, and with --json prints the whole progress file plus
                              every ticket's frontmatter.

  task add "<name>"           Add a Gantt row. --start marks it running at --at (default now),
      [--owner <who>]         --ticket links it to a ticket that has no row of its own, --note is
      [--note <text>]         the detail shown beside the bar, and --tokens records what the work
      [--ticket <id>]         cost. --force moves --ticket's link off the row that holds it.
      [--start] [--tokens <n>]
      [--at <when>] [--force]

  task start|pause|finish|review|deliver <id> [--owner <who>] [--note <text>] [--tokens <n>]
      [--at <when>] [--force]
                              Move one row and stamp it: \`start\` sets its start and resumes a
                              paused row, \`pause\` records that the work is waiting without closing
                              the bar, \`finish\` and \`review\` set its end, \`deliver\` records that
                              the work reached its destination. A stamp already recorded is kept,
                              so --at backfills a row nobody registered at the time. A row a ticket
                              owns is refused, naming the \`ticket\` verb that moves both; --force
                              moves only the row.

  task update <id>            Change a row without moving its clock: --name, --owner, --note,
      [--name <text>]         --tokens, or --status for a correction the transitions cannot
      [--owner <who>]         express. At least one of them is required, and --status on a row a
      [--note <text>]         ticket owns is refused unless --force.
      [--status <status>]
      [--tokens <n>] [--force]

  task remove <id>            Delete a row. A ticket pointing at it is unlinked rather than
                              deleted. The id is never given to another row.

  log "<text>" [--at <when>]  Append one line to the log shown under the chart. --at backfills it.

  ticket add "<title>"        File a ticket: a markdown file under \`.agent-progress/tickets/\` with
      [--type bug|change|feature]
      [--group <name>]        its own frontmatter, plus a pending Gantt row. The body comes from
      [--depends-on <ids>]    the template, from --body, or from --body-file (\`-\` reads standard
      [--body <markdown>]     input); an empty body falls back to the template, and afterwards the
      [--body-file <path|->]  body is preserved byte for byte, so an agent may edit everything
      [--at <when>]           below the frontmatter freely. --depends-on files it already waiting
                              on other tickets (\`3,4\`), as \`ticket depends\` does.

  ticket list [--status <s>]  The tickets with their type, status, group and row id. --status
      [--json]                narrows the listing to one status. --json carries no bodies; use
                              \`ticket show\` for one ticket's prose.

  ticket show <id> [--json]   One ticket: its frontmatter, its body, and always its file path —
                              which is what an agent needs in order to edit that body.

  ticket start|review|done|deliver|abandon|reopen <id> [--branch <b>] [--commit <sha>]
      [--reason <text>] [--tokens <n>] [--at <when>]
                              Move a ticket and its Gantt row together, stamping both. Each verb
                              moves a ticket that is in a status it makes sense from: start from
                              open or in-review, review from in-progress, done from in-progress or
                              in-review, deliver from done, abandon from anything not already
                              delivered or abandoned, reopen from anything but open. Moving a
                              ticket to the status it already has is refused and logs nothing.
                              \`abandon\` requires --reason; \`reopen\` clears the stamps and returns
                              the row to pending. --branch and --commit record where the work
                              landed, and --tokens what it cost.

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
                              its own frontmatter. Row ids are not reused. --all deletes the
                              tickets too and restarts their ids at 001. --yes skips the
                              confirmation, and is required when standard input is not a terminal.

  help                        This command reference.
`;
}
