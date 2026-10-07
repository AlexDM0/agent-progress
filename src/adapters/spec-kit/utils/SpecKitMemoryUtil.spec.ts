/**
 * The constitution and `init-options.json` read from literal text, modelled on spec-kit 1.1.0, without a disk. The cases that matter: the
 * footer's version and dates and the Core Principles names are read, never the commented example beneath the footer; an untouched
 * template copy reads as `template`; and empty, binary-looking, truncated or wrongly shaped text is a verdict, never a throw.
 */
import { describe, expect, test } from 'bun:test';

import { CONSTITUTION_TEMPLATE_TEXT, HOSTILE_TEXTS, truncationsOf } from '../testing/SpecKitTemplateTexts.ts';
import { SpecKitMemoryUtil }                                        from './SpecKitMemoryUtil.ts';

const { constitutionReadingOf, initOptionsReadingOf } = SpecKitMemoryUtil;

const FILLED_CONSTITUTION_TEXT = CONSTITUTION_TEMPLATE_TEXT
  .replace('[PROJECT_NAME]', 'Example Agency')
  .replace('[PRINCIPLE_1_NAME]', 'I. Library-First')
  .replace('[PRINCIPLE_2_NAME]', 'II. CLI Interface')
  .replace('[CONSTITUTION_VERSION]', '1.2.0')
  .replace('[RATIFICATION_DATE]', '2026-09-01')
  .replace('[LAST_AMENDED_DATE]', '2026-10-01');

describe('the constitution', () => {
  test('an untouched template copy reads as template, its placeholders read as they stand', () => {
    expect(constitutionReadingOf(CONSTITUTION_TEMPLATE_TEXT)).toEqual({
      verdict:  'parsed',
      document: {
        fillState:       'template',
        title:           '[PROJECT_NAME] Constitution',
        version:         '[CONSTITUTION_VERSION]',
        ratifiedDate:    '[RATIFICATION_DATE]',
        lastAmendedDate: '[LAST_AMENDED_DATE]',
        principleNames:  ['[PRINCIPLE_1_NAME]', '[PRINCIPLE_2_NAME]'],
      },
    });
  });

  test('a filled constitution reads its version, dates and principle names', () => {
    expect(constitutionReadingOf(FILLED_CONSTITUTION_TEXT)).toMatchObject({
      verdict:  'parsed',
      document: {
        fillState:       'filled',
        version:         '1.2.0',
        ratifiedDate:    '2026-09-01',
        lastAmendedDate: '2026-10-01',
        principleNames:  ['I. Library-First', 'II. CLI Interface'],
      },
    });
  });

  test('a constitution with no footer has no version or dates', () => {
    expect(constitutionReadingOf('# Example Agency Constitution\n\n## Core Principles\n')).toMatchObject({
      verdict:  'parsed',
      document: {
        version: null, ratifiedDate: null, lastAmendedDate: null, principleNames: []
      },
    });
  });

  for (const [description, text] of HOSTILE_TEXTS) {
    test(`${description} is a verdict, never a throw`, () => {
      expect(constitutionReadingOf(text).verdict).toBe('malformed');
    });
  }

  test('every truncation of a constitution reads without a throw', () => {
    for (const truncated of truncationsOf(FILLED_CONSTITUTION_TEXT)) {
      expect(['parsed', 'malformed']).toContain(constitutionReadingOf(truncated).verdict);
    }
  });
});

describe('init-options.json', () => {
  const INIT_OPTIONS_TEXT = '{\n  "ai": "claude",\n  "here": true,\n  "speckit_version": "1.1.0"\n}\n';

  test('the spec-kit version is read', () => {
    expect(initOptionsReadingOf(INIT_OPTIONS_TEXT)).toEqual({ verdict: 'parsed', document: { speckitVersion: '1.1.0' } });
  });

  test.each([
    ['a JSON array', '["1.1.0"]'],
    ['an object without the version', '{ "ai": "claude" }'],
    ['a version that is no text', '{ "speckit_version": 110 }'],
    ['null', 'null'],
  ])('%s is malformed', (_description, text) => {
    expect(initOptionsReadingOf(text)).toMatchObject({ verdict: 'malformed', line: 1 });
  });

  for (const [description, text] of HOSTILE_TEXTS) {
    test(`${description} is a verdict, never a throw`, () => {
      expect(initOptionsReadingOf(text).verdict).toBe('malformed');
    });
  }

  test('every truncation reads without a throw', () => {
    for (const truncated of truncationsOf(INIT_OPTIONS_TEXT)) expect(['parsed', 'malformed']).toContain(initOptionsReadingOf(truncated).verdict);
  });
});
