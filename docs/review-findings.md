# Final adversarial review — consolidated findings (2026-09-18)

Three sub-reviews (runtime attack on the binary, convention audit, guard/page audit) consolidated by
the orchestrator. Ranked by user impact. Owner: A = core fix agent (cli/, lib/platform, lib/progress,
lib/tickets, lib/utils, lib/constants, README, SKILL, HelpText); B = render fix agent (lib/render/**);
C = guards/docs agent (lib/*.spec.ts guards, docs/, CLAUDE.md files, setup.sh, lib/tooling/dev).

## Must fix
1. (A) `lib/platform/RepositoryRoot.ts:152` — `git rev-parse --git-common-dir` answers `.` in a bare repo and `<super>/.git/modules/<name>` in a submodule; `dirname()` then puts the tracker (and a CLAUDE.md!) in the bare repo's parent or inside `.git/modules/`. Fix: when the common dir's basename is not `.git`, use `git rev-parse --show-toplevel` from the start directory (submodule → its own checkout); a bare repository (`--is-bare-repository` true) is refused by `init` with exit 1.
2. (B) `lib/utils/HtmlEscapeUtil.ts:52` (owned by A, but the spec in lib/utils) — `escapeJsonForScriptTag` leaves `<!--`; a task named `x <!--<script>` puts the tokenizer in double-escaped state and the page script never runs. Fix (A): also replace `<!--` with `<!--` (and `<script`/`</script` case-insensitively via `<`); spec it.
3. (B) `lib/render/Markdown.ts:49` — `hrefIsUnsafe` never decodes entities: `javascript&colon;alert(1)` and `&#106;avascript:` yield live links; `vbscript:`/`file:` not denied. Fix: allowlist schemes (`http:`, `https:`, `mailto:`, `#`, relative) after entity-decoding numeric and named entities; spec each case.
4. (A) `lib/progress/ProgressStore.ts:209` — task ids reused after `task remove` and after `clear` (max+1). Fix: add `nextTaskId` to `ProgressFile` (Types.ts), allocate from it, never reset (including by `clear`); README/SKILL already promise this.
5. (A) `task start|finish|review|deliver|update --status` on a ticket-owned row desynchronises row and ticket (exit 0). Fix: refuse with exit 1 naming the `ticket <verb>` command; `--force` overrides (documented).
6. (A) No ticket transition legality: every move from every status exits 0 and repeated `ticket start` appends duplicate log lines. Fix: verbs enforce a matrix — start: open|in-review→in-progress; review: in-progress→in-review; done: in-review|in-progress→done; deliver: done→delivered; abandon: any except delivered/abandoned; reopen: any except open. Same-status → refused "already …" (exit 1, no log line). `ticket status <id> <status>` remains the explicit override for any move. Row timestamps: a ticket that never started and is moved with the override gets start = at (documented). Update the table in README/SKILL.
7. (B) `lib/render/page/GanttGeometry.ts:177` — automatic axis starts at `startedAt`; after `clear` every re-seeded bar is a clipped sliver. Fix: from = min(startedAt, earliest parsable task.start).
8. (A+B) Log order: stored in insertion order; `status` (A, `cli/status/StatusCommand.ts:88`) and the page (B, `lib/render/Template.ts`) print array order, so `--at` backfill breaks "newest first"; `HH:MM` only. Fix: sort by `at` descending for display; show `MM-DD HH:MM` when the log spans more than one calendar day.
9. (A) `cli/ticket/TicketCommand.ts:407` — bare `TRANSITION_SUBCOMMANDS[subcommand]` lookup with argv text: `ticket constructor 1` writes garbage. Fix: `Object.hasOwn`.
10. (A) `status --json` drops `version`, `trackerId` and truncates the log to 20 while docs call it "the progress file itself". Fix: print the full progress file plus `tickets`; document.
11. (A) `AGENT_PROGRESS_ROOT` pointing at a directory with no tracker → the refusal names cwd. Fix: name the override path and say the variable is set; document the variable in `help` and README.
12. (A) `init --root <file>` / nonexistent path → raw ENOTDIR/EROFS exit 2. Fix: refuse (exit 1) unless the path is an existing directory.
13. (A) `range --from` after `--to` accepted; `range --from garbage` message never says the bound is unparseable. Fix: refuse both with precise messages.
14. (A) Empty `ticket add ""`, `task add ""`, `log ""`, and `--body-file -` with empty stdin accepted. Fix: refuse empty/whitespace-only titles and log text; empty body falls back to the template.
15. (A) Frontmatter: SKILL/README say unknown lines are "kept in place"; `lib/tickets/Frontmatter.ts` relocates them below the known keys. Fix the two docs to state the real rule (known keys first, extras after, order among extras kept).

## Should fix
16. (A) Undocumented: `task add --ticket <id> --force` (add to HelpText), `<command> --help` (accept after a command name), `.gitignore: no-gitignore-written` printed raw (human words), lock-as-directory message says "file", `task update` with no fields exits 0 (refuse), `ticket list --json` includes bodies (document it or drop them — drop).
17. (C) `lib/DocumentedPaths.spec.ts:34` skips any directory named `progress` at any depth, so `lib/progress/` is never scanned; directory citations (`lib/render/page/`) never checked; floor 20 vs 256 real. Fix: exempt only the repo-root `progress/`; check trailing-slash citations as directories; floor 200.
18. (C) `lib/ImportDirection.spec.ts`: `FEATURE_FOLDERS` hardcoded (assert `readdirSync('lib')` is fully classified); no `cli/<command>/` sibling rule; `require(` form not scanned; `agent-progress.ts` outside all scans (add to all three guards).
19. (C) `lib/EnvironmentReads.spec.ts:65` misses `process['env']`, `const { env } = process`, `import.meta.env`, `process\n.env`; add patterns and constructed cases.
20. (B) `lib/render/PageBundle.ts` should enforce (replace `</script` → `<\/script` in the built text), not just observe.
21. (B) No spec for `lib/render/page/GanttPage.ts` pure helpers (`viewRangeFrom`, `effectiveRangeFor`, `storageKeyFor`): export them and add `lib/render/PageData.spec.ts`.
22. (B) `GanttPage.ts` reads `Date.now()` twice per layout (range vs now marker) — read once. `<details>` open state and half-typed datetime inputs lost on the 30 s refresh — persist the open set beside the view override.
23. (C) `setup.sh:112-118` — `rm -rf "$SKILL_TARGET"` reaches a real user directory that is empty or lacks a SKILL.md naming agent-progress. Fix: remove only when the target is a symlink; any real directory → warn and skip. Compare `readlink` via realpath.

## Conventions
24. (A) `pid` → `processId` (Lock.ts, AtomicFile.ts); `argv` → `commandLineArguments` (Main.ts, CliProcess.ts, agent-progress.ts, spec helpers); `each` (StatusCommand.ts:55); `'alex'`/`alex-example`/`alex@example.invalid` → `Alex Example` / `alex.example@example.com` in specs and ScratchWorkspace (C for tooling/dev, A elsewhere).
25. (B) `class="ind"` (dead, no CSS) and `class="num"` in Html.ts → `indicator`/`row-number`.
26. (A+B) Duplicated constants: `DATE_AND_CLOCK_LENGTH/CLOCK_SLICE_*` in three files and `JSON_INDENT` in two → `lib/constants/Limits.ts` (A adds, B consumes); `TimeUtil` magic `2`,`4`,`11`,`31`,`23`,`59` → named; `Frontmatter.ts:232` `+ 2` → `KEY_VALUE_SEPARATOR.length`.
27. (B) GanttGeometry `60`/`1440` → `limits.dayMinutes` + a `HOUR_MINUTES` in the payload; `TICK_COUNT_SAFETY_BOUND`, `SELF_CHECK_INTERVAL_MILLISECONDS`, `TICK_CHOICES` → Limits + payload; `GanttPage.ts:151` double cast → a proper structural check; test name `'chooses a %i-minute span a step of %i minutes'` → grammatical.
28. (C) Root `CLAUDE.md:28` eslint snippet omits `progress/**`; `lib/constants/Statuses.ts:18` extensionless `./Types` (A); non-null assertions in ArgumentParser.ts:82,101 → fallbacks (A).
29. (A) `Lock.ts:131` compares an mtime the tool did not write; either document it as part of exception 1 (garbage payload fallback) in the docblock and CLAUDE.md, or drop the mtime path. Keep (fail closed) and document.
30. (C) docs/decisions.md: record the matrix decision, id counter, the frontmatter order compromise, the bare-repo refusal.
