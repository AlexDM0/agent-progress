# Cutover smoke: the Overseer end to end with real Claude sessions

The owner runs this before unholding the release ticket (design §13.4 step 4): it proves, with real `claude` sessions,
that the branch's Overseer drives tickets from filing to delivered with no session of User's. It is a script, never a
spec: `cli/testing/CutoverSmoke.ts`, its judgement `cli/testing/CutoverSmokeUtil.ts`, held by
`cli/testing/CutoverSmokeUtil.spec.ts`.

## Running it

In a scratch clone of the group tip (or a worktree of it), after `bun install`:

```
bun cli/testing/CutoverSmoke.ts --with-real-claude [--model sonnet] [--effort medium] [--timeout-minutes 120]
    [--main-checkout <path>]
```

- `--with-real-claude` is the opt-in: without it the script refuses at exit 1, since every session spends subscription.
- It refuses when `PRODUCT_NAMES` is the released program's (`PROGRAM` `agent-progress`, or its data or monitor folder),
  so it runs only under the side-by-side names: `agent-progress-v2`, `.agent-progress-v2/`, `~/.agent-progress-v2-monitor/`.
- `--model` and `--effort` go on both tickets; without them the product's defaults apply.
- The log goes to `<main checkout>/.claude/.evidence/cutover-smoke/cutover-smoke-<stamp>.log`, beside the board's
  `-log.jsonl`, `-overseer.log` and the SSE client's `-events.ndjson`. The main checkout is the one the script's
  checkout belongs to (`git rev-parse --git-common-dir`), or `--main-checkout`; the script refuses when that folder is
  not git-ignored there. In a standalone scratch clone, pass the real main checkout.
- Exit 0 only when items 1-5 pass.

Everything else is scratch: a fresh git repository under the temporary folder holding `README.md` and `palette.txt`,
and a `bin/` folder whose `agent-progress-v2` shim runs this checkout's `agent-progress.ts`, put first on the
children's `PATH` so the Overseer's sessions reach the branch's binary without a `bun link`. The children inherit the
environment minus the fake-agent switch, a job's variables and the root override; `HOME` stays real, since `claude`
signs in from it, so the Overseer registers the scratch board in `~/.agent-progress-v2-monitor/projects.json`. The
scratch repository is kept for reading and named on the log's last line; remove it afterwards.

## What it does

1. `init --no-hooks`, commits the ignores, adds three gates (`readme`, `palette`, `palette-file`), stores a `review`
   phase in the scratch `pipeline.json` (an optional phase no command writes), `concurrency 2`, `oversee pause`, then
   `oversee --detach` and an SSE client on `/api/events`.
2. Files two tickets and readies both, then `oversee resume`. Both append a line at the end of `palette.txt`, which plants a
   textual conflict whose resolution keeps both lines (two values for one line would rightly be `cannot-resolve`):
   - #001 asks User a colour through AskUserQuestion (header `colour`): an `agent-question` decision the script
     answers with `decide <id> a` as soon as it is open.
   - #002 reports its ticket malformed through AskUserQuestion with the reserved header `ticket`: a `malformed-ticket`
     incident the script leaves to the Assistant. An escalation opens an `agent-question` decision, answered as above.
3. At the first build job `running`: `kill -9` of the process the newest Baton names, `oversee --detach` again, a wait,
   `oversee restart`, a wait; the agent's Watcher process and Watcher instance are read before and after each.
4. Polls every ten seconds until both tickets are `delivered`, a decision only User may take opens (a park, a refused
   landing or merge), or the timeout, logging every change of the tickets and jobs; then `job stop --all`,
   a bounded wait for the stopped jobs to end, `oversee stop --now`, and kills the Watchers still running in the scratch board,
   logging apart how many belonged to ended jobs (the Overseer reaps those, so 0) and to jobs still live, such as the
   Assistant's, which outlive the Overseer by design.

## Reading the log

The last lines are one pass line per item (`item <n>: PASS — <evidence>` or `FAIL — <what is missing>`), judged from
the board's stored log and the received events:

| Item | Passes when |
| --- | --- |
| 1 | both tickets had a builder and a reviewer and were delivered; at least two landings; no two merges held one target at once; at least three passed `gate-ran` records |
| 2 | the build's Watcher process lived through the kill and the restart (or its job ended with no `job-interrupted`), its job folder holds no second Watcher instance, no further build job launched on its ticket, and `oversee restart` exited 0 |
| 3 | a `resolver` job ended `resolved` and its parent merge job then landed |
| 4 | #001's decision was answered and #001 finished after it; #002's `malformed-ticket` incident was answered or escalated |
| 5 | every ticket move logged while the stream was connected showed as that status in a `board` event, and every job launched then in a `job` event; the job states seen are listed. A move a later move of the ticket overtook in the same stamp is never published (an event carries what a whole pass left), and the gaps from the kill and the restart to the reconnection are not judged |

Item 6 is the script's own guard, logged at the start. A reviewer checks the pass lines against the copied board log.
