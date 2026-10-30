/**
 * The whole command reference, which `cli/HelpText.spec.ts` holds against `COMMAND_NAMES` and the skills under `skills/`.
 * The layout is load-bearing: an entry begins at column 2 and every continuation line is indented past it.
 */
import { ROOT_OVERRIDE_VARIABLE } from '../src/shared/Environment.ts';
import { PRODUCT_NAMES }          from '../src/shared/constants/ProductNames.ts';

export function helpText(): string {
  return `${PRODUCT_NAMES.PROGRAM} — tasks, tickets and a Gantt dashboard for one repository

Usage: ${PRODUCT_NAMES.PROGRAM} <command> [options]

The tracker lives in \`${PRODUCT_NAMES.DATA_FOLDER}/\` at the repository root and is shared by every worktree of
it. Every mutating command takes the lock and writes the progress file atomically; the live
Overseer serves the board, and \`open\` opens it. \`<when>\` is an ISO 8601 timestamp, \`now\`,
or an offset from now: \`-5m\`, \`-2h\`, \`-1d\`, \`+30m\`. \`<n>\` on --tokens is a whole number or a
decimal with a \`k\`/\`m\`/\`b\` suffix: \`12000\`, \`12k\`, \`12.3k\`, \`1.2m\`, \`1.20b\`.

\`--help\` works after a command word as well as on its own, and \`-h\` on its own or straight after
the command word; a \`-h\` further on is refused at exit 1, since it may be text (put text behind a
bare \`--\`). An option taking a value, given twice, is refused at exit 1.
${ROOT_OVERRIDE_VARIABLE} names the repository to use instead of walking up from the current directory. --json, accepted by every
command but init, update, open, hook and help, prints one JSON document on standard output
in place of the human output.

\`status\`, \`ticket add\`, every ticket or task move (\`task add --start\` among them), \`ticket
depends\`, \`priority\`, \`agent\`, \`hold\` and \`unhold\` end their
output with one line read from the board after the change: \`Next: 1 of 2 slots free; ready: #003, #005\`, \`Next: no slot
free (2 agents in flight); ready: #003\` or \`Next: 2 of 2 slots free; nothing ready\` — at most five
ready ids, then \`and N more\`; a held ready ticket is left out and named apart, \`; held: #002\` —
followed by the dispatcher's advice where it has any: \`; launch the
dispatcher\` or \`; dispatcher stopped: wait for the user's go\`. While the dispatcher is \`running\`,
\`ticket add\`, \`priority\`, \`agent\`, \`depends\`, \`hold\`, \`unhold\`, \`reopen\` and \`status <id> pending\` add
one more line after it: the run
picks the change up at its next agent's return and is never stopped or relaunched for it. --json
output never carries either.

  init                        Create the tracker here: \`${PRODUCT_NAMES.DATA_FOLDER}/\` with an empty progress
      [--project <name>]      file and log and a \`tickets/\` folder, and \`.gitignore\` entries for it
      [--root <path>]         and for \`${PRODUCT_NAMES.WORKTREES_FOLDER}/\`, before any worktree can exist. Beside the
      [--no-hooks]            tracker go \`session-instructions.md\` (written first, its presence marking
                              the install), \`reference.md\` (the ticket format, the moves and the exit
                              codes) and \`assistant-brief.md\`, the role prompt the runner fills for
                              its Assistant; the SessionStart hook \`hook session-start\` goes into
                              \`.claude/settings.local.json\`, and two skills into \`.claude/skills/\`:
                              ${PRODUCT_NAMES.PRODUCT_OWNER_SKILL}, which a session asked to file a ticket loads, and
                              ${PRODUCT_NAMES.ORCHESTRATE_SKILL}, for the session running the board, which loads
                              ${PRODUCT_NAMES.PRODUCT_OWNER_SKILL} for intake. It never writes CLAUDE.md. Refused when an
                              ancestor already holds a tracker, when --root is not an existing
                              directory, and inside a bare repository, which has no working tree to
                              track. Re-running only refreshes what \`update\` refreshes, and
                              \`update\` is the command to reach for there. --project names the project shown
                              on the page, --root tracks that directory instead of the discovered
                              repository root, and --no-hooks touches no settings file.

  update [--no-hooks]         Refresh what the tool wrote into a repository it already tracks: the
                              three files beside the tracker, guidance shipped with the tool rather
                              than files a project edits, the SessionStart hook, the two skills and
                              the worktrees folder's \`.gitignore\` entry, removing what an earlier
                              version installed in a skill folder this one retired. It removes,
                              once, what install version 16 wrote: the managed CLAUDE.md block,
                              reported "removed; commit CLAUDE.md" since the runner launches
                              nothing onto a branch whose committed CLAUDE.md still holds it, the
                              SubagentStop, PreToolUse and PostToolUse hook entries (unless
                              --no-hooks), the worker agent definition, the dispatcher script and the
                              three briefs. The tracker itself is left alone: a tracker an earlier
                              ${PRODUCT_NAMES.PROGRAM} wrote in a format this one no longer reads is refused at
                              exit 2 by every command that reads it, saying to run \`update\` with a
                              release that still reads it. It creates no tracker, so it takes no
                              --project and no --root, and it is refused with exit 1 where there
                              is none — \`${PRODUCT_NAMES.PROGRAM} init\` makes one.
                              Each line says whether that file changed, so a session that read the
                              instructions at its start learns that its copy is now stale.
                              Every command but init, update, help and status refuses, with exit
                              1, while the files installed here are of another install version
                              than this ${PRODUCT_NAMES.PROGRAM} (the SessionStart hook prints its
                              instructions regardless);
                              update rewrites them, and it and \`init\` refuse files a newer
                              ${PRODUCT_NAMES.PROGRAM} installed.

  status [--json] [--full]    The project, the counts, the rows that are not delivered or
                              abandoned, and the last five log entries newest first. --json prints the
                              same working view for an agent: the unsettled rows and tickets, the
                              last 10 log entries and counts of what was left out. --full lists
                              everything, and with --json prints the whole progress file plus
                              every ticket's frontmatter. Both --json documents carry
                              \`concurrency\`: the limit, the agents in flight, the free slots and
                              the ids of the ready tickets — pending, every dependency settled —
                              high priority first, then normal, each lowest id first. A low ticket
                              is ready only once no normal or high ticket is left that is not
                              delivered or abandoned. Beside it, \`readyTickets\` lists the same
                              tickets in the same order as {id, priority, model, effort}, the
                              defaults resolved, plus an optional group and held: true on a held
                              one, so a dispatcher derives none of them itself.
                              Both carry \`epics\`, every epic with its roll-up as \`epic list
                              --json\` prints it, and each ticket's \`epics\`, empty when it has none.
      [--tickets-only]        --tickets-only leaves out the free-standing task rows, those that are
                              no ticket's own row and no review bar; tickets and the log stay.
                              The token total is also given per owner, grouped case-insensitively
                              on the trimmed owner under its most common spelling, rows without an
                              owner apart; --json carries it as \`tokensByOwner\`, and then
                              \`ticketCountByStatus\`, every ticket counted per status.

  task add "<name>"           Add a Gantt row. --start marks it in-progress at --at (default
      [--owner <who>]         now), --ticket links it to a ticket that has no row of its own, --note
      [--note <text>]         is the detail shown beside the bar, and --tokens records what the work
      [--ticket <id>]         cost. --force moves --ticket's link off the row that holds it.
      [--review-of <id>]      --review-of marks the row as a review pass of that ticket: the page
      [--start]               draws it directly above the ticket's own row, latest round first. A
      [--tokens <n>]          ticket that does not exist is refused at exit 1.
      [--at <when>] [--force]

  task start|pause|finish|approve|rereview|deliver <id> [--owner <who>] [--note <text>]
      [--tokens <n>] [--at <when>] [--force]
                              Move one row and stamp it: \`start\` sets its start and resumes a
                              paused row, \`pause\` records that the work is waiting without closing
                              the bar, \`finish\` and \`approve\` set its end, \`rereview\` sends a row
                              whose review found too much into its next review pass — round 2, then
                              3 — without reopening the bar, and \`deliver\` records that the work
                              reached its destination. A stamp already recorded is kept, so --at
                              backfills a row nobody registered at the time. A row a ticket owns is
                              refused, except a pause and its resume, naming the \`ticket\` verb that
                              moves both; --force moves only the row.

  task update <id>            Change a row without moving its clock: --name, --owner, --note,
      [--name <text>]         --tokens, or --status for a correction the transitions cannot
      [--owner <who>]         express. At least one of them is required, and --status on a row a
      [--note <text>]         ticket owns is refused unless --force, except a pause and its resume.
      [--status <status>]
      [--tokens <n>] [--force]

  task remove <id>            Delete a row. A ticket pointing at it is unlinked rather than
                              deleted. The id is never given to another row.

  log "<text>" [--at <when>]  Append one line to the log. --at backfills it.

  hook session-start          Print \`session-instructions.md\` for the session Claude Code is
                              starting: \`init\` and \`update\` wire it as the SessionStart hook in
                              \`.claude/settings.local.json\`, which a job's sessions never load. It
                              prints nothing under a job, skips the install version check, and
                              exits 0 whatever happens, printing nothing on failure.

  hook bash-domains           Keep a job's network inside its ticket's \`network\` line: the
      --allow <domains>       PreToolUse guard a runner renders into a job's settings. It denies,
                              through the hook's JSON on standard output, a Bash call whose
                              \`allowed_domains\`, or a WebFetch whose URL host, names a domain
                              outside the comma-separated list (\`*.example.com\` admits its
                              subdomains). Any other call passes silently and is granted nothing.
                              It skips the install-version check, runs under a job, and exits 0
                              whatever happens, answering deny on any failure.

  usage [--since <when>]      What this repository's subagents cost, read out of the transcripts the
      [--transcripts <folder>]
      [--json]                harness wrote for them, a workflow's agents under
                              \`subagents/workflows/<run>/\` included: one row per agent, oldest
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

  review-stats [--json]       What the recorded reviews catch, miss and cost: every ticket with a
                              review-recorded line, summed over all of them and split by ticket
                              type, by the builder's change size (insertions plus deletions its
                              first recorded pass measured: up to 50, 200, 750, or above) and by
                              its resolved model and effort. Per group: tickets, passes, rounds per
                              ticket, verdicts, findings by class and severity, serious findings
                              (would-ship-a-bug or acceptance-fails) per ticket, review and builder
                              tokens per ticket, review tokens per serious finding, escaped bugs
                              (bugs whose introducedBy names the ticket) per delivered ticket split
                              by whether its last pass had a serious finding, tickets filed from
                              its reviews (foundInReview), the share of claims contradicting the
                              Handoff, and fix and rebase lines per ticket; docs/cli.md defines
                              each. Tickets with no recorded review are counted on one line. It
                              takes no lock and writes and renders nothing, as \`status\` does.

  ticket add "<title>"        File a ticket: a markdown file under \`${PRODUCT_NAMES.DATA_FOLDER}/tickets/\` with
      --type ticket|bug|research
      [--priority low|normal|high]
      [--size XS|S|M|L|XL|XXL]
      [--model <m>]
      [--effort <e>]
      [--group <name>]        its own frontmatter, as a draft ticket with no Gantt row until
                              \`ticket ready\` readies it. The body comes from
      [--depends-on <ids>]    the template, from --body, or from --body-file (\`-\` reads standard
      [--epic <keys>]         input); an empty body falls back to the template, and afterwards the
      [--network <domains>]
      [--introduced-by <id>]  body is preserved byte for byte, so an agent may edit everything
      [--found-in-review <id>]
      [--body <markdown>]     below the frontmatter freely. --depends-on files it already waiting
      [--body-file <path|->]  on other tickets (\`3,4\`), as \`ticket depends\` does; --epic files it
      [--at <when>]           in existing epics (\`checkout-redesign,loyalty-programme\`, the first
      [--needs-user]          its primary one), as \`ticket epic\` does. --introduced-by names the
                              delivered ticket whose change introduced a bug, as
                              \`ticket introduced-by\` does; --found-in-review names the ticket
                              whose review found this one, a ticket that must exist. --network
                              sets its network line, as \`ticket network\` does. --needs-user
                              routes a worker's relayed low finding to User; it is refused
                              anywhere but under a job. --priority
                              defaults to normal and only orders the ready tickets, low last.
                              --model (haiku, sonnet, opus, fable)
                              and --effort (low, medium, high, xhigh, max) name what the agents
                              building and reviewing it run on; left off, they are opus and
                              medium. --size, in capitals, is the expected change in code lines
                              (XS ≤ 20, S ≤ 100, M ≤ 300, L ≤ 750, XL ≤ 1500, XXL beyond); left
                              off, the ticket has no size. Anything else is refused at exit 1, and
                              so are --body and --body-file together.

  ticket list [--status <s>]  The tickets with their status, priority, type and row id, and the
                              model and effort after the title where the ticket names them. --status
      [--priority <p>]        and --priority narrow the listing. --json carries no bodies; use
      [--json]                \`ticket show\` for one ticket's prose.

  ticket show <id> [--json]   One ticket: its frontmatter, its priority, its model and effort
                              where it names them, its body, and always its file path — which is
                              what an agent needs in order to edit that body.

  ticket edit <id>            Rename a ticket with --title, replace its body with --body or
      [--title "<title>"]     --body-file (\`-\` reads standard input), or with --append add to its
      [--append]              end, putting one line ending before the text when the body does not
      [--body <markdown>]     end in one; a title and a body change go in one write. The text is
      [--body-file <path|->]  written in the line ending the body already uses. A new title
      [--force]               rewrites the title line, the ticket's own row name and a body
      [--at <when>] [--json]  heading still reading as generated, never the file name or a review
                              row, and is logged; a body change is not. Every other frontmatter
                              byte is kept and \`updated\` is not stamped. Nothing to change writes
                              nothing and exits 0; an empty replacement or title, none of --title,
                              --body and --body-file, or both body options are refused at exit 1.
                              Only a pending ticket is edited: past it, the edit is refused at
                              exit 1 unless --force, and a forced body change is logged and shows
                              in \`ticket show\` as the body changed since the claim.

  ticket agent <id> [--model <m>] [--effort <e>] [--at <when>]
                              Change the model or the effort a ticket's agents run on, or both,
                              with one log line. Refused at exit 1 on a delivered or abandoned
                              ticket, with neither option, with a value outside the lists under
                              \`ticket add\`, and when nothing would change.

  ticket hold <id> [--reason <text>] [--at <when>]
                              Pause a ticket between steps without stopping the run: the
                              runner starts no builder or reviewer for it while it is held, and
                              a claim refuses it. One log line; \`status --json\` lists it in
                              \`heldTicketIds\`. An agent already running is never interrupted, so
                              a hold set after a builder's final status read is too late for the
                              reviewer it starts. Refused at exit 1 on a delivered or abandoned
                              ticket and on one already held.

  ticket unhold <id> [--at <when>]
                              Lift the hold, with one log line: the step it held starts at the
                              dispatcher's next board read. On a ticket in progress whose row is
                              paused, a last line says how the build resumes: by a dispatcher run
                              under a dispatcher claim note, by \`task start <row>\` under any
                              other. Refused at exit 1 on a delivered or abandoned ticket and on
                              one not held.

  ticket release-of <id> [--clear] [--at <when>]
                              Mark a ticket as its group's release ticket: the group's release is
                              that ticket plus every ticket of the group it depends on, directly or
                              not. Stored as \`releasesGroup: true\`; --clear removes it. One log
                              line. Refused at exit 1 on a ticket with no group, when the group
                              already has a release ticket, on a delivered or abandoned ticket,
                              and with --clear on a ticket that is not marked.

  ticket priority <id> low|normal|high [--at <when>]
                              Change a ticket's priority, with one log line. Lowering to low is
                              refused unless the ticket is a draft ticket or pending, and keeps
                              its row: priority only orders the ready tickets. A draft ticket has
                              none at any priority; raising a low ticket that has no row gives it
                              one at once. A low ticket with no row gets
                              its row when its build starts, and keeps
                              it; abandoning a low ticket that has none creates none.

  ticket size <id> XS|S|M|L|XL|XXL [--at <when>]
                              Change a ticket's size, in any status, with one log line. Refused at
                              exit 1 on a value outside the list under \`ticket add\` and when
                              nothing would change.

  ticket network <id> <domain>... | --clear [--at <when>] [--json]
                              Set the public domains a ticket's agents may reach, comma or space
                              separated and stored lower case as \`network\`; --clear removes the
                              line. One log line. Refused at exit 1, writing nothing, unless the
                              ticket is a draft ticket or pending, on a loopback name, a .local
                              name or a loopback or private IP address (network-domain-not-public),
                              and when nothing would change.

  ticket ready <id> [<id>...] [--incident <I>] [--at <when>] [--json]
                              Ready draft tickets to build, all or nothing: each becomes pending
                              with a pending row at any priority, one log line each. Refused at
                              exit 1 with nothing written when a ticket named is not a draft
                              ticket, or is incomplete: \`acceptance-unnumbered\` with no numbered
                              Acceptance item, \`brief-missing\` with no \`## Brief\` holding a
                              non-blank line, each ticket named. \`ticket add\` files every ticket
                              as a draft ticket, with no row; no move returns a ticket there.
                              With --incident, only findings the findings-delivered incident lists
                              (finding-not-listed otherwise); a first-run leftover has its
                              \`first-run review\` hold lifted.
  ticket triage <id> [<id>...] [--incident <I>] [--at <when>] [--json]
                              Put findings to User's low-priority triage (findingRoute: user,
                              ticket-triaged); a \`first-run review\` hold stays. A findings-delivered
                              incident closes once every finding it lists is readied, triaged or
                              abandoned, and its default triages the rest.
  ticket park <id> [--incident <I>] -- <reason> [--at <when>] [--json]
                              Hold the ticket parked:<incident kind> (parked:user with none) and
                              open a parked decision to User; under a question incident it stops
                              the waiting job (outcome stopped) and carries the agent's questions.

  ticket abandon|reopen <id> [--branch <b>] [--commit <sha>]
      [--reason <text>] [--tokens <n>] [--at <when>]
                              Move a ticket and its Gantt row together, stamping both: abandon
                              from anything not already delivered or abandoned, reopen from
                              anything but a draft ticket or pending. The runner makes every other
                              lifecycle move. A draft ticket moves only through \`ticket ready\` or
                              \`abandon\`.
                              Moving a ticket to the status it already has is refused and logs
                              nothing — \`ticket rereview\` below is the one exception. Every
                              move out of in-review finishes and delivers the ticket's in-progress
                              review bar, with one log line each. A move to in-progress warns on
                              standard error, and still moves it, when the ticket is held.
                              \`abandon\` requires --reason; \`reopen\` clears the stamps and returns
                              the row to pending. --branch and --commit record where the work
                              landed, and --tokens what it cost; --tokens on a ticket with no
                              row (a low one never started) is refused at exit 1.

  ticket deliver <id> --by-hand [--branch <b>] [--commit <sha>] [--at <when>]
                              Record as delivered a ticket finished and landed outside the
                              runner, from any status but draft, in one hold: it merges, lands
                              and spawns nothing, and logs \`ticket-delivered\` with byHand true.
                              Refused at exit 1 while a runner's lease is live
                              (runner-owns-the-lifecycle) and while a job of the ticket is live
                              (ticket-has-live-job).

  ticket rereview <id> --start-review [--owner <who>] [--note <text>] [--at <when>]
                              The next review round and the reviewer's in-progress bar
                              (\`Review <N> #<id> — <title>\`, its \`reviewOf\` the ticket, N the
                              \`## Review\` sections plus one) in one lock hold, closing any bar of
                              the round before: the builder's slot passes to its reviewer, and one
                              round's to the next, without \`status --json\` ever showing it free.
                              A bundle's bar carries its claim's agent key while other rows of the
                              bundle still run, so it takes no second slot.
                              --owner and --note name the bar, and are refused without the flag.

  ticket rereview <id>        Send a ticket already in review round again, for a fresh reviewer: the
      [--at <when>]           ticket stays in-review and only its \`updated\` moves, while its row
                              goes one review round up, from 2, and the log says which round it is.
                              It is the one verb that may be run on the status the ticket already
                              has, and it is refused from every other status. It takes no --tokens:
                              the row's figure is the builder's, and a review pass has its own row.

  ticket status <id> <status>
                              The same move, naming the target status directly: pending,
                              in-progress, in-review, reviewed, delivered or abandoned. It takes
                              the same options and is the documented way to make a move the verbs above refuse.

  ticket link <ticketId> <taskId> [--force]
                              Point a ticket at an existing row instead of the one it filed.
                              Refused when that row already belongs to another ticket, unless
                              --force, which unlinks it there first.

  ticket depends <id> [<id>...] | --add <ids> | --remove <ids> [--json]
                              Set the tickets this one waits on. Bare ids replace its list, and no
                              ids clears it; the output names every id that dropped, and says
                              which of those are still open, since the ticket may now start before
                              them. --add 3,4 appends to the list (an id already there is kept),
                              --remove 3,4 takes ids out; either beside bare ids is refused as
                              ambiguous, and so are the two together. --json carries the ticket
                              with \`added\` and \`dropped\`. Refused for a ticket that does not exist
                              and for a list that would make tickets wait on each other in a
                              circle. Until every one of them is reviewed or delivered, the
                              ticket's row, table entry and card read "waiting on #003", \`ticket list\`
                              says so too, and a move to in-progress warns on standard error but
                              still moves it.

  ticket epic <id> [<key>...] | --add <keys> | --remove <keys> [--at <when>] [--json]
                              Set the epics a ticket belongs to, the first its primary epic. Bare
                              keys replace its list, and no keys clears it; --add appends (a key
                              already there keeps its place), --remove takes keys out, and the two
                              are refused beside bare keys or together, as for \`ticket depends\`.
                              An epic that does not exist is refused at exit 1 with nothing
                              written. One log line; \`updated\` is not stamped. --json carries the
                              ticket with \`added\` and \`dropped\`. Epics never affect dispatch,
                              claiming, concurrency or release: that is \`--group\`.

  ticket introduced-by <id> [<cause id>] [--at <when>] [--json]
                              Name the delivered ticket whose change introduced a bug, stored as
                              its \`introducedBy\`; no cause, or an empty one, clears it. Refused at
                              exit 1 with nothing written when the ticket is not a bug, or the
                              cause does not exist, is the ticket itself or is not delivered. One
                              log line; \`updated\` is not stamped.

  epic add <key> "<title>"    Add an epic, a larger feature tickets are grouped under:
      [--body <markdown>]     \`${PRODUCT_NAMES.DATA_FOLDER}/epics/<key>.md\` holding its key, title and colour
      [--body-file <path|->]  slot, then the description from --body or --body-file (\`-\` reads
      [--at <when>] [--json]  standard input), kept byte for byte. The key is lower-case letters
                              and digits in words joined by single hyphens (\`checkout-redesign\`);
                              a malformed key or one already taken is refused at exit 1 with
                              nothing written, and so are --body and --body-file together. The
                              slot, 1 to 6, is the one the fewest epics use, the lowest on a tie,
                              and is never reassigned.
  epic edit <key>             Change an epic's title, or replace its description, or with
      [--title "<title>"]     --append add to its end. Nothing to change writes nothing and exits 0;
      [--append]              an empty replacement or title, none of --title, --body and
                              --body-file, or both body options, are refused at exit 1.
      [--body <markdown>]
      [--body-file <path|->]
      [--at <when>] [--json]
  epic list [--json]          Every epic with its roll-up: its ticket ids, a count per ticket
                              status, the tokens of each ticket's own row and review rows, and its
                              span from the first start to the last end (open while a row runs,
                              null before any starts). An epic has no status of its own.
  epic show <key> [--json]    One epic: its roll-up, its file path and its description.
  epic remove <key> [--at <when>] [--json]
                              Delete an epic's file. Refused at exit 1 while any ticket names it.

  draft open "<title>"        Open a filing draft, the working record a filing session builds tickets
      --owner <who>           from: \`${PRODUCT_NAMES.DATA_FOLDER}/filing-cabinet/D<n>.json\` holding its title,
      [--request <text>]      the request from --request or --request-file (\`-\` reads standard
      [--request-file <path|->]
      [--json]                input) kept byte for byte, and the claim held by <who>. Prints the
                              new id, \`D1\`, \`D2\`, …, never reused; --json prints the draft.
  draft claim D<n> --owner <who> [--force] [--json]
                              Take a draft's claim. Refused at exit 1 with nothing written while
                              another owner holds it, unless --force, which logs the takeover; how
                              long ago it was claimed is never judged. Only this command checks
                              the claim.
  draft release D<n> [--json] Drop a draft's claim, as a session ending with work left does.
  draft note D<n> "<text>" [--assumption] [--json]
                              Add a research fact, its paths written in the text, or with
                              --assumption an assumption, as the next note N1, N2, ….
  draft ask D<n> "<question>" --context <text> --option <text> --option <text> [--option …]
      --recommended <letters> [--multiple] [--under Q<k>] [--json]
                              Add the next question Q1, Q2, …, its two to four options lettered
                              a to d in the order given. --multiple makes it multi-select, whose
                              --recommended may name several letters (a,c); --under makes it a
                              follow-up of Q<k>. A wrong option count, a letter outside the
                              options or a missing Q<k> is refused at exit 1.
  draft answer D<n> Q<k> "<answer>" [--json]
                              Record an answer, overwriting any earlier one: option letters (a or
                              a,c, several only on a multi-select question) or else free text. The
                              log keeps every answer. Needs no claim.
  draft drop D<n> N<k>|Q<k> [--json]
                              Remove a note or a question made moot, a question with its follow-ups.
                              Numbers are never reused.
  draft close D<n> --tickets <ids> [--json]
                              End a draft once its tickets are filed: removes its file and logs the
                              ticket ids it became. A ticket that does not exist, or any question
                              still open, is refused at exit 1 with nothing written.
  draft abandon D<n> --reason <text> [--json]
                              Remove a draft, logging the reason; without --reason it is refused
                              at exit 1.
  draft show D<n> [--json]    One draft: its title, claim, state, file, request, notes and question
                              tree. The state is waiting while a question is open, else
                              researching while claimed and resumable once released. --json prints
                              the whole stored draft, so a rebooted session resumes from it alone.
  draft list [--json]         Every open draft; a malformed draft file is reported on standard
                              error and skipped.

  concurrency [<n>] [--json]  Print the concurrency limit: how many agents may be in flight at once.
                              A slot is an agent: the in-progress rows one claim started
                              count once, and every other in-progress row, such as a review bar,
                              counts on its own. With <n>, store a new one (a whole number, 1 or more) for
                              every worktree, from 1 to 10: a higher one is refused at exit 1 with
                              nothing written, and one an older tracker stored reads as 10. A
                              tracker that never set one reads 2; a limit below the agents already
                              in flight is accepted and simply leaves no free slot. \`status --json\`
                              carries it beside \`agentsInFlight\`, the free slots and the ready
                              tickets.

  gate list [--json]          The board's gate pipeline, stored in <data>/pipeline.json beside
                              progress.json and never tracked. Read-only, no lock. --json prints
                              {pipelineIsSet, pipelineHash, prepare, gates} and review,
                              constitution and agents when stored; with no pipeline pipelineIsSet
                              is false, pipelineHash null and both lists empty. A malformed file
                              is refused at exit 1 with its reason.

  gate prepare <name> [--json] -- <command>
                              Set the prepare step <name>, run before a gate in a fresh worktree;
                              a step of the same name is replaced where it stands. One log line.
  gate add <name> [--fix "<command>"] [--in <folder>] [--defined-by <pattern>]
           [--network <domain>] [--writes <path>] [--overseer-only] [--json] -- <command>
                              Add the gate <name>, run last, or replace one of the same name where
                              it stands; --defined-by, --network and --writes repeat.
                              --in runs it in a folder of the worktree; --defined-by
                              names the files that define it (git pathspec-style patterns), which
                              a job may change only when its ticket body names them; --writes a
                              folder it may write besides the worktree and temp. One log line.
  gate none [--json]          Store an empty gate list on purpose: the board counts it as set, so
                              no checks-not-set decision opens, and a landing runs no gate.
  gate remove <name> [--json] Remove the gate <name>; an unknown one is refused at exit 1.
                              Every write takes the lock, is accepted with tickets in flight, and
                              refuses a malformed pipeline.json at exit 1 rather than overwrite it.
                              Each row records the content hash of the pipeline at its next gate
                              run. --json prints {pipeline, pipelineHash}.

  range --from <when>         The stored default axis of the chart; a bound may also be \`start\`, the
                              earliest visible row. A relative bound is stored as
        --to <when>           written, so \`--from -2h\` keeps meaning "the last two hours" on every
        [--tick <15m|1h|1d>]  refresh. A pair that is not in order is refused at exit 1 when both
                              are timestamps or both are relative to now; a pair naming \`start\`
                              or mixing the two is not judged. One log line per stored range.
                              The page's own range menu overrides this per browser.
  range --auto                Reset the axis to the automatic span; it takes no --from, --to or
                              --tick, and any of them beside it is refused at exit 1.

  open                        Open the live Overseer's URL in the default browser and print it. With
                              no live lease it is refused (overseer-down) at exit 1, advising
                              \`run --detach\`. \`progress.html\` is only a stub naming that URL, or
                              saying the Overseer is down, written by \`init\`, \`update\` and \`run\`.

  run [--port <n>] [--detach] [--json]
                              Start the board's one runner on 127.0.0.1, logging to standard error
                              and \`runner.log\`: it creates the lease \`runner/lease-<n>.json\`, writes
                              the API token to \`runner/token\` (mode 0600), prints its URL and serves
                              until stopped. The port derives from the tracker id, moving upward
                              past one in use; --port binds the one given, 0 any free one. A live
                              runner refuses it (runner-already-running, with its URL) at exit 1, as
                              does a starter that lost the race (runner-contended); a runner whose
                              lease a newer one overtook stops lease-taken-over at exit 2.
                              --detach starts it in the background and prints the URL once it answers.
  run --successor-of <generation> [--port <n>]
                              The successor's side of \`run restart\`'s handover, which only the
                              live runner starts.
  run stop [--now] [--json]   Stop the live runner, through its API or else SIGTERM to the process
                              its lease names; agent hosts are never touched. --now also stops
                              process hosts.
  run restart [--now] [--json]
                              Hand the board to the code on disk: a successor proves it, then takes
                              over and reattaches every host; no agent is touched. A failed
                              handover leaves the old runner driving with a warning and exits 1
                              (runner-handover-failed).
  run pause|resume [--json]   Store \`dispatcherState\` \`stopped\` or \`running\`: no new jobs while
                              paused. Works with the runner up or down.
  run status [--json]         The lease, the URL, the runtime state, paused or not, and the code
                              version on disk against the live runner's. Read-only, no lock.

  version [--json]            Print the code version on disk and the install version:
                              {codeVersion, installVersion}. Read-only.

  merges [--json]             The merge queue: each held slot {target, jobId, ticketIds, phase,
                              targetTip, branchTip}, then each queued ticket {ticketId, target,
                              priority, queuedAt} by priority, then queue order. Read-only,
                              no lock.
  merge fixer|abort|review|land <J> [--incident <I>] [--json]
                              An Airlock move on merge job J's merge-gate-failed or
                              resolution-over-threshold incident, carried out on the next sweep:
                              fixer launches one merge-gate fixer, review a resolution reviewer,
                              abort parks the ticket parked:<kind> and frees the slot, and land
                              lands a merged tree with a passing gate (merge-gate-not-passed
                              otherwise). Without --incident it takes J's one open incident that
                              allows it, refused no-open-incident when there is none.

  worktree repair <id> --step <step> [--incident <I>] [--json]
                              Repair the ticket's worktree in the hold (worktree-repaired), the
                              step one of prune, reinstall, recreate, unlock: git worktree prune;
                              reinstall on the next launch; recreate from the branch
                              after saving its changes to <data>/jobs/<J>/recreate-<n>.patch
                              (worktree-has-uncommitted-work when they cannot be saved); remove a
                              stale index.lock. recreate and unlock are refused worktree-in-use
                              while a job is on the ticket.
  gate retry <J> [--incident <I>] [--json]
                              Settle J's gate-cannot-run incident, so the merged tree is gated again
                              or the ticket's next attempt launches; nothing to do without one.
                              Without --incident, worktree repair and gate retry take the one open
                              incident that allows them, or apply as a plain control.

  decisions [--json]          The open decisions for User, in opening order: each {id, kind,
                              ticketIds, jobId, askedBy, requestId, questions, context, openedAt},
                              its options lettered a, b, c as decide takes them. Read-only, no lock.

  decide <decision> <letters>... | -- <text> [--json]
                              Answer an open decision, with the runner up or down: one choice of
                              option letters per question (b; ac for a multi-select), or free text
                              after -- for a one-question decision (decision-has-several-questions
                              otherwise). The first answer wins (decision-already-answered); it is
                              stored as {question: answer}, logged decision-answered, and the
                              runner delivers it to the asking session.

  incidents [--json]          The open incidents for the runner's orchestrator, in opening order,
                              each with its facts, the moves its kind allows and its default.
                              Read-only, no lock.
  incident answer <I> -- <text> [--json]
                              Answer a system-question or malformed-ticket: its waiting session
                              takes the answer, and a malformed ticket's also goes under the
                              ticket's ## Questions (incident-handled, incident-answered).
  incident note <I> -- <text> [--json]
                              Record a finding (incident-noted); the incident stays open.
  incident escalate <I> [--json]
                              Put the agent's own questions to User unchanged, as an
                              agent-question decision (incident-escalated).
                              Every move naming an incident, here or with --incident, is refused
                              unless the incident is open and its kind allows the move; it marks
                              the incident handled in the same hold (incident-handled).

  jobs [--json]               The live jobs, one line each (id, kind and role, state, tickets,
                              attempt, host instance, a stop asked), then the runner, paused or not,
                              agents against the limit, open decisions and incidents, and each
                              incident that took its default since the runner started, a warning.
                              Read-only.
  job show <J> [--json]       The job's record, or what the log holds of a finished one.
  job attach <J> [--json]     Replay every host instance's event log, then follow the newest while
                              the job is on the board (--json replays only). Both read-only.
  job message <J> [--incident <I>] -- <text> [--json]
                              A chat turn the runner writes to the session (job-messaged); a closed
                              product owner is reopened, resuming its session (job-reopened), and
                              any other finished job is refused job-finished. Under an
                              incident, refused job-awaits-user-answer for a job waiting on User or
                              whose ticket has an open agent-question, and job-is-product-owner.
  job fresh <J> [--incident <I>] [--json]
  job wind-down|stop <J> [--json]
                              Logged job-stop-requested with the mode. stop and wind-down hold the
                              ticket "stopped by User (J<n>)" or "wound down by User (J<n>)" in the
                              same hold, with the runner up or down; a stopped product owner is
                              finished and its open decisions withdrawn. fresh stops the job so the
                              next attempt starts on its worktree (job-has-no-ticket otherwise).
  job stop --all [--wind-down] [--json]
                              run pause, then stop or wind down every build, review and
                              product-owner job.

  intake -- <text> [--json]   Record a product-owner job (no ticket, no build slot) the runner
                              launches in <worktrees>/sessions/<J>/ with /${PRODUCT_NAMES.PRODUCT_OWNER_SKILL} <text>;
                              several may run at once, and job message chats with one.
  intake close <J> [--set <id,id>]... [--json]
                              Close its input (job-not-intake for another kind of job); once its
                              session ends the runner opens a ready-drafts decision listing its
                              drafts, one option per --set and one for none. Under the product
                              owner's own job it names no job.

  await [--json] [--after <n>]
                              Wait until the log holds a decision-opened or incident-escalated
                              record past position <n> (the log's length when absent), then print
                              them with their positions, and the position to wait after next.

  clear [--all] [--yes]       Throw away every task row and the log and restart the clock, keeping
                              the tickets: each surviving ticket is given a fresh row seeded from
                              its own frontmatter, except a low one with no row. Row ids are not reused. --all deletes the
                              tickets and every epic too and restarts the ticket ids at 001. --yes skips the
                              confirmation, and is required when standard input is not a terminal.

  help                        This command reference.
`;
}
