/**
 * The header's model. What matters: Restart is offered only with new code on disk and never during a Baton pass, which also withdraws Pause
 * and Stop; the new-code notice points at `update`; every incident default, a failed Baton pass with its step and error, and an Assistant
 * that cannot come up are warnings, kept apart from the other notices; the statistics read concurrency and today's work.
 */
import { describe, expect, test } from 'bun:test';

import { PRODUCT_NAMES }                  from '../../src/shared/constants/ProductNames.ts';
import { boardStateFixture, FIXTURE_NOW } from '../testing/BoardStateFixture.ts';
import { HeaderModelUtil }                from './HeaderModel.ts';

const { headerModelOf } = HeaderModelUtil;

describe('the Overseer state and its controls', () => {
  test('serving offers Pause and Stop, and no Restart without new code', () => {
    const model = headerModelOf(boardStateFixture(), FIXTURE_NOW);
    expect([model.stateText, model.pauseControl, model.restartOffered, model.stopOffered, model.newCodeNotice]).toEqual([
      'Overseer serving', 'pause', false, true, null,
    ]);
  });

  test('paused offers Resume', () => {
    const model = headerModelOf(boardStateFixture({ overseer: { state: 'serving', paused: true, codeVersion: 'code-1' } }), FIXTURE_NOW);
    expect([model.stateText, model.pauseControl]).toEqual(['Overseer serving, paused', 'resume']);
  });

  test('new code on disk offers Restart and the notice pointing at update, and is not listed again among the notices', () => {
    const model = headerModelOf(boardStateFixture({ notices: [{ kind: 'new-code' }] }), FIXTURE_NOW);
    expect(model.restartOffered).toBe(true);
    expect(model.newCodeNotice).toBe(`new code: run \`${PRODUCT_NAMES.PROGRAM} update\``);
    expect(model.notices).toEqual([]);
  });

  test('during a Baton pass the state reads handing over and no control is offered, new code or not', () => {
    const model = headerModelOf(boardStateFixture({
      overseer: { state: 'handing-over', paused: false, codeVersion: 'code-1' },
      notices:  [{ kind: 'new-code' }],
    }), FIXTURE_NOW);
    expect([model.stateToken, model.stateText, model.pauseControl, model.restartOffered, model.stopOffered]).toEqual([
      'handing-over', 'Overseer handing over', null, false, false,
    ]);
  });

  test('before the first board the header reads connecting and offers nothing', () => {
    const model = headerModelOf(null, FIXTURE_NOW);
    expect([model.stateText, model.pauseControl, model.stopOffered, model.statistics]).toEqual(['Overseer connecting', null, false, []]);
  });
});

describe('the warnings and notices', () => {
  test('every incident default, a failed Baton pass and an Assistant that cannot come up are warnings', () => {
    const model = headerModelOf(boardStateFixture({
      overseer: {
        state: 'serving', paused: false, codeVersion: 'code-1', handoverWarning: { successorCodeVersion: 'code-2', step: 'prepared', error: 'the successor exited' }
      },
      notices: [
        {
          kind: 'incident-defaulted', incidentId: 'I3', move: 'merge-abort', cause: 'turn-closed'
        },
        {
          kind: 'incident-defaulted', incidentId: 'I4', move: 'merge-review', cause: 'no-orchestrator'
        },
      ],
    }), FIXTURE_NOW);
    expect(model.warnings).toEqual([
      'incident I3 took its default, merge-abort: its delivery turn closed',
      'incident I4 took its default, merge-review: no Assistant was up',
      'the Baton pass to code code-2 failed at prepared: the successor exited',
      'no Assistant can come up: open incidents take their defaults',
    ]);
    expect(model.notices).toEqual([]);
  });

  test('the other notices are listed in their own words', () => {
    const model = headerModelOf(boardStateFixture({
      notices: [{
        kind: 'dirty-main-checkout', target: 'main', branch: 'main', blockingFiles: ['README.md']
      }, { kind: 'rounds-not-converging', ticketId: '42' }],
    }), FIXTURE_NOW);
    expect(model.notices).toEqual([
      'landings on main wait: the main checkout\'s changes to README.md block the fast-forward',
      'ticket #42\'s review rounds are not converging',
    ]);
    expect(model.warnings).toEqual([]);
  });
});

describe('concurrency, usage and the statistics', () => {
  test('agents against the limit, today\'s deliveries and tokens, the queue, and the open questions and incidents', () => {
    const model = headerModelOf(boardStateFixture(), FIXTURE_NOW);
    expect(model.concurrencyLimit).toBe(4);
    expect(model.statistics).toEqual([
      { figure: '2 / 4', label: 'agents working' },
      { figure: '1', label: 'done today' },
      { figure: '5k', label: 'tokens today' },
      { figure: '1', label: 'waiting in queue' },
      { figure: '1', label: 'open questions' },
      { figure: '0', label: 'open incidents' },
    ]);
  });

  test('usage reads under its limit until a limit is hit, then when it resets', () => {
    expect(headerModelOf(boardStateFixture(), FIXTURE_NOW).usageText).toBe('usage under its limit');
    expect(headerModelOf(boardStateFixture({ usage: { resetsAt: '2026-10-29T15:30:00+01:00', window: 'five-hour' } }), FIXTURE_NOW).usageText)
      .toBe('five-hour usage limit hit, resets 15:30');
  });
});
