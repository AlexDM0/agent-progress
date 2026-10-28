/**
 * Blocks until the log holds a `decision-opened` or `incident-escalated` record past position `--after` (the log's length when absent),
 * then prints them with their positions and the position to wait after next. A stop signal ends the wait with nothing printed.
 */
import { watch } from 'node:fs';

import type { LogRecord }      from '../../../src/lib/tracker-model/@types/LogRecord.ts';
import { requireTracker }      from '../../../src/services/tracker/TrackerReader.ts';
import { requireWorkspace }    from '../../../src/services/tracker/Workspace.ts';
import { OperationRefusal }    from '../../../src/shared/OperationRefusal.ts';
import { PRODUCT_NAMES }       from '../../../src/shared/constants/ProductNames.ts';
import type { CommandHandler } from '../../CommandHandler.ts';
import { OutputUtil }          from '../../utils/OutputUtil.ts';

const USAGE = `${PRODUCT_NAMES.PROGRAM} await [--json] [--after <n>]`;

const WAKING_RECORD_KINDS: readonly LogRecord['kind'][] = ['decision-opened', 'incident-escalated'];

/** A change the folder watch misses, on a platform that cannot watch it, is still seen within this. */
const AWAIT_SWEEP_MILLISECONDS = 1000;

const WHOLE_NUMBER_PATTERN = /^\d+$/;

type PositionedRecord = LogRecord & { position: number };

function afterPositionOf(written: string | undefined, logLength: number): number {
  if (written === undefined) return logLength;
  if (!WHOLE_NUMBER_PATTERN.test(written)) throw new OperationRefusal('refused', `"${written}" is not a log position.\n  Usage: ${USAGE}`);
  return Number(written);
}

/** Positions count from 1, so `--after` the printed position never wakes on the same record twice. */
function wakingRecordsAfter(records: readonly LogRecord[], after: number): PositionedRecord[] {
  return records.slice(after)
    .map((record, i) => ({ ...record, position: after + i + 1 }))
    .filter((record) => WAKING_RECORD_KINDS.includes(record.kind));
}

function changeOrSweep(folderPath: string): Promise<void> {
  return new Promise((resolve) => {
    const watcher = watch(folderPath, () => finish());
    const sweep   = setTimeout(() => finish(), AWAIT_SWEEP_MILLISECONDS);

    function finish(): void {
      watcher.close();
      clearTimeout(sweep);
      resolve();
    }
  });
}

export const awaitCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(['json', 'after'], USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);
  const workspace = requireWorkspace(context.currentDirectory);
  const after     = afterPositionOf(commandArguments.option('after'), requireTracker(workspace).storedLog.records.length);
  let stopped     = false;
  const forget    = context.onStopSignal(() => { stopped = true; });
  try {
    while (!stopped) {
      const { records } = requireTracker(workspace).storedLog;
      const woken   = wakingRecordsAfter(records, after);
      if (woken.length > 0) {
        const report = { after, position: records.length, records: woken };
        const nextLine = `Next: ${PRODUCT_NAMES.PROGRAM} await --after ${records.length}`;
        OutputUtil.printEntityThenNextLine(commandArguments, context, report, OutputUtil.loggedSentencesOf(woken), nextLine);
        return;
      }
      await changeOrSweep(workspace.trackerDirectory);
    }
  } finally {
    forget();
  }
};
