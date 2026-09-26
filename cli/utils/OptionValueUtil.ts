import { TimeUtil }            from '../../src/lib/utils/TimeUtil';
import { TokenCountUtil }      from '../../src/lib/utils/TokenCountUtil';
import { OperationRefusal }    from '../../src/shared/OperationRefusal';
import type { ArgumentParser } from '../arguments/ArgumentParser';

/** An unreadable `--at` is refused rather than defaulted to now, which would stamp a bar nobody can explain. */
function resolveAtOption(commandArguments: ArgumentParser, now: Date): string {
  const written = commandArguments.option('at');
  if (written === undefined) return TimeUtil.formatLocalIso(now);

  const resolved = TimeUtil.resolveWhen(written, now);
  if (resolved === null) {
    throw new OperationRefusal(
      'refused',
      `--at "${written}" is not a time. Write an ISO 8601 timestamp, \`now\`, or a signed offset from now such as \`-5m\`, \`-2h\`, \`-1d\` or \`+30m\`.`,
    );
  }
  return TimeUtil.formatLocalIso(resolved);
}

function tokenCountFrom(commandArguments: ArgumentParser): number | undefined {
  const written = commandArguments.option('tokens');
  if (written === undefined) return undefined;

  const count = TokenCountUtil.parseTokenCount(written);
  if (count === null) {
    throw new OperationRefusal(
      'refused',
      `--tokens "${written}" is not a token count. Write a whole number, or a decimal with a \`k\` or \`m\` suffix: \`12000\`, \`12k\`, \`12.3k\`, \`1.2m\`.`,
    );
  }
  return count;
}

export const OptionValueUtil = { resolveAtOption, tokenCountFrom } as const;
