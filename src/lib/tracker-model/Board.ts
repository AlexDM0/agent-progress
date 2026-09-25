/**
 * The tracker's aggregate for one invocation: the compound changes to rows and tickets, the queries over them, and which tickets it
 * changed. It does no I/O, logs through the `Logger` and refuses with a `BoardRefusal`; it changes the records it was handed in place.
 */
import type { ConcurrencyLimitSet, DispatcherStateSet, Logged } from './@types/BoardChanges.ts';
import type { Concurrency }                                     from './@types/Concurrency.ts';
import type { DispatcherState, ProgressFile, ViewRange }        from './@types/ProgressFile.ts';
import type { Task }                                            from './@types/Task.ts';
import type { Ticket }                                          from './@types/Ticket.ts';
import type { Logger }                                          from './Logger.ts';
import { DEFAULT_DISPATCHER_STATE }                             from './constants/DispatcherStates.ts';
import { ConcurrencyUtil }                                      from './utils/ConcurrencyUtil.ts';
import { TicketIdUtil }                                         from './utils/TicketIdUtil.ts';

export interface BoardInput {
  progress: ProgressFile;
  tickets:  Ticket[];
  logger:   Logger;
}

export class Board {
  private readonly progress: ProgressFile;

  private readonly ticketRecords: Ticket[];

  private readonly logger: Logger;

  /** In the order each ticket was first changed, once each: the order the writer writes them in. */
  private readonly changedTicketRecords: Ticket[] = [];

  constructor(input: BoardInput) {
    this.progress      = input.progress;
    this.ticketRecords = input.tickets;
    this.logger        = input.logger;
  }

  setChartRange(view: ViewRange, at: string): Logged {
    this.progress.view = view;
    return { logged: [this.logger.chartRangeSet(view, at)] };
  }

  setConcurrencyLimit(limit: number, at: string): ConcurrencyLimitSet {
    const previousLimit           = this.concurrency().limit;
    this.progress.concurrencyLimit = limit;
    const logged                  = [this.logger.concurrencyLimitSet(limit, at)];
    return { logged, previousLimit, concurrency: this.concurrency() };
  }

  /** A `null` run id deletes the stored one, since an older id would be resumed wrongly. */
  setDispatcherState(state: DispatcherState, runId: string | null, at: string): DispatcherStateSet {
    const previousState           = this.dispatcherState();
    this.progress.dispatcherState = state;
    if (runId === null) delete this.progress.dispatcherRunId;
    else this.progress.dispatcherRunId = runId;
    return { logged: [this.logger.dispatcherSet(state, runId, at)], previousState };
  }

  recordNote(text: string, at: string): Logged {
    return { logged: [this.logger.note(text, at)] };
  }

  tasks(): readonly Readonly<Task>[] {
    return this.progress.tasks;
  }

  tickets(): readonly Readonly<Ticket>[] {
    return this.ticketRecords;
  }

  taskById(taskId: number): Readonly<Task> | undefined {
    return this.progress.tasks.find((task) => task.id === taskId);
  }

  /** Reads `3`, `#3` and `003` alike, as a reference typed on the command line may be any of them. */
  ticketByReference(reference: string): Readonly<Ticket> | undefined {
    const ticketId = TicketIdUtil.parseTicketReference(reference);
    if (ticketId === null) return undefined;
    return this.ticketRecords.find((ticket) => ticket.frontmatter.id === ticketId);
  }

  concurrency(): Concurrency {
    return ConcurrencyUtil.concurrencyOf(this.progress.tasks, this.progress.concurrencyLimit);
  }

  dispatcherState(): DispatcherState {
    return this.progress.dispatcherState ?? DEFAULT_DISPATCHER_STATE;
  }

  dispatcherRunId(): string | undefined {
    return this.progress.dispatcherRunId;
  }

  changedTickets(): readonly Ticket[] {
    return this.changedTicketRecords;
  }
}
