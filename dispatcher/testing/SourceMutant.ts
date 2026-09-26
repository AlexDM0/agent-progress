/** A one-occurrence rewrite of one dispatcher module, applied as the bundle is built, so a claim can be watched failing without the decision it pins. */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

export interface SourceMutant {
  /** Repo-rooted, as `dispatcher/run/DispatchRun.ts`. */
  modulePath: string;
  find:       string;
  replace:    string;
}

function literalPatternOf(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function occurrencesOf(text: string, find: string): number {
  return text.split(find).length - 1;
}

/** Fails the build unless `find` occurs exactly once in its module, so a mutant that stopped matching cannot pass by changing nothing. */
export function mutantPluginFor(mutant: SourceMutant): Bun.BunPlugin {
  const absoluteModulePath = join(import.meta.dir, '..', '..', mutant.modulePath);
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
