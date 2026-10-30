# Overseer probe: the Claude stream, question and permission contract (T1 P1-P8, T1b P9-P17)

What Claude Code 2.1.311 did on 2026-10-27 for the Overseer's contract, probe by probe, and which design fallback each
finding selects. The probe repository, driver, settings files and full logs are git-ignored, in the main checkout's
`.claude/.evidence/overseer-claude-probe/` (`drive.py` drives one stream-json session, `summarise.py` prints a log as
one line per event, `export-fixture.py` turns a log into a fixture); paths below are relative to that folder. Every
session ran `claude -p --input-format stream-json --output-format stream-json --verbose --model haiku` in a linked
worktree nested in its main checkout (`repo/.agent-progress-worktrees/ticket-1/`), with the data folder at
`repo/.agent-progress/`, plus the flags each probe names. The stream fixtures sit in
`src/lib/claude-code/testing/fixtures/`, held by `src/lib/claude-code/ClaudeStreamFixtures.spec.ts`; their paths and
the init record's skill, command and plugin lists are replaced by synthetic ones.

## P1: a live answer by `control_response`

Confirmed. Under `--permission-mode auto --permission-prompt-tool stdio --json-schema <schema text>` the question
arrives as a `control_request` `can_use_tool` for `AskUserQuestion` with `requires_user_interaction: true`. The reply

```
{"type":"control_response","response":{"subtype":"success","request_id":<id>,
 "response":{"behavior":"allow","updatedInput":{<the request's input>,"answers":{"<question text>":"<label>"}}}}}
```

gives the tool the result "Your questions have been answered: …", the agent calls `StructuredOutput`, and the one
`result` is `success` with `structured_output` `{"colour":"Blue"}`, valid against the schema
(`p1/run1-live-answer.log`; fixture `ask-user-question-live-answer`). The resume fallback of design §8.2 is not needed
for a live Watcher; it stays for the no-live-watcher case.

## P2: the CLAUDE.md upward walk

Under `--setting-sources project`, `~/.claude/CLAUDE.md` and `~/development/agent-progress/CLAUDE.md` load as
"project instructions" beside the worktree's own CLAUDE.md, under both environments (`p2/baseline-inherited` and
`p2/baseline-clean`, each a `.log` and a `-transcript.jsonl`). A `--settings` file holding
`{"claudeMdExcludes": ["<home>/.claude/CLAUDE.md", "<home>/development/agent-progress/CLAUDE.md"]}` stops both while
the worktree's CLAUDE.md still loads, again under both environments (`p2/excludes-inherited`, `p2/excludes-clean`).
The CLI matches the setting's entries with picomatch against absolute paths of User, Project and Local memory files,
and reads it from the flag settings even though `--setting-sources project` drops the user layer. Only absolute paths
were tried, not globs.

Selects: T10 renders `claudeMdExcludes` into every job's `settings.json`, listing each memory file above the main
checkout (`CLAUDE.md`, `CLAUDE.local.md` and `.claude/CLAUDE.md` of every ancestor folder, the home folder's included).
Owner answer Q33's "stop the walk" branch applies; workers need not accept the user file.

## P3: `--disable-slash-commands`

Confirmed. With the flag the init record's `skills` and `slash_commands` are empty and the `Skill` tool is gone; the
`Task` tool and the `agents` list are unchanged, and a `general-purpose` subagent ran and replied
(`p3/disable-slash-commands.log`, three sidechain records). Without the flag the worktree's own tracked skill and the
user's skills are listed (`p3/with-skills.log`). An untracked skill in the main checkout's `.claude/skills/` was not
listed in the nested worktree session even without the flag; the earlier probe's visible main-checkout skill was most
likely a tracked one, which the worktree carries itself. The fallback (keep skills, forbid them in the role prompt) is
not needed.

## P4: the network guard in auto mode

Every run had `sandbox.enabled`, `allowUnsandboxedCommands: false` and `network.allowedDomains: []` in its `--settings`
file; the agent ran `curl https://example.com`, then the same command with `allowed_domains: ["example.com"]`, then a
WebFetch of `https://example.org` (`p4/<configuration>-<environment>.log`).

| Configuration | Bash, no list | Bash with `allowed_domains` | WebFetch of an unlisted domain |
| --- | --- | --- | --- |
| auto mode alone (`classifier`) | sandbox proxy refuses | granted, `200` | fetched |
| `strictAllowlist: true` (`strict`) | sandbox proxy refuses | refused before running (1) | fetched |
| `bash-domains` hook on `Bash\|WebFetch` (`hook`) | sandbox proxy refuses | denied by the hook | denied by the hook |

(1) "allowed_domains cannot widen network access in this session". The hook is a `PreToolUse` hook.

Identical under both environments. No `control_request` arrived for any of these calls: the classifier decides alone.
The hook was a stand-in script (`p4/bash-domains-hook.py`) with the design's contract; the calls it saw are in
`p4/hook-calls-<environment>.jsonl`.

Selects: both guards deny the Bash request, and only the hook denies the WebFetch, so T13a renders the hook for every
role with a `network` line (and `strictAllowlist`, which makes the Bash refusal deterministic without the hook). Owner
answer Q37's fallback branch ("if neither denies, auto mode stays and may grant a listed domain") does not apply: auto
mode stays with the guards. Unrelated to the guards: claude.ai connector tools (17 `mcp__` tools) appeared in some
sessions under either environment and not in others, so `--strict-mcp-config` stays necessary.

## P5: Edit, Write and Read under `//`-anchored rules, and the `denyRead` glob

`p5/settings.json` denies `Edit` and `Write` of `//<data>/**`, `//<W>/hatch/**`, the main checkout's tracked files and
`//<worktree>/.claude/**`, and `Read` of `//<data>/jobs/*/launch-*.json`. In auto mode (`p5/run1.log`) every one is
refused with "File is in a directory that is denied by your permission settings": an Edit of `<data>/gates/gate.txt`,
a Write and an Edit in another job's Hatch folder `<W>/hatch/J2/`, an Edit of the main checkout's `file.txt`, a Write
under the worktree's `.claude/`, and a Read of a launch file. An Edit of the worktree's own file succeeded.

A Write to a folder outside the repository that no rule names **succeeded** in auto mode without a prompt
(`outside/written.txt`): auto mode does not confine Edit and Write to the working directory, so every path a worker
must not write needs its own deny rule.

The sandbox glob is honoured. Under the auto mode settings a Bash `cat` of a launch file, and a Bash write into
`<data>/gates/`, are refused by the classifier ("Auto-Mode Bypass") before the sandbox is reached, even with
`Bash(cat *)` allowed (`p5/run2-sandbox-deny-read.log`). With the `Read` rule removed and `--permission-mode dontAsk`
so that only the sandbox decides (`p5/run3-sandbox-only-dontask.log`), `cat` of `<data>/jobs/J2/status.json` prints
it while `cat` of `jobs/J2/launch-1.json` and `jobs/J1/launch-7.json` both fail "Operation not permitted", and the
write into `<data>/gates/` fails the same way. The launch-folder fallback (`<data>/overseer/launches/`) is not needed.

## P6: the resume argv

Confirmed: in the original working directory,

```
claude -p --model <role model> --input-format stream-json --output-format stream-json --verbose
  --resume <session id> --json-schema <schema text> --setting-sources project --settings <re-rendered settings file>
  --permission-mode auto --permission-prompt-tool stdio
```

keeps the session id in `init` and `result`, recalls the earlier turn's answer from its transcript, and returns a
schema-valid `structured_output` (`p6/resume.log`; fixture `resume-structured-output`). The settings file was a fresh
file of the same content at a new path.

## P7: Watcher death and the Bash child's process group

The Bash tool's command runs in a process group of its own: the CLI starts `/bin/zsh -c source <snapshot> … eval
<command>` as a group leader, and the command and its children inherit that group, not the CLI's
(`p7/kill-group.log`: CLI group 58080, `sleep` in group 59315). `kill(-<CLI pgid>, SIGKILL)` therefore leaves the
command running, reparented to launchd (`### after kill(-pgid): … orphan`). The fallback applies: the Watcher kills the
whole process tree, every group found among the CLI's descendants, which left no orphan of that run
(`p7/kill-tree.log`). Descendants are listed from `ps -A -o pid=,ppid=,pgid=` before the kill; a child forked between
the listing and the kill would escape, so the kill repeats until the listing is empty.

When the Watcher dies mid-turn, closing the CLI's stdin and stdout, the agent does not stop. With a long tool call still
running the CLI stayed alive for the 30 seconds observed (`p7/close-pipes.log`). With a short one it finished the
turn without a reader: the tool returned, the agent made its next call (a Write, which created
`after-watcher-death.txt` in the worktree), ended the turn, and exited 0 on the closed stdin
(`p7/close-pipes-tool-finishes.log` and its transcript). A lost Watcher therefore leaves an agent working unobserved
until its turn ends; the Overseer kills the job's process tree before it resumes or replaces the job.

## P8: a chat line written mid-turn

Folded. A user line written while the first turn's Bash call ran was taken into that same turn: the transcript
records `queue-operation` `enqueue`, then `remove` with reason `absorbed_mid_turn`, and the model received it as "The
user sent a new message while you were working". One `result` came for the two lines, its text answering both, and no
second turn followed within 90 seconds (`p8/mid-turn.log`, `p8/mid-turn-transcript.jsonl`; fixture
`mid-turn-line-folded`). Stdout carries no record of the absorption, so the Overseer reads a line written before a turn's
`result` as delivered in that turn, and never expects one `result` per line.

## P9: auto-memory, subagent models, `modelUsage`, the explorer and the `Agent` rule

Every run passed the agents through `--agents` and ran in `--permission-mode dontAsk`, so only allow rules let a tool
run (`p9/run-*.log`, settings and agents beside them).

- **Auto-memory.** `"autoMemoryEnabled": false` in the `--settings` file is the switch: the init record's
  `memory_paths` key is absent with it (`run-a`) and names the project's `memory/` folder without it (`run-b`).
- **Model precedence.** An explorer defined with `"model": "sonnet"`, started without a `model` parameter, ran on
  Sonnet (`run-c1`), and still did with `CLAUDE_CODE_SUBAGENT_MODEL=opus` set (`run-c2`, the variable inherited by the
  driver, which its log does not record): the variable does not override a definition's model. A `model` parameter in
  the `Agent` call does: a coder defined as Sonnet, started with `"model": "haiku"` by the parent, ran on Haiku
  (`run-a`, no Sonnet in `modelUsage`).
- **`modelUsage` includes subagents.** With a Sonnet explorer under a Haiku session, the `result`'s `modelUsage` has a
  `claude-sonnet-5-5` entry beside Haiku's, while `usage` counts the top level only (`run-c1`: 303 top-level output
  tokens, `modelUsage` 303 Haiku plus 199 Sonnet). A subagent the parent started in the background was still running at
  the `result` (`run-c2`), whose `modelUsage` held only the Sonnet tokens spent so far.
- **The explorer searches.** Read plus `Bash(rg *)`, `Bash(grep *)` and `Bash(find *)` in its `tools` let it run
  `rg -l` under dontAsk (`run-a`, `run-c1`). The patterns are no confinement: it also ran `cat file.txt`
  (`run-explorer-limits.log`, its transcript `explorer-limits-subagent-transcript.jsonl`).
- **The `Agent` rule.** With `Agent(coder)` in `permissions.deny`, the call was refused "Agent type 'coder' has been
  denied by permission rule 'Agent(coder)' from flagSettings" while the explorer ran (`run-b`); the init record lists
  the tool as `Task`.

Selects: T10 renders `autoMemoryEnabled: false`; each agent definition names its model, and `role.md` tells the agent
never to pass `model` to the `Agent` tool, since the call's parameter wins. T13a may take `modelUsage` as the session
total at a `result` with no background subagent running, and otherwise adds the subagent transcripts.

## P10: `rate_limit_event` at a rejected limit

Rate-limit events are emitted only for a subscription login, so the probe pointed `ANTHROPIC_BASE_URL` at a local
stand-in for the Messages API (`p10/stub-server.ts`) that answers with the unified rate-limit headers, and logged in
with a dummy `CLAUDE_CODE_OAUTH_TOKEN` under `env -i HOME PATH USER`. With an API key instead, no `rate_limit_event`
came: a 429 gave one `api_retry` and an error result (`p10/rejected.log`).

- **Top-level rejected** (`p10/rejected-oauth.log`; fixture `rate-limit-rejected`): the event's `status` is `rejected`,
  `rateLimitType` `five_hour`, `resetsAt` the window's reset in epoch seconds, `unifiedWindows.five_hour.status`
  `rejected`. No retry follows; the `result` has `is_error: true`, `api_error_status: 429`, `terminal_reason`
  `api_error`, the text "You've hit your session limit · resets …", and `subtype` `success`.
- **A window rejected under overage** (`p10/window-rejected-oauth.log`; fixture
  `rate-limit-window-rejected-under-allowed`): with the five-hour window `rejected`, overage `allowed` and in use, and
  the seven-day window at `allowed_warning`, the top-level `status` is `allowed_warning`, not `allowed`, and the turn
  answers normally.

Selects: the design's reading holds (only a top-level `rejected` interrupts); T13a reads `status === 'rejected'`, not
`status !== 'allowed'`, and treats an `is_error` result with `api_error_status` 429 as the limit whatever its `subtype`.

## P11: a product-owner session under `<W>/sessions/<J>/`

The session ran in a plain folder `repo/.agent-progress-worktrees/sessions/J3/` of the main checkout, without
`--disable-slash-commands`, under the sandbox with `allowWrite` of its Hatch folder `hatch/J3` and the design's
permission denies (`p11/settings.json`, `p11/po-session.log`). The init record lists `agent-po` (installed untracked in
the main checkout's `.claude/skills/`) among its skills, and the main checkout's CLAUDE.md loaded: the agent quoted its
marker line. Writing its own session folder worked; `<data>/gates/` and another job's Hatch folder `hatch/J2/` failed
"Operation not permitted".

**Its own Hatch folder failed too.** The `Edit` and `Write` deny of `<W>/hatch/**` is also applied to the sandbox as a
write deny, which beats `allowWrite`. With that rule replaced by `Edit` and `Write` denies of the other job's folder
alone, the Bash write into `hatch/J3/` succeeded and both other writes still failed
(`p11/po-session-other-relays-only.log`).

Selects: T13 renders the Hatch `Edit`/`Write` denies per other job's Hatch folder, never over `<W>/hatch/**`, and leaves
the job's own folder to the sandbox's `allowWrite`.

## P13: `.claude/settings.local.json` in a worktree

Read under `--setting-sources project,local`: a `SessionStart` hook in the worktree's `.claude/settings.local.json`
ran (`p13/project-local.log`, `p13/hook-markers.txt`). Under `--setting-sources project` it did not
(`p16/project-only.log`). Workers exclude `local`, so it stays irrelevant to them; T19 may rely on the file being read
from the session's own worktree when `local` is included.

## P14: signing, and the ref denies, under the rendered per-job sandbox

`p14/render.py` renders design section 4.4's settings for job J1 on `ticket-1` (write denies of `<data>/`, the monitor
folder, `<worktree>/.claude/`, `<common>/packed-refs`, `refs/heads/main`, `refs/heads/group-alpha`,
`refs/heads/ticket-2` and `<common>/worktrees/ticket-2/`; read denies of the launch files, `~/.ssh`, `~/.aws`) with one
signing allowance; `p14/probe.sh` then runs every attempt in one sandboxed Bash call. The owner's git signs with gpg
(`commit.gpgsign=true`), whose `common.conf` has `use-keyboxd`, so gpg needs two sockets: the agent's for the key and
keyboxd's for the public keyring.

| Allowance | Signed commit, inherited | Signed commit, `env -i` |
| --- | --- | --- |
| none: `~/.gnupg` read-denied | fails: keyring unreadable | fails |
| the gpg-agent socket alone (1) | fails: "can't connect to the keyboxd" | fails |
| the agent and keyboxd sockets (1) | **signs** (`gpgsig` header present) | **signs** |
| writes to `~/.gnupg` with the agent socket | fails, and gpg started a second keyboxd | fails |

(1) Through `network.allowUnixSockets`, with `~/.gnupg` readable and its `private-keys-v1.d/` read-denied.

Logs: `p14/<allowance>-<environment>.log`, with `rerun-` and `final-` reruns of the socket rows; the `final-` pair holds
every attempt. Under the socket allowance gpg still warns that it cannot create its lock file in `~/.gnupg`, without
failing. Two hazards: the writes allowance let the sandboxed gpg start its own keyboxd, which took over the socket
and left the owner's gpg waiting on the old daemon's lock until both daemons were stopped; and verifying a signature
in the sandbox (`git log --format=%G?`) hung and outlived its session.

In every run the unsigned commit (`-c commit.gpgsign=false`) and a new branch succeeded, and every write the denies
name failed: `git update-ref` of `main`, `group-alpha` and `ticket-2` ("couldn't set"), an append to `packed-refs`,
and a write or new file in `<common>/worktrees/ticket-2/`, while the job's own `<common>/worktrees/ticket-1/` stayed
writable; `private-keys-v1.d/` stayed unreadable and `~/.gnupg` unwritable. `git branch -f` of a checked-out branch is
refused by git itself before the sandbox is reached. The refs were unchanged after every run (`### refs after`).

Selects: the signing allowance is the agent socket plus the keyboxd socket (`gpgconf --list-dirs agent-socket` and
`keyboxd-socket`) through `network.allowUnixSockets`, `~/.gnupg` readable but not writable, `private-keys-v1.d/`
read-denied; writes to `~/.gnupg` are never granted, and `commit.gpgsign=false` is not needed (owner answer Q32). The
ref denies hold, so owner answer Q38's `target-moved` fallback does not apply: the silent requeue stays, with V14 for
refs created after launch.

## P15: this repository's checks and install lines under the gate Seatbelt profile

`p15/render-profile.py` writes design section 5.2's profile for a linked worktree of this repository: everything
allowed but writes, which go only to the worktree, its own admin folder, temp (`/private/tmp`, `/private/var/folders`)
and `~/.bun/install/cache`; writes denied to `<data>/`, the monitor folder, `<common>/refs` and `packed-refs`; reads
denied of `~/.ssh`, `~/.aws`, `~/.gnupg/private-keys-v1.d`, the Overseer token and the launch files; `(deny network*)`
for the checks line (`gate-off.sb`), network on for the install line (`gate-on.sb`).

The install line `bun install` passed in both environments (`install-inherited.out`, `install-clean.out`). The checks
line `bun run verify` failed one test of 4064 in both: `src/lib/git/BranchIntegration.spec.ts` committed in a scratch
repository without `commit.gpgsign=false`, so gpg, denied its keyring, could not sign (`checks-inherited.out`,
`checks-clean.out`). With that spec fixed on this branch the checks line passes under the profile in both environments
(`checks-fixed-inherited.out`, `checks-fixed-clean.out`); no test needed the network or loopback.

Selects: gates and install lines run sandboxed and the shared gate cache stays; the memory-only fallback is not needed.
A gate gets no signing allowance, so its process Watcher sets `commit.gpgsign=false` through the `GIT_CONFIG_*` triple.

## P16: setting sources and the worktree's CLAUDE.md and hooks

The worktree's CLAUDE.md loads only when `project` is among the sources: under `--setting-sources project` and
`project,local` the agent quoted the worktree's own marker line; under `--setting-sources user` it found none, and under
`--setting-sources ""` it found it only by reading the file with the Read tool (`p16/<run>.log` and transcripts).
A `SessionStart` hook in the worktree's `.claude/settings.json` ran under `--setting-sources project` and under
`project,local`, and not without `project` (`p16/hook-markers.txt`).

Selects: workers keep `--setting-sources project`, so the worktree's `.claude/` stays write-denied and V13 checks every
branch before a launch on it.

## P17: `permissions.blockReadsOutsideWorkingDirectories`

With it on (`p17/settings.json`, `p17/block-reads-git.log`), git in the worktree read the shared `.git` (`rev-parse
--git-common-dir`, `status`, `log`, `cat` of `<common>/config`) and committed, while both a Bash `cat` and a Read of the
main checkout's CLAUDE.md, or of any file outside the repository, were refused; for Bash it also refused running a
script outside the worktree (`p17/block-reads.log`). Without it the same reads succeed (`control-no-block-git.log`).

Selects: the setting confines sandboxed Bash as well as Read and leaves git working, but it also blocks every read of
`<data>/`, which the read-only verbs need under a job; T13 adds it only together with a read grant of `<data>/`
(untested here), otherwise the design's `denyRead` list stays the read confinement.

## The environments

P2, P4, P14 and P15 ran twice: with the probe driver's inherited environment, which is a dispatched builder's
(`CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_MESSAGING_SOCKET`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_SIMPLE` and
the rest of its `CLAUDE_*` variables set), and under `env -i HOME PATH USER` (`--clean-environment`). Every finding
was the same under both, and subscription authentication worked with those three variables alone (`apiKeySource`
`none`). P15's inherited environment is this builder's own, a dispatched builder's; its gates ran under `sandbox-exec`
directly.
P9, P11, P13, P16 and P17 ran in the inherited environment only, and P10 under `env -i` plus its stand-in variables.
