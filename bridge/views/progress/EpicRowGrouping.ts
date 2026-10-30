/**
 * The Progress rows grouped by epic, as the static page grouped them: a head row per epic, open epics
 * first, each followed by the rows of the tickets whose primary epic it is, then "No epic" for the rest. A folded group keeps its head and
 * draws none of its rows; a group with no rows is left out.
 */
import type { ProgressEpicFacts, ProgressTicketDocument } from '../../@types/ProgressBoardState.ts';
import type { TimestampSlices }                           from '../../utils/TimeUtil.ts';
import { TimeUtil }                                       from '../../utils/TimeUtil.ts';

/** The ungrouped head's fold key, the static page's, so a stored fold keeps its meaning. */
export const NO_EPIC_GROUP_KEY = 'no epic';
/** The static page's choice name for the folded groups, a JSON list of their keys. */
export const FOLDED_EPIC_GROUPS_CHOICE_NAME = 'progress-folded-epics';

const NO_EPIC_LABEL = 'No epic';

export interface EpicGroupSpanModel {
  readonly leftPercent:  number;
  readonly widthPercent: number;
  readonly title:        string;
  /** The epic still has open tickets. */
  readonly isOpen:       boolean;
}

export interface EpicGroupHeadModel {
  readonly key:               string;
  /** The epic's colour slot; null on the "No epic" head. */
  readonly slot:              number | null;
  readonly label:             string;
  /** "N / M done" on an epic's head; null on "No epic", which counts its rows instead. */
  readonly doneText:          string | null;
  /** Its tickets drawn under another, primary, epic. */
  readonly sharedMemberCount: number;
  readonly memberCount:       number;
  readonly isFolded:          boolean;
  readonly span:              EpicGroupSpanModel | null;
}

export interface EpicRowGroup<Row> {
  readonly head: EpicGroupHeadModel;
  /** Empty while the group is folded. */
  readonly rows: readonly Row[];
}

/** What the grouping reads of a chart row: the ticket it is or reviews. */
export interface EpicGroupedRow {
  readonly groupTicketId: string | null;
}

export interface EpicGroupingAxis {
  readonly fromEpochMilliseconds:   number;
  readonly toEpochMilliseconds:     number;
  readonly nowEpochMilliseconds:    number;
  readonly minimumSpanWidthPercent: number;
  readonly todayCalendarDate:       string;
  readonly slices:                  TimestampSlices;
}

export interface EpicGroupingSource {
  readonly epics:           readonly ProgressEpicFacts[] | undefined;
  readonly tickets:         readonly Pick<ProgressTicketDocument, 'id' | 'epics'>[];
  readonly foldedGroupKeys: ReadonlySet<string>;
  readonly axis:            EpicGroupingAxis;
}

function countOf(epic: ProgressEpicFacts, status: string): number {
  return Object.hasOwn(epic.ticketCountByStatus, status) ? epic.ticketCountByStatus[status] ?? 0 : 0;
}

function openTicketCountOf(epic: ProgressEpicFacts): number {
  return epic.ticketIds.length - countOf(epic, 'delivered') - countOf(epic, 'abandoned');
}

/** The span on the axis, null when the epic never started or lies wholly outside the range; a short span keeps the bars' minimum width. */
function spanModelOf(epic: ProgressEpicFacts, axis: EpicGroupingAxis): EpicGroupSpanModel | null {
  const { span } = epic;
  if (span === null) return null;
  const startEpochMilliseconds = TimeUtil.epochMillisecondsOf(span.start);
  const endEpochMilliseconds = span.end === null ? axis.nowEpochMilliseconds : TimeUtil.epochMillisecondsOf(span.end);
  if (startEpochMilliseconds === null || endEpochMilliseconds === null) return null;
  const axisMilliseconds = axis.toEpochMilliseconds - axis.fromEpochMilliseconds;
  const rawLeftPercent = (startEpochMilliseconds - axis.fromEpochMilliseconds) / axisMilliseconds * 100;
  const rawRightPercent = (Math.max(startEpochMilliseconds, endEpochMilliseconds) - axis.fromEpochMilliseconds) / axisMilliseconds * 100;
  if (rawRightPercent < 0 || rawLeftPercent > 100) return null;
  const widthPercent = Math.min(100, Math.max(Math.min(rawRightPercent, 100) - Math.max(rawLeftPercent, 0), axis.minimumSpanWidthPercent));
  const leftPercent = Math.max(0, Math.min(Math.max(rawLeftPercent, 0), 100 - widthPercent));
  const endText = span.end === null ? 'now' : TimeUtil.shortStampText(span.end, axis.todayCalendarDate, axis.slices);
  return {
    leftPercent,
    widthPercent,
    title:  `${epic.title} · ${TimeUtil.shortStampText(span.start, axis.todayCalendarDate, axis.slices)} → ${endText}`,
    isOpen: openTicketCountOf(epic) > 0,
  };
}

/** Null on a board without epics, whose rows are drawn ungrouped. */
function epicRowGroupsOf<Row extends EpicGroupedRow>(rows: readonly Row[], source: EpicGroupingSource): EpicRowGroup<Row>[] | null {
  const { epics, foldedGroupKeys, axis } = source;
  if (epics === undefined || epics.length === 0) return null;
  const knownEpicKeys = new Set(epics.map((epic) => epic.key));
  const primaryEpicOfTicket = new Map(source.tickets.flatMap((ticket) => {
    const primary = ticket.epics?.find((key) => knownEpicKeys.has(key));
    return primary === undefined ? [] : [[ticket.id, primary] as const];
  }));
  const membersByGroup = new Map<string, Row[]>();
  for (const row of rows) {
    const groupKey = (row.groupTicketId === null ? undefined : primaryEpicOfTicket.get(row.groupTicketId)) ?? NO_EPIC_GROUP_KEY;
    membersByGroup.set(groupKey, [...membersByGroup.get(groupKey) ?? [], row]);
  }
  const openFirst = epics.toSorted((a, b) => Number(openTicketCountOf(a) === 0) - Number(openTicketCountOf(b) === 0));
  const heads: EpicGroupHeadModel[] = [
    ...openFirst.map((epic) => ({
      key:               epic.key,
      slot:              epic.slot,
      label:             epic.title,
      doneText:          `${countOf(epic, 'delivered')} / ${epic.ticketIds.length} done`,
      sharedMemberCount: epic.ticketIds.filter((ticketId) => primaryEpicOfTicket.get(ticketId) !== epic.key).length,
      memberCount:       membersByGroup.get(epic.key)?.length ?? 0,
      isFolded:          foldedGroupKeys.has(epic.key),
      span:              spanModelOf(epic, axis),
    })),
    {
      key:               NO_EPIC_GROUP_KEY,
      slot:              null,
      label:             NO_EPIC_LABEL,
      doneText:          null,
      sharedMemberCount: 0,
      memberCount:       membersByGroup.get(NO_EPIC_GROUP_KEY)?.length ?? 0,
      isFolded:          foldedGroupKeys.has(NO_EPIC_GROUP_KEY),
      span:              null,
    },
  ];
  return heads.filter((head) => head.memberCount > 0).map((head) => ({ head, rows: head.isFolded ? [] : membersByGroup.get(head.key) ?? [] }));
}

/** The folded keys after a head is toggled, in the order they were folded. */
function foldedGroupKeysAfterToggle(foldedGroupKeys: readonly string[], groupKey: string): string[] {
  return foldedGroupKeys.includes(groupKey) ? foldedGroupKeys.filter((key) => key !== groupKey) : [...foldedGroupKeys, groupKey];
}

export const EpicRowGrouping = Object.freeze({ epicRowGroupsOf, foldedGroupKeysAfterToggle });
