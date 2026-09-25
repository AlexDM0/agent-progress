import type { DispatchRun, DispatchScenario } from '../DispatchScriptHarness';

export interface TextMutant {
  find:    string;
  replace: string;
}

export interface DispatchClaim {
  name:        string;
  scenarioFor: () => DispatchScenario;
  holds:       (run: DispatchRun) => boolean;
  mutant:      TextMutant;
}
