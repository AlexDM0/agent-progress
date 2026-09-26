/**
 * What `reportRenderProblems` prints after a store write, for each render outcome, byte for byte: the words are the command line's, a
 * script may match them, and none of them fails the command, so nothing goes to standard output and every line goes to standard error.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import type { MalformedTicketFile }                       from '../src/services/tracker/TicketStore';
import { createScratchDirectory, removeScratchDirectory } from '../src/testing/ScratchWorkspace';
import { reportRenderProblems }                           from './CommandSupport';
import { createCapturedCommandContext }                   from './testing/CapturedCommandContext';

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
  scratchDirectory = createScratchDirectory('command-support');
});

afterEach(() => {
  removeScratchDirectory(scratchDirectory);
});

describe('reportRenderProblems', () => {
  test('an unreadable tracker is one line saying the dashboard was not regenerated, with the render reason', () => {
    const context = createCapturedCommandContext({ currentDirectory: scratchDirectory });

    reportRenderProblems(context, {
      verdict: 'unreadable',
      reading: {
        verdict:        'unreadable',
        unreadableFile: 'log-file',
        filePath:       '/example/.agent-progress/log.jsonl',
        reason:         '/example/.agent-progress/log.jsonl, line 1: fields.text is not a string',
      },
    });

    expect(context.outputText()).toBe('');
    expect(context.errorText()).toBe('The dashboard was not regenerated: the log cannot be read: /example/.agent-progress/log.jsonl, line 1: fields.text is not a string');
  });

  test('a page written without its script says so first, then one ignored-ticket line per malformed file', () => {
    const context = createCapturedCommandContext({ currentDirectory: scratchDirectory });

    reportRenderProblems(context, { verdict: 'rendered-without-page-script', reason: 'the page bundle produced no output file', malformedTickets: MALFORMED_TICKETS });

    expect(context.outputText()).toBe('');
    expect(context.errorText()).toBe([
      'The dashboard was written without its page script, so the chart is not interactive: the page bundle produced no output file',
      IGNORED_TICKET_LINES,
    ].join('\n'));
  });

  test('a rendered page prints only the ignored-ticket lines', () => {
    const context = createCapturedCommandContext({ currentDirectory: scratchDirectory });

    reportRenderProblems(context, { verdict: 'rendered', malformedTickets: MALFORMED_TICKETS });

    expect(context.outputText()).toBe('');
    expect(context.errorText()).toBe(IGNORED_TICKET_LINES);
  });

  test('a rendered page with no malformed ticket prints nothing at all', () => {
    const context = createCapturedCommandContext({ currentDirectory: scratchDirectory });

    reportRenderProblems(context, { verdict: 'rendered', malformedTickets: [] });

    expect(context.outputText()).toBe('');
    expect(context.errorText()).toBe('');
  });
});
