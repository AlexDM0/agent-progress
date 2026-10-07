/**
 * The stored shape written as checks: a written document passes, `null` passes only where the snapshot allows it, and each kind of check
 * (text, whole number, true or false, a value list, a list, an object, a keyed count) names the offending field by its full path, so the
 * render's `unrepaired` report points at the field.
 */
import { describe, expect, test } from 'bun:test';

import { JsonRecordUtil }                         from '../../../lib/json-record/JsonRecordUtil.ts';
import { deriveSpecSnapshot }                     from '../../../lib/spec-snapshot/SpecSnapshotDerivation.ts';
import { phase, sourceFeature, sourceRepository } from '../../../testing/SpecSnapshotSourceFixtures.ts';
import { SpecSnapshotFileMappingUtil }            from './SpecSnapshotFileMappingUtil.ts';
import { SpecSnapshotFileValidationUtil }         from './SpecSnapshotFileValidationUtil.ts';

type FieldPath = readonly (string | number)[];

function writtenDocument(): unknown {
  const source = sourceRepository([sourceFeature({ plan: 'filled', tasks: 'filled', phases: [phase('setup', 1, 2), phase('user-story', 0, 3, 1)] })]);
  return structuredClone(SpecSnapshotFileMappingUtil.storedDocumentOf(deriveSpecSnapshot(source, new Date('2026-10-07T09:30:00.000Z'))));
}

function documentWith(replacements: readonly (readonly [FieldPath, unknown])[]): unknown {
  const storedDocument = writtenDocument();
  for (const [fieldPath, replacement] of replacements) {
    const parentPath = fieldPath.slice(0, -1);
    const field = fieldPath.at(-1) ?? '';
    const parent = parentPath.reduce<unknown>(
      (container, step) => (Array.isArray(container) ? container[Number(step)] : JsonRecordUtil.recordOf(container)?.[step]),
      storedDocument,
    );
    if (Array.isArray(parent)) parent[Number(field)] = replacement;
    else if (JsonRecordUtil.valueIsAPlainObject(parent)) parent[field] = replacement;
    else throw new Error(`the written document has no ${fieldPath.join('.')}`);
  }
  return storedDocument;
}

test('a document the writer stores has no problem, and reads back as readable', () => {
  expect(SpecSnapshotFileValidationUtil.documentProblemOf(writtenDocument())).toBeNull();
  expect(SpecSnapshotFileValidationUtil.readingOf(writtenDocument()).verdict).toBe('readable');
});

describe('each check names its field', () => {
  const cases: readonly (readonly [string, FieldPath, unknown, string])[] = [
    ['a missing version', ['version'], undefined, 'version is undefined, and this build of agent-progress reads version 1'],
    ['a project that is a number', ['project'], 7, 'project is not a string'],
    ['a lane count that is a fraction', ['laneCounts', 'plan'], 1.5, 'laneCounts.plan is not a whole number'],
    ['a lane outside the lane list', ['specs', 0, 'lane'], 'review', 'specs[0].lane is "review", which is not one of specify, plan, tasks, implement, converge, done'],
    ['a task tick that is text', ['specs', 0, 'workItems', 1, 'tasks', 0, 'isDone'], 'yes', 'specs[0].workItems[1].tasks[0].isDone is not true or false'],
    ['a waiting-on entry that is a number', ['specs', 0, 'workItems', 0, 'waitingOn'], [3], 'specs[0].workItems[0].waitingOn[0] is not a string'],
    ['a stage span with no start', ['specs', 0, 'stageSpans', 0, 'start'], null, 'specs[0].stageSpans[0].start is not an object'],
    ['an artefact date that is text', ['specs', 0, 'artefacts', 0, 'created'], '2026-10-07', 'specs[0].artefacts[0].created is not an object'],
    ['a constitution that is a list', ['constitution'], [], 'constitution is not an object'],
    ['an artefact file count that is a fraction', ['specs', 0, 'artefacts', 0, 'fileCount'], 1.5, 'specs[0].artefacts[0].fileCount is not a whole number'],
  ];

  test.each(cases)('%s', (_case, fieldPath, replacement, expectedProblem) => {
    expect(SpecSnapshotFileValidationUtil.documentProblemOf(documentWith([[fieldPath, replacement]]))).toBe(expectedProblem);
  });
});

test('null passes where the snapshot allows it: no spec-kit version, no constitution, an open span\'s end', () => {
  const storedDocument = documentWith([[['specKitVersion'], null], [['constitution'], null], [['specs', 0, 'stageSpans', 0, 'end'], null]]);
  expect(SpecSnapshotFileValidationUtil.documentProblemOf(storedDocument)).toBeNull();
});

test('an artefact\'s file count is optional: absent, as a file written without it, or a whole number both read', () => {
  const uncounted = writtenDocument();
  expect(JSON.stringify(uncounted)).not.toContain('fileCount');
  expect(SpecSnapshotFileValidationUtil.readingOf(uncounted).verdict).toBe('readable');
  expect(SpecSnapshotFileValidationUtil.documentProblemOf(documentWith([[['specs', 0, 'artefacts', 0, 'fileCount'], 3]]))).toBeNull();
});

test('a reading of a spoiled document is unreadable with the same reason', () => {
  expect(SpecSnapshotFileValidationUtil.readingOf(documentWith([[['tasks'], { ticked: 1 }]]))).toEqual({ verdict: 'unreadable', reason: 'tasks.total is not a whole number' });
});
