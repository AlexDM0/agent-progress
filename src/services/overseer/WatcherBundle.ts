/**
 * The Watcher code an Overseer pins at its start: the entry `watcher.ts` bundled once, as one file for Bun, into
 * `<data>/overseer/watcher-<codeVersion>.js`, so a landing, a pull or a `bun install` never changes what a running or later Watcher runs.
 */
import { existsSync } from 'node:fs';
import { join }       from 'node:path';

import { writeFileAtomically } from '../../lib/atomic-file/AtomicFile.ts';
import { OperationRefusal }    from '../../shared/OperationRefusal.ts';

export interface WatcherBundleRequest {
  overseerDirectory: string;
  codeVersion:       string;
  /** The Watcher entry; the Overseer's own is `WATCHER_ENTRY_PATH`. */
  entryPath:         string;
}

export const WATCHER_ENTRY_PATH = join(import.meta.dir, '..', '..', '..', 'watcher.ts');

function bundlePathOf(overseerDirectory: string, codeVersion: string): string {
  return join(overseerDirectory, `watcher-${codeVersion}.js`);
}

/** A bundle already written for this code version is the same code, so it is kept rather than rebuilt under a Watcher that may be loading it. */
async function pinWatcherBundle(request: WatcherBundleRequest): Promise<string> {
  const bundlePath = bundlePathOf(request.overseerDirectory, request.codeVersion);
  if (existsSync(bundlePath)) return bundlePath;
  const built = await Bun.build({ entrypoints: [request.entryPath], target: 'bun', format: 'esm' });
  const [bundled] = built.outputs;
  if (!built.success || bundled === undefined) {
    throw new OperationRefusal('unrepaired', { kind: 'watcher-bundle-failed', entryPath: request.entryPath, reason: built.logs.map(String).join('\n') });
  }
  writeFileAtomically(bundlePath, await bundled.text());
  return bundlePath;
}

export const WatcherBundle = Object.freeze({ pinWatcherBundle, bundlePathOf });
