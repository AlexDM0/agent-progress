/** Control surroundings over a fake command client that records every `ControlCommand` and answers with the outcome a spec sets. Test-only. */
import type { CommandOutcome, ControlCommandBody }       from '../api/CommandClient.ts';
import type { ControlAvailability, ControlSurroundings } from '../shell/ControlAvailability.ts';

export interface FakeControlSurroundings {
  readonly surroundings: ControlSurroundings;
  readonly sent:         ControlCommandBody[];
  readonly answerWith:   (outcome: CommandOutcome) => void;
}

export function fakeControlSurroundingsOf(availability: ControlAvailability = 'enabled'): FakeControlSurroundings {
  const sent: ControlCommandBody[] = [];
  let nextOutcome: CommandOutcome = { verdict: 'applied', outcome: 'done', result: null };
  return {
    surroundings: {
      availability,
      commandClient: {
        send: (command) => {
          sent.push(command);
          return Promise.resolve(nextOutcome);
        },
      },
      onInstallHeld: () => undefined,
    },
    sent,
    answerWith: (outcome) => {
      nextOutcome = outcome;
    },
  };
}
