/**
 * The Assistant view as data: the live Assistant session, or none while a fresh one boots; its open incidents; and the handled ones read
 * back from the log, each with the moves, notes and escalations made under it. An incident whose default applied is in the warning state.
 */
import type { ConversationBoardDocument, HistoryRecordDocument, SessionJobDocument } from '../../@types/ConversationDocuments.ts';
import type { TranscriptEntryDocument }                                              from '../../api/TranscriptStreamClient.ts';

export type IncidentSettlement = 'open' | 'handled' | 'escalated' | 'defaulted';

export interface IncidentStep {
  readonly at:   string;
  readonly text: string;
}

export interface IncidentEntry {
  readonly incidentId:  string;
  readonly kind:        string;
  readonly ticketIds:   readonly string[];
  readonly settlement:  IncidentSettlement;
  /** The move it takes when its delivery turn closes unhandled; known only while it is open. */
  readonly defaultMove: string | null;
  readonly delivered:   boolean;
  readonly facts:       readonly (readonly [name: string, value: string])[];
  readonly steps:       readonly IncidentStep[];
}

export interface AssistantModel {
  /** `null` while no Assistant session is up: a fresh one is booting. */
  readonly assistantJobId:   string | null;
  readonly openIncidents:    readonly IncidentEntry[];
  readonly settledIncidents: readonly IncidentEntry[];
}

/** The Assistant's job kind as the board stores it. */
const ASSISTANT_JOB_KIND = 'orchestrator';
const NOT_YET_UP_STATES: ReadonlySet<string> = new Set(['launching', 'preparing', 'interrupted', 'stopping']);
const SETTLING_KINDS: Readonly<Record<string, IncidentSettlement>> = {
  'incident-handled':   'handled',
  'incident-answered':  'handled',
  'incident-escalated': 'escalated',
  'incident-defaulted': 'defaulted',
};

function liveAssistantOf(jobs: readonly SessionJobDocument[]): SessionJobDocument | null {
  return jobs.find((job) => job.kind === ASSISTANT_JOB_KIND && !NOT_YET_UP_STATES.has(job.state)) ?? null;
}

function textField(record: HistoryRecordDocument, name: string): string {
  const value = record.fields[name];
  return typeof value === 'string' ? value : '';
}

function stepTextOf(record: HistoryRecordDocument): string | null {
  switch (record.kind) {
    case 'incident-handled':
      return `handled with ${textField(record, 'move')}`;
    case 'incident-answered':
      return 'answered for the waiting agent';
    case 'incident-escalated':
      return `escalated to User as ${textField(record, 'decisionId')}`;
    case 'incident-defaulted':
      return `default applied: ${textField(record, 'move')} (${textField(record, 'cause')})`;
    case 'incident-noted':
      return `note: ${textField(record, 'text')}`;
    default:
      return null;
  }
}

function stepsOf(history: readonly HistoryRecordDocument[], incidentId: string): IncidentStep[] {
  return history.flatMap((record) => {
    const text = record.incidentId === incidentId ? stepTextOf(record) : null;
    return text === null ? [] : [{ at: record.at, text }];
  });
}

function settledIncidentsOf(history: readonly HistoryRecordDocument[], openIds: ReadonlySet<string>): IncidentEntry[] {
  return history
    .filter((record) => record.kind === 'incident-opened' && record.incidentId !== undefined && !openIds.has(record.incidentId))
    .map((opened) => {
      const incidentId = opened.incidentId ?? '';
      const settling = history.findLast((record) => record.incidentId === incidentId && Object.hasOwn(SETTLING_KINDS, record.kind));
      const { ticketIds } = opened.fields;
      return {
        incidentId,
        kind:        textField(opened, 'kind'),
        ticketIds:   Array.isArray(ticketIds) ? ticketIds.map(String) : [],
        settlement:  settling === undefined ? 'handled' : SETTLING_KINDS[settling.kind] ?? 'handled',
        defaultMove: null,
        delivered:   true,
        facts:       [],
        steps:       stepsOf(history, incidentId),
      };
    })
    .reverse();
}

function assistantModelOf(board: ConversationBoardDocument): AssistantModel {
  const history = board.questionHistory ?? [];
  const openIds = new Set(board.incidents.map((incident) => incident.id));
  return {
    assistantJobId: liveAssistantOf(board.jobs)?.id ?? null,
    openIncidents:  board.incidents.map((incident) => ({
      incidentId:  incident.id,
      kind:        incident.kind,
      ticketIds:   incident.ticketIds,
      settlement:  'open',
      defaultMove: incident.defaultMove,
      delivered:   incident.deliveredInTurn !== null,
      facts:       Object.entries(incident.facts),
      steps:       stepsOf(history, incident.id),
    })),
    settledIncidents: settledIncidentsOf(history, openIds),
  };
}

/** The messages User sent that no `user` line of the transcript carries yet: queued until the Assistant is idle. */
function queuedMessagesOf(sentTexts: readonly string[], entries: readonly TranscriptEntryDocument[]): string[] {
  return sentTexts.filter((text) => !entries.some((entry) => entry.role === 'user' && entry.text.includes(text)));
}

export const AssistantModelUtil = Object.freeze({ assistantModelOf, queuedMessagesOf });
