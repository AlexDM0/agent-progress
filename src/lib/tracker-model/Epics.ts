/**
 * Epics as records and as what tickets belong to: an epic added, edited and removed, a ticket's epic list set, added to and removed from,
 * and each epic's roll-up over its tickets. Nothing here touches dispatch: an epic only groups tickets for reading.
 */
import type { EpicChanged, EpicEdited, TicketEpicsChanged } from './@types/BoardChanges.ts';
import type {
  Epic,
  EpicAddition,
  EpicEdit,
  EpicRollup
} from './@types/Epic.ts';
import type { Task }           from './@types/Task.ts';
import type { TicketStatus }   from './@types/Ticket.ts';
import type { BoardRecords }   from './BoardRecords.ts';
import { BoardRefusal }        from './BoardRefusal.ts';
import type { DisplayQueries } from './DisplayQueries.ts';
import { TICKET_STATUSES }     from './constants/Statuses.ts';
import { EpicUtil }            from './utils/EpicUtil.ts';
import { MarkdownBodyUtil }    from './utils/MarkdownBodyUtil.ts';

export class Epics {
  constructor(
    private readonly records: BoardRecords,
    private readonly displayQueries: DisplayQueries,
  ) {}

  addEpic(addition: EpicAddition, at: string): EpicChanged {
    const { key, title } = addition;
    if (!EpicUtil.epicKeyIsWellFormed(key)) throw new BoardRefusal({ reason: 'malformed-epic-key', epicKey: key });
    if (this.records.epicRecordByKey(key) !== undefined) throw new BoardRefusal({ reason: 'epic-already-exists', epicKey: key });

    const slot = EpicUtil.leastUsedSlotOf(this.records.epicRecords.map((epic) => epic.frontmatter.slot));
    const epic: Epic = {
      frontmatter: {
        key, title, slot, extra: []
      },
      body:     addition.body,
      filePath: addition.filePath,
    };
    this.records.epicRecords.push(epic);
    this.records.epicRecords.sort((a, b) => (a.frontmatter.key < b.frontmatter.key ? -1 : Number(a.frontmatter.key > b.frontmatter.key)));
    this.records.markEpicChanged(epic);
    return { logged: [this.records.logger.log({ kind: 'epic-added', epicKey: key, fields: { title } }, at)], epic };
  }

  editEpic(epicKey: string, edit: EpicEdit, at: string): EpicEdited {
    const epic  = this.requireEpic(epicKey);
    const title = edit.title ?? epic.frontmatter.title;
    const body  = edit.body === undefined ? epic.body : MarkdownBodyUtil.editedBodyOf(epic, edit.body);
    if (title === epic.frontmatter.title && body === epic.body) return { logged: [], epic, changed: false };

    epic.frontmatter.title = title;
    epic.body              = body;
    this.records.markEpicChanged(epic);
    return { logged: [this.records.logger.log({ kind: 'epic-edited', epicKey, fields: { title } }, at)], epic, changed: true };
  }

  /** Refused while any ticket names the epic, whatever its status, so no ticket is left naming an epic that is gone. */
  removeEpic(epicKey: string, at: string): EpicChanged {
    const epic      = this.requireEpic(epicKey);
    const ticketIds = this.ticketIdsNaming(epicKey);
    if (ticketIds.length > 0) throw new BoardRefusal({ reason: 'epic-still-named', epicKey, ticketIds });

    this.records.epicRecords.splice(this.records.epicRecords.indexOf(epic), 1);
    const changedIndex = this.records.changedEpicRecords.indexOf(epic);
    if (changedIndex !== -1) this.records.changedEpicRecords.splice(changedIndex, 1);
    this.records.removedEpicRecords.push(epic);
    return { logged: [this.records.logger.log({ kind: 'epic-removed', epicKey, fields: {} }, at)], epic };
  }

  /** A key listed twice is kept at its first place, so the first key stays the primary epic. */
  setTicketEpics(ticketId: string, epicKeys: readonly string[], at: string): TicketEpicsChanged {
    const ticket = this.records.requireTicket(ticketId);
    this.refuseUnknownEpicKeys(epicKeys);
    const epics          = [...new Set(epicKeys)];
    const previousEpics  = ticket.frontmatter.epics ?? [];
    if (epics.length === 0) delete ticket.frontmatter.epics;
    else ticket.frontmatter.epics = epics;
    this.records.markChanged(ticket);
    return {
      logged:          [this.records.logger.log({ kind: 'ticket-epics-set', ticketId, fields: { epics } }, at)],
      ticket,
      addedEpicKeys:   epics.filter((epicKey) => !previousEpics.includes(epicKey)),
      droppedEpicKeys: previousEpics.filter((epicKey) => !epics.includes(epicKey)),
    };
  }

  addTicketEpics(ticketId: string, addedEpicKeys: readonly string[], at: string): TicketEpicsChanged {
    const currentEpics = this.records.requireTicket(ticketId).frontmatter.epics ?? [];
    return this.setTicketEpics(ticketId, [...currentEpics, ...addedEpicKeys], at);
  }

  removeTicketEpics(ticketId: string, removedEpicKeys: readonly string[], at: string): TicketEpicsChanged {
    const currentEpics = this.records.requireTicket(ticketId).frontmatter.epics ?? [];
    this.refuseUnknownEpicKeys(removedEpicKeys);
    return this.setTicketEpics(ticketId, currentEpics.filter((epicKey) => !removedEpicKeys.includes(epicKey)), at);
  }

  refuseUnknownEpicKeys(epicKeys: readonly string[]): void {
    const missingEpicKeys = [...new Set(epicKeys)].filter((epicKey) => this.records.epicRecordByKey(epicKey) === undefined);
    if (missingEpicKeys.length > 0) throw new BoardRefusal({ reason: 'unknown-epic', missingEpicKeys });
  }

  epicRollupOf(epic: Readonly<Epic>): EpicRollup {
    const { key, title, slot } = epic.frontmatter;
    const ticketIds            = this.ticketIdsNaming(key);
    const ticketCountByStatus  = Object.fromEntries(TICKET_STATUSES.map((status) => [status, 0])) as Record<TicketStatus, number>;
    const rows: Readonly<Task>[] = [];
    for (const ticketId of ticketIds) {
      const ticket = this.records.requireTicket(ticketId);
      ticketCountByStatus[ticket.frontmatter.status]++;
      const ownRow = this.displayQueries.ownRowOf(ticketId);
      rows.push(...(ownRow === null ? [] : [ownRow]), ...this.displayQueries.reviewRowsOf(ticketId).filter((row) => row !== ownRow));
    }
    return {
      key,
      title,
      slot,
      ticketIds,
      ticketCountByStatus,
      tokens: rows.reduce((total, row) => total + (row.tokens ?? 0), 0),
      span:   EpicUtil.spanOf(rows),
    };
  }

  private ticketIdsNaming(epicKey: string): string[] {
    return this.records.ticketRecords.filter((ticket) => (ticket.frontmatter.epics ?? []).includes(epicKey)).map((ticket) => ticket.frontmatter.id);
  }

  private requireEpic(epicKey: string): Epic {
    const epic = this.records.epicRecordByKey(epicKey);
    if (epic === undefined) throw new BoardRefusal({ reason: 'unknown-epic', missingEpicKeys: [epicKey] });
    return epic;
  }
}
