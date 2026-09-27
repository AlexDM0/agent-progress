import { existsSync, readFileSync } from 'node:fs';

export type StoredFileText =
  | { verdict: 'readable'; text: string }
  | { verdict: 'absent' }
  | { verdict: 'unreadable'; reason: string };

/**
 * Never throws. A file that exists but cannot be read is `unreadable`, never `absent`, because `absent` invites the caller to treat a good
 * file as missing; the reason is worded as an ingestion reports it, so a caller that names the file only prefixes it.
 */
export function storedFileTextOf(filePath: string): StoredFileText {
  try {
    return { verdict: 'readable', text: readFileSync(filePath, 'utf8') };
  } catch (error) {
    if (!existsSync(filePath)) return { verdict: 'absent' };
    return { verdict: 'unreadable', reason: `it could not be read (${error instanceof Error ? error.message : 'unknown error'})` };
  }
}
