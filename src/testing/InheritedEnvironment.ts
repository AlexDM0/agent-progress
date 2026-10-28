/** The spec run's own environment, for a `src/lib/` spec that launches a real tool and may not reach `src/shared/` itself. */
import { environmentCopy } from '../shared/Environment.ts';

export function inheritedEnvironment(): Record<string, string> {
  return environmentCopy();
}
