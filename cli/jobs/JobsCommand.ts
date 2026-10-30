/** One screen of the board's live jobs, one line each, then a footer of the runner and what is open for User. Read-only, no lock. */
import { readingBoardOf }                      from '../../src/lib/tracker-model/ReadingBoard.ts';
import { IncidentRouter }                      from '../../src/services/runner/IncidentRouter.ts';
import { runnerFilesIn }                       from '../../src/services/runner/RunnerFiles.ts';
import { RunnerLease }                         from '../../src/services/runner/RunnerLease.ts';
import { requireProgressFile, requireTracker } from '../../src/services/tracker/TrackerReader.ts';
import { requireWorkspace }                    from '../../src/services/tracker/Workspace.ts';
import { PRODUCT_NAMES }                       from '../../src/shared/constants/ProductNames.ts';
import type { CommandHandler }                 from '../CommandHandler.ts';
import { OutputUtil }                          from '../utils/OutputUtil.ts';

const USAGE = `${PRODUCT_NAMES.PROGRAM} jobs [--json]`;

const JOB_ID_COLUMN_WIDTH = 6;
const ROLE_COLUMN_WIDTH   = 18;
const STATE_COLUMN_WIDTH  = 19;

export const jobsCommand: CommandHandler = (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(['json'], USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);
  const workspace = requireWorkspace(context.currentDirectory);
  const progress  = requireProgressFile(workspace);
  const board     = readingBoardOf(progress, [], []);
  const jobs      = progress.jobs ?? [];
  const lease     = RunnerLease.newestLeaseOf(runnerFilesIn(workspace.trackerDirectory).runnerDirectory);
  const concurrency = board.concurrency();
  const footer = {
    runner:             lease.verdict === 'live' ? { state: 'live', url: lease.record.url } : { state: 'down' },
    paused:             board.runnerState() === 'paused',
    agentsInFlight:     concurrency.agentsInFlight,
    limit:              concurrency.limit,
    openDecisions:      (progress.decisions ?? []).length,
    openIncidents:      (progress.incidents ?? []).length,
    defaultedIncidents: IncidentRouter.defaultedIncidentsOf(requireTracker(workspace).storedLog.records),
  };
  const warningLines = footer.defaultedIncidents.map(({
    incidentId, move, cause, at
  }) => `warning: incident ${incidentId} took its default, ${move} (${cause}), ${at}`);
  const jobLines = jobs.map((job) => [
    OutputUtil.padColumn(job.id, JOB_ID_COLUMN_WIDTH),
    OutputUtil.padColumn(`${job.kind}/${job.role ?? '-'}`, ROLE_COLUMN_WIDTH),
    OutputUtil.padColumn(job.state, STATE_COLUMN_WIDTH),
    job.ticketIds.length === 0 ? '-' : job.ticketIds.map((ticketId) => `#${ticketId}`).join(','),
    `attempt ${job.attempt}`,
    `host ${job.hostInstance}`,
    ...(job.stopRequest === undefined ? [] : [`(${job.stopRequest} asked)`]),
  ].join('  '));
  const runnerText = footer.runner.state === 'live' ? `runner: live at ${lease.verdict === 'live' ? lease.record.url : ''}` : 'runner: down';
  const footerText = `${runnerText}; ${footer.paused ? 'paused' : 'not paused'}; agents ${footer.agentsInFlight}/${footer.limit}; `
    + `open decisions ${footer.openDecisions}; open incidents ${footer.openIncidents}`;
  const text = [...(jobLines.length === 0 ? ['No job is live.'] : jobLines), footerText, ...warningLines].join('\n');
  OutputUtil.printEntity(commandArguments, context, { jobs, ...footer }, text);
  return Promise.resolve();
};
