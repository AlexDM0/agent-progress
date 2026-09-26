/** Reads the committed old dispatcher script, which `init` and `update` install until plan step 8 deletes it. */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

function oldDispatchScriptPath(): string {
  return join(import.meta.dir, '..', '..', 'templates', 'workflows', 'AgentProgressDispatch.js');
}

export function readOldDispatchScript(): string {
  return readFileSync(oldDispatchScriptPath(), 'utf8');
}
