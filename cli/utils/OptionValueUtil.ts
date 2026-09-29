import { LocalTimeUtil }       from '../../src/lib/local-time/LocalTimeUtil.ts';
import { TokenCountUtil }      from '../../src/lib/token-count/TokenCountUtil.ts';
import { FIRST_TASK_ID }       from '../../src/lib/tracker-model/constants/TaskIds.ts';
import { OperationRefusal }    from '../../src/shared/OperationRefusal.ts';
import type { ArgumentParser } from '../arguments/ArgumentParser.ts';

/** An unreadable `--at` is refused rather than defaulted to now, which would stamp a bar nobody can explain. */
function atStampFrom(commandArguments: ArgumentParser, now: Date): string {
  const written = commandArguments.option('at');
  if (written === undefined) return LocalTimeUtil.formatLocalIso(now);

  const resolved = LocalTimeUtil.resolveWhen(written, now);
  if (resolved === null) {
    throw new OperationRefusal(
      'refused',
      `--at "${written}" is not a time. Write an ISO 8601 timestamp, \`now\`, or a signed offset from now such as \`-5m\`, \`-2h\`, \`-1d\` or \`+30m\`.`,
    );
  }
  return LocalTimeUtil.formatLocalIso(resolved);
}

function tokenCountFrom(commandArguments: ArgumentParser): number | undefined {
  const written = commandArguments.option('tokens');
  if (written === undefined) return undefined;

  const count = TokenCountUtil.parseTokenCount(written);
  if (count === null) {
    throw new OperationRefusal(
      'refused',
      `--tokens "${written}" is not a token count. Write a whole number, or a decimal with a \`k\`, \`m\` or \`b\` suffix: \`12000\`, \`12k\`, \`12.3k\`, \`1.2m\`, \`1.20b\`.`,
    );
  }
  return count;
}

/** A task id as written, or null when it is not a whole number of at least the first task id; the caller words the refusal. */
function taskIdOf(written: string): number | null {
  const identifier = Number(written);
  return Number.isSafeInteger(identifier) && identifier >= FIRST_TASK_ID ? identifier : null;
}

export const OptionValueUtil = { atStampFrom, tokenCountFrom, taskIdOf } as const;
