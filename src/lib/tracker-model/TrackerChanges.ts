/** The Board's changes to the tracker as a whole rather than to one row or ticket: its settings, a note in its log, and its clearing. */
import type {
  CheckCommandSet,
  ConcurrencyLimitSet,
  DispatcherStateSet,
  InstallCommandSet,
  ChecksDefinitionFilesSet,
  Logged,
  TrackerCleared
} from './@types/BoardChanges.ts';
import type { LogRecordFieldsOf }          from './@types/LogRecord.ts';
import type { Task }                       from './@types/Task.ts';
import type { Ticket }                     from './@types/Ticket.ts';
import type { DispatcherState, ViewRange } from './@types/TrackerProgress.ts';
import type { BoardRecords }               from './BoardRecords.ts';
import { BoardRefusal }                    from './BoardRefusal.ts';
import type { DispatchQueries }            from './DispatchQueries.ts';
import { TicketChartUtil }                 from './utils/TicketChartUtil.ts';

export class TrackerChanges {
  constructor(
    private readonly records: BoardRecords,
    private readonly dispatchQueries: DispatchQueries,
  ) {}

  setChartRange(view: ViewRange, at: string): Logged {
    this.records.progress.view = view;
    return { logged: [this.records.logger.log({ kind: 'chart-range-set', fields: { view } }, at)] };
  }

  setConcurrencyLimit(limit: number, at: string): ConcurrencyLimitSet {
    const previousLimit                    = this.dispatchQueries.concurrency().limit;
    this.records.progress.concurrencyLimit = limit;
    const logged                           = [this.records.logger.log({ kind: 'concurrency-limit-set', fields: { limit } }, at)];
    return { logged, previousLimit, concurrency: this.dispatchQueries.concurrency() };
  }

  /** A `null` run id deletes the stored one, since an older id would be resumed wrongly. */
  setDispatcherState(state: DispatcherState, runId: string | null, at: string): DispatcherStateSet {
    const { progress }       = this.records;
    const previousState      = this.dispatchQueries.dispatcherState();
    progress.dispatcherState = state;
    if (runId === null) delete progress.dispatcherRunId;
    else progress.dispatcherRunId = runId;
    return { logged: [this.records.logger.log({ kind: 'dispatcher-set', fields: { state, runId } }, at)], previousState };
  }

  /**
   * A `null` command deletes the stored one, so a release runs no check again. A ticket in flight was stamped with the command it started
   * under, so a change that would leave its stamp behind is refused unless `restamps` stamps every such row with the new command.
   */
  setCheckCommand(command: string | null, restamps: boolean, at: string): CheckCommandSet {
    const { progress, logger } = this.records;
    const ticketsInFlight      = this.ticketsInFlightWithTheirRows();
    if (!restamps) {
      const staleTicketIds = ticketsInFlight.filter(({ row }) => (row.checkCommand ?? null) !== command).map(({ ticket }) => ticket.frontmatter.id);
      if (staleTicketIds.length > 0) throw new BoardRefusal({ reason: 'check-command-change-with-tickets-in-flight', ticketIds: staleTicketIds });
    }

    const previousCheckCommand = progress.checkCommand ?? null;
    if (command === null) delete progress.checkCommand;
    else progress.checkCommand = command;
    const logged = [logger.log({ kind: 'check-command-set', fields: { command } }, at)];
    if (!restamps) return { logged, previousCheckCommand, restampedTicketIds: [] };

    for (const { ticket, row } of ticketsInFlight) {
      this.records.stampCheckCommand(row);
      logged.push(logger.log({ kind: 'ticket-check-command-restamped', ticketId: ticket.frontmatter.id, fields: { command } }, at));
    }
    return { logged, previousCheckCommand, restampedTicketIds: ticketsInFlight.map(({ ticket }) => ticket.frontmatter.id) };
  }

  /** No ticket is stamped with it: a changed line only changes the gate cache's key, so a gate runs again. */
  setInstallCommand(command: string, at: string): InstallCommandSet {
    const { progress, logger }   = this.records;
    const previousInstallCommand = progress.installCommand ?? null;
    progress.installCommand      = command;
    return { logged: [logger.log({ kind: 'install-command-set', fields: { command } }, at)], previousInstallCommand };
  }

  /** `null` removes the key, so the board holds no definition files again. */
  setChecksDefinitionFiles(patterns: readonly string[] | null, at: string): ChecksDefinitionFilesSet {
    const { progress, logger }          = this.records;
    const previousChecksDefinitionFiles = progress.checksDefinitionFiles ?? null;
    if (patterns === null) delete progress.checksDefinitionFiles;
    else progress.checksDefinitionFiles = [...patterns];
    return {
      logged: [logger.log({ kind: 'checks-definition-files-set', fields: { patterns: patterns ?? [] } }, at)],
      previousChecksDefinitionFiles,
    };
  }

  /** The gate ran outside the hold, so only its outcome is recorded here. */
  recordGateRan(fields: LogRecordFieldsOf<'gate-ran'>, at: string): Logged {
    return { logged: [this.records.logger.log({ kind: 'gate-ran', fields: { tree: fields.tree, outcome: fields.outcome, cached: fields.cached } }, at)] };
  }

  private ticketsInFlightWithTheirRows(): { ticket: Readonly<Ticket>; row: Task }[] {
    return this.records.ticketRecords.flatMap((ticket) => {
      if (ticket.frontmatter.status !== 'in-progress' && ticket.frontmatter.status !== 'in-review') return [];
      const row = this.records.linkedTaskRecordOf(ticket);
      return row === undefined ? [] : [{ ticket, row }];
    });
  }

  recordNote(text: string, at: string): Logged {
    return { logged: [this.records.logger.log({ kind: 'note', fields: { text } }, at)] };
  }

  /**
   * Empties the rows in place rather than replacing the progress, so the tracker id readers key their choices by and the id counter survive.
   * A surviving ticket is re-seeded from its own stamps, except a low ticket with no row; the epics go only with the tickets.
   * What becomes of the log is the sink's to decide.
   */
  clearTracker(request: { ticketsSurvive: boolean }, at: string): TrackerCleared {
    const { progress, ticketRecords } = this.records;
    const removedTaskCount            = progress.tasks.length;
    progress.startedAt                = at;
    progress.view                     = { kind: 'auto' };
    progress.tasks.length             = 0;
    const logged                      = [this.records.logger.log({ kind: 'tracker-cleared', fields: {} }, at)];

    if (!request.ticketsSurvive) {
      ticketRecords.length = 0;
      return {
        logged, removedTaskCount, survivingTicketCount: 0, removedEpicCount: this.removeEveryEpic()
      };
    }
    for (const ticket of ticketRecords) {
      // A reopen clears `started`, so the row the ticket held before the clear is what says it was worked.
      const ticketHadNoRowToLose = ticket.frontmatter.task === null && TicketChartUtil.ticketStaysOffTheChart(ticket.frontmatter);
      if (!ticketHadNoRowToLose) this.records.seedTaskFromTicket(ticket);
      this.records.markChanged(ticket);
    }
    return {
      logged, removedTaskCount, survivingTicketCount: ticketRecords.length, removedEpicCount: 0
    };
  }

  private removeEveryEpic(): number {
    const { epicRecords, changedEpicRecords, removedEpicRecords } = this.records;
    const removedEpicCount = epicRecords.length;
    removedEpicRecords.push(...epicRecords);
    epicRecords.length        = 0;
    changedEpicRecords.length = 0;
    return removedEpicCount;
  }
}
