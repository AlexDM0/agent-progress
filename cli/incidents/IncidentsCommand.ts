/** The open incidents for the runner's orchestrator, in opening order, each with the moves its kind allows. Read-only, no lock. */
import type { Incident }                  from '../../src/lib/tracker-model/@types/Incident.ts';
import { ALLOWED_MOVES_BY_INCIDENT_KIND } from '../../src/services/control/constants/AllowedMovesByIncidentKind.ts';
import { requireProgressFile }            from '../../src/services/tracker/TrackerReader.ts';
import { requireWorkspace }               from '../../src/services/tracker/Workspace.ts';
import { PRODUCT_NAMES }                  from '../../src/shared/constants/ProductNames.ts';
import type { CommandHandler }            from '../CommandHandler.ts';
import { OutputUtil }                     from '../utils/OutputUtil.ts';

const USAGE = `${PRODUCT_NAMES.PROGRAM} incidents [--json]`;

function incidentTextOf(incident: Readonly<Incident>): string {
  const tickets   = incident.ticketIds.length === 0 ? '' : ` on #${incident.ticketIds.join(', #')}`;
  const job       = incident.jobId === null ? '' : `, job ${incident.jobId}`;
  const delivered = incident.deliveredInTurn === null ? 'undelivered' : `delivered to ${incident.deliveredInTurn.jobId}`;
  const facts     = Object.entries(incident.facts).map(([fact, value]) => `  ${fact}: ${value}`);
  return [
    `${incident.id} ${incident.kind}${tickets} (${delivered}${job}, ${incident.openedAt})`,
    ...facts,
    `  moves: ${ALLOWED_MOVES_BY_INCIDENT_KIND[incident.kind].join(', ')}; default ${incident.defaultMove}`,
  ].join('\n');
}

export const incidentsCommand: CommandHandler = (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(['json'], USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);
  const incidents = requireProgressFile(requireWorkspace(context.currentDirectory)).incidents ?? [];
  const text = incidents.length === 0 ? 'No incident is open.' : incidents.map(incidentTextOf).join('\n\n');
  OutputUtil.printEntity(commandArguments, context, { incidents }, text);
  return Promise.resolve();
};
