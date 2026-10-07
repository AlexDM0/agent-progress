/**
 * `spec.md` and `plan.md` read from literal text, modelled on spec-kit 1.1.0's templates, without a disk. The cases that matter: an
 * untouched template copy reads as `template` while the same file with only its title filled reads as `filled`, since spec-kit copies the
 * template before an agent fills it; the stories, requirement and criterion ids, open markers and clarification sessions are found with
 * their lines; and empty, binary-looking and truncated text is a verdict, never a throw.
 */
import { describe, expect, test } from 'bun:test';

import {
  HOSTILE_TEXTS,
  PLAN_TEMPLATE_TEXT,
  SPEC_TEMPLATE_TEXT,
  truncationsOf
} from '../testing/SpecKitTemplateTexts.ts';
import { SpecFeatureDocumentUtil } from './SpecFeatureDocumentUtil.ts';

const { planReadingOf, specReadingOf } = SpecFeatureDocumentUtil;

const FILLED_SPEC_TEXT = SPEC_TEMPLATE_TEXT
  .replace('# Feature Specification: [FEATURE NAME]', '# Feature Specification: Example Checkout')
  .replace('### User Story 1 - [Brief Title]', '### User Story 1 - Pay with a saved card')
  .replace('## User Scenarios & Testing', `## Clarifications

### Session 2026-10-01

- Q: Which cards are kept? → A: Only cards the shopper saved.
- Q: How long? → A: Until removed.

### Session 2026-10-02

- Q: Guest checkout? → A: Out of scope.

## User Scenarios & Testing`);

function parsedSpecOf(text: string) {
  const reading = specReadingOf(text);
  if (reading.verdict === 'malformed') throw new Error(reading.reason);
  return reading.document;
}

describe('spec.md', () => {
  test('an untouched template copy reads as template', () => {
    expect(parsedSpecOf(SPEC_TEMPLATE_TEXT).fillState).toBe('template');
  });

  test('the same file with its title filled reads as filled, though `[DATE]` and `[###-feature-name]` stay', () => {
    const titleOnly = SPEC_TEMPLATE_TEXT.replace('[FEATURE NAME]', 'Example Checkout');
    const document  = parsedSpecOf(titleOnly);
    expect(document.fillState).toBe('filled');
    expect(document.title).toBe('Feature Specification: Example Checkout');
    expect(document.createdText).toBe('[DATE]');
  });

  test('the user stories read with number, title, priority and line', () => {
    expect(parsedSpecOf(SPEC_TEMPLATE_TEXT).userStories).toEqual([
      {
        number: 1, title: '[Brief Title]', priority: 1, line: 18
      },
      {
        number: 2, title: '[Brief Title]', priority: 2, line: 24
      },
    ]);
  });

  test('requirement and success criterion ids read in file order', () => {
    const document = parsedSpecOf(SPEC_TEMPLATE_TEXT);
    expect(document.requirementIds).toEqual(['FR-001', 'FR-002', 'FR-006', 'FR-007']);
    expect(document.successCriterionIds).toEqual(['SC-001', 'SC-002']);
  });

  test('each open NEEDS CLARIFICATION marker reads with its text and line', () => {
    expect(parsedSpecOf(SPEC_TEMPLATE_TEXT).openClarifications).toEqual([
      { text: 'auth method not specified - email/password, SSO, OAuth?', line: 39 },
      { text: 'retention period not specified', line: 40 },
    ]);
  });

  test('the clarification sessions read with their answers, each under its own session', () => {
    const document = parsedSpecOf(FILLED_SPEC_TEXT);
    expect(document.clarificationSessions).toEqual([
      {
        dateText: '2026-10-01',
        line:     13,
        answers:  [
          { question: 'Which cards are kept?', answer: 'Only cards the shopper saved.', line: 15 },
          { question: 'How long?', answer: 'Until removed.', line: 16 },
        ],
      },
      { dateText: '2026-10-02', line: 18, answers: [{ question: 'Guest checkout?', answer: 'Out of scope.', line: 20 }] },
    ]);
    expect(document.userStories[0]?.title).toBe('Pay with a saved card');
  });

  test('a `- Q:` line outside `## Clarifications` is no answer', () => {
    const stray = `${SPEC_TEMPLATE_TEXT}\n### Session 2026-10-03\n\n- Q: Stray? → A: Ignored.\n`;
    expect(parsedSpecOf(stray).clarificationSessions).toEqual([]);
  });

  test('a file with no title heading is malformed with a line', () => {
    expect(specReadingOf('**Created**: 2026-10-01\n')).toMatchObject({ verdict: 'malformed', line: 1 });
  });

  for (const [description, text] of HOSTILE_TEXTS) {
    test(`${description} is a verdict, never a throw`, () => {
      expect(specReadingOf(text).verdict).toBe('malformed');
    });
  }

  test('every truncation of a spec reads without a throw', () => {
    for (const truncated of truncationsOf(FILLED_SPEC_TEXT)) expect(['parsed', 'malformed']).toContain(specReadingOf(truncated).verdict);
  });
});

describe('plan.md', () => {
  test('an untouched template copy reads as template, counting its open NEEDS CLARIFICATION marks', () => {
    const reading = planReadingOf(PLAN_TEMPLATE_TEXT);
    expect(reading).toEqual({
      verdict:  'parsed',
      document: { fillState: 'template', title: 'Implementation Plan: [FEATURE]', openClarificationCount: 2 },
    });
  });

  test('the same file with its title filled reads as filled, though `[DATE]` stays', () => {
    const titleOnly = PLAN_TEMPLATE_TEXT.replace('[FEATURE]', 'Example Checkout');
    expect(planReadingOf(titleOnly)).toMatchObject({ verdict: 'parsed', document: { fillState: 'filled' } });
  });

  for (const [description, text] of HOSTILE_TEXTS) {
    test(`${description} is a verdict, never a throw`, () => {
      expect(planReadingOf(text).verdict).toBe('malformed');
    });
  }

  test('every truncation of a plan reads without a throw', () => {
    for (const truncated of truncationsOf(PLAN_TEMPLATE_TEXT)) expect(['parsed', 'malformed']).toContain(planReadingOf(truncated).verdict);
  });
});
