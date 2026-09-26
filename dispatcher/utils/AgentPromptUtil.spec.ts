/**
 * Which paragraphs a request puts in a prompt; the exact text is the frozen trace table's to pin. What the run relies on is that the takeover
 * of another run's paused build is offered only where this run may take it over, that a builder is told to resume a paused row only where it
 * can meet one, that the install line appears only with an install command, and that the parking agent's log line cannot break its quotes.
 */
import { describe, expect, test } from 'bun:test';

import type { DispatchSettings } from '../@types/DispatchSettings.ts';
import type { PreviousPass }     from '../@types/DispatchWork.ts';
import { DISPATCH_POLICY }       from '../constants/DispatchPolicy.ts';
import { AgentPromptUtil }       from './AgentPromptUtil.ts';

const {
  builderPrompt,
  reviewerPrompt,
  surveyPrompt,
  ticketSettingsLookupPrompt,
  parkingPrompt,
} = AgentPromptUtil;

const WHOLE_BOARD_SETTINGS: DispatchSettings = {
  mainCheckout:       '/scratch/example-repository',
  mainLine:           'main',
  checkCommand:       'example-check',
  installCommand:     '',
  includeLowPriority: false,
  ticketIds:          null,
  readyTickets:       [],
  runLabel:           'whole-board',
};

const SINGLE_TICKET_SETTINGS: DispatchSettings = { ...WHOLE_BOARD_SETTINGS, ticketIds: ['001'], runLabel: 'ticket-001' };

const TAKEOVER_TEXT = 'when the note is instead another dispatcher run\'s claim';

const RESUMPTION_TEXT = 'resume it first with `agent-progress task start <that row>';

const INSTALL_TEXT = 'In a worktree you just created, run';

function firstPassOf(settings: DispatchSettings, pausedBuildWasFoundBySurvey: boolean): string {
  return builderPrompt(settings, {
    ticketId:     '001',
    previousPass: null,
    owner:        'opus',
    pausedBuildWasFoundBySurvey,
  });
}

function passAfter(previousPass: PreviousPass): string {
  return builderPrompt(WHOLE_BOARD_SETTINGS, {
    ticketId:                    '001',
    previousPass,
    owner:                       'opus',
    pausedBuildWasFoundBySurvey: false,
  });
}

describe('the builder prompt', () => {
  test('a whole-board run offers no takeover of a build its survey did not find paused', () => {
    expect(firstPassOf(WHOLE_BOARD_SETTINGS, false)).not.toContain(TAKEOVER_TEXT);
  });

  test('a whole-board run offers the takeover of a build its survey found paused, quoting the claim note\'s bounds', () => {
    const prompt = firstPassOf(WHOLE_BOARD_SETTINGS, true);
    expect(prompt).toContain('This run found this ticket\'s build paused: when the note is instead another dispatcher run\'s claim');
    expect(prompt).toContain('beginning "Built by the " and ending " dispatcher run on ticket-001"');
  });

  test('a run launched for the ticket alone offers the takeover without a survey', () => {
    expect(firstPassOf(SINGLE_TICKET_SETTINGS, false)).toContain('This run was launched for this ticket alone: when the note is instead');
  });

  // A first pass finds its own claim at most, never a paused row, so the resumption line would only lengthen its prompt.
  test('a first pass without a takeover is not told to resume a paused row', () => {
    expect(firstPassOf(WHOLE_BOARD_SETTINGS, false)).not.toContain(RESUMPTION_TEXT);
  });

  test.each(['builder', 'review', 'paused'] as const)('a pass after a %s pass is told to resume a paused row under this run\'s claim', (previousPass) => {
    expect(passAfter(previousPass)).toContain(`${RESUMPTION_TEXT} --note "Built by the whole-board dispatcher run on ticket-001"\``);
  });

  test('a first pass with a takeover is told to resume a paused row', () => {
    expect(firstPassOf(SINGLE_TICKET_SETTINGS, false)).toContain(`${RESUMPTION_TEXT} --note "Built by the ticket-001 dispatcher run on ticket-001"\``);
  });

  test('the install line appears only when an install command was given', () => {
    expect(firstPassOf(WHOLE_BOARD_SETTINGS, false)).not.toContain(INSTALL_TEXT);
    const withInstall = builderPrompt({ ...WHOLE_BOARD_SETTINGS, installCommand: 'example-install' }, {
      ticketId:                    '001',
      previousPass:                null,
      owner:                       'opus',
      pausedBuildWasFoundBySurvey: false,
    });
    expect(withInstall).toContain(`${INSTALL_TEXT} \`example-install\` in it once`);
  });

  test('each previous pass names its own reason for the rebuild, and a first pass names none', () => {
    expect(passAfter('review')).toContain('A reviewer found that the previous pass does not hold');
    expect(passAfter('builder')).toContain('An earlier builder of this run stopped before review');
    expect(passAfter('paused')).toContain('An earlier dispatcher run left this build paused');
    const firstPass = firstPassOf(WHOLE_BOARD_SETTINGS, false);
    for (const reason of ['A reviewer found', 'An earlier builder', 'An earlier dispatcher run']) expect(firstPass).not.toContain(reason);
  });

  test('the builder starts its reviewer\'s bar with `ticket finish --start-review` under this run\'s review note', () => {
    expect(firstPassOf(WHOLE_BOARD_SETTINGS, false))
      .toContain('`agent-progress ticket finish 001 --start-review --owner opus --note "Reviewed by the whole-board dispatcher run on ticket-001"`');
  });
});

describe('the reviewer prompt', () => {
  function reviewerPromptWith(rereviewFirst: boolean, earlierReviewerDied: boolean): string {
    return reviewerPrompt(WHOLE_BOARD_SETTINGS, {
      ticketId:      '001',
      expectedRound: 2,
      rereviewFirst,
      earlierReviewerDied,
      owner:         'opus',
    });
  }

  test('only a reviewer sent to rereview first is told to start its bar with `ticket rereview --start-review`', () => {
    expect(reviewerPromptWith(true, false)).toContain('`agent-progress ticket rereview 001 --start-review --owner opus');
    expect(reviewerPromptWith(false, false)).not.toContain('ticket rereview 001');
  });

  test('only a reviewer after one that returned nothing is told its bar may still be running', () => {
    const deadReviewerLine = 'An earlier reviewer of this run returned nothing';
    expect(reviewerPromptWith(false, true)).toContain(deadReviewerLine);
    expect(reviewerPromptWith(false, false)).not.toContain(deadReviewerLine);
  });

  test('the round the dispatcher counts is stated', () => {
    expect(reviewerPromptWith(false, false)).toContain('round 2 as the dispatcher counts it');
  });
});

describe('the helper prompts', () => {
  test('the survey runs in the main checkout', () => {
    expect(surveyPrompt(WHOLE_BOARD_SETTINGS)).toContain('once, in /scratch/example-repository, then `test -d` once per paused build');
  });

  test('the settings lookup names its tickets on its marker line and in its request', () => {
    const [markerLine, request] = ticketSettingsLookupPrompt(WHOLE_BOARD_SETTINGS, ['001', '002']).split('\n');
    expect(markerLine).toBe('agent-progress settings: 001,002');
    expect(request).toContain('For each of the tickets 001, 002,');
  });

  // The line sits inside a double-quoted shell argument, so a quote, a backtick, a dollar or a backslash would end it or expand.
  test('the parking agent\'s log line has its whitespace folded, its shell characters replaced and its length cut', () => {
    const unsafeLine = `Parked #001: a "quoted"\n\`tick\` $HOME \\ ${'x'.repeat(DISPATCH_POLICY.PARKING_LOG_REASON_LIMIT_CHARACTERS)}`;
    const logLine = /`agent-progress log "(.*)"`/.exec(parkingPrompt(WHOLE_BOARD_SETTINGS, '001', unsafeLine))?.[1] ?? '';
    expect(logLine.startsWith('Parked #001: a \'quoted\' \'tick\' \'HOME \' ')).toBe(true);
    expect(logLine).toHaveLength(DISPATCH_POLICY.PARKING_LOG_REASON_LIMIT_CHARACTERS);
  });
});
