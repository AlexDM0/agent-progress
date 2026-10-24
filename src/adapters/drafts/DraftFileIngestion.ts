/** One draft file read into the model: a file that cannot be read or parsed is a `malformed` verdict with its reason, never a throw. */
import { readFileSync }                                 from 'node:fs';
import { DraftDocumentUtil, type DraftDocumentParsing } from './utils/DraftDocumentUtil.ts';

export class DraftFileIngestion {
  constructor(private readonly draftFilePath: string) {}

  read(): DraftDocumentParsing {
    let text: string;
    try {
      text = readFileSync(this.draftFilePath, 'utf8');
    } catch (problem) {
      return { verdict: 'malformed', reason: `the file could not be read: ${String(problem)}` };
    }
    return DraftDocumentUtil.parsedDraftDocumentOf(text);
  }
}
