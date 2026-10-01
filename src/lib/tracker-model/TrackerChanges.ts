/** The Board's changes to the tracker as a whole rather than to one row or ticket: its settings, a note in its log, and its clearing. */
import type {
  ConcurrencyLimitSet,
  DispatcherStateSet,
  Logged,
  TrackerCleared
} from './@types/BoardChanges.ts';
import type { DispatcherState, ViewRange } from './@types/TrackerProgress.ts';
import type { BoardRecords }               from './BoardRecords.ts';
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

  recordNote(text: string, at: string): Logged {
    return { logged: [this.records.logger.log({ kind: 'note', fields: { text } }, at)] };
  }

  /**
   * Empties the rows in place rather than replacing the progress, so the tracker id readers key their choices by and the id counter survive.
   * A surviving ticket is re-seeded from its own stamps, except a low ticket with no row, and the epics go only with the tickets; what becomes of the log is the sink's to decide.
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
      return { logged, removedTaskCount, survivingTicketCount: 0, removedEpicCount: this.removeEveryEpic() };
    }
    for (const ticket of ticketRecords) {
      // A reopen clears `started`, so the row the ticket held before the clear is what says it was worked.
      const ticketHadNoRowToLose = ticket.frontmatter.task === null && TicketChartUtil.ticketStaysOffTheChart(ticket.frontmatter);
      if (!ticketHadNoRowToLose) this.records.seedTaskFromTicket(ticket);
      this.records.markChanged(ticket);
    }
    return { logged, removedTaskCount, survivingTicketCount: ticketRecords.length, removedEpicCount: 0 };
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
