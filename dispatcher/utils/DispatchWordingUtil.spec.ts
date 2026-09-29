/**
 * The dispatcher's output edge. What callers rely on is each park reason's sentence, the round refusals' included, since the orchestrator reads
 * them in the summary and the board's log; the agent labels the Workflow tool shows; the board log lines a parking agent writes; a failure's
 * detail shown only when it says something; and a summary that leaves out a key with nothing to say, in the key order the frozen trace table pins.
 */
import { describe, expect, test } from 'bun:test';

import type { DispatchOutcome } from '../@types/DispatchOutcome.ts';
import { DispatchWordingUtil }  from './DispatchWordingUtil.ts';

const {
  settingsRefusalText,
  agentLabelOf,
  passFailureText,
  parkReasonText,
  boardLogLineOf,
  logEntryText,
  summaryOf,
} = DispatchWordingUtil;

const ARGUMENTS_SUMMARY = '{ mainCheckout, mainLine, checkCommand, installCommand?, includeLowPriority?, ticketIds?, readyTickets?, group? }';

const QUIET_OUTCOME: DispatchOutcome = {
  delivered:               [],
  parked:                  [],
  findingsFiled:           [],
  agentsRun:               0,
  runWasStoppedByBoard:    false,
  runWasStoppedByFailures: false,
  lowPriorityWaiting:      [],
  held:                    [],
  pausedBuilds:            [],
  reviewsLeft:             [],
  dirtyMainCheckoutFiles:  [],
};

describe('the settings refusal', () => {
  test('a missing argument is named, with the arguments the dispatcher takes', () => {
    expect(settingsRefusalText({ reason: 'missing-argument', argumentName: 'checkCommand' }))
      .toBe(`The dispatcher needs args.checkCommand: args are ${ARGUMENTS_SUMMARY}.`);
  });

  test('invalid ticket ids say what a valid list is', () => {
    expect(settingsRefusalText({ reason: 'invalid-ticket-ids' }))
      .toBe(`The dispatcher's args.ticketIds is a non-empty list of ticket ids when given: args are ${ARGUMENTS_SUMMARY}.`);
  });

  test('an invalid group says what a group run takes', () => {
    expect(settingsRefusalText({ reason: 'invalid-group' })).toBe('The dispatcher\'s args.group is one group name, letters, digits, dots, dashes and underscores, '
      + `given without args.ticketIds: args are ${ARGUMENTS_SUMMARY}.`);
  });
});

describe('the agent labels', () => {
  test.each([
    [{ kind: 'survey' } as const, 'survey'],
    [{ kind: 'ticket-settings' } as const, 'ticket settings'],
    [{ kind: 'build', ticketId: '001', previousPass: null } as const, 'build #001'],
    [
      {
        kind:                'review',
        ticketId:            '001',
        round:               2,
        rereviewRunsFirst:   true,
        earlierReviewerDied: false,
      } as const,
      'review 2 #001',
    ],
    [{ kind: 'park', ticketId: '001', release: { cause: 'held' } } as const, 'park #001'],
  ])('%o is labelled %p', (subject, label) => {
    expect(agentLabelOf(subject)).toBe(label);
  });
});

describe('a failed pass', () => {
  test('a detail that says something is shown trimmed in parentheses', () => {
    expect(passFailureText({ cause: 'builder-stopped-short', detail: '  stopped short \n' })).toBe('the builder did not reach review (stopped short)');
  });

  test('a blank detail is left out', () => {
    expect(passFailureText({ cause: 'builder-stopped-short', detail: ' \n ' })).toBe('the builder did not reach review');
    expect(passFailureText({ cause: 'own-claim-refused', detail: '' })).toBe('the claim was refused while this run\'s own claim holds the ticket');
  });

  test.each([
    [{ cause: 'builder-returned-nothing' } as const, 'the builder returned no result'],
    [{ cause: 'own-claim-refused', detail: '#001 is in-progress' } as const, 'the claim was refused while this run\'s own claim holds the ticket (#001 is in-progress)'],
    [{ cause: 'reviewer-returned-nothing' } as const, 'the reviewer returned no result'],
    [{ cause: 'review-does-not-hold' } as const, 'the review found it does not hold'],
  ])('%o reads %p', (failure, text) => {
    expect(passFailureText(failure)).toBe(text);
  });
});

describe('the park reasons', () => {
  test.each([
    [{ cause: 'second-failed-pass', failure: { cause: 'review-does-not-hold' } } as const, 'the review found it does not hold, the second failed pass'],
    [{ cause: 'release-refused', statedReason: 'merge-refused', blockingFiles: [] } as const, 'the release was refused: merge-refused'],
    [
      { cause: 'release-refused', statedReason: 'merge-refused', blockingFiles: ['CLAUDE.md', 'docs/cli.md'] } as const,
      'the release was refused: merge-refused, blocked by uncommitted changes in the main checkout to CLAUDE.md, docs/cli.md',
    ],
    [{ cause: 'main-line-moved', releases: 2 } as const, 'the main line moved under 2 releases'],
    [
      { cause: 'round-refused', refusal: { reason: 'rework-not-over-threshold', requestedRound: 2, reworkedLines: 750 } } as const,
      'round 2 refused: 750 reworked lines, not over 750',
    ],
    [
      { cause: 'round-refused', refusal: { reason: 'previous-round-not-reviewed-in-this-run', requestedRound: 4 } } as const,
      'round 4 refused: round 2 was not reviewed in this run, so convergence cannot be judged',
    ],
    [
      {
        cause:   'round-refused',
        refusal: {
          reason:               'findings-not-halved',
          requestedRound:       3,
          findingCount:         3,
          previousFindingCount: 4,
        },
      } as const,
      'round 3 refused: 3 findings against 4 the round before, more than half',
    ],
    [
      { cause: 'round-refused', refusal: { reason: 'finding-class-returned', requestedRound: 3, findingClass: 'naming' } } as const,
      'round 3 refused: the class "naming" came back',
    ],
    [
      { cause: 'round-refused', refusal: { reason: 'new-file-named', requestedRound: 3, file: 'c.ts' } } as const,
      'round 3 refused: c.ts was named by no earlier round',
    ],
  ])('%o reads %p', (reason, text) => {
    expect(parkReasonText(reason)).toBe(text);
  });
});

describe('the board log lines', () => {
  test('a parked ticket\'s line carries its park reason', () => {
    expect(boardLogLineOf('001', { cause: 'parked', parkReason: { cause: 'main-line-moved', releases: 2 } }))
      .toBe('Parked #001: the main line moved under 2 releases');
  });

  test('a held ticket\'s rows are paused as held', () => {
    expect(boardLogLineOf('001', { cause: 'held' })).toBe('Paused the rows of #001: held');
  });

  test('a row left at the end of the run waits for the user\'s go', () => {
    expect(boardLogLineOf('001', { cause: 'left-for-the-go' })).toBe('Paused the row of #001: left for the user\'s go');
  });
});

describe('the log sentences', () => {
  test('tickets left waiting are the user\'s go after a stop, and the board\'s limit otherwise', () => {
    expect(logEntryText({ kind: 'tickets-left-waiting', ticketIds: ['001', '002'], runIsStopped: true })).toBe('Left for the user\'s go: #001, #002.');
    expect(logEntryText({ kind: 'tickets-left-waiting', ticketIds: ['001'], runIsStopped: false })).toBe('No slot free for #001: other agents hold the board\'s limit.');
  });

  test('the closing line names the parked tickets only when there are any', () => {
    expect(logEntryText({
      kind:               'run-done',
      deliveredCount:     1,
      parkedTicketIds:    ['002', '003'],
      findingsFiledCount: 4,
      agentsRun:          9,
    })).toBe('Done: 1 delivered, 2 parked (#002, #003), 4 findings filed, 9 agents run.');
    expect(logEntryText({
      kind:               'run-done',
      deliveredCount:     0,
      parkedTicketIds:    [],
      findingsFiledCount: 0,
      agentsRun:          0,
    })).toBe('Done: 0 delivered, 0 parked, 0 findings filed, 0 agents run.');
  });

  test('a failed agent is named by its label', () => {
    expect(logEntryText({ kind: 'agent-failed', subject: { kind: 'survey' }, errorMessage: 'Example outage' }))
      .toBe('survey: the agent failed (Example outage); read as no result.');
  });

  test('the held tickets at the end name what each waits for', () => {
    expect(logEntryText({ kind: 'held-at-end', entries: [{ ticketId: '001', waitingFor: 'review' }, { ticketId: '002', waitingFor: 'build' }] }))
      .toBe('Held, for the next run once unheld: #001 (review), #002 (build).');
  });
});

describe('the summary', () => {
  test('a run with nothing to add returns only the four unconditional keys', () => {
    expect(Object.keys(summaryOf(QUIET_OUTCOME))).toEqual(['delivered', 'parked', 'findingsFiled', 'agentsRun']);
  });

  test('every key that says something is present, in the order the frozen trace table pins', () => {
    const summary = summaryOf({
      ...QUIET_OUTCOME,
      parked:                  [{ ticketId: '002', reason: { cause: 'release-refused', statedReason: 'merge-refused', blockingFiles: [] } }],
      runWasStoppedByBoard:    true,
      runWasStoppedByFailures: true,
      lowPriorityWaiting:      ['003'],
      held:                    [{ ticketId: '004', waitingFor: 'build' }],
      pausedBuilds:            ['005'],
      reviewsLeft:             ['006'],
      dirtyMainCheckoutFiles:  ['CLAUDE.md'],
    });
    expect(Object.keys(summary)).toEqual([
      'delivered',
      'parked',
      'findingsFiled',
      'agentsRun',
      'stoppedByBoard',
      'stoppedByFailures',
      'lowPriorityWaiting',
      'held',
      'pausedBuilds',
      'reviewsLeft',
      'dirtyMainCheckoutFiles',
    ]);
    expect(summary.parked).toEqual([{ id: '002', reason: 'the release was refused: merge-refused' }]);
    expect(summary.held).toEqual([{ id: '004', waitingFor: 'build' }]);
  });

  // A group run's keys follow every whole-board key, so a whole-board summary's order is untouched.
  test('a group run adds its group and integrated tickets last, and each other group key only when it says something', () => {
    const groupOutcome = {
      groupName:            'example-group',
      integrated:           ['101'],
      waitingOnPredecessor: [],
      bundleIsUnread:       false,
    };
    expect(summaryOf({ ...QUIET_OUTCOME, groupOutcome })).toEqual({ ...summaryOf(QUIET_OUTCOME), group: 'example-group', integrated: ['101'] });
    const fullSummary = summaryOf({
      ...QUIET_OUTCOME,
      groupOutcome: {
        ...groupOutcome,
        waitingOnPredecessor: ['103'],
        bundleIsUnread:       true,
      },
    });
    expect(Object.keys(fullSummary).slice(-4)).toEqual(['group', 'integrated', 'waitingOnPredecessor', 'bundleUnread']);
  });
});

describe('the group run\'s log sentences', () => {
  test('name the refused grouped ticket, the unread bundle, each integration and the release', () => {
    expect(logEntryText({ kind: 'group-ticket-refused', ticketId: '101', groupName: 'example-group' }))
      .toBe('#101 belongs to the group example-group, whose bundle only a group run builds: relaunch with args.group.');
    expect(logEntryText({ kind: 'group-bundle-unread', groupName: 'example-group' })).toContain('`agent-progress ticket release-of`');
    expect(logEntryText({ kind: 'ticket-integrated', ticketId: '101', groupName: 'example-group' })).toBe('#101 integrated into group-example-group.');
    expect(logEntryText({
      kind: 'group-released', ticketId: '103', groupName: 'example-group', deliveredTicketIds: ['101', '102', '103'],
    })).toBe('#103\'s reviewer released group-example-group to the main line, delivering #101, #102, #103.');
  });

  test('a claim refused on a group ticket parks it with the refusal', () => {
    expect(DispatchWordingUtil.parkReasonText({ cause: 'claim-refused', detail: '#101 is in-progress' })).toBe('the claim was refused (#101 is in-progress)');
  });

  test('a release reported by a bundle ticket\'s reviewer parks it, naming the release ticket', () => {
    expect(DispatchWordingUtil.parkReasonText({ cause: 'released-out-of-turn', releaseTicketId: '103' })).toContain('only the reviewer of #103 does');
  });
});
