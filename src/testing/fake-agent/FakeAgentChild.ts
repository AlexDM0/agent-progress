/**
 * The fake agent session `src/testing/FakeAgentAdapter.ts` launches: plays the scenario file its one argument names, step by step. An
 * entry point, so it runs on load.
 */
import { readFileSync } from 'node:fs';

import type { FakeAgentStep } from '../FakeAgentAdapter.ts';

async function playScenario(scenarioPath: string): Promise<void> {
  const steps = JSON.parse(readFileSync(scenarioPath, 'utf8')) as FakeAgentStep[];
  const stdinLines = console[Symbol.asyncIterator]();
  for (const step of steps) {
    if (step.kind === 'print') {
      process.stdout.write(`${step.line}\n`);
    } else if (step.kind === 'await-line') {
      if ((await stdinLines.next()).done === true) return;
    } else if (step.kind === 'exit') {
      process.exitCode = step.code;
      return;
    } else {
      process.kill(process.pid, 'SIGKILL');
    }
  }
}

await playScenario(process.argv[2] ?? '');
