/**
 * What `lib/tickets/Frontmatter.ts` must survive from outside the CLI — unknown keys, comments, CRLF,
 * a byte order mark, `---` inside the body — and the verdicts a malformed ticket comes back as.
 */

import { describe, expect, test }                       from 'bun:test';
import type { TicketFrontmatter }                       from '../constants/Types.ts';
import { parseTicketDocument, serializeTicketDocument } from './Frontmatter.ts';

const FULL_TICKET = [
  '---',
  'id: "003"',
  'title: "Fix: the export dialog forgets the folder"',
  'type: "bug"',
  'status: "in-progress"',
  'filed: "2026-09-18T20:11:03+02:00"',
  'updated: "2026-09-18T20:40:00+02:00"',
  'started: "2026-09-18T20:40:00+02:00"',
  'finished: null',
  'delivered: null',
  'abandonedAt: null',
  'group: "export-dialog"',
  'branch: "ticket/export-dialog"',
  'task: 17',
  '---',
  '# 003 — Fix: the export dialog forgets the folder',
  '',
  '## Report',
  '',
  '> Reported by Alex Example.',
  '',
].join('\n');

function parsedDocument(text: string): { frontmatter: TicketFrontmatter; body: string } {
  const parsed = parseTicketDocument(text);
  if (parsed.verdict !== 'parsed') {
    throw new Error(`expected a parsed ticket document, got "${parsed.reason}" at line ${parsed.line}`);
  }
  return parsed;
}

describe('parseTicketDocument', () => {
  test('reads every key the CLI owns out of a complete ticket', () => {
    const { frontmatter, body } = parsedDocument(FULL_TICKET);

    expect(frontmatter.id).toBe('003');
    expect(frontmatter.title).toBe('Fix: the export dialog forgets the folder');
    expect(frontmatter.type).toBe('bug');
    expect(frontmatter.status).toBe('in-progress');
    expect(frontmatter.started).toBe('2026-09-18T20:40:00+02:00');
    expect(frontmatter.finished).toBeNull();
    expect(frontmatter.delivered).toBeNull();
    expect(frontmatter.abandonedAt).toBeNull();
    expect(frontmatter.group).toBe('export-dialog');
    expect(frontmatter.branch).toBe('ticket/export-dialog');
    expect(frontmatter.commit).toBeUndefined();
    expect(frontmatter.task).toBe(17);
    expect(frontmatter.extra).toEqual([]);
    expect(body.startsWith('# 003 — Fix:')).toBe(true);
  });

  test('a ticket written before the delivered key existed reads it as null', () => {
    const withoutDelivered = FULL_TICKET.replace('delivered: null\n', '');

    expect(parsedDocument(withoutDelivered).frontmatter.delivered).toBeNull();
  });

  test('keeps an unknown key, a comment and a blank line in extra, in the order they were written', () => {
    const handEdited = [
      '---',
      'id: "007"',
      '# filed while pairing with Alex Example',
      'title: "Tidy the seed data"',
      'type: "change"',
      'status: "open"',
      'filed: "2026-09-18T09:00:00+02:00"',
      'updated: "2026-09-18T09:00:00+02:00"',
      '',
      'owner: Alex Example',
      'severity: 2',
      'task: null',
      '---',
      'body',
    ].join('\n');

    expect(parsedDocument(handEdited).frontmatter.extra).toEqual([
      ['#', 'filed while pairing with Alex Example'],
      ['', ''],
      ['owner', 'Alex Example'],
      ['severity', '2'],
    ]);
  });

  test('the closing fence is the first one, so a horizontal rule in the body stays in the body', () => {
    const withRule = [
      '---',
      'id: "004"',
      'title: "Split the settings page"',
      'type: "feature"',
      'status: "open"',
      'filed: "2026-09-18T09:00:00+02:00"',
      'updated: "2026-09-18T09:00:00+02:00"',
      '---',
      '## Report',
      '',
      '---',
      '',
      '## Acceptance',
      '',
    ].join('\n');
    const { frontmatter, body } = parsedDocument(withRule);

    expect(frontmatter.title).toBe('Split the settings page');
    expect(body).toBe('## Report\n\n---\n\n## Acceptance\n');
  });

  test('an unquoted value keeps every colon after the first separator', () => {
    const unquoted = FULL_TICKET.replace('title: "Fix: the export dialog forgets the folder"', 'title: Fix: the export dialog forgets the folder');

    expect(parsedDocument(unquoted).frontmatter.title).toBe('Fix: the export dialog forgets the folder');
  });

  test('a byte order mark is dropped rather than read as part of the opening fence', () => {
    expect(parsedDocument(`\uFEFF${FULL_TICKET}`).frontmatter.id).toBe('003');
  });

  test('an id written unquoted or unpadded still names ticket 003', () => {
    expect(parsedDocument(FULL_TICKET.replace('id: "003"', 'id: 3')).frontmatter.id).toBe('003');
  });

  test('a document with no closing fence is malformed and names the last line', () => {
    const unterminated = ['---', 'id: "003"', 'title: "No fence"'].join('\n');
    const parsed       = parseTicketDocument(unterminated);

    expect(parsed).toEqual({ verdict: 'malformed', reason: 'the frontmatter has no closing `---` fence', line: 3 });
  });

  test('a document that does not open with a fence is malformed at line 1', () => {
    const parsed = parseTicketDocument('# just a markdown file\n');

    expect(parsed.verdict).toBe('malformed');
    expect(parsed.verdict === 'malformed' ? parsed.line : 0).toBe(1);
  });

  test('an unknown status is malformed, names the key and points at its line', () => {
    const parsed = parseTicketDocument(FULL_TICKET.replace('status: "in-progress"', 'status: "in progress"'));

    expect(parsed.verdict).toBe('malformed');
    expect(parsed.verdict === 'malformed' ? parsed.reason : '').toBe('`status` is not a known ticket status: in progress');
    expect(parsed.verdict === 'malformed' ? parsed.line : 0).toBe(5);
  });

  test('a required key that is missing is malformed and names the key', () => {
    const parsed = parseTicketDocument(FULL_TICKET.replace('title: "Fix: the export dialog forgets the folder"\n', ''));

    expect(parsed.verdict === 'malformed' ? parsed.reason : '').toBe('the frontmatter has no `title` key');
  });

  test('an indented line is a nested structure this subset does not have, and is refused', () => {
    const nested = FULL_TICKET.replace('group: "export-dialog"', '  nested: true');

    expect(parseTicketDocument(nested).verdict).toBe('malformed');
  });
});

describe('dependsOn', () => {
  // An agent editing a ticket by hand writes whatever looks natural; every spelling of the same ids has to read the same.
  test('reads ids written with commas or spaces, with or without a hash or padding, once each', () => {
    const handWritten = FULL_TICKET.replace('task: 17', 'dependsOn: #1, 2 002 #4\ntask: 17');

    expect(parsedDocument(handWritten).frontmatter.dependsOn).toEqual(['001', '002', '004']);
  });

  test('reads a single unquoted number as a list of one', () => {
    expect(parsedDocument(FULL_TICKET.replace('task: 17', 'dependsOn: 5\ntask: 17')).frontmatter.dependsOn).toEqual(['005']);
  });

  test('reads an absent, null or empty value as no dependencies', () => {
    expect(parsedDocument(FULL_TICKET).frontmatter.dependsOn).toBeUndefined();
    expect(parsedDocument(FULL_TICKET.replace('task: 17', 'dependsOn: null\ntask: 17')).frontmatter.dependsOn).toBeUndefined();
    expect(parsedDocument(FULL_TICKET.replace('task: 17', 'dependsOn: ""\ntask: 17')).frontmatter.dependsOn).toBeUndefined();
  });

  test('refuses a value that is not a ticket number, naming its line', () => {
    const parsed = parseTicketDocument(FULL_TICKET.replace('task: 17', 'dependsOn: 3, the importer\ntask: 17'));

    expect(parsed.verdict).toBe('malformed');
    expect(parsed.verdict === 'malformed' ? parsed.line : 0).toBe(14);
  });
});

describe('serializeTicketDocument', () => {
  test('a full ticket survives a parse and a write unchanged', () => {
    const { frontmatter, body } = parsedDocument(FULL_TICKET);

    expect(serializeTicketDocument(frontmatter, body)).toBe(FULL_TICKET);
  });

  test('unknown keys, comments and blank lines are written back below the keys the CLI owns', () => {
    const handEdited = [
      '---',
      'id: "007"',
      'title: "Tidy the seed data"',
      'type: "change"',
      'status: "open"',
      'filed: "2026-09-18T09:00:00+02:00"',
      'updated: "2026-09-18T09:00:00+02:00"',
      'started: null',
      'finished: null',
      'delivered: null',
      'abandonedAt: null',
      'task: null',
      '# filed while pairing with Alex Example',
      '',
      'owner: Alex Example',
      '---',
      'body\n',
    ].join('\n');
    const { frontmatter, body } = parsedDocument(handEdited);

    expect(serializeTicketDocument(frontmatter, body)).toBe(handEdited);
  });

  test('a CRLF document is written back with CRLF', () => {
    const windowsTicket = FULL_TICKET.replaceAll('\n', '\r\n');
    const { frontmatter, body } = parsedDocument(windowsTicket);

    expect(body.includes('\r\n')).toBe(true);
    expect(serializeTicketDocument(frontmatter, body)).toBe(windowsTicket);
  });

  test('a title holding a colon, a quote and a leading hash is written as JSON and read back identically', () => {
    const { frontmatter, body } = parsedDocument(FULL_TICKET);
    frontmatter.title           = '#3: the "export" dialog';

    const written = serializeTicketDocument(frontmatter, body);

    expect(written).toContain('title: "#3: the \\"export\\" dialog"');
    expect(parsedDocument(written).frontmatter.title).toBe('#3: the "export" dialog');
  });

  test('an optional key that was cleared is omitted rather than written as null', () => {
    const { frontmatter, body } = parsedDocument(FULL_TICKET);
    delete frontmatter.group;

    expect(serializeTicketDocument(frontmatter, body)).not.toContain('group:');
  });

  test('a dependency list is written padded and comma-separated, after the optional keys and before the row', () => {
    const { frontmatter, body } = parsedDocument(FULL_TICKET);
    frontmatter.dependsOn       = ['001', '002'];

    const written = serializeTicketDocument(frontmatter, body);

    expect(written).toContain('branch: "ticket/export-dialog"\ndependsOn: "001, 002"\ntask: 17');
    expect(parsedDocument(written).frontmatter.dependsOn).toEqual(['001', '002']);
  });

  test('an empty dependency list is omitted', () => {
    const { frontmatter, body } = parsedDocument(FULL_TICKET);
    frontmatter.dependsOn       = [];

    expect(serializeTicketDocument(frontmatter, body)).not.toContain('dependsOn');
  });
});
