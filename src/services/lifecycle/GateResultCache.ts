/**
 * The passes a gate has recorded, keyed by sha256 of the tree, the checks line and the install line, so identity is content and the clock
 * decides nothing. The folder cache is trusted only because nothing but the runner writes its folder; the memory cache is the fallback
 * when gates cannot run under that sandbox, lost on a restart so gates run again.
 */
import { createHash }            from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join }                  from 'node:path';

import { writeFileAtomically } from '../../lib/atomic-file/AtomicFile.ts';

export interface GatePass {
  treeId:      string;
  checksLine:  string;
  installLine: string | null;
}

export interface GateResultCache {
  holdsPassOf(key: string): boolean;
  recordPass(key: string, pass: GatePass): void;
}

const CACHE_FILE_SUFFIX = '.json';

/** Joined as a JSON list, so no line can end where another begins and collide with a different triple. */
export function gateCacheKeyOf({ treeId, checksLine, installLine }: GatePass): string {
  return createHash('sha256').update(JSON.stringify([treeId, checksLine, installLine ?? ''])).digest('hex');
}

export function createMemoryGateResultCache(): GateResultCache {
  const passedKeys = new Set<string>();
  return {
    holdsPassOf: (key) => passedKeys.has(key),
    recordPass:  (key) => {
      passedKeys.add(key);
    },
  };
}

/** `<folder>/<key>.json`, one file per pass, written atomically so a reader never sees half a record. */
export function createFolderGateResultCache(folder: string): GateResultCache {
  const filePathOf = (key: string): string => join(folder, `${key}${CACHE_FILE_SUFFIX}`);
  return {
    holdsPassOf: (key) => existsSync(filePathOf(key)),
    recordPass:  (key, pass) => {
      mkdirSync(folder, { recursive: true });
      writeFileAtomically(filePathOf(key), `${JSON.stringify(pass, null, 2)}\n`);
    },
  };
}
