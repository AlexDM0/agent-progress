/**
 * Where a board's Overseer listens: a port derived from its tracker id, so a bookmarked URL survives a restart, moved upward past a port
 * another process holds. An explicit `--port` is bound as given, `0` letting the system choose.
 */
import { createHash } from 'node:crypto';

import { OperationRefusal }    from '../../shared/OperationRefusal.ts';
import { OVERSEER_PORT_COUNT } from '../../shared/constants/OverseerLimits.ts';
import { PRODUCT_NAMES }       from '../../shared/constants/ProductNames.ts';

export type OverseerPortChoice = { kind: 'preferred'; trackerId: string } | { kind: 'given'; port: number };

const ADDRESS_IN_USE_CODE = 'EADDRINUSE';

function preferredPortOf(trackerId: string): number {
  const digest = createHash('sha256').update(trackerId).digest();
  return PRODUCT_NAMES.OVERSEER_PORT_FIRST + (digest.readUInt32BE(0) % OVERSEER_PORT_COUNT);
}

function addressIsInUse(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === ADDRESS_IN_USE_CODE;
}

/** Tries each candidate port in turn, moving on only past a port in use; any other failure is the caller's. */
function bindFirstFree<Bound>(choice: OverseerPortChoice, bind: (port: number) => Bound): Bound {
  const firstPort = choice.kind === 'given' ? choice.port : preferredPortOf(choice.trackerId);
  const lastPort  = choice.kind === 'given' ? firstPort : firstPort + OVERSEER_PORT_COUNT - 1;
  for (let port = firstPort; port <= lastPort; port++) {
    try {
      return bind(port);
    } catch (error) {
      if (!addressIsInUse(error)) throw error;
    }
  }
  throw new OperationRefusal('refused', { kind: 'overseer-port-in-use', firstPort, lastPort });
}

export const OverseerPort = Object.freeze({ preferredPortOf, bindFirstFree });
