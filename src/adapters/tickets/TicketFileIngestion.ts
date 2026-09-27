/** One ticket file read into the model: a file that cannot be read or parsed is a `malformed` verdict with its reason and line, never a throw. */
import { readFileSync }       from 'node:fs';
import type { Ticket }        from '../../lib/tracker-model/@types/Ticket.ts';
import { TicketDocumentUtil } from './utils/TicketDocumentUtil.ts';

export type TicketFileReading =
  | { verdict: 'parsed'; ticket: Ticket; identifierLine: number }
  | { verdict: 'malformed'; reason: string; line: number };

const IDENTIFIER_LINE_MATCH = /^id:/;

export class TicketFileIngestion {
  constructor(private readonly ticketFilePath: string) {}

  read(): TicketFileReading {
    let text: string;
    try {
      text = readFileSync(this.ticketFilePath, 'utf8');
    } catch (problem) {
      return { verdict: 'malformed', reason: `the file could not be read: ${String(problem)}`, line: 0 };
    }

    const parsed = TicketDocumentUtil.parsedTicketDocumentOf(text);
    if (parsed.verdict === 'malformed') {
      return parsed;
    }
    const ticket: Ticket = {
      frontmatter: parsed.frontmatter,
      body:        parsed.body,
      filePath:    this.ticketFilePath,
      lineEnding:  parsed.lineEnding,
    };
    return {
      verdict:        'parsed',
      ticket,
      identifierLine: text.split('\n').findIndex((line) => IDENTIFIER_LINE_MATCH.test(line)) + 1,
    };
  }
}
