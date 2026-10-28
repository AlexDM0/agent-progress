/**
 * The host code a runner pins at its start: the entry `agent-host.ts` bundled once, as one file for Bun, into
 * `<data>/runner/host-<codeVersion>.js`, so a landing, a pull or a `bun install` never changes what a running or later host runs.
 */
import { existsSync } from 'node:fs';
import { join }       from 'node:path';

import { writeFileAtomically } from '../../lib/atomic-file/AtomicFile.ts';
import { OperationRefusal }    from '../../shared/OperationRefusal.ts';

export interface HostBundleRequest {
  runnerDirectory: string;
  codeVersion:     string;
  /** The host entry; the runner's own is `HOST_ENTRY_PATH`. */
  entryPath:       string;
}

export const HOST_ENTRY_PATH = join(import.meta.dir, '..', '..', '..', 'agent-host.ts');

function bundlePathOf(runnerDirectory: string, codeVersion: string): string {
  return join(runnerDirectory, `host-${codeVersion}.js`);
}

/** A bundle already written for this code version is the same code, so it is kept rather than rebuilt under a host that may be loading it. */
async function pinHostBundle(request: HostBundleRequest): Promise<string> {
  const bundlePath = bundlePathOf(request.runnerDirectory, request.codeVersion);
  if (existsSync(bundlePath)) return bundlePath;
  const built = await Bun.build({ entrypoints: [request.entryPath], target: 'bun', format: 'esm' });
  const [bundled] = built.outputs;
  if (!built.success || bundled === undefined) {
    throw new OperationRefusal('unrepaired', { kind: 'host-bundle-failed', entryPath: request.entryPath, reason: built.logs.map(String).join('\n') });
  }
  writeFileAtomically(bundlePath, await bundled.text());
  return bundlePath;
}

export const HostBundle = Object.freeze({ pinHostBundle, bundlePathOf });
