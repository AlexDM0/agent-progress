<p align="center">
  <img src="docs/images/icon.png" width="112" height="112" alt="agent-progress icon: four coloured Gantt bars and a red now-line on a dark rounded square">
</p>

<h1 align="center">agent-progress</h1>

<p align="center">
  <b>Mission control for your Claude Code agents.</b><br>
  Describe the work. Agents build it in their own worktrees, a fresh agent reviews it, main is fast-forwarded,
  and one self-contained page shows every step as it happens.
</p>

<div align="center">
<table>
  <tr>
    <td align="center"><sub>SKILLS</sub><br><b>2</b><br><sub>for Claude Code</sub></td>
    <td align="center"><sub>CLI</sub><br><b>Bun</b><br><sub>+ TypeScript</sub></td>
    <td align="center"><sub>RUNTIME DEPENDENCY</sub><br><b>1</b><br><sub>marked</sub></td>
    <td align="center"><sub>DASHBOARD</sub><br><b>Bridge</b><br><sub>local only</sub></td>
    <td align="center"><sub>AGENTS AT ONCE</sub><br><b>up to 10</b><br><sub>2 by default</sub></td>
  </tr>
</table>
</div>

<br>

The Bridge is the live board the Overseer serves while it runs the work. Every image below is its own view of the
Example Storefront demo board, taken with the Overseer running scripted fake agents.

<p align="center">
  <img src="docs/images/bridge-kanban.png" width="100%" alt="Kanban: the Bridge's Kanban view of the Example Storefront board, with the Overseer header, its controls and statistics above lanes for drafts, ready, building and in-review tickets; ready cards carry Hold and priority buttons">
</p>

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/images/bridge-progress.png" width="100%" alt="Progress: the Bridge's Progress view, a Gantt row per ticket with its state, then the waves Now, Wave 2, a one-at-a-time Wave 3 holding #012 One-page checkout, and Wave 4">
    </td>
    <td width="50%" valign="top">
      <img src="docs/images/bridge-agents.png" width="100%" alt="Agents: the Bridge's Agents view, one row per job the Overseer launched, the Assistant, three builders and a product owner, with state, calls, tool calls and tokens">
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/images/bridge-tickets.png" width="100%" alt="Tickets: the Bridge's Tickets view with ticket #012 One-page checkout open in the detail panel">
    </td>
    <td width="50%" valign="top">
      <img src="docs/images/bridge-merge-queue.png" width="100%" alt="Merge queue: the Bridge's Merge queue view, opened from the Kanban, listing each merge target's slot holder and queue">
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/images/bridge-questions.png" width="100%" alt="Questions: the Bridge's Questions view with an open decision the Overseer asks the user, its answer box, and the answered, notices and low-priority triage sections">
    </td>
    <td width="50%" valign="top">
      <img src="docs/images/bridge-assistant.png" width="100%" alt="Assistant: the Bridge's Assistant view, the Overseer's own orchestrating session, its transcript and a chat box">
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/images/bridge-intake.png" width="100%" alt="Intake: the Bridge's Intake view with its New request box and the product-owner session taking a wish-list request">
    </td>
    <td width="50%" valign="top">
      <img src="docs/images/bridge-kanban-dark.png" width="100%" alt="Dark theme: the same Kanban view in the dark theme">
    </td>
  </tr>
</table>

## About

Running one coding agent is easy to follow. Running five is not: which one is on what, which branch is
safe to merge, who checked the work, and what did it all cost? The answers end up scattered across
terminal tabs and a context window that gets compacted halfway through the afternoon.

agent-progress puts the answers on a board, and one Overseer, the **Overseer** (`agent-progress oversee`), works
it. You describe a request in the Bridge's Intake view or in a Claude Code session; a product owner files
it as a draft ticket with a testable Acceptance. Once you ready it, the Overseer launches a builder agent
per ready ticket in its own worktree, gates the result, hands every finished build to a reviewer agent
that never saw it being written, and queues it for the **Airlock**, which merges one ticket at a time onto
main. The **Bridge**, the page the Overseer serves on your machine, shows every step as it happens.
Nothing on the board is edited by hand.

## Highlights

**The board draws itself.** Each command takes the tracker's lock and writes its state atomically before
letting go, and the Bridge follows the Overseer's event stream, so it never shows a state the files did
not hold. Every view is a link, `#tickets/42` or `#agents/J12`, that survives an Overseer restart.

**Every ticket gets its own worktree.** Builders work on a `ticket-<id>` branch in `.claude/worktrees/`,
never in your checkout. All worktrees write to one tracker, found through git's common directory, so
five agents still make one chart.

**The reviewer did not write the code.** Each review round is a fresh agent that starts from the builder's
Handoff and the diff, is told to show the ticket does *not* hold, and re-runs every claim itself. It
fixes what is in scope and files everything else as a low-priority ticket.

**The rules live in code, not in prompts.** Slots, gates, review rounds and parking are decided by the
Overseer. Another review round happens only when a pass reworked more lines of code than the rework
threshold (comments and docs do not count). A red gate resumes the same builder with the failure in hand;
two failed passes park a ticket for you, and two agents in a row dying stop launching as an outage instead
of blaming the tickets. What only you can answer becomes a decision in the Questions view.

**Merges cannot collide.** Store the repository's gates once with `agent-progress gate add`, and every
build runs them on its final commit. The Airlock holds one Airlock per target: it merges the target's
tip into the reviewed branch, gates the merged tree, and lands it by a compare-and-swap fast-forward, so a
main line that moved meanwhile only requeues the ticket. On this board a row's *done* pill means merged.

**You see what every agent cost.** The Agents view shows each job's calls and tokens live, read from its
own session. When a job working tickets ends, the Overseer adds everything it processed, its subagents and
cache reads included, to the row of each ticket it worked. `agent-progress usage` audits the figures from
the transcripts.

## How it works

| Role | Runs as | Does |
|---|---|---|
| **You** | yourself, in the Bridge or a Claude Code session | Describe the work, ready drafts, answer decisions, pause and stop. |
| **Overseer** | `agent-progress oversee`, one Overseer per board | Launches every job below, gates each build, decides rounds and parking, serves the Bridge, reads each session's calls and tokens live. |
| **Bridge** | the page the Overseer serves on `127.0.0.1`, opened with `agent-progress open` | Shows the board and takes your moves: Kanban, Progress, Tickets, Agents, Questions, Assistant and Intake. |
| **Product owner** | a job the Overseer launches for an Intake request, or any Claude Code session with the `agent-po` skill | Files draft tickets with a brief and a numbered Acceptance, its fact-finding in subagents. Builds nothing. |
| **Assistant** | the Overseer's own orchestrating session | Handles the incidents the Overseer delivers and chats with you in the Assistant view. Writes no code. |
| **Orchestrator** | optionally, your Claude Code session with `/agent-progress-orchestrate` | Starts the Overseer on your go and turns what you say into board commands. Drives nothing itself. |
| **Builder** | a job in the ticket's worktree, Opus at medium effort unless the ticket names another | Builds the ticket and reports its gates and a Handoff on its final commit. |
| **Reviewer** | a fresh job in the same worktree | Tries to prove the build wrong, fixes what is in scope, files the rest as low-priority tickets. |
| **Airlock** | the Overseer's merge queue | Merges each reviewed ticket onto its target one at a time, a resolver agent taking a conflict, and gates the merged tree before it lands. |

<p align="center">
  <img src="docs/images/lifecycle.png" width="560" alt="One ticket, start to merge: you describe the work, a product owner files a draft, once you ready it the Overseer starts a builder in a worktree, a fresh agent reviews it, a large rework loops to another round, otherwise the Airlock merges it into main and done means merged; findings outside scope become low-priority tickets and the Overseer reads each session's calls and tokens live">
</p>

You can keep filing tickets while the Overseer runs; it picks each one up as soon as it is ready and a slot
is free, and a high-priority one goes first. `agent-progress oversee pause` starts no new job while the jobs in
flight carry on, and `agent-progress job wind-down <job>` or `job stop <job>` ends one. Every job and its state live
on the board, so a restarted Overseer picks up where the last one left off.

<details>
<summary><b>Where everything goes</b> — the architecture</summary>
<br>
<p align="center">
  <img src="docs/images/architecture.png" width="680" alt="One Overseer owns the board: you work through the Bridge in your browser or an optional orchestrator session; both reach the Overseer, agent-progress oversee, which launches product-owner, builder, reviewer and Assistant sessions, keeps .agent-progress/, and passes reviewed tickets through the merge queue to the Airlock, which lands them on main one at a time">
</p>
</details>

## Get started

### 1. Install once

```sh
git clone https://github.com/AlexDM0/agent-progress.git && cd agent-progress
./setup.sh
```

<p align="center">
  <img src="docs/images/terminal-setup.png" width="790" alt="Terminal output of setup.sh: Bun found, dependencies installed and agent-progress on your PATH, then Tooling ready">
</p>

It offers to install Bun if it is missing and links the CLI; it changes nothing in your projects and installs no
skill globally: `agent-progress init` copies both skills into each repository it adopts. [Getting the code running](docs/development.md#getting-the-code-running)
walks through each step.

**Updating.** A `git pull` in this checkout updates the CLI and the skills' source. Then run
`agent-progress update` in every repository it tracks: it rewrites the session instructions, the default
briefs, the skill copies and the other files it installed, and records their install version in
`.agent-progress/version.json`. When the
pull changed the install version, most commands in that repository refuse at exit 1 until it has run
there, and say to run it; see
[Install version](docs/cli.md#install-version).

### 2. Adopt a repository

```sh
cd ~/code/example-storefront
agent-progress init --project "Example Storefront"
```

<p align="center">
  <img src="docs/images/terminal-init.png" width="720" alt="Terminal output of agent-progress init for Example Storefront, listing tracker, session instructions, dashboard, .gitignore entry, CLAUDE.md, retired files, SessionStart hook, skills and worktrees folder, followed by agent-progress oversee --detach printing the Overseer's local URL">
</p>

`init` writes seven things:

- **`.agent-progress/`**, the tracker: the state file, the log (`log.jsonl`), a `tickets/` folder, the
  `progress.html` stub that points at the live Bridge, and the lock.
- **`.gitignore` entries** for `.agent-progress/` and the worktrees folder, unless git already ignores them.
- **The files beside the tracker**: the session instructions, the reference (the ticket format, the moves and
  the exit codes) and the default briefs under `.agent-progress/briefs/defaults/`, which each job reads when
  the board's pipeline names no other.
- **A `SessionStart` hook** in `.claude/settings.local.json`, which tells every session you open in the
  repository how it tracks its work. `--no-hooks` leaves it out.
- **The two skills**, copied into `.claude/skills/agent-po/` and `.claude/skills/agent-progress-orchestrate/`
  and git-ignored there, so Claude Code loads them in this repository only: `agent-po` whenever a session is asked to
  file a ticket, bug or research question (or on `/agent-po`), and `agent-progress-orchestrate` for a session
  working alongside the Overseer, which loads `agent-po` for its intake.
- **Removed once**: whatever an older install wrote that the Overseer replaced, a managed `CLAUDE.md` block
  among it, so commit `CLAUDE.md` when `init` says it changed.
- **`.agent-progress/version.json`**, the install version of everything the tool installs, written last.

`agent-progress update` refreshes the tool's files later, never touching your tickets and log.

### 3. Run the board

Start the Overseer and open the Bridge:

```sh
agent-progress oversee --detach
agent-progress open
```

On a board with no gates yet it first starts an onboarder that proposes them, and asks you in the Questions
view. Then
describe what you want in Intake, one request or ten, ready the drafts the product owner files, and the board
fills in from there. To work from Claude Code instead, open it in the repository and type
`/agent-progress-orchestrate`.

> [!TIP]
> The board allows two agents at once by default. `agent-progress concurrency <n>` raises it, up to ten.

## Privacy

<table>
  <tr>
    <td width="33%" valign="top"><b>No network</b><br><sub>agent-progress itself makes no network request: the Bridge listens on 127.0.0.1 only; no telemetry, no CDN, no web fonts.</sub></td>
    <td width="33%" valign="top"><b>Plain files</b><br><sub>All state is JSON and markdown in <code>.agent-progress/</code> at the repository root, git-ignored.</sub></td>
    <td width="33%" valign="top"><b>Your own agents</b><br><sub>The agents it tracks are your own Claude Code sessions. The page's view choices stay in your browser.</sub></td>
  </tr>
</table>

Downloads happen only at setup: `bun install` fetches the packages, and if Bun is missing `setup.sh`
offers its official installer.

## Information

<table>
  <tr>
    <td width="190"><b>Requires</b></td>
    <td>Bun (1.2 or newer recommended), git, Claude Code</td>
  </tr>
  <tr>
    <td width="190"><b>Runs in</b></td>
    <td>your terminal: the Overseer, <code>agent-progress oversee</code>, launches every agent as a Claude Code session of its own</td>
  </tr>
  <tr>
    <td width="190"><b>Runtime dependency</b></td>
    <td><code>marked</code>, for ticket bodies on the page</td>
  </tr>
  <tr>
    <td width="190"><b>Storage</b></td>
    <td><code>.agent-progress/</code> at the repository root, shared by every worktree</td>
  </tr>
  <tr>
    <td width="190"><b>Dashboard</b></td>
    <td>the Bridge, served by the Overseer on <code>127.0.0.1</code>: Kanban · Progress · Tickets · Agents · Questions · Assistant · Intake; light, dark or auto.</td>
  </tr>
  <tr>
    <td width="190"><b>Agents</b></td>
    <td>builders and reviewers on Opus at medium effort, per ticket overridable, the Assistant on Sonnet; 2 at once by default, 10 at most</td>
  </tr>
  <tr>
    <td width="190"><b>Source</b></td>
    <td><a href="https://github.com/AlexDM0/agent-progress">github.com/AlexDM0/agent-progress</a></td>
  </tr>
</table>

## Further reading

- **[CLI reference](docs/cli.md)**: every command and flag, the exit codes, what `init` and `update` write,
  the dashboard in detail and the files on disk.
- **[Developing agent-progress](docs/development.md)**: getting a checkout running, the checks every change
  must pass, the repository layout, the test helpers and guard specs, and the decisions
  behind the design.
