/**
 * What `reportIgnoredTicketFiles` prints after a store write, byte for byte: the words are the command line's, a script may match them,
 * and none of them fails the command, so nothing goes to standard output and every line goes to standard error.
 * Beside it, the column padding every table relies on, the ignored-ticket line with and without a line number, and the logged records
 * worded one per line as every writing command prints them.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { LogUtil }                                        from '../../src/adapters/utils/LogUtil.ts';
import type { MalformedTicketFile }                       from '../../src/services/tracker/TicketStore.ts';
import { boardFixture, ticketFixture }                    from '../../src/testing/BoardFixtures.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../src/testing/ScratchWorkspace.ts';
import { createCapturedCommandContext }                   from '../testing/CapturedCommandContext.ts';
import { OutputUtil }                                     from './OutputUtil.ts';

const {
  padColumn,
  ignoredTicketFileText,
  loggedSentencesOf,
  reportIgnoredTicketFiles,
} = OutputUtil;

const MALFORMED_TICKETS: MalformedTicketFile[] = [
  { filePath: '/example/.agent-progress/tickets/004-broken.md', reason: 'the frontmatter has no closing fence', line: 1 },
  { filePath: '/example/.agent-progress/tickets/005-unreadable.md', reason: 'the file could not be read: EACCES', line: 0 },
];

const IGNORED_TICKET_LINES = [
  'Ticket file ignored: /example/.agent-progress/tickets/004-broken.md (line 1): the frontmatter has no closing fence',
  'Ticket file ignored: /example/.agent-progress/tickets/005-unreadable.md: the file could not be read: EACCES',
].join('\n');

let scratchDirectory = '';

beforeEach(() => {
  scratchDirectory = createScratchDirectory('output-util');
});

afterEach(() => {
  removeScratchDirectory(scratchDirectory);
});

describe('OutputUtil.reportIgnoredTicketFiles', () => {
  test('prints one ignored-ticket line per malformed file, all on standard error', () => {
    const context = createCapturedCommandContext({ currentDirectory: scratchDirectory });

    reportIgnoredTicketFiles(context, MALFORMED_TICKETS);

    expect(context.outputText()).toBe('');
    expect(context.errorText()).toBe(IGNORED_TICKET_LINES);
  });

  test('with no malformed ticket prints nothing at all', () => {
    const context = createCapturedCommandContext({ currentDirectory: scratchDirectory });

    reportIgnoredTicketFiles(context, []);

    expect(context.outputText()).toBe('');
    expect(context.errorText()).toBe('');
  });
});

describe('OutputUtil.padColumn', () => {
  test('a shorter text is padded with spaces to the column width', () => {
    expect(padColumn('id', 6)).toBe('id    ');
  });

  // Without the space, an over-long value would run into the next column and the two would read as one word.
  test('a text as long as the column or longer keeps its length and gets one trailing space', () => {
    expect(padColumn('status', 6)).toBe('status ');
    expect(padColumn('reviewed', 6)).toBe('reviewed ');
  });
});

describe('OutputUtil.ignoredTicketFileText', () => {
  test('a malformed file with a line names the line after the path', () => {
    expect(ignoredTicketFileText({ filePath: '/example/tickets/004-broken.md', line: 3, reason: 'the frontmatter has no closing `---` fence' }))
      .toBe('Ticket file ignored: /example/tickets/004-broken.md (line 3): the frontmatter has no closing `---` fence');
  });

  test('a malformed file without a line, given as zero, names only the path', () => {
    expect(ignoredTicketFileText({ filePath: '/example/tickets/005-unreadable.md', line: 0, reason: 'the file could not be read: EACCES' }))
      .toBe('Ticket file ignored: /example/tickets/005-unreadable.md: the file could not be read: EACCES');
  });
});

describe('OutputUtil.loggedSentencesOf', () => {
  test('words each logged record and joins them one per line', () => {
    const { board, records } = boardFixture({ tickets: [ticketFixture({ id: '001' }), ticketFixture({ id: '002' })] });
    board.setTicketPriority('001', 'high', '2026-09-18T09:30:00+02:00');
    board.setTicketPriority('002', 'low', '2026-09-18T09:31:00+02:00');

    expect(records).toHaveLength(2);
    expect(loggedSentencesOf(records)).toBe('Ticket #001 priority normal → high\nTicket #002 priority normal → low');
    expect(loggedSentencesOf(records)).toBe(records.map((record) => LogUtil.sentenceOf(record)).join('\n'));
  });

  test('nothing logged is the empty text', () => {
    expect(loggedSentencesOf([])).toBe('');
  });
});
