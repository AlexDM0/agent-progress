/**
 * The spec stepper. The cases that matter: the five phases in order with no approval gates, the done ones and the current one marked, a done
 * spec with every phase done and no current one, and the size written for the CSS to read.
 */

import { describe, expect, test } from 'bun:test';

import { specStepperMarkup } from './SpecStepperMarkup.ts';

describe('specStepperMarkup', () => {
  test('marks the done phases and the current one, in phase order, and nothing else', () => {
    expect(specStepperMarkup({ doneLanes: ['specify', 'plan'], currentLane: 'tasks' }, 'compact')).toBe(
      '<ol class="ap-spec-steps" data-size="compact" aria-label="Phase: Tasks">'
      + '<li class="ap-spec-step" data-step="done">Specify</li><li class="ap-spec-step" data-step="done">Plan</li>'
      + '<li class="ap-spec-step" data-step="current">Tasks</li><li class="ap-spec-step" data-step="next">Implement</li>'
      + '<li class="ap-spec-step" data-step="next">Converge</li></ol>',
    );
  });

  test('a done spec has every phase done and says so', () => {
    const markup = specStepperMarkup({ doneLanes: ['specify', 'plan', 'tasks', 'implement', 'converge'], currentLane: null }, 'full');

    expect(markup).toStartWith('<ol class="ap-spec-steps" data-size="full" aria-label="Phase: every phase done">');
    expect(markup.match(/data-step="done"/g)?.length).toBe(5);
  });
});
