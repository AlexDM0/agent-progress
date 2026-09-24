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

function parsedDocument(text: string): { frontmatter: TicketFrontmatter; body: string; lineEnding: '\n' | '\r\n' } {
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

  // Unquoted values are taken verbatim: a hand-written leading zero read as a number would be lost on the next rewrite.
  test('an unquoted all-digit value keeps its text, leading zeros included, and only the task is read as a number', () => {
    const handEdited = FULL_TICKET
      .replace('title: "Fix: the export dialog forgets the folder"', 'title: 0042')
      .replace('branch: "ticket/export-dialog"', 'branch: "ticket/export-dialog"\ncommit: 0123456')
      .replace('task: 17', 'task: 7');
    const { frontmatter, body } = parsedDocument(handEdited);

    expect(frontmatter.title).toBe('0042');
    expect(frontmatter.commit).toBe('0123456');
    expect(frontmatter.task).toBe(7);
    expect(serializeTicketDocument(frontmatter, body)).toBe(handEdited.replace('title: 0042', 'title: "0042"').replace('commit: 0123456', 'commit: "0123456"'));
  });

  test('an id written unquoted or unpadded still names ticket 003', () => {
    expect(parsedDocument(FULL_TICKET.replace('id: "003"', 'id: 3')).frontmatter.id).toBe('003');
  });

  test('a document with no closing fence is malformed and names the last line', () => {
    const unterminated = ['---', 'id: "003"', 'title: "No fence"'].join('\n');
    const parsed       = parseTicketDocument(unterminated);

    expect(parsed).toEqual({ verdict: 'malformed', reason: 'the frontmatter has no closing `---` fence', line: 3 });
  });

  // Without this, the body's first rule closes the frontmatter and every heading above it is silently kept as a comment.
  test('a document whose closing fence was deleted is refused at the first heading, saying to restore the fence above it', () => {
    const fenceDeleted = FULL_TICKET.replace('task: 17\n---\n', 'task: 17\n').concat('---\n\n## Acceptance\n');
    const parsed       = parseTicketDocument(fenceDeleted);

    expect(parsed).toEqual({
      verdict: 'malformed',
      reason:  'line 17 is the markdown heading `## Report`, and a frontmatter holds no heading (a comment has one `#`); '
        + 'if the closing `---` fence was deleted, restore it above line 17',
      line: 17,
    });
  });

  // The same refusal meets a correctly fenced file, so its reason must not call the real fence a rule in the body.
  test('a two-hash comment inside a correctly fenced frontmatter is refused without claiming the fence is missing', () => {
    const parsed = parseTicketDocument(FULL_TICKET.replace('task: 17\n', 'task: 17\n## note from Alex Example\n'));

    expect(parsed.verdict === 'malformed' ? parsed.reason : '').toStartWith('line 15 is the markdown heading `## note from Alex Example`');
    expect(parsed.verdict === 'malformed' ? parsed.reason : '').not.toContain('no closing');
  });

  // A body opening on `# Title`, a blank and prose used to be refused at the prose as a bad key, hiding that the fence went missing.
  test('a single-hash line followed by a blank and prose is refused at itself when the closing fence was deleted, saying to restore the fence above it', () => {
    const fenceDeleted = FULL_TICKET.replace('task: 17\n---\n', 'task: 17\n').replace('## Report', 'The dialog forgets the folder.').concat('---\n');

    expect(parseTicketDocument(fenceDeleted)).toEqual({
      verdict: 'malformed',
      reason:  'line 15 `# 003 — Fix: the export dialog forgets the folder` is followed after blank lines by line 17, which is not a `key: value` line: '
        + 'if line 15 is a markdown heading, the closing `---` fence was deleted and belongs above it; if it is a comment, line 17 does not belong in the frontmatter',
      line: 15,
    });
  });

  // In a correctly fenced file the same shape is a comment above a stray line, so the reason must not state that line 15 is a heading.
  test('a single-hash comment followed by a blank and prose inside a fenced frontmatter is refused naming the stray line as well', () => {
    const parsed = parseTicketDocument(FULL_TICKET.replace('task: 17\n', 'task: 17\n# owners\n\n- Alex Example\n'));
    const reason = parsed.verdict === 'malformed' ? parsed.reason : '';

    expect(reason).toContain('line 17 does not belong in the frontmatter');
    expect(reason).not.toContain('is the markdown heading');
  });

  test('a single-hash comment followed by a blank and a key stays a comment', () => {
    const commented = FULL_TICKET.replace('task: 17\n', '# pairing notes\n\ntask: 17\n');

    expect(parsedDocument(commented).frontmatter.extra).toEqual([['#', 'pairing notes'], ['', '']]);
  });

  test('a single-hash comment followed directly by prose is refused at the prose, not as a heading', () => {
    const parsed = parseTicketDocument(FULL_TICKET.replace('task: 17\n', 'task: 17\n# pairing notes\nnot a key\n'));

    expect(parsed).toEqual({ verdict: 'malformed', reason: '`not a key` is not a `key: value` line', line: 16 });
  });

  test('an id of zero or past the safe integers is refused rather than padded', () => {
    expect(parseTicketDocument(FULL_TICKET.replace('id: "003"', 'id: 0'))).toEqual({ verdict: 'malformed', reason: '`id` is not a ticket number: 0', line: 2 });
    expect(parseTicketDocument(FULL_TICKET.replace('id: "003"', 'id: 99999999999999999999')))
      .toEqual({ verdict: 'malformed', reason: '`id` is not a ticket number: 99999999999999999999', line: 2 });
  });

  test('a task past the safe integers is refused rather than rounded', () => {
    expect(parseTicketDocument(FULL_TICKET.replace('task: 17', 'task: 99999999999999999999')))
      .toEqual({ verdict: 'malformed', reason: '`task` is not a safe whole number: 99999999999999999999', line: 14 });
  });

  test('a quoted task is refused with a reason saying it is quoted', () => {
    expect(parseTicketDocument(FULL_TICKET.replace('task: 17', 'task: "5"')))
      .toEqual({ verdict: 'malformed', reason: '`task` is quoted, but a task is a whole number written without quotes: "5"', line: 14 });
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

    expect(parseTicketDocument(nested)).toEqual({ verdict: 'malformed', reason: '`  nested: true` is indented, and this frontmatter has no nested structure', line: 12 });
  });

  // An indented heading used to pass as a comment, so a deleted fence above an indented `## Report` went unnoticed.
  test('a deleted fence is refused at an indented heading as it is at one in column 0', () => {
    const fenceDeleted = FULL_TICKET.replace('task: 17\n---\n', 'task: 17\n').replace('## Report', '  ## Report').concat('---\n\n## Acceptance\n');

    expect(parseTicketDocument(fenceDeleted)).toEqual({
      verdict: 'malformed',
      reason:  'line 17 is the markdown heading `  ## Report`, and a frontmatter holds no heading (a comment has one `#`); if the closing `---` fence was deleted, restore it above line 17',
      line:    17,
    });
  });

  // A single indented hash is not a heading, and must not slip through as a comment either.
  test('an indented single-hash line is refused as indented rather than kept as a comment', () => {
    const indentedHash = FULL_TICKET.replace('group: "export-dialog"', '  # filed while pairing');

    expect(parseTicketDocument(indentedHash)).toEqual({
      verdict: 'malformed',
      reason:  '`  # filed while pairing` is indented, and this frontmatter has no nested structure',
      line:    12,
    });
  });

  test('a comment in column 0 is still kept, its text trimmed', () => {
    const commented = FULL_TICKET.replace('group: "export-dialog"', '#   filed while pairing  ');

    expect(parsedDocument(commented).frontmatter.extra).toEqual([['#', 'filed while pairing']]);
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

// Every ticket written before priorities existed has no key, and a rewrite for a move must not add one it was never given.
describe('priority', () => {
  test('an absent or null priority stays absent, and the full ticket without one writes back byte for byte', () => {
    const { frontmatter, body } = parsedDocument(FULL_TICKET);

    expect(frontmatter.priority).toBeUndefined();
    expect(parsedDocument(FULL_TICKET.replace('type: "bug"\n', 'type: "bug"\npriority: null\n')).frontmatter.priority).toBeUndefined();
    expect(serializeTicketDocument(frontmatter, body)).toBe(FULL_TICKET);
  });

  test('a priority written quoted or bare reads back, and is written just after the type', () => {
    const withPriority = FULL_TICKET.replace('type: "bug"\n', 'type: "bug"\npriority: low\n');
    const { frontmatter, body } = parsedDocument(withPriority);

    expect(frontmatter.priority).toBe('low');
    expect(serializeTicketDocument(frontmatter, body)).toBe(withPriority.replace('priority: low', 'priority: "low"'));
  });

  test('a priority that is not low, normal or high is malformed and names its line', () => {
    const parsed = parseTicketDocument(FULL_TICKET.replace('type: "bug"\n', 'type: "bug"\npriority: "urgent"\n'));

    expect(parsed).toEqual({ verdict: 'malformed', reason: '`priority` is not a known ticket priority: urgent', line: 5 });
  });
});

// The same rule as priority: a ticket filed before agents were named must never gain `model` or `effort` from a rewrite.
describe('model and effort', () => {
  test('absent or null keys stay absent, and the full ticket without them writes back byte for byte', () => {
    const { frontmatter, body } = parsedDocument(FULL_TICKET);
    const withNulls             = parsedDocument(FULL_TICKET.replace('type: "bug"\n', 'type: "bug"\nmodel: null\neffort: null\n')).frontmatter;

    expect(frontmatter.model).toBeUndefined();
    expect(frontmatter.effort).toBeUndefined();
    expect(withNulls.model).toBeUndefined();
    expect(withNulls.effort).toBeUndefined();
    expect(serializeTicketDocument(frontmatter, body)).toBe(FULL_TICKET);
  });

  test('both read back quoted or bare, and are written after the priority and before the status', () => {
    const withAgent = FULL_TICKET.replace('type: "bug"\n', 'type: "bug"\npriority: "high"\nmodel: sonnet\neffort: "xhigh"\n');
    const { frontmatter, body } = parsedDocument(withAgent);

    expect(frontmatter.model).toBe('sonnet');
    expect(frontmatter.effort).toBe('xhigh');
    expect(serializeTicketDocument(frontmatter, body)).toBe(withAgent.replace('model: sonnet', 'model: "sonnet"'));
  });

  test('a model or an effort the tool does not know is malformed and names its line', () => {
    expect(parseTicketDocument(FULL_TICKET.replace('type: "bug"\n', 'type: "bug"\nmodel: "claude-opus-5-5"\n')))
      .toEqual({ verdict: 'malformed', reason: '`model` is not a known agent model: claude-opus-5-5', line: 5 });
    expect(parseTicketDocument(FULL_TICKET.replace('type: "bug"\n', 'type: "bug"\neffort: "extreme"\n')))
      .toEqual({ verdict: 'malformed', reason: '`effort` is not a known agent effort: extreme', line: 5 });
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
    const { frontmatter, body, lineEnding } = parsedDocument(windowsTicket);

    expect(body.includes('\r\n')).toBe(true);
    expect(serializeTicketDocument(frontmatter, body, lineEnding)).toBe(windowsTicket);
  });

  // The body used to be where the line ending was read from, so an empty one lost CRLF on the first rewrite.
  test('a CRLF document with an empty body keeps CRLF, because the line ending is the frontmatter\'s', () => {
    const windowsTicketWithoutBody = `${FULL_TICKET.slice(0, FULL_TICKET.indexOf('# 003'))}`.replaceAll('\n', '\r\n');
    const { frontmatter, body, lineEnding } = parsedDocument(windowsTicketWithoutBody);

    expect(body).toBe('');
    expect(serializeTicketDocument(frontmatter, body, lineEnding)).toBe(windowsTicketWithoutBody);
  });

  test('an LF frontmatter over a body holding a pasted CRLF line is written back with LF', () => {
    const mixedTicket = `${FULL_TICKET}pasted\r\n`;
    const { frontmatter, body, lineEnding } = parsedDocument(mixedTicket);

    expect(serializeTicketDocument(frontmatter, body, lineEnding)).toBe(mixedTicket);
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
