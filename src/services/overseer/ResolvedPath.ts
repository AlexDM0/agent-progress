import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join }  from 'node:path';

/** Seatbelt matches resolved paths, so `/var` must read as `/private/var`; a path not there yet resolves through its nearest folder. */
export function resolvedPathOf(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  return parent === path ? path : join(resolvedPathOf(parent), basename(path));
}
