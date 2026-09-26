/** The whole `progress.html` document for one tracker state: the page script bundled, then the template filled; it writes no file. */
import type { LogRecord }     from '../../lib/tracker-model/@types/LogRecord.ts';
import type { ProgressFile }  from '../../lib/tracker-model/@types/ProgressFile.ts';
import type { Ticket }        from '../../lib/tracker-model/@types/Ticket.ts';
import { ConcurrencyUtil }    from '../../lib/tracker-model/utils/ConcurrencyUtil.ts';
import { bundlePageScript }   from './PageBundle.ts';
import { renderProgressHtml } from './Template.ts';

export interface ProgressPageInput {
  progress:    ProgressFile;
  tickets:     Ticket[];
  logRecords:  readonly LogRecord[];
  /** The caller's clock, never one read here. */
  generatedAt: Date;
}

export interface ProgressPageRendering {
  document:          string;
  /** Non-null when the page was written with the banner-only script. */
  pageScriptFailure: string | null;
}

/** The concurrency figures come from the function `status --json` builds its block with, so the page and the command cannot disagree on a count. */
export async function renderProgressPage(input: ProgressPageInput): Promise<ProgressPageRendering> {
  const {
    progress,
    tickets,
    logRecords,
    generatedAt,
  } = input;

  const pageBundle        = await bundlePageScript();
  const pageScriptFailure = pageBundle.verdict === 'failed' ? pageBundle.reason : null;

  const document = renderProgressHtml({
    progress,
    logRecords,
    tickets,
    pageScript:  pageBundle.verdict === 'built' ? pageBundle.script : null,
    pageScriptFailure,
    generatedAt,
    concurrency: ConcurrencyUtil.concurrencyOf(progress.tasks, progress.concurrencyLimit),
  });
  return { document, pageScriptFailure };
}
