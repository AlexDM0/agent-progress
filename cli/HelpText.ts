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
it. Every mutating command takes the lock, writes the progress file atomically and regenerates
\`progress.html\`, which reloads itself within a minute of new data when idle. \`<when>\` is an ISO 8601 timestamp, \`now\`,
or an offset from now: \`-5m\`, \`-2h\`, \`-1d\`, \`+30m\`. \`<n>\` on --tokens is a whole number or a
decimal with a \`k\`/\`m\`/\`b\` suffix: \`12000\`, \`12k\`, \`12.3k\`, \`1.2m\`, \`1.20b\`.

\`--help\` works after a command word as well as on its own, and \`-h\` on its own or straight after
the command word; a \`-h\` further on is refused at exit 1, since it may be text (put text behind a
bare \`--\`). An option taking a value, given twice, is refused at exit 1.
${ROOT_OVERRIDE_VARIABLE} names the repository to use instead of walking up from the current directory. --json, accepted by every
command but init, update, render, open, hook and help, prints one JSON document on standard output
in place of the human output.

\`status\`, \`ticket add\`, every ticket or task move (\`ticket claim\` and \`task add --start\` among
them), \`ticket depends\`, \`priority\`, \`agent\`, \`hold\` and \`unhold\`, and \`release\` end their
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
      [--project <name>]      file and log, a \`tickets/\` folder and \`agent-brief.md\` — the brief to fill in
      [--root <path>]         before spawning an implementing agent — a \`.gitignore\` entry for it,
      [--no-claude-md]        a managed block in the repository's CLAUDE.md telling an agent to track
      [--no-hooks]            its work through this tool, the three hooks below, and the
      [--no-workflow]         dispatcher workflow at \`${PRODUCT_NAMES.DATA_FOLDER}/agent-progress-dispatch.js\`,
      [--no-agent-definition] generated from this tool's dispatcher, and the Claude Code agent
                              definition \`.claude/agents/agent-progress-worker.md\`, whose
                              frontmatter sets the default model and effort for builders and
                              reviewers (opus, medium). Beside the brief go the builder and review
                              briefs and \`reference.md\` (the ticket format, the moves and the exit
                              codes, which the briefs cite), and two skills go into
                              \`.claude/skills/\`: ${PRODUCT_NAMES.PRODUCT_OWNER_SKILL}, which a session asked to file a ticket
                              loads, and ${PRODUCT_NAMES.ORCHESTRATE_SKILL}, for the session running the
                              board, which loads ${PRODUCT_NAMES.PRODUCT_OWNER_SKILL} for intake. Refused when an ancestor
                              already holds a tracker, when --root is not an existing directory,
                              and inside a bare repository, which has no working tree to track.
                              Re-running only refreshes what \`update\` refreshes, and
                              \`update\` is the command to reach for there. --project names the
                              project shown on the page, --root tracks that directory instead of the
                              discovered repository root, --no-claude-md leaves CLAUDE.md alone,
                              --no-hooks writes no hook, --no-workflow no workflow and
                              --no-agent-definition no agent definition; it is refused with exit
                              1, writing nothing, unless --no-workflow is given too, since the
                              dispatcher starts every builder and reviewer as that agent; and
                              both together are refused the same way while a dispatcher is
                              installed without its definition, which --no-workflow would keep.

  update                      Refresh what the tool wrote into a repository it already tracks: the
      [--no-claude-md]        managed CLAUDE.md block, \`agent-brief.md\` — guidance shipped with the
      [--no-hooks]            tool rather than a file a project edits — the three hooks and the
      [--no-workflow]         dispatcher workflow, generated anew, and the agent definition, a hand
      [--no-agent-definition] edit to either of which is undone, the other briefs, \`reference.md\` and
                              the two skills, removing what an earlier version installed in a
                              skill folder this one retired. The tracker itself is left alone:
                              a tracker an earlier ${PRODUCT_NAMES.PROGRAM} wrote in a format this one no
                              longer reads is refused at exit 2 by every command that reads it,
                              saying to run \`update\` with a release that still reads it. It creates no tracker, so it takes no
                              --project and no --root, and it is refused with exit 1 where there
                              is none — \`${PRODUCT_NAMES.PROGRAM} init\` makes one.
                              Each line says whether that file changed, so a session that read the
                              brief at its start learns that its copy is now stale. It takes the same
                              --no-claude-md, --no-hooks, --no-workflow and --no-agent-definition
                              as \`init\`, and refuses --no-agent-definition without --no-workflow,
                              or with it over a dispatcher lacking its definition, the same way.
                              Every command but init, update, help and status refuses, with exit
                              1, while the files installed here are of another install version
                              than this ${PRODUCT_NAMES.PROGRAM} (the SubagentStop hook reports it and exits
                              0); update rewrites them, and it and \`init\` refuse files a newer
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

  hook subagent-stop          Record what a finished subagent cost, as one log line: the hook JSON
                              arrives on standard input, and the agent's transcript is summed per
                              API call rather than per line. When the agent's first message — its
                              brief — holds a line \`agent-progress row: <id>\`, or several ids
                              separated by commas, the log line's \`input\` total is also added to
                              those rows' tokens, divided evenly. A line \`agent-progress ticket:
                              <id>\` names tickets instead, each resolved to the row it holds when
                              the hook runs. A line \`agent-progress review: <id>\` names one
                              ticket whose review row the reviewer creates itself: the input goes
                              to the most recently added row reviewing that ticket (its
                              --review-of), whatever its status; a row a ticket
                              owns is never a review row. A brief with
                              several is read by one alone: row over ticket over review.
                              This is the command \`init\` and \`update\` wire into
                              \`.claude/settings.local.json\`; nobody types it. Given exactly the
                              event word, it exits 0 whatever goes wrong — no input, an unreadable
                              transcript, no tracker at the hook's own working directory, installed
                              files of another install version, a row or a ticket's row that does
                              not exist — and writes the reason to standard error. Its exit code
                              prevents nothing, since the agent has already finished; exiting 0 is
                              what keeps a failure here from becoming an error the orchestrator must
                              read, or a delay before it is told.

  hook pre-tool-use           Keep the check command the orchestrator's: wired with
                              \`hook subagent-stop\` for Bash calls, it blocks at exit 2, the reason
                              on standard error, a subagent's call (its hook JSON carries
                              \`agent_id\`, which Claude Code sets only on a subagent's call) that
                              runs \`${PRODUCT_NAMES.PROGRAM} checks\` with a line, --clear or --restamp.
                              A read (\`checks\`, \`checks --json\`), every other call, and every
                              call from the main session pass at exit 0, unreadable input too.

  hook post-tool-use          Keep the page live while agents work: wired with
                              \`hook subagent-stop\` for every tool call, it regenerates the page as
                              \`render\` does only when the page is more than 5 minutes old. It
                              never waits on the lock (a held one skips the render), never prints
                              and always exits 0.

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

  rework [--since <commit>]   How many lines of code a review reworked on a branch: added plus
      [--rebased-from <old tip>]
      [--main <branch>]       removed lines, never blank lines, comments or documentation (*.md,
      [--merge <commit>]      *.mdx, *.rst, *.txt and anything under the repository's docs/). It
      [--worktree <path>]     counts; no threshold is built in. --since counts every commit in
      [--files] [--json]      <commit>..HEAD, and is refused when <commit> is not an ancestor of HEAD
                              or a merge lies in between: count a merge with --merge. --rebased-from
                              counts what a rebase changed in the branch's own work — the hand
                              resolution — as the added lines in which the branch's patch against
                              --main (default \`main\`) differs before and after, so a line resolved
                              by hand counts 2 and main's own change none; a rebase without
                              conflicts counts 0. It is measured up to HEAD, so run it right after the rebase.
                              A rebase rewrites the commits after <commit>, so either count --since
                              before rebasing and --rebased-from ORIG_HEAD after it, or rebase first
                              and take <commit> from the rebased tip: both in one call then measure
                              the rebase up to <commit> and print one total and the two parts,
                              counting nothing twice. --merge counts what a merge commit's
                              resolution changed against git's automatic merge of its two parents
                              (git merge-tree --write-tree), leaving out the conflict markers git
                              wrote: a merge git made by itself counts 0. Comments are read per file
                              type (// and /* */, #, <!-- -->, docstrings, a <script> or <style> in
                              HTML); a line of code with a trailing comment is code, and a file type
                              it does not know counts every non-blank line. --worktree names the
                              working tree to read instead of the current directory; --files adds
                              the per-file breakdown. It needs no tracker and writes nothing.

  review record <id>          Record one review pass as a review-recorded line in the log, on the
      --worktree <path>       ticket's in-progress review bar, whose stored round it takes. A
      --since <review start>  reviewer runs it once per pass, on every outcome. It counts the rework
      --findings-file <file>  itself, as \`rework\` does: the commits since <review start> up to the
      [--rebased-from <tip>]  first --rebased-from (HEAD without one), and each rebase from its
      [--main <line>]         pre-rebase tip, given once per rebase, up to the next one's (HEAD for
      [--bar <row>]           the last), and prints the total to report as reworkedLines. It takes
      [--json]                the builder's change size, \`git diff --shortstat <main>...<review
                              start>\`. One --main names every rebase's main line (default \`main\`),
                              or one per --rebased-from. A bundle's review runs on one bar: --bar
                              names it, run once per ticket of the bundle, and is refused unless it
                              is an in-progress review bar of a ticket claimed with <id>. The
                              findings file (\`-\` reads standard input) is a JSON object: verdict,
                              claims (item, result, handoffContradicted) and findings (class,
                              severity, file, summary, evidence, outcome, then commit or
                              filedTicketId); docs/cli.md lists the words each takes. A word
                              outside them, a missing field, or a ticket with no in-progress
                              review bar is refused, recording nothing.

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

  release <id> --branch <b>   Release a reviewed branch: fast-forward the main checkout — the
      [--worktree <path>]     tracker's root, wherever this runs from — to <b>, then approve the
      [--main <line>]         ticket and deliver it with --branch <b> and --commit set
      [--json]                to the merged tip. More ids after <id> release every ticket of a
                              bundle, which share <b>. A ticket of a group's release bundle that
                              is already reviewed is released beside that group's release ticket,
                              delivered without a second approval. Every in-progress review row whose
                              --review-of names a released ticket is finished and delivered at the release
                              time, and named.
                              All of it happens in one lock hold, so two releases never race.
                              With a check command stored (see \`checks\`) it first runs it, outside
                              the lock, through the user's shell in --worktree, which it then needs:
                              refused, before the command runs, when that worktree's HEAD is not
                              <b>'s tip (\`worktree-not-at-tip\`) or it holds an uncommitted or
                              untracked file (\`worktree-dirty\`); when the command exits non-zero
                              (\`checks-failed\`, its last 20 lines in the detail: fix, commit and
                              release again) or changes a tracked file (\`worktree-dirty\`); and,
                              in the lock, when <b> moved since (\`branch-moved\`) or the stored
                              command changed (\`check-command-changed\`). With or without one, a
                              ticket whose row was stamped at its start with another line than the
                              stored one, none counting as a line, is refused
                              (\`check-command-differs-from-start\`); the orchestrator settles it
                              with \`checks "<line>" --restamp\`. Each ticket's latest \`## Review\`
                              must hold or waive every numbered \`A<n>.\` item of its Acceptance:
                              refused \`acceptance-unnumbered\` with none numbered,
                              \`acceptance-unaccounted\` naming an item without such a line, and
                              \`acceptance-waived\` naming a waiver its Acceptance does not mark
                              \`Waived:\`, before the checks and again in the lock.
                              Refused at exit 1, with nothing changed (no review row either), when a ticket
                              is not in-progress or in-review (or such a reviewed bundle ticket),
                              when the main checkout is not on
                              --main (default \`main\`), when <b> is not a local branch, when <b>
                              does not descend from --main — reason \`main-moved\`: rebase <b> onto
                              it, re-run the checks and release again — and when git will not
                              fast-forward. Refused at exit 2, also with nothing changed, when git
                              or the tracker could not be read — reason \`git-failed\` or
                              \`tracker-failed\`. Afterwards \`git worktree remove\` on --worktree,
                              never forced, and \`git branch -d <b>\`; what git declines is named
                              with its reason, the files a worktree still holds among it, at exit
                              0. --json prints, on success, {released: true, tickets, branch,
                              mainLine, commit, checkCommand, closedReviewRows, cleanup} —
                              checkCommand the command that passed (a tracker storing none is
                              refused checks-not-set), closedReviewRows the ids of the review rows it delivered — and on a
                              refusal {released: false, reason, detail, blockingFiles, cleanup: []};
                              reason is one of invalid-request, unknown-ticket,
                              ticket-not-releasable, unknown-branch, not-on-main-line,
                              checks-not-set, worktree-not-at-tip, worktree-dirty, checks-failed,
                              check-command-changed, check-command-differs-from-start,
                              acceptance-unnumbered, acceptance-unaccounted, acceptance-waived,
                              branch-moved, main-moved, merge-refused,
                              git-failed and tracker-failed, and blockingFiles, on merge-refused,
                              the main checkout's own uncommitted files the merge would overwrite,
                              empty otherwise. A cleanup step is one of {target: worktree, path,
                              outcome: removed}, {target: worktree, path, outcome: left, reason,
                              untrackedFiles, changedFiles}, {target: branch, name, outcome:
                              deleted} and {target: branch, name, outcome: left, reason}.
                              Allowing this command is the release permission: a reviewer never
                              runs \`git merge\` itself.

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
                              dispatcher starts no builder or reviewer for it while it is held, and
                              \`ticket claim\` refuses it. One log line; \`status --json\` lists it in
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
                              its row when \`ticket start\` or \`ticket claim\` starts it, and keeps
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

  ticket ready <id> [<id>...] [--at <when>] [--json]
                              Ready draft tickets to build, all or nothing: each becomes pending
                              with a pending row at any priority, one log line each. Refused at
                              exit 1 with nothing written when a ticket named is not a draft
                              ticket, or is incomplete: \`acceptance-unnumbered\` with no numbered
                              Acceptance item, \`brief-missing\` with no \`## Brief\` holding a
                              non-blank line, each ticket named. \`ticket add\` files every ticket
                              as a draft ticket, with no row; no move returns a ticket there.

  ticket start|finish|approve|deliver|abandon|reopen <id> [--branch <b>] [--commit <sha>]
      [--reason <text>] [--tokens <n>] [--at <when>]
                              Move a ticket and its Gantt row together, stamping both. Each verb
                              moves a ticket that is in a status it makes sense from: start from
                              pending or in-review, finish from in-progress, approve from
                              in-progress or in-review, deliver from reviewed, abandon from
                              anything not already delivered or abandoned, reopen from anything
                              but a draft ticket or pending. A draft ticket moves only through
                              \`ticket ready\` or \`abandon\`.
                              Moving a ticket to the status it already has is refused and logs
                              nothing — \`ticket rereview\` below is the one exception. Every
                              move out of in-review finishes and delivers the ticket's in-progress
                              review bar, with one log line each. \`start\` warns on standard error, and still
                              moves it, when the ticket is held.
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

  ticket finish|rereview <id> --start-review [--owner <who>] [--note <text>] [--at <when>]
                              The move to review, or the next round, and the reviewer's in-progress bar
                              (\`Review <N> #<id> — <title>\`, its \`reviewOf\` the ticket, N the
                              \`## Review\` sections plus one) in one lock hold, closing any bar of
                              the round before: the builder's slot passes to its reviewer, and one
                              round's to the next, without \`status --json\` ever showing it free.
                              A bundle's bar carries its claim's agent key while other rows of the
                              bundle still run, so it takes no second slot.
                              --owner and --note name the bar, and are refused without the flag.

  ticket claim <id> [<id>...]
      [--owner <who>]         \`ticket start\` and the row's --owner and --note in one write, for
      [--note <text>]         every ticket named, as ONE agent: a bundle's builder claims all its
      [--after <id>]          tickets in the one call, and their rows share one agent key. Refused
      [--at <when>]           at exit 1 with nothing written, all or nothing, when any ticket is not
                              pending or in-review, when one is held, when one waits on a ticket
                              outside the claim that is not reviewed or delivered (one inside it is
                              settled: the bundle is worked in dependency order), when one is low
                              and an unheld normal or high ticket is not yet delivered or
                              abandoned — \`ticket start\` only warns
                              about that — when a review bar of one is in progress, or when the agents
                              in flight already number the concurrency limit. The count and the
                              moves share one lock hold, so
                              two claims racing for the last slot cannot both succeed. --json
                              prints the ticket, or with several ids the list of them. The first
                              command an implementing agent runs.
                              --after <predecessor> claims one pipelined successor while its
                              predecessor is still in review: accepted only when the predecessor
                              is in-review, in the same release bundle, and the one unsettled
                              ticket it waits on; the slot limit applies as for any claim.

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
                              says so too, and \`ticket start\` warns on standard error but still moves it.

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
                              A slot is an agent: the in-progress rows one \`ticket claim\` started
                              count once, and every other in-progress row, such as a review bar,
                              counts on its own. With <n>, store a new one (a whole number, 1 or more) for
                              every worktree, from 1 to 10: a higher one is refused at exit 1 with
                              nothing written, and one an older tracker stored reads as 10. A
                              tracker that never set one reads 2; a limit below the agents already
                              in flight is accepted and simply leaves no free slot. \`status --json\`
                              carries it beside \`agentsInFlight\`, the free slots and the ready
                              tickets.

  dispatcher [running|finished|stopped] [--run <runId>] [--json]
                              Print where the dispatcher was left, or store a new state with one
                              log line, so it survives a compaction of the orchestrator's context.
                              \`running --run <runId>\` stores the Workflow run beside it, the one a
                              killed run is resumed by; \`--run\` goes with \`running\` alone, and
                              every write without it clears the stored id. The read and
                              \`status --json\` (\`concurrency.dispatcherRunId\`) print it.
                              \`running\`: a dispatcher is at work. \`finished\`: it ended by itself,
                              and the Next line says "work ready for the orchestrator" while a
                              normal or high ticket is ready, or "only low priority ready, for the
                              orchestrator to triage" while only low ones are. \`stopped\`: never
                              started, or ended by the user, and the Next line says "dispatcher
                              stopped: wait for the user's go" however many tickets are filed
                              meanwhile. A tracker that
                              never set one reads \`stopped\`, and the read writes nothing; any
                              other word is refused at exit 1 with nothing written.
                              \`status --json\` carries it as \`concurrency.dispatcherState\`.

  checks ["<command>" | --clear] [--restamp] [--json]
                              Print the check command \`release\` runs on a branch's tip before it
                              changes anything, or store one for every worktree with one log line:
                              the repository's full check line, quoted as one argument. It lives in
                              the tracker, never in the branch being released, and runs through the
                              user's shell (\`$SHELL\`, else /bin/sh) in the branch's worktree.
                              A new line is first run in the main checkout: when it exits non-zero
                              nothing is stored or logged, and it is refused at exit 1 with its last
                              20 lines. --clear removes it; release refuses a tracker that never
                              set one (checks-not-set), and the read writes nothing. Every ticket start and claim stamps the
                              stored line on the ticket's row, so a change while a ticket is in
                              progress or in review is refused at exit 1 unless --restamp is given,
                              which stamps every such row with the new line in the same write and
                              logs each. A blank command, a command beside --clear, --restamp alone,
                              or --clear with none stored and no --restamp is refused at exit 1 with
                              nothing written. Only the orchestrator's session changes it: the
                              PreToolUse hook blocks a subagent's change (see \`hook\`).
                              --json prints {checkCommand}, null when none is stored, and a change
                              adds previousCheckCommand and restampedTicketIds.

  checks --install "<line>" [--json]
                              Store the install line that prepares a fresh worktree before a gate,
                              untried, with one log line; it is part of a gate's cache key. It goes
                              alone, and a blank one is refused at exit 1 with nothing written.
                              --json prints {installCommand, previousInstallCommand}.

  checks --definition-files ("<pattern> <pattern>…" | --clear) [--json]
                              Store the files the check line resolves through, as git pathspec-style
                              globs quoted as one argument: * and ? stay in a folder, ** crosses
                              folders, a name without an inner / matches at any depth, a trailing /
                              takes a whole folder. A job whose commits change a matching path its
                              ticket body does not name is refused (checks-definition-changed).
                              With none stored nothing is refused. --clear removes the list; it
                              goes alone, and a blank list is refused at exit 1 with nothing
                              written. --json prints {checksDefinitionFiles,
                              previousChecksDefinitionFiles}.

  checks --key-command ("<line>" | --clear) [--json]
                              Store a shell line whose standard output joins a gate's cache key,
                              such as \`bun --version\`, untried, with one log line. Before each
                              cache lookup it runs as the gate does, in the gate's sandboxed host on
                              the gated tree; one that exits non-zero or cannot run caches nothing
                              and the gate cannot run (gate-cannot-run). With none stored the key
                              is the tree, the checks line and the install line alone. --clear
                              removes it; it goes alone, and a blank one is refused at exit 1 with
                              nothing written. --json prints {gateKeyCommand,
                              previousGateKeyCommand}.

  checks --cache-paths ("<path> <path>…" | --clear) [--json]
                              Store the folders a gate and install line may write besides the
                              worktree, its git admin folder and temp, absolute or home-relative
                              (\`~/.bun/install/cache\`), with one log line; with none stored they
                              write only those. A path that is, sits in or holds a \`bin\` folder or
                              a folder on PATH is refused at exit 1 with nothing written, and one
                              that became so later is left out of the gate's profile; the \`bin\`
                              beside each of a cache path's ancestors is never writable.
                              A worker may run unasked the first word of each command in the
                              stored checks and install lines (split outside quotes on &&, ||, ;,
                              | and parentheses) and the git verbs it reads and commits with. --clear removes the key; it
                              goes alone.
                              --json prints {gateCachePaths, previousGateCachePaths}.

  range --from <when>         The stored default axis of the chart; a bound may also be \`start\`, the
                              earliest visible row. A relative bound is stored as
        --to <when>           written, so \`--from -2h\` keeps meaning "the last two hours" on every
        [--tick <15m|1h|1d>]  refresh. A pair that is not in order is refused at exit 1 when both
                              are timestamps or both are relative to now; a pair naming \`start\`
                              or mixing the two is not judged. One log line per stored range.
                              The page's own range menu overrides this per browser.
  range --auto                Reset the axis to the automatic span; it takes no --from, --to or
                              --tick, and any of them beside it is refused at exit 1.

  render                      Regenerate \`progress.html\` from the progress file, the log and the
                              tickets, changing nothing else. For a page lost to a crash, or after a
                              ticket body was edited by hand.

  open                        Open the live runner's URL when a runner lease is live; otherwise open
                              \`progress.html\` in the default browser, rendering it first when
                              it is missing; a page that cannot be rendered is exit 2, as for
                              \`render\`.

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

  jobs [--json]               The live jobs, one line each (id, kind and role, state, tickets,
                              attempt, host instance, a stop asked), then the runner, paused or not,
                              agents against the limit, open decisions and incidents. Read-only.
  job show <J> [--json]       The job's record, or what the log holds of a finished one.
  job attach <J> [--json]     Replay every host instance's event log, then follow the newest while
                              the job is on the board (--json replays only). Both read-only.
  job message <J> -- <text> [--json]
                              A chat turn the runner writes to the session (job-messaged); refused
                              job-finished for a finished job, which is never continued.
  job wind-down|stop|fresh <J> [--json]
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
