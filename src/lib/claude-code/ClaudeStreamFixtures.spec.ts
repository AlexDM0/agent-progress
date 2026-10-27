/**
 * The stream fixtures under `testing/fixtures/` are recorded Claude Code 2.1.311 sessions (`docs/development/runner-claude-probe.md`),
 * kept for the stream mapper and the question delivery that later build on them. These claims hold what each fixture was recorded to
 * show, so a re-recorded or hand-trimmed fixture that no longer shows it fails here rather than in the code that relies on it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join }                      from 'node:path';

import { describe, expect, test } from 'bun:test';

type StreamRecord = Readonly<Record<string, unknown>>;

const FIXTURES_FOLDER = join(import.meta.dir, 'testing', 'fixtures');
const PROBE_SESSION_IDENTIFIER = '7a1f0c52-0001-4000-8000-000000000001';

function recordsOf(fileName: string): StreamRecord[] {
  return readFileSync(join(FIXTURES_FOLDER, fileName), 'utf8').split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line) as StreamRecord);
}

function recordsOfType(records: readonly StreamRecord[], type: string): StreamRecord[] {
  return records.filter((record) => record['type'] === type);
}

function objectAt(record: StreamRecord | undefined, key: string): StreamRecord {
  const value = record?.[key];
  if (typeof value !== 'object' || value === null) throw new Error(`no object at ${key}`);
  return value as StreamRecord;
}

function onlyResult(records: readonly StreamRecord[]): StreamRecord {
  const results = recordsOfType(records, 'result');
  expect(results).toHaveLength(1);
  return results[0] ?? {};
}

function colourIsSchemaValid(structuredOutput: StreamRecord): boolean {
  const schema = JSON.parse(readFileSync(join(FIXTURES_FOLDER, 'button-colour.schema.json'), 'utf8')) as { properties: { colour: { enum: string[] } } };
  return Object.keys(structuredOutput).join() === 'colour' && schema.properties.colour.enum.includes(String(structuredOutput['colour']));
}

describe('every stream fixture', () => {
  const fixtureNames = readdirSync(FIXTURES_FOLDER).filter((name) => name.endsWith('.jsonl'));

  test('exists as a stdout and stdin pair, one JSON object per line', () => {
    expect(fixtureNames.length).toBeGreaterThanOrEqual(6);
    for (const name of fixtureNames) {
      const partner = name.endsWith('.stdout.jsonl') ? name.replace('.stdout.', '.stdin.') : name.replace('.stdin.', '.stdout.');
      expect(fixtureNames).toContain(partner);
      expect(recordsOf(name).length).toBeGreaterThan(0);
    }
  });
});

describe('ask-user-question-live-answer (P1)', () => {
  const stdout = recordsOf('ask-user-question-live-answer.stdout.jsonl');
  const stdin = recordsOf('ask-user-question-live-answer.stdin.jsonl');

  test('runs in auto mode and asks through a can_use_tool control request needing user interaction', () => {
    expect(recordsOfType(stdout, 'system')[0]?.['permissionMode']).toBe('auto');
    const request = objectAt(recordsOfType(stdout, 'control_request')[0], 'request');
    expect(request['subtype']).toBe('can_use_tool');
    expect(request['tool_name']).toBe('AskUserQuestion');
    expect(request['requires_user_interaction']).toBe(true);
  });

  test('is answered by a control_response allow carrying updatedInput.answers for the same request', () => {
    const requestIdentifier = recordsOfType(stdout, 'control_request')[0]?.['request_id'];
    const response = objectAt(recordsOfType(stdin, 'control_response')[0], 'response');
    expect(response['request_id']).toBe(requestIdentifier);
    const decision = objectAt(response, 'response');
    expect(decision['behavior']).toBe('allow');
    expect(objectAt(decision, 'updatedInput')['answers']).toEqual({ 'Which colour should the button be?': 'Blue' });
  });

  test('reaches a successful result whose structured output is schema-valid and carries the answer', () => {
    const result = onlyResult(stdout);
    expect(result['subtype']).toBe('success');
    expect(result['is_error']).toBe(false);
    expect(colourIsSchemaValid(objectAt(result, 'structured_output'))).toBe(true);
    expect(objectAt(result, 'structured_output')['colour']).toBe('Blue');
  });
});

describe('resume-structured-output (P6)', () => {
  const stdout = recordsOf('resume-structured-output.stdout.jsonl');

  test('keeps the resumed session id and answers from its transcript with schema-valid output', () => {
    expect(recordsOfType(stdout, 'system')[0]?.['session_id']).toBe(PROBE_SESSION_IDENTIFIER);
    const result = onlyResult(stdout);
    expect(result['session_id']).toBe(PROBE_SESSION_IDENTIFIER);
    expect(objectAt(result, 'structured_output')).toEqual({ colour: 'Blue' });
  });
});

describe('mid-turn-line-folded (P8)', () => {
  const stdout = recordsOf('mid-turn-line-folded.stdout.jsonl');
  const stdin = recordsOf('mid-turn-line-folded.stdin.jsonl');

  test('folds a user line written while a tool runs into that turn: two lines in, one result out, which uses the second line', () => {
    expect(recordsOfType(stdin, 'user')).toHaveLength(2);
    expect(String(onlyResult(stdout)['result'])).toContain('PELICAN-8');
  });

  test('echoes no stdout record for the folded line', () => {
    const userTexts = recordsOfType(stdout, 'user').map((record) => JSON.stringify(record));
    expect(userTexts.some((text) => text.includes('PELICAN-8'))).toBe(false);
  });
});
