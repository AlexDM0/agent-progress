/** Turns whatever is on disk into `progress.html`; the only file write in `lib/render/`, and every mutating command ends here inside its lock. */

import { writeFileAtomically } from '../../src/lib/atomic-file/AtomicFile.ts';
import type { ProgressFile }   from '../../src/lib/tracker-model/@types/ProgressFile.ts';
import type { Ticket }         from '../../src/lib/tracker-model/@types/Ticket.ts';
import type { Workspace }      from '../platform/Workspace.ts';
import { bundlePageScript }    from './PageBundle.ts';
import { renderProgressHtml }  from './Template.ts';

export interface MalformedTicketFile {
  filePath: string;
  reason:   string;
  /** 1-based; `0` when the file could not be read at all. */
  line:     number;
}

/** Declared structurally rather than imported: `lib/progress/` and `lib/tickets/` are sibling features, which may not import each other. */
export interface TrackerReads {
  readProgressFile: (workspace: Workspace) => (
    | { verdict: 'readable'; progress: ProgressFile }
    | { verdict: 'absent' }
    | { verdict: 'unreadable'; reason: string }
  );
  listTickets:   (workspace: Workspace) => { verdict: 'listed'; tickets: Ticket[]; malformed: MalformedTicketFile[] };
  /** The function `status --json` builds its `concurrency` block with, so the page and the command cannot disagree on a count. */
  concurrencyOf: (progress: ProgressFile) => { limit: number; agentsInFlight: number };
}

export type RerenderOutcome =
  | { verdict: 'rendered'; malformedTickets: MalformedTicketFile[] }
  | { verdict: 'rendered-without-page-script'; reason: string; malformedTickets: MalformedTicketFile[] }
  | { verdict: 'unreadable'; reason: string };

interface RerenderInput {
  workspace:   Workspace;
  /** The caller's clock, never one read here. */
  generatedAt: Date;
  reads:       TrackerReads;
}

export async function rerenderDashboard(input: RerenderInput): Promise<RerenderOutcome> {
  const {
    workspace,
    generatedAt,
    reads,
  } = input;

  const progressRead = reads.readProgressFile(workspace);
  if (progressRead.verdict === 'absent') {
    return { verdict: 'unreadable', reason: `there is no progress file at ${workspace.progressFilePath}` };
  }
  if (progressRead.verdict === 'unreadable') {
    return { verdict: 'unreadable', reason: `${workspace.progressFilePath} could not be read: ${progressRead.reason}` };
  }

  const listing       = reads.listTickets(workspace);
  const pageBundle    = await bundlePageScript();
  const failureReason = pageBundle.verdict === 'failed' ? pageBundle.reason : null;

  const document = renderProgressHtml({
    progress:          progressRead.progress,
    tickets:           listing.tickets,
    pageScript:        pageBundle.verdict === 'built' ? pageBundle.script : null,
    pageScriptFailure: failureReason,
    generatedAt,
    concurrency:       reads.concurrencyOf(progressRead.progress),
  });
  writeFileAtomically(workspace.htmlFilePath, document);

  if (failureReason !== null) {
    return { verdict: 'rendered-without-page-script', reason: failureReason, malformedTickets: listing.malformed };
  }
  return { verdict: 'rendered', malformedTickets: listing.malformed };
}
