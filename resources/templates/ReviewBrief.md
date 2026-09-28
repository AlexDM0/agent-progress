# Review brief

What a reviewer follows: the block below is its whole procedure, plus the ticket's Browser loop when
the work has a user interface. The reviewer is a clean agent and owns the whole pass — an adversarial
review, every fix that review calls for, the certainty of those fixes, a closing rebase onto the main
line — and the release.

It fixes bugs in what it reviews, the branch's own change and the ticket's Acceptance, and in nothing
else: it is the last reader before the main line, so a fix beside the change would ship unreviewed.
A defect outside that, however small, is filed as a low-priority ticket. A fix the reviewer watched
fail and pass needs no second reader: a second review is only for a pass that reworked over
{{reworkThresholdLines}} lines of code, documentation and comments not counted, and is always asked
of the orchestrator.

The round is the number of `## Review` sections already in the ticket, plus one. From round 2 on,
say in the first line that the pass is scoped to the commits the previous reviewer authored and that
what the earlier Reviews settled is not to be re-derived. Step 0 reads the diff once, because a
reviewer that rebuilds the change file by file spends most of its input re-reading files already
open. Step 7b is a count, not a judgement, so that two reviewers reach the same verdict. Harness
subagents get their working directory reset to the main checkout, which is why every git command
names its checkout.

```
Worktree: <absolute path>   Branch: <branch>   Main checkout: <absolute path>   Main line: <name>
agent-progress row: <reviewRowId, the id of this review's own bar>
Review ticket <id> (or the bundle #a, #b, #c), round <N>; `agent-progress ticket show <id>` prints
one. Run git as `git -C <worktree>` unless a step names <main checkout>. The work is
`git diff <main line>...HEAD`.

0. Before you change anything, record `git -C <worktree> rev-parse HEAD` as <review start>. Then
   read the change once: the last `## Handoff`, `git -C <worktree> diff --stat <main line>...HEAD`,
   then the full `git -C <worktree> diff <main line>...HEAD` in one call (a large one split by path
   into the fewest calls, all in one message). Open a whole file only where the diff's context
   cannot settle a finding, every such file in one message of Read calls, never `cat` or `sed -n`
   through Bash. Re-read your own fixes with `git -C <worktree> diff <review start>`, not by
   re-opening files.
1. Set out to show the ticket does NOT hold — each ticket of a bundle on its own commits, and
   whatever a Handoff lists under `Also fixed`. The last `## Handoff` says where to look and proves
   nothing: re-run the measurement behind each claim with your own probe or count and state your
   numbers; a guard it watched fail, you watch fail. It fails if any is false: <two or three claims;
   a dispatched review reads them from the ticket's `## Brief`, under `Fails review if false`>.
2. Fix every finding in what you review — the branch's change and the ticket's Acceptance — yourself,
   with the Edit tool (no heredoc, edit script or `sed -i`), one commit per fix, one plain subject
   line. A defect outside that, however small, you report and do not fix, a few lines each with
   where and what you would do; so is a finding that needs a product or design decision or touches a
   file out of bounds. A dispatched reviewer files each itself,
   `agent-progress ticket add "<what and where>" --priority low --body "<what you saw>"`; by hand
   the orchestrator files what you report.
3. A change you reasoned to but did not watch fail and pass: build the probe and watch it. A doubt
   still open at the budget is `does not hold`, never a caveat.
   Every probe that touches a scratch repository names it absolutely (`git -C <scratch>`,
   `AGENT_PROGRESS_ROOT=<scratch>` before every agent-progress command in it, `cd <scratch> && …`
   joined with `&&`, never `;`); `--root` is `init`'s alone, and any other command refuses it.
   Never write into any `.git` directory by hand.
4. Count your fixes before you rebase, since the rebase rewrites <review start>:
   `agent-progress rework --since <review start> --worktree <worktree>`.
5. Record `git -C <worktree> rev-parse HEAD` as <pre-rebase tip>, then `git rebase <main line>`,
   never `-i`: resolve with Edit, `git add`, `GIT_EDITOR=true git rebase --continue`. Run
   `<full check command> 2>&1 | tail -20` until green, commit what is uncommitted. Step 3 covers
   hunks you resolved by hand. Count what the rebase changed:
   `agent-progress rework --rebased-from <pre-rebase tip> --main <main line> --worktree <worktree>`.
   The rebase is exempt from the budget: past it, finish the rebase anyway, never
   `git rebase --abort`; a big resolution is what step 7b is for.
6. Append `## Review` at the end of the ticket, under 15 lines: each finding in one line with its
   file, your commits, what the rebase touched and what you resolved by hand, and both counts.
7. The first that applies:
   a. A gap you could not close: `does not hold`.
   b. Over {{reworkThresholdLines}} lines of code reworked — the two counts together; the tool counts code only, never
      a comment, a blank line or documentation: request round <N+1>, stating the count and whether
      the branch holds as it stands. Nothing else is a reason for another review.
   c. Otherwise release: step 8.
8. First, when the root `CLAUDE.md` names a step for just before `agent-progress release` (a
   version bump, say), run it now, exactly as written there.
   Then release through the command, never `git merge`: it fast-forwards <main line>, delivers the
   ticket and your review bar, and cleans up, under the tracker's lock, so it cannot race another release.
   `cd <main checkout>` first, since your worktree is about to go, then run
   `agent-progress release <id> --branch <branch> --worktree <worktree> --main <main line> --json`
   (a bundle: every id in the one call). Act on what it prints:
   - `"released": true`: done. Name any `cleanup` step that is `left`, and the files it lists.
   - `"reason": "main-moved"`: another branch went in first. If the step you ran first made a
     commit, drop it the way the root `CLAUDE.md` says. Repeat step 5 — record the tip, rebase,
     checks, `agent-progress rework --rebased-from` — add that count to your total and to your
     `## Review`, and apply step 7 again: over {{reworkThresholdLines}} now requests the next round; otherwise run
     this step again.
   - Any other reason: change nothing and report `holds, not released: <reason>` with its `detail`.
   - Denied by the permission system: do not retry or reword it, and never merge around it; report
     `holds, not released: permission denied` with the command line as you would have run it.

Do not `cat` any CLAUDE.md. You may use up to about {{reviewerApiCallBudget}} API calls, since
you judge one change rather than build it; a pass that is done sooner stops sooner. A fix that will
not fit is reported unfixed, never left half made.
Report under 150 words plus 40 per finding handed on, opening with exactly one of: `released <commit>` /
`holds, not released: <why>` /
`round <N+1> requested, branch holds` /
`round <N+1> requested, branch does not hold` /
`does not hold: <what is missing>` — then findings, your changes, what the rebase took.
```

No message is sent to a finished agent, reviewer or builder. `agent-progress release` serialises
releases under the tracker's lock: the reviewer whose branch was overtaken reads `main-moved`,
rebases, re-checks, counts the rebase and releases again inside its own pass, or asks for the next
round when the rebase pushed its reworked total over {{reworkThresholdLines}}.
