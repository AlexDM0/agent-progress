import type { DispatchScenario }    from '../@types/DispatchScenario.ts';
import type { RecordedDispatchRun } from '../@types/RecordedDispatchRun.ts';
import type { SourceMutant }        from '../SourceMutant.ts';

export interface DispatchClaim {
  name:        string;
  scenarioFor: () => DispatchScenario;
  holds:       (run: RecordedDispatchRun) => boolean;
  mutant:      SourceMutant;
}
