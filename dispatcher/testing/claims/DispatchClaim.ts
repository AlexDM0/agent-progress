import type { SourceMutant }        from '../../../src/testing/SourceMutant.ts';
import type { DispatchScenario }    from '../@types/DispatchScenario.ts';
import type { RecordedDispatchRun } from '../@types/RecordedDispatchRun.ts';

export interface DispatchClaim {
  name:        string;
  scenarioFor: () => DispatchScenario;
  holds:       (run: RecordedDispatchRun) => boolean;
  mutant:      SourceMutant;
}
