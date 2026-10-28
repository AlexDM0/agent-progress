/**
 * The decisions, incidents and their counters in progress.json. What matters: each is written only once set, so a file without them stays
 * byte-identical; a file with them round-trips byte for byte; a key the tool does not know on a decision, a question, an option, an
 * incident or its delivery turn keeps its place through a change the Board makes; and an open decision or incident left by the Board is
 * written back as the Board holds it.
 */
import { expect, test } from 'bun:test';

import { Board }                      from '../../../lib/tracker-model/Board.ts';
import { createLogger }               from '../../../lib/tracker-model/Logger.ts';
import { JsonTextUtil }               from '../../../shared/utils/JsonTextUtil.ts';
import { emptyProgress }              from '../../../testing/ProgressFixtures.ts';
import type { StoredProgressFile }    from '../@types/StoredProgressFile.ts';
import { ProgressFileMappingUtil }    from './ProgressFileMappingUtil.ts';
import { ProgressFileValidationUtil } from './ProgressFileValidationUtil.ts';

const AT = '2026-09-26T10:15:00+02:00';

function storedTextWithDecisionsAndIncidents(): string {
  const progress = emptyProgress();
  const document = {
    version:        2,
    trackerId:      progress.trackerId,
    project:        progress.project,
    startedAt:      progress.startedAt,
    view:           progress.view,
    nextTaskId:     progress.nextTaskId,
    nextDecisionId: 4,
    decisions:      [{
      unknownLeadingDecisionKey: 'kept',
      id:                        'E3',
      kind:                      'agent-question',
      ticketIds:                 ['001'],
      jobId:                     'J2',
      askedBy:                   'builder',
      requestId:                 'request-7',
      questions:                 [{
        question:           'Which export format?',
        unknownQuestionKey: 1,
        header:             'Format',
        multiSelect:        false,
        options:            [{ label: 'CSV', description: 'Comma separated', unknownOptionKey: true }],
      }],
      context:                    'Example export',
      openedAt:                   AT,
      unknownTrailingDecisionKey: { nested: true },
    }],
    nextIncidentId: 6,
    incidents:      [{
      id:                 'I5',
      kind:               'setup-failed',
      ticketIds:          ['001'],
      jobId:              'J2',
      facts:              { step: 'install', exitCode: '1' },
      defaultMove:        'worktree-repair',
      deliveredInTurn:    { jobId: 'J1', unknownTurnKey: 'kept', chatSequence: 2 },
      openedAt:           AT,
      unknownIncidentKey: [],
    }],
    tasks: [],
  };
  return JsonTextUtil.storedFileTextOf(document);
}

function storedDocumentOf(text: string): StoredProgressFile {
  const reading = ProgressFileValidationUtil.readingOf(JSON.parse(text));
  if (reading.verdict === 'unreadable') throw new Error(reading.reason);
  return reading.document;
}

test('a file with decisions, incidents and both counters is written back byte for byte', () => {
  const text = storedTextWithDecisionsAndIncidents();
  expect(JsonTextUtil.storedFileTextOf(ProgressFileMappingUtil.storedDocumentOf(ProgressFileMappingUtil.progressOf(storedDocumentOf(text))))).toBe(text);
});

test('a decision, its question, its option, an incident and its delivery turn keep a key the tool does not know where the file had it', () => {
  const progress   = ProgressFileMappingUtil.progressOf(storedDocumentOf(storedTextWithDecisionsAndIncidents()));
  const [decision] = progress.decisions ?? [];
  const [incident] = progress.incidents ?? [];
  expect(Object.keys(decision ?? {}).at(0)).toBe('unknownLeadingDecisionKey');
  expect(Object.keys(decision ?? {}).at(-1)).toBe('unknownTrailingDecisionKey');
  expect(Object.keys(decision?.questions[0] ?? {})).toEqual(['question', 'unknownQuestionKey', 'header', 'multiSelect', 'options']);
  expect(Object.keys(decision?.questions[0]?.options[0] ?? {}).at(-1)).toBe('unknownOptionKey');
  expect(Object.keys(incident ?? {}).at(-1)).toBe('unknownIncidentKey');
  expect(Object.keys(incident?.deliveredInTurn ?? {})).toEqual(['jobId', 'unknownTurnKey', 'chatSequence']);
});

test('what the Board opens, delivers and closes is written back with the counters moved on and the incident\'s unknown keys kept', () => {
  const progress = ProgressFileMappingUtil.progressOf(storedDocumentOf(storedTextWithDecisionsAndIncidents()));
  const board    = new Board({
    progress, tickets: [], epics: [], logger: createLogger(() => undefined)
  });
  board.markIncidentDelivered('I5', { jobId: 'J1', chatSequence: 3 });
  board.openIncident({
    kind: 'blocked', ticketIds: [], jobId: null, facts: {}, defaultMove: 'ticket-park'
  }, AT);
  board.answerDecision('E3', ['CSV'], AT);

  const stored = ProgressFileMappingUtil.storedDocumentOf(progress);
  expect(stored.nextDecisionId).toBe(4);
  expect(stored.decisions).toEqual([]);
  expect(stored.nextIncidentId).toBe(7);
  expect(stored.incidents?.map((incident) => incident.id)).toEqual(['I5', 'I6']);
  expect(stored.incidents?.[0]?.deliveredInTurn).toEqual({ jobId: 'J1', chatSequence: 3 });
  expect(Object.keys(stored.incidents?.[0] ?? {}).at(-1)).toBe('unknownIncidentKey');
});

test('a file without decisions, incidents or their counters stores none of them', () => {
  const text   = JsonTextUtil.storedFileTextOf(ProgressFileMappingUtil.storedDocumentOf(emptyProgress()));
  const stored = ProgressFileMappingUtil.storedDocumentOf(ProgressFileMappingUtil.progressOf(storedDocumentOf(text)));
  expect(JsonTextUtil.storedFileTextOf(stored)).toBe(text);
  for (const key of ['decisions', 'nextDecisionId', 'incidents', 'nextIncidentId']) expect(Object.hasOwn(stored, key)).toBe(false);
});
