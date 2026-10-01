/** One epic file read into the model: a file that cannot be read or parsed is a `malformed` verdict with its reason and line, never a throw. */
import { readFileSync }     from 'node:fs';
import type { Epic }        from '../../lib/tracker-model/@types/Epic.ts';
import { EpicDocumentUtil } from './utils/EpicDocumentUtil.ts';

export type EpicFileReading =
  | { verdict: 'parsed'; epic: Epic }
  | { verdict: 'malformed'; reason: string; line: number };

export class EpicFileIngestion {
  constructor(private readonly epicFilePath: string) {}

  read(): EpicFileReading {
    let text: string;
    try {
      text = readFileSync(this.epicFilePath, 'utf8');
    } catch (problem) {
      return { verdict: 'malformed', reason: `the file could not be read: ${String(problem)}`, line: 0 };
    }

    const parsed = EpicDocumentUtil.parsedEpicDocumentOf(text);
    if (parsed.verdict === 'malformed') return parsed;
    return {
      verdict: 'parsed',
      epic:    {
        frontmatter: parsed.frontmatter,
        body:        parsed.body,
        filePath:    this.epicFilePath,
        lineEnding:  parsed.lineEnding,
      },
    };
  }
}
