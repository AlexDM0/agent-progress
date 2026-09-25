/** Reads the committed old dispatcher script, which `init` and `update` install until plan step 8 deletes it. */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

export function dispatchScriptPath(): string {
  return join(import.meta.dir, '..', '..', 'templates', 'workflows', 'AgentProgressDispatch.js');
}

export function readDispatchScript(): string {
  return readFileSync(dispatchScriptPath(), 'utf8');
}
