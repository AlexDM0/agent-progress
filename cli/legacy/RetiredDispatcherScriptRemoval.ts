/**
 * agent-progress before the generated dispatcher installed its copy at `.claude/workflows/agent-progress-dispatch.js`; `init` and `update`
 * delete it so only one dispatcher is left to launch. It can be deleted once every tracked repository has run `agent-progress update`, with
 * the sentences on it in `cli/HelpText.ts` and `docs/cli.md`.
 */
import {
  existsSync,
  readdirSync,
  rmdirSync,
  rmSync
}                       from 'node:fs';
import { dirname, join } from 'node:path';

/** The path older versions installed to, spelled out, since the current dispatcher's name may change without moving this one. */
const RETIRED_DISPATCHER_SCRIPT_PATH_IN_REPOSITORY = ['.claude', 'workflows', 'agent-progress-dispatch.js'] as const;

/** The report line's clause, or `null` when there was no copy to remove. */
export function removalOfTheRetiredDispatcherScript(rootDirectory: string): string | null {
  const retiredDispatcherScriptFilePath = join(rootDirectory, ...RETIRED_DISPATCHER_SCRIPT_PATH_IN_REPOSITORY);
  if (!existsSync(retiredDispatcherScriptFilePath)) return null;
  rmSync(retiredDispatcherScriptFilePath, { force: true });
  const retiredWorkflowsDirectory = dirname(retiredDispatcherScriptFilePath);
  if (readdirSync(retiredWorkflowsDirectory).length === 0) rmdirSync(retiredWorkflowsDirectory);
  return `removed the old ${retiredDispatcherScriptFilePath}`;
}
