export const meta = {
  name:        'agent-progress-dispatch',
  description: 'Run the agent-progress board: a builder per ready ticket and a clean reviewer per built one, never past the board limit',
  whenToUse:   'When the orchestrator hands the board to the dispatcher. args: { mainCheckout, mainLine, checkCommand, installCommand?, includeLowPriority? }',
  phases:      [
    { title: 'Survey', detail: 'read the concurrency block, the ready tickets and the reviews waiting', model: 'haiku' },
    { title: 'Build', detail: 'one builder per ready ticket, in the ticket worktree', model: 'opus' },
    { title: 'Review', detail: 'a clean reviewer per built ticket, round by round', model: 'opus' },
  ],
};

// The decisions live here, in code, and never in a prompt: an agent that decides its own next round is the loop this script replaces.
const CONCURRENCY_CEILING_AGENTS = 10;
const BUILDER_CALL_BUDGET = 150;
const REVIEWER_CALL_BUDGET = 75;
const REWORK_ROUND_THRESHOLD_LINES = 750;
const FAILED_PASSES_BEFORE_PARKING = 2;
const MAIN_MOVED_RELEASES_BEFORE_PARKING = 2;
const SURVEY_MODEL = 'haiku';
const WORKER_MODEL = 'opus';

const STATUS_BLOCK_SCHEMA = {
  type:       'object',
  properties: {
    limit:           { type: 'integer', minimum: 1 },
    agentsInFlight:  { type: 'integer', minimum: 0 },
    freeSlots:       { type: 'integer', minimum: 0 },
    readyTicketIds:            { type: 'array', items: { type: 'string' } },
    lowPriorityReadyTicketIds: { type: 'array', items: { type: 'string' } },
    dispatcherState:           { type: 'string', enum: ['running', 'stopped', 'finished'] },
    runningTicketIds:          { type: 'array', items: { type: 'string' } },
    runningReviewOfIds:        { type: 'array', items: { type: 'string' } },
  },
  required: ['limit', 'agentsInFlight', 'freeSlots', 'readyTicketIds', 'lowPriorityReadyTicketIds', 'dispatcherState', 'runningTicketIds', 'runningReviewOfIds'],
};

const SURVEY_SCHEMA = {
  type:       'object',
  properties: {
    status:                 STATUS_BLOCK_SCHEMA,
    reviewWaitingTicketIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'reviewWaitingTicketIds'],
};

const BUILDER_SCHEMA = {
  type:       'object',
  properties: {
    outcome: { type: 'string', enum: ['in-review', 'claim-refused', 'failed'] },
    detail:  { type: 'string' },
    status:  STATUS_BLOCK_SCHEMA,
  },
  required: ['outcome', 'detail', 'status'],
};

const REVIEWER_SCHEMA = {
  type:       'object',
  properties: {
    round:         { type: 'integer', minimum: 1 },
    verdict:       { type: 'string', enum: ['released', 'round-requested', 'does-not-hold', 'not-released'] },
    releaseReason: { type: 'string' },
    reworkedLines: { type: 'integer', minimum: 0 },
    findings:      {
      type:  'array',
      items: {
        type:       'object',
        properties: { class: { type: 'string' }, file: { type: 'string' }, summary: { type: 'string' } },
        required:   ['class', 'file', 'summary'],
      },
    },
    filedTicketIds: { type: 'array', items: { type: 'string' } },
    status:         STATUS_BLOCK_SCHEMA,
  },
  required: ['round', 'verdict', 'releaseReason', 'reworkedLines', 'findings', 'filedTicketIds', 'status'],
};

function settingsFrom(workflowArguments) {
  const given = workflowArguments ?? {};
  for (const name of ['mainCheckout', 'mainLine', 'checkCommand']) {
    if (typeof given[name] !== 'string' || given[name] === '') {
      throw new Error(`The dispatcher needs args.${name}: args are { mainCheckout, mainLine, checkCommand, installCommand?, includeLowPriority? }.`);
    }
  }
  return {
    mainCheckout:       given.mainCheckout,
    mainLine:           given.mainLine,
    checkCommand:       given.checkCommand,
    installCommand:     typeof given.installCommand === 'string' ? given.installCommand : '',
    // Low tickets are the orchestrator's to triage first; only its relaunch after that triage passes true.
    includeLowPriority: given.includeLowPriority === true,
  };
}

const settings = settingsFrom(args);

function worktreeOf(ticketId) {
  return `${settings.mainCheckout}/.claude/worktrees/ticket-${ticketId}`;
}

function briefPlaceholdersText(ticketId) {
  return `with <worktree> = ${worktreeOf(ticketId)}, <branch> = ticket-${ticketId}, <main line> = ${settings.mainLine}, `
    + `<main checkout> = ${settings.mainCheckout} and <full check command> = \`${settings.checkCommand}\``;
}

const DERIVED_STATUS_FIELDS_TEXT = 'adding `runningTicketIds` (the `ticket` of every `running` task that has one), `runningReviewOfIds` (the `reviewOf` of every `running` task that has one) '
  + 'and `lowPriorityReadyTicketIds` (each id of `concurrency.readyTicketIds` whose entry in the same document\'s `tickets` list has `priority` `"low"`, in the ready order)';

const STATUS_RETURN_TEXT = `As your very last act run \`agent-progress status --json\` and return its \`concurrency\` block as \`status\`, ${DERIVED_STATUS_FIELDS_TEXT}, `
  + 'so the dispatcher acts on the newest board.';

function surveyPrompt() {
  return [
    `Run \`agent-progress status --json\` once, in ${settings.mainCheckout}, and make no other call. Judge nothing; return:`,
    `- \`status\`: its \`concurrency\` block as printed (limit, agentsInFlight, freeSlots, readyTicketIds, dispatcherState), ${DERIVED_STATUS_FIELDS_TEXT};`,
    '- `reviewWaitingTicketIds`: the ids of the tickets whose status is `in-review` and that no `running` task names in its `reviewOf`.',
  ].join('\n');
}

// `previousPass` is what sent this ticket back to a builder in this run: `builder` (a pass that stopped short of review), `review` (a does-not-hold), or null.
function builderPrompt(ticketId, previousPass) {
  const worktree = worktreeOf(ticketId);
  // The earlier builder's claim left the ticket in-progress, and `ticket claim` refuses an in-progress ticket.
  const claimRefusalText = previousPass === 'builder'
    ? 'If it exits 1 saying the ticket is in-progress, that is the claim of this run\'s earlier builder: carry on. On any other refusal, stop at once and return outcome '
      + '`claim-refused` with its message verbatim as `detail`.'
    : 'If it exits 1, stop at once and return outcome `claim-refused` with its message verbatim as `detail`.';
  const lines = [
    `agent-progress ticket: ${ticketId}`,
    `Worktree: ${worktree}   Branch: ticket-${ticketId}   Main checkout: ${settings.mainCheckout}   Main line: ${settings.mainLine}`,
    `You build ticket #${ticketId} for the agent-progress dispatcher, alone: one ticket, one agent.`,
    `FIRST command, before anything else: \`agent-progress ticket claim ${ticketId} --owner ${WORKER_MODEL} --note "Built by the dispatcher on ticket-${ticketId}"\`. `
      + claimRefusalText,
    `Then the worktree: when ${worktree} exists, reuse it as it stands, since it holds an earlier pass's commits; otherwise `
      + `\`git -C ${settings.mainCheckout} worktree add ${worktree} -b ticket-${ticketId} ${settings.mainLine}\`, dropping \`-b\` when the branch already exists.`,
  ];
  if (settings.installCommand !== '') lines.push(`In a worktree you just created, run \`${settings.installCommand}\` in it once before anything else there.`);
  lines.push(
    'Everything you do happens in that worktree: every edit, every command, every commit, git as `git -C <worktree>`. Your working directory may be the main checkout; it is not yours to touch.',
    `The task is the ticket: \`agent-progress ticket show ${ticketId}\` prints it. Its \`## Brief\` section, when it has one, is your brief; `
      + 'otherwise Report, Wanted and Acceptance are, and the files they name are where the work belongs.',
  );
  if (previousPass === 'review') lines.push('A reviewer found that the previous pass does not hold: the last `## Review` in the ticket says why, and your work starts there.');
  if (previousPass === 'builder') lines.push('An earlier builder of this run stopped before review: the worktree holds whatever it committed, and your work continues from there.');
  lines.push(
    `Read \`${settings.mainCheckout}/.agent-progress/agent-brief.md\` once and follow its fenced blocks under Call discipline, Stop conditions, `
      + `Find and fix, Ready to merge and Report, ${briefPlaceholdersText(ticketId)}. The Scope, Contract, Browser loop and Review brief blocks are not yours.`,
    'Do not `cat` any CLAUDE.md.',
    `Stop when the Acceptance block is satisfied, or at about ${BUILDER_CALL_BUDGET} API calls, whichever is first.`,
    `Close as Ready to merge says, append the \`## Handoff\`, then run \`agent-progress ticket review ${ticketId}\`. `
      + `Never merge ticket-${ticketId} into ${settings.mainLine} and never run \`agent-progress release\`: the release is the reviewer's.`,
    `Return outcome \`in-review\` when \`ticket review\` succeeded and \`failed\` otherwise, with your report as \`detail\`. ${STATUS_RETURN_TEXT}`,
  );
  return lines.join('\n');
}

function reviewerPrompt(ticketId, expectedRound, rereviewFirst, earlierReviewerDied) {
  const lines = [
    `agent-progress review: ${ticketId}`,
    `Worktree: ${worktreeOf(ticketId)}   Branch: ticket-${ticketId}   Main checkout: ${settings.mainCheckout}   Main line: ${settings.mainLine}`,
    `You are a clean reviewer of ticket #${ticketId} for the agent-progress dispatcher, round ${expectedRound} as the dispatcher counts it. `
      + 'Your round is the number of `## Review` sections already in the ticket plus one; return it as `round`.',
  ];
  if (rereviewFirst) lines.push(`FIRST command, before anything else: \`agent-progress ticket rereview ${ticketId}\`.`);
  // A dead reviewer's bar would stay running and hold one of the board's slots for the rest of the run.
  if (earlierReviewerDied) {
    lines.push(`An earlier reviewer of this run returned nothing. When \`agent-progress status --json\` shows a \`running\` row whose \`reviewOf\` is ${ticketId}, that bar is `
      + 'its: close it with `agent-progress task finish <that row>`, then `agent-progress task deliver <that row>`, before you add your own.');
  }
  lines.push(
    `Then add your own bar: \`agent-progress task add "Review <round> #${ticketId} — <ticket title>" --review-of ${ticketId} --owner ${WORKER_MODEL} --start\`, `
      + `the title from \`agent-progress ticket show ${ticketId}\`. Your bar takes the place of the brief's \`agent-progress row:\` line; the review line above carries your tokens to it.`,
    `Read \`${settings.mainCheckout}/.agent-progress/agent-brief.md\` once and follow the fenced block under \`## Review brief\` as your whole procedure, `
      + `steps 0 to 8, ${briefPlaceholdersText(ticketId)}. Step 0 reads the diff first; you fix only what you review.`,
    `You may use up to about ${REVIEWER_CALL_BUDGET} API calls.`,
    'Every finding you would hand on instead of fixing, you file yourself: `agent-progress ticket add "<what and where>" --priority low --body "<what you saw and what you would do>"`; '
      + 'return the ids it printed as `filedTicketIds`.',
    `Step 7b is a count: request the next round only when over ${REWORK_ROUND_THRESHOLD_LINES} lines of code were reworked. Whether that round runs is the dispatcher's decision.`,
    'A release refused with `main-moved` is yours to handle, as step 8 says. On every verdict other than released, close your own bar: `agent-progress task finish <bar>`, then `agent-progress task deliver <bar>`.',
    'Return `verdict` (released, round-requested, does-not-hold or not-released), `releaseReason` (the release\'s reason when not-released, empty otherwise), '
      + '`reworkedLines` (both rework counts together), `findings` (every finding of this round, each with a one-word `class`, its `file` and a one-line `summary`), '
      + `and \`filedTicketIds\`. ${STATUS_RETURN_TEXT}`,
  );
  return lines.join('\n');
}

const ticketRecords = new Map();
const reviewQueue = [];
const rebuildQueue = [];
const takeoversWaiting = new Map();
const ticketIdsTakenThisRun = new Set();
const inFlight = new Map();
const delivered = [];
const parked = [];
const findingsFiled = [];
let agentsRun = 0;
let launchCount = 0;
let board = null;
let othersInFlightAtBoardReading = 0;
let stoppedByBoard = false;
let lowPriorityReadyTicketIds = new Set();

function recordOf(ticketId) {
  if (!ticketRecords.has(ticketId)) ticketRecords.set(ticketId, { failedPasses: 0, mainMovedReleases: 0, nextRound: 1, rounds: [] });
  return ticketRecords.get(ticketId);
}

function readyTicketIsAdmitted(ticketId) {
  return settings.includeLowPriority || !lowPriorityReadyTicketIds.has(ticketId);
}

function lowPriorityWaitingIds() {
  if (board === null) return [];
  return board.readyTicketIds.filter((ticketId) => !ticketIdsTakenThisRun.has(ticketId) && !readyTicketIsAdmitted(ticketId));
}

function summary() {
  const lowPriorityWaiting = lowPriorityWaitingIds();
  return {
    delivered,
    parked,
    findingsFiled,
    agentsRun,
    ...(stoppedByBoard ? { stoppedByBoard } : {}),
    ...(lowPriorityWaiting.length > 0 ? { lowPriorityWaiting } : {}),
  };
}

async function runAgent(prompt, options) {
  agentsRun++;
  try {
    return await agent(prompt, options);
  } catch (error) {
    log(`${options.label}: the agent failed (${error instanceof Error ? error.message : String(error)}); read as no result.`);
    return null;
  }
}

// A builder is on the board from its claim, a reviewer from its `task add --review-of --start`; a status block without the rows confirms nothing.
function ownAgentIsOnBoard(work, status) {
  const confirmingTicketIds = work.kind === 'build' ? status.runningTicketIds : status.runningReviewOfIds;
  return Array.isArray(confirmingTicketIds) && confirmingTicketIds.includes(work.ticketId);
}

function takeoverKeyOf(work) {
  return `${work.kind} ${work.ticketId}`;
}

// An agent that stopped short left its row running, and the fresh agent for the same work takes that row over rather than adding one.
function awaitTakeover(work) {
  takeoversWaiting.set(takeoverKeyOf(work), work);
}

function takeoversOnBoard(status) {
  return [...takeoversWaiting.values()].filter((takeover) => ownAgentIsOnBoard(takeover, status));
}

// Only an own agent whose row the board shows is subtracted: one that has not run its first command yet is not in `agentsInFlight`, and
// subtracting it too would read a real other agent's slot as free. A row left running for a takeover is the dispatcher's own, not another's.
function adoptBoard(status) {
  if (status === null || typeof status !== 'object' || !Array.isArray(status.readyTicketIds)) return;
  board = status;
  // A block without the low ids keeps the ones read last, rather than reading every ready ticket as normal.
  if (Array.isArray(status.lowPriorityReadyTicketIds)) lowPriorityReadyTicketIds = new Set(status.lowPriorityReadyTicketIds);
  const ownAgentsOnBoard = [...inFlight.values()].filter((ownAgent) => ownAgentIsOnBoard(ownAgent.work, status)).length + takeoversOnBoard(status).length;
  othersInFlightAtBoardReading = Math.max(0, status.agentsInFlight - ownAgentsOnBoard);
  // A stop is final for this run: the agents in flight finish and are settled, and nothing new starts until the user's go launches a new run.
  if (status.dispatcherState === 'stopped' && !stoppedByBoard) {
    stoppedByBoard = true;
    log(`The board is stopped: no new agent starts, and the ${inFlight.size} in flight finish.`);
  }
}

// Every own agent counts against the slots, on the board yet or not; the ceiling holds whatever limit the board states.
function ownSlotLimit() {
  return Math.max(0, Math.min(board.limit, CONCURRENCY_CEILING_AGENTS) - othersInFlightAtBoardReading);
}

function park(ticketId, reason) {
  parked.push({ id: ticketId, reason });
  log(`#${ticketId} parked: ${reason}.`);
}

function reviewWorkFor(ticketId, rereviewFirst, earlierReviewerDied) {
  return {
    kind:  'review',
    ticketId,
    round: recordOf(ticketId).nextRound,
    rereviewFirst,
    earlierReviewerDied,
  };
}

function queueReview(ticketId, rereviewFirst) {
  reviewQueue.push(reviewWorkFor(ticketId, rereviewFirst, false));
}

function countFailedPass(ticketId, why, retry) {
  const record = recordOf(ticketId);
  record.failedPasses++;
  if (record.failedPasses >= FAILED_PASSES_BEFORE_PARKING) {
    park(ticketId, `${why}, the second failed pass`);
    return;
  }
  log(`#${ticketId}: ${why}; a fresh agent takes it.`);
  retry();
}

// A takeover goes first: until it starts, its row is on the board and counted as the dispatcher's own, beside every agent it has in flight.
// Then reviews waiting: a built ticket holds a worktree and a finished pass, a new ticket holds nothing yet.
function nextWork() {
  const [takeover] = takeoversWaiting.values();
  if (takeover !== undefined) {
    takeoversWaiting.delete(takeoverKeyOf(takeover));
    return takeover;
  }
  const review = reviewQueue.shift();
  if (review !== undefined) return review;
  const rebuild = rebuildQueue.shift();
  if (rebuild !== undefined) return rebuild;
  const readyTicketId = board.readyTicketIds.find((ticketId) => !ticketIdsTakenThisRun.has(ticketId) && readyTicketIsAdmitted(ticketId));
  if (readyTicketId === undefined) return null;
  ticketIdsTakenThisRun.add(readyTicketId);
  return { kind: 'build', ticketId: readyTicketId, previousPass: null };
}

function launch(work) {
  const key = launchCount++;
  const running = work.kind === 'build'
    ? runAgent(builderPrompt(work.ticketId, work.previousPass), {
      label:  `build #${work.ticketId}`,
      phase:  'Build',
      schema: BUILDER_SCHEMA,
      model:  WORKER_MODEL,
    })
    : runAgent(reviewerPrompt(work.ticketId, work.round, work.rereviewFirst, work.earlierReviewerDied), {
      label:  `review ${work.round} #${work.ticketId}`,
      phase:  'Review',
      schema: REVIEWER_SCHEMA,
      model:  WORKER_MODEL,
    });
  inFlight.set(key, { work, finishing: running.then((result) => ({ key, work, result })) });
}

function settleBuild(work, result) {
  const { ticketId } = work;
  // A builder that stopped short of `ticket review` left its claimed row running.
  const rebuild = () => awaitTakeover({ kind: 'build', ticketId, previousPass: 'builder' });
  if (result === null) {
    countFailedPass(ticketId, 'the builder returned no result', rebuild);
    return;
  }
  if (result.outcome === 'claim-refused') {
    log(`#${ticketId} skipped for this run: the claim was refused (${result.detail}).`);
    return;
  }
  if (result.outcome === 'failed') {
    countFailedPass(ticketId, `the builder did not reach review (${result.detail})`, rebuild);
    return;
  }
  queueReview(ticketId, false);
}

function findingsOfRoundsBefore(record, round) {
  return record.rounds.filter((earlier) => earlier.round < round).flatMap((earlier) => earlier.findings);
}

// Round 2 needs the rework count alone; from round 3 the findings must also be converging, or the next round only finds more.
function nextRoundVerdict(record, current) {
  const requestedRound = current.round + 1;
  if (current.reworkedLines <= REWORK_ROUND_THRESHOLD_LINES) {
    return { granted: false, reason: `round ${requestedRound} refused: ${current.reworkedLines} reworked lines, not over ${REWORK_ROUND_THRESHOLD_LINES}` };
  }
  if (requestedRound === 2) return { granted: true };
  const previous = record.rounds.find((earlier) => earlier.round === current.round - 1);
  if (previous === undefined) return { granted: false, reason: `round ${requestedRound} refused: round ${current.round - 1} was not reviewed in this run, so convergence cannot be judged` };
  const earlierFindings = findingsOfRoundsBefore(record, current.round);
  const earlierClasses = new Set(earlierFindings.map((finding) => finding.class));
  const earlierFiles = new Set(earlierFindings.map((finding) => finding.file));
  if (current.findings.length * 2 > previous.findings.length) {
    return { granted: false, reason: `round ${requestedRound} refused: ${current.findings.length} findings against ${previous.findings.length} the round before, more than half` };
  }
  const repeatedClass = current.findings.find((finding) => earlierClasses.has(finding.class));
  if (repeatedClass !== undefined) return { granted: false, reason: `round ${requestedRound} refused: the class "${repeatedClass.class}" came back` };
  const newFile = current.findings.find((finding) => !earlierFiles.has(finding.file));
  if (newFile !== undefined) return { granted: false, reason: `round ${requestedRound} refused: ${newFile.file} was named by no earlier round` };
  return { granted: true };
}

function settleReview(work, result) {
  const { ticketId } = work;
  const record = recordOf(ticketId);
  if (result === null) {
    record.nextRound = work.round + 1;
    countFailedPass(ticketId, 'the reviewer returned no result', () => awaitTakeover(reviewWorkFor(ticketId, true, true)));
    return;
  }
  findingsFiled.push(...result.filedTicketIds);
  const round = Number.isInteger(result.round) ? result.round : work.round;
  record.rounds.push({ round, findings: result.findings });
  record.nextRound = round + 1;
  if (result.verdict === 'released') {
    delivered.push(ticketId);
    return;
  }
  if (result.verdict === 'does-not-hold') {
    countFailedPass(ticketId, 'the review found it does not hold', () => rebuildQueue.push({ kind: 'build', ticketId, previousPass: 'review' }));
    return;
  }
  if (result.verdict === 'not-released') {
    if (result.releaseReason !== 'main-moved') {
      park(ticketId, `the release was refused: ${result.releaseReason}`);
      return;
    }
    record.mainMovedReleases++;
    if (record.mainMovedReleases >= MAIN_MOVED_RELEASES_BEFORE_PARKING) {
      park(ticketId, `the main line moved under ${record.mainMovedReleases} releases`);
      return;
    }
    log(`#${ticketId}: the main line moved and the reviewer did not finish the release; round ${record.nextRound} takes it.`);
    queueReview(ticketId, true);
    return;
  }
  const verdict = nextRoundVerdict(record, { ...result, round });
  if (!verdict.granted) {
    park(ticketId, verdict.reason);
    return;
  }
  log(`#${ticketId}: round ${record.nextRound} granted at ${result.reworkedLines} reworked lines.`);
  queueReview(ticketId, true);
}

phase('Survey');
const survey = await runAgent(surveyPrompt(), {
  label:  'survey',
  phase:  'Survey',
  schema: SURVEY_SCHEMA,
  model:  SURVEY_MODEL,
});
if (survey === null) {
  log('The survey returned no board, so nothing was dispatched.');
  return summary();
}
adoptBoard(survey.status);
if (board === null) {
  log('The survey returned no readable concurrency block, so nothing was dispatched.');
  return summary();
}
for (const ticketId of survey.reviewWaitingTicketIds) {
  ticketIdsTakenThisRun.add(ticketId);
  queueReview(ticketId, false);
}

phase('Build');
for (;;) {
  const slotLimit = ownSlotLimit();
  while (!stoppedByBoard && inFlight.size < slotLimit) {
    const work = nextWork();
    if (work === null) break;
    launch(work);
  }
  if (inFlight.size === 0) break;
  const finished = await Promise.race([...inFlight.values()].map((ownAgent) => ownAgent.finishing));
  inFlight.delete(finished.key);
  // Settled first, so a row this agent left running is a takeover by the time its own status block is read.
  if (finished.work.kind === 'build') settleBuild(finished.work, finished.result);
  else settleReview(finished.work, finished.result);
  if (finished.result !== null) adoptBoard(finished.result.status);
}

const leftWaiting = [
  ...[...takeoversWaiting.values()].map((takeover) => takeover.ticketId),
  ...reviewQueue.map((review) => review.ticketId),
  ...rebuildQueue.map((rebuild) => rebuild.ticketId),
  ...board.readyTicketIds.filter((ticketId) => !ticketIdsTakenThisRun.has(ticketId) && readyTicketIsAdmitted(ticketId)),
];
const leftWaitingText = leftWaiting.map((ticketId) => `#${ticketId}`).join(', ');
if (leftWaiting.length > 0) log(stoppedByBoard ? `Left for the user's go: ${leftWaitingText}.` : `No slot free for ${leftWaitingText}: other agents hold the board's limit.`);
const lowPriorityWaiting = lowPriorityWaitingIds();
if (lowPriorityWaiting.length > 0) log(`Left for the orchestrator's triage, low priority: ${lowPriorityWaiting.map((ticketId) => `#${ticketId}`).join(', ')}.`);
log(`Done: ${delivered.length} delivered, ${parked.length} parked, ${findingsFiled.length} findings filed, ${agentsRun} agents run.`);
return summary();
