/**
 * A scratch git repository `init` has already run in, copied from one template per init arguments and clock reading rather than built by
 * running `init` for every case.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, sep }                 from 'node:path';

import { createScratchCopyOf, createScratchGitRepository, keptAsTemplateUntilTheRunEnds } from '../../src/testing/ScratchWorkspace.ts';
import { runCommandLine }                                                                 from '../Main.ts';
import { createCapturedCommandContext }                                                   from './CapturedCommandContext.ts';

const GIT_DIRECTORY_NAME = '.git';

const initializedTemplates = new Map<string, string>();

/** A copy is exactly what `init` would have written in the copy's own directory only while no file `init` wrote names the directory. */
function requireNoFileNamesItsDirectory(templateDirectory: string): void {
  const directoryName = basename(templateDirectory);
  const filesNamingIt = readdirSync(templateDirectory, { recursive: true, encoding: 'utf8' })
    .filter((relativePath) => relativePath !== GIT_DIRECTORY_NAME && !relativePath.startsWith(`${GIT_DIRECTORY_NAME}${sep}`))
    .filter((relativePath) => statSync(join(templateDirectory, relativePath)).isFile())
    .filter((relativePath) => readFileSync(join(templateDirectory, relativePath), 'utf8').includes(directoryName));
  if (filesNamingIt.length > 0) throw new Error(`init wrote its directory into ${filesNamingIt.join(', ')}, so a copy of it would not be what init writes there.`);
}

async function initializedTemplateFor(initArguments: readonly string[], now: () => Date): Promise<string> {
  const templateKey      = JSON.stringify([initArguments, now().toISOString()]);
  const existingTemplate = initializedTemplates.get(templateKey);
  if (existingTemplate !== undefined) return existingTemplate;
  const templateDirectory = keptAsTemplateUntilTheRunEnds(createScratchGitRepository('initialized-repository-template'));
  const context           = createCapturedCommandContext({ currentDirectory: templateDirectory, now });
  const exitCode          = await runCommandLine(['init', ...initArguments], context);
  if (exitCode !== 0) throw new Error(`\`agent-progress init ${initArguments.join(' ')}\` exited ${exitCode}: ${context.errorText()}`);
  requireNoFileNamesItsDirectory(templateDirectory);
  initializedTemplates.set(templateKey, templateDirectory);
  return templateDirectory;
}

/** What `createScratchGitRepository` followed by `init <initArguments>` under the clock `now` leaves, in a directory of its own. */
export async function createInitializedScratchRepository(prefix: string, initArguments: readonly string[], now: () => Date): Promise<string> {
  return createScratchCopyOf(await initializedTemplateFor(initArguments, now), prefix);
}
