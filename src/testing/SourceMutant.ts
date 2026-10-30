/** A one-occurrence rewrite of one module, applied as it is bundled, so a claim can be watched failing without the decision it pins. */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { createScratchDirectory, removeScratchDirectory } from './ScratchWorkspace.ts';

export interface SourceMutant {
  /** Repo-rooted, as `src/lib/tracker-model/Playbook.ts`. */
  modulePath: string;
  find:       string;
  replace:    string;
}

const REPOSITORY_ROOT = join(import.meta.dir, '..', '..');

function literalPatternOf(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function occurrencesOf(text: string, find: string): number {
  return text.split(find).length - 1;
}

/** Fails the build unless `find` occurs exactly once in its module, so a mutant that stopped matching cannot pass by changing nothing. */
export function mutantPluginFor(mutant: SourceMutant): Bun.BunPlugin {
  const absoluteModulePath = join(REPOSITORY_ROOT, mutant.modulePath);
  return {
    name: `source mutant of ${mutant.modulePath}`,
    setup(build) {
      build.onLoad({ filter: new RegExp(`^${literalPatternOf(absoluteModulePath)}$`) }, () => {
        const source = readFileSync(absoluteModulePath, 'utf8');
        const occurrences = occurrencesOf(source, mutant.find);
        if (occurrences !== 1) throw new Error(`the mutant's text occurs ${occurrences} times in ${mutant.modulePath}, not once: ${JSON.stringify(mutant.find)}`);
        return { contents: source.replace(mutant.find, () => mutant.replace), loader: 'ts' };
      });
    },
  };
}

/** Bundles the repo-rooted `entryModulePath` with the mutant applied and imports the bundle, so a spec can call the mutated exports. */
export async function mutatedModuleOf(entryModulePath: string, mutant: SourceMutant): Promise<Record<string, unknown>> {
  const outputDirectory = createScratchDirectory('source-mutant');
  try {
    const build = await Bun.build({
      entrypoints: [join(REPOSITORY_ROOT, entryModulePath)], outdir: outputDirectory, target: 'bun', plugins: [mutantPluginFor(mutant)]
    });
    const output = build.outputs[0];
    if (!build.success || output === undefined) throw new Error(`the mutant of ${mutant.modulePath} did not build: ${build.logs.map(String).join('; ')}`);
    return await import(output.path) as Record<string, unknown>;
  } finally {
    removeScratchDirectory(outputDirectory);
  }
}
