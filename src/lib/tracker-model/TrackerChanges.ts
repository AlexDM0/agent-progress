/** The Board's changes to the tracker as a whole rather than to one row or ticket: its settings, a note in its log, and its clearing. */
import type {
  ConcurrencyLimitSet,
  DispatcherStateSet,
  Logged,
  PipelineChanged,
  TrackerCleared
} from './@types/BoardChanges.ts';
import type { LogRecordFieldsOf }                    from './@types/LogRecord.ts';
import type { Pipeline, PipelineGate, PipelineStep } from './@types/Pipeline.ts';
import type { DispatcherState, ViewRange }           from './@types/TrackerProgress.ts';
import type { BoardRecords }                         from './BoardRecords.ts';
import { BoardRefusal }                              from './BoardRefusal.ts';
import type { DispatchQueries }                      from './DispatchQueries.ts';
import { PipelineUtil }                              from './utils/PipelineUtil.ts';
import { TicketChartUtil }                           from './utils/TicketChartUtil.ts';

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

  /** The record keeps its `runId` field, null, so a log holding a run id from a retired Workflow dispatcher still reads. */
  setDispatcherState(state: DispatcherState, at: string): DispatcherStateSet {
    const { progress }       = this.records;
    const previousState      = this.dispatchQueries.dispatcherState();
    progress.dispatcherState = state;
    return { logged: [this.records.logger.log({ kind: 'dispatcher-set', fields: { state, runId: null } }, at)], previousState };
  }

  /**
   * Every pipeline change is accepted with tickets in flight: no row is stamped here, and each row records the hash of the pipeline it is
   * judged by at its next gate run.
   */
  private changedPipelineOf(change: (pipeline: Pipeline) => void, logged: Logged['logged']): PipelineChanged {
    const pipeline = this.records.pipeline ?? { prepare: [], gates: [] };
    change(pipeline);
    this.records.pipeline        = pipeline;
    this.records.pipelineChanged = true;
    return { logged, pipeline };
  }

  /** A step of the same name is replaced where it stands, so a prepare step is set rather than added twice. */
  setPrepareStep(step: PipelineStep, at: string): PipelineChanged {
    const logged = [this.records.logger.log({ kind: 'pipeline-prepare-step-set', fields: { name: step.name, run: step.run } }, at)];
    return this.changedPipelineOf((pipeline) => {
      const index = pipeline.prepare.findIndex((candidate) => candidate.name === step.name);
      if (index === -1) pipeline.prepare.push({ ...step });
      else pipeline.prepare[index] = { ...step };
    }, logged);
  }

  /** A gate of the same name is replaced where it stands, keeping its place in the run order; a new one runs last. */
  addGate(gate: PipelineGate, at: string): PipelineChanged {
    const logged = [this.records.logger.log({ kind: 'pipeline-gate-added', fields: { name: gate.name, run: gate.run } }, at)];
    return this.changedPipelineOf((pipeline) => {
      const index = pipeline.gates.findIndex((candidate) => candidate.name === gate.name);
      if (index === -1) pipeline.gates.push({ ...gate });
      else pipeline.gates[index] = { ...gate };
    }, logged);
  }

  /** No gates on purpose: an empty list stored, which counts as set, unlike no pipeline at all. */
  setNoGates(at: string): PipelineChanged {
    const logged = [this.records.logger.log({ kind: 'pipeline-gates-none', fields: {} }, at)];
    return this.changedPipelineOf((pipeline) => {
      pipeline.gates.length = 0;
    }, logged);
  }

  removeGate(name: string, at: string): PipelineChanged {
    const gateNames = this.records.pipeline?.gates.map((gate) => gate.name) ?? [];
    if (!gateNames.includes(name)) throw new BoardRefusal({ reason: 'unknown-gate', gateName: name, gateNames });
    const logged = [this.records.logger.log({ kind: 'pipeline-gate-removed', fields: { name } }, at)];
    return this.changedPipelineOf((pipeline) => {
      pipeline.gates.splice(pipeline.gates.findIndex((gate) => gate.name === name), 1);
    }, logged);
  }

  /** At a gate run: the ticket's row records the hash of the pipeline it is judged by, or loses it when none is stored. */
  recordPipelineJudgedBy(ticketId: string): void {
    const row = this.records.linkedTaskRecordOf(this.records.requireTicket(ticketId));
    if (row === undefined) return;
    if (this.records.pipeline === null) delete row.pipelineHash;
    else row.pipelineHash = PipelineUtil.pipelineHashOf(this.records.pipeline);
  }

  recordWorktreeRepaired(ticketId: string, fields: LogRecordFieldsOf<'worktree-repaired'>, at: string): Logged {
    this.records.requireTicket(ticketId);
    return { logged: [this.records.logger.log({ kind: 'worktree-repaired', ticketId, fields: { step: fields.step, patchPath: fields.patchPath } }, at)] };
  }

  /** The gate ran outside the hold, so only its outcome is recorded here. */
  recordGateRan(fields: LogRecordFieldsOf<'gate-ran'>, at: string): Logged {
    return { logged: [this.records.logger.log({ kind: 'gate-ran', fields: { tree: fields.tree, outcome: fields.outcome, cached: fields.cached } }, at)] };
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
