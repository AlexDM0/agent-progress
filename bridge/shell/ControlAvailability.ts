/**
 * Whether the Bridge's controls may act. While the event stream is down every control is disabled, since what it shows may be stale; while
 * launches are held for an install change every control is disabled but the ones the Overseer still answers, Restart and Stop.
 */
import { createContext } from 'react';

import type { CommandClient } from '../api/CommandClient.ts';

export type ControlAvailability = 'enabled' | 'stream-down' | 'install-held';

export interface ControlSurroundings {
  readonly availability:  ControlAvailability;
  readonly commandClient: CommandClient;
  /** A command was answered 423: launches are held for an install change. */
  readonly onInstallHeld: (refusal: string) => void;
}

function availabilityOf(streamIsDown: boolean, installIsHeld: boolean): ControlAvailability {
  if (streamIsDown) return 'stream-down';
  return installIsHeld ? 'install-held' : 'enabled';
}

function controlIsEnabled(availability: ControlAvailability, answeredWhileInstallHeld: boolean): boolean {
  return availability === 'enabled' || (availability === 'install-held' && answeredWhileInstallHeld);
}

const UNAVAILABLE_COMMAND_CLIENT: CommandClient = { send: () => Promise.resolve({ verdict: 'unreachable' }) };

export const ControlSurroundingsContext = createContext<ControlSurroundings>({
  availability:  'stream-down',
  commandClient: UNAVAILABLE_COMMAND_CLIENT,
  onInstallHeld: () => undefined,
});

export const ControlAvailabilityUtil = Object.freeze({ availabilityOf, controlIsEnabled });
