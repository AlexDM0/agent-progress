/**
 * A relative bound is stored as written and resolved at layout time, so `--from -2h` keeps meaning "the
 * last two hours"; `lib/render/page/GanttGeometry.ts` resolves each end, which is what makes a mixed pair legal.
 */
import type { ViewRange }                     from '../../lib/constants/Types';
import { OperationRefusal }                   from '../../lib/platform/OperationRefusal';
import { TimeUtil }                           from '../../lib/utils/TimeUtil';
import { openTrackerForWriting, printEntity } from '../CommandSupport';
import type { CommandHandler }                from '../CommandTable';

const USAGE = [
  'agent-progress range --from <iso|-2h|start> --to <iso|now|+30m> [--tick 15m|1h|1d]',
  'agent-progress range --auto',
].join('\n         ');

const KNOWN_OPTION_NAMES = ['from', 'to', 'tick', 'auto', 'json'];

const RELATIVE_BOUND_WORDS = ['start', 'now'];

const RELATIVE_OFFSET_PATTERN = /^[+-]\d+[mhd]$/i;

function boundIsRelative(text: string): boolean {
  return RELATIVE_BOUND_WORDS.includes(text.trim().toLowerCase()) || RELATIVE_OFFSET_PATTERN.test(text.trim());
}

function storedBound(text: string): string | null {
  if (boundIsRelative(text)) return text.trim();
  const parsed = TimeUtil.parseIso(text);
  return parsed === null ? null : TimeUtil.formatLocalIso(parsed);
}

/** Only a pair of timestamps can be judged, and a backwards axis draws nothing with no error anywhere. */
function refuseABackwardsRange(writtenFrom: string, writtenTo: string): void {
  if (boundIsRelative(writtenFrom) || boundIsRelative(writtenTo)) return;
  const from = TimeUtil.parseIso(writtenFrom);
  const to   = TimeUtil.parseIso(writtenTo);
  if (from === null || to === null || from.getTime() < to.getTime()) return;

  throw new OperationRefusal(
    'refused',
    `--from "${writtenFrom}" is not before --to "${writtenTo}", so the axis would have no width. Swap them, or widen the window.`,
  );
}

function viewRangeFrom(writtenFrom: string, writtenTo: string, writtenTick: string | undefined): ViewRange {
  const from = storedBound(writtenFrom);
  const to   = storedBound(writtenTo);
  for (const [optionName, written, stored] of [['from', writtenFrom, from], ['to', writtenTo, to]] as const) {
    if (stored === null) {
      throw new OperationRefusal(
        'refused',
        `--${optionName} "${written}" could not be read as a time, so it is not a range bound. `
        + 'Write an ISO 8601 timestamp, `start`, `now`, or a signed offset from now such as `-2h` or `+30m`.',
      );
    }
  }
  refuseABackwardsRange(writtenFrom, writtenTo);

  let tickMinutes: number | null = null;
  if (writtenTick !== undefined) {
    tickMinutes = TimeUtil.parseDurationMinutes(writtenTick);
    if (tickMinutes === null) {
      throw new OperationRefusal('refused', `--tick "${writtenTick}" is not a duration. Write it as \`15m\`, \`1h\`, \`1d\`, or a whole number of minutes.`);
    }
  }

  const bothAreTimestamps = !boundIsRelative(writtenFrom) && !boundIsRelative(writtenTo);
  return {
    kind: bothAreTimestamps ? 'absolute' : 'relative',
    from: from ?? writtenFrom,
    to:   to ?? writtenTo,
    tickMinutes,
  };
}


function describeRange(view: ViewRange): string {
  if (view.kind === 'auto') return 'Chart range: automatic';
  const tick = view.tickMinutes === null ? '' : ` (tick ${view.tickMinutes}m)`;
  return `Chart range: ${view.from} → ${view.to}${tick}`;
}

export const rangeCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);

  const resetsToAutomatic = commandArguments.flag('auto');
  const writtenFrom       = commandArguments.option('from');
  const writtenTo         = commandArguments.option('to');

  if (resetsToAutomatic && (writtenFrom !== undefined || writtenTo !== undefined)) {
    throw new OperationRefusal('refused', `--auto sets the axis on its own; drop --from and --to.\n  Usage: ${USAGE}`);
  }
  if (!resetsToAutomatic && (writtenFrom === undefined || writtenTo === undefined)) {
    throw new OperationRefusal('refused', `agent-progress range needs either --auto or both --from and --to.\n  Usage: ${USAGE}`);
  }

  const view: ViewRange = resetsToAutomatic || writtenFrom === undefined || writtenTo === undefined
    ? { kind: 'auto' }
    : viewRangeFrom(writtenFrom, writtenTo, commandArguments.option('tick'));

  const stored = await openTrackerForWriting(commandArguments, context, (change) => {
    change.progress.view = view;
    return view;
  });

  printEntity(commandArguments, context, stored, describeRange(stored));
};
