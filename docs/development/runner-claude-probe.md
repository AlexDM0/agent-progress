# Runner probe: the Claude stream, question and permission contract (T1, P1-P8)

What Claude Code 2.1.311 did on 2026-10-27 for the runner's contract, probe by probe, and which design fallback each
finding selects. The probe repository, driver, settings files and full logs are git-ignored, in the main checkout's
`.claude/.evidence/runner-claude-probe/` (`drive.py` drives one stream-json session, `summarise.py` prints a log as
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
for a live host; it stays for the no-live-host case.

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

`p5/settings.json` denies `Edit` and `Write` of `//<data>/**`, `//<W>/relay/**`, the main checkout's tracked files and
`//<worktree>/.claude/**`, and `Read` of `//<data>/jobs/*/launch-*.json`. In auto mode (`p5/run1.log`) every one is
refused with "File is in a directory that is denied by your permission settings": an Edit of `<data>/gates/gate.txt`,
a Write and an Edit in another job's relay folder `<W>/relay/J2/`, an Edit of the main checkout's `file.txt`, a Write
under the worktree's `.claude/`, and a Read of a launch file. An Edit of the worktree's own file succeeded.

A Write to a folder outside the repository that no rule names **succeeded** in auto mode without a prompt
(`outside/written.txt`): auto mode does not confine Edit and Write to the working directory, so every path a worker
must not write needs its own deny rule.

The sandbox glob is honoured. Under the auto mode settings a Bash `cat` of a launch file, and a Bash write into
`<data>/gates/`, are refused by the classifier ("Auto-Mode Bypass") before the sandbox is reached, even with
`Bash(cat *)` allowed (`p5/run2-sandbox-deny-read.log`). With the `Read` rule removed and `--permission-mode dontAsk`
so that only the sandbox decides (`p5/run3-sandbox-only-dontask.log`), `cat` of `<data>/jobs/J2/status.json` prints
it while `cat` of `jobs/J2/launch-1.json` and `jobs/J1/launch-7.json` both fail "Operation not permitted", and the
write into `<data>/gates/` fails the same way. The launch-folder fallback (`<data>/runner/launches/`) is not needed.

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

## P7: host death and the Bash child's process group

The Bash tool's command runs in a process group of its own: the CLI starts `/bin/zsh -c source <snapshot> … eval
<command>` as a group leader, and the command and its children inherit that group, not the CLI's
(`p7/kill-group.log`: CLI group 58080, `sleep` in group 59315). `kill(-<CLI pgid>, SIGKILL)` therefore leaves the
command running, reparented to launchd (`### after kill(-pgid): … orphan`). The fallback applies: the host kills the
whole process tree, every group found among the CLI's descendants, which left no orphan of that run
(`p7/kill-tree.log`). Descendants are listed from `ps -A -o pid=,ppid=,pgid=` before the kill; a child forked between
the listing and the kill would escape, so the kill repeats until the listing is empty.

When the host dies mid-turn, closing the CLI's stdin and stdout, the agent does not stop. With a long tool call still
running the CLI stayed alive for the 30 seconds observed (`p7/close-pipes.log`). With a short one it finished the
turn without a reader: the tool returned, the agent made its next call (a Write, which created
`after-host-death.txt` in the worktree), ended the turn, and exited 0 on the closed stdin
(`p7/close-pipes-tool-finishes.log` and its transcript). A lost host therefore leaves an agent working unobserved
until its turn ends; the runner kills the job's process tree before it resumes or replaces the job.

## P8: a chat line written mid-turn

Folded. A user line written while the first turn's Bash call ran was taken into that same turn: the transcript
records `queue-operation` `enqueue`, then `remove` with reason `absorbed_mid_turn`, and the model received it as "The
user sent a new message while you were working". One `result` came for the two lines, its text answering both, and no
second turn followed within 90 seconds (`p8/mid-turn.log`, `p8/mid-turn-transcript.jsonl`; fixture
`mid-turn-line-folded`). Stdout carries no record of the absorption, so the runner reads a line written before a turn's
`result` as delivered in that turn, and never expects one `result` per line.

## The environments

P2 and P4 ran twice: with the probe driver's inherited environment, which is a dispatched builder's (`CLAUDECODE`,
`CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_MESSAGING_SOCKET`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_SIMPLE` and the rest of
its `CLAUDE_*` variables set), and under `env -i HOME PATH USER` (`--clean-environment`). Every finding was the same
under both, and subscription authentication worked with those three variables alone (`apiKeySource` `none`).
