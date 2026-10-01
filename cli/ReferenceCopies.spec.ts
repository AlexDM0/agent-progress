/**
 * `skills/agent-progress/Reference.md` carries three sections of `docs/cli.md` for agents that cannot read the docs: the ticket file, the ticket moves and
 * the exit codes. Each copy must hold its source's body byte for byte, so an edit to either side alone fails here. The Reference section may
 * add lines of its own around the copy (a path line above the ticket file, a paragraph after the moves), never inside it. The scan is
 * fence-aware, because the ticket file's example holds markdown headings that would otherwise end its section early.
 */
import { readFileSync }           from 'node:fs';
import { join }                   from 'node:path';
import { describe, expect, test } from 'bun:test';

const DOCUMENTATION_TEXT = readFileSync(join(import.meta.dir, '..', 'docs', 'cli.md'), 'utf8');
const REFERENCE_TEXT     = readFileSync(join(import.meta.dir, '..', 'skills', 'agent-progress', 'Reference.md'), 'utf8');

/** Shorter than any of the three sources, so a heading renamed into an empty match fails the floor rather than passing on nothing. */
const SMALLEST_COPIED_SECTION_CHARACTERS = 1_000;

/** Each section with a phrase that occurs once in it and a word of that phrase the mutation tests swap. */
const COPIED_SECTIONS = [
  {
    sourceHeading: '### `.agent-progress/tickets/003-double-click-a-role-to-edit-it.md`',
    copyHeading:   '## The ticket file',
    mutation:      { phrase: 'The frontmatter is a deliberately small YAML subset.', word: 'small' },
  },
  {
    sourceHeading: '## Ticket moves and their rows',
    copyHeading:   '## What each move does to the Gantt row',
    mutation:      { phrase: 'is the matrix the named verbs enforce', word: 'matrix' },
  },
  {
    sourceHeading: '## Exit codes',
    copyHeading:   '## Exit codes',
    mutation:      { phrase: 'a refusal the caller can act on', word: 'caller' },
  },
] as const;

const FENCE_PATTERN   = /^```/;
const HEADING_PATTERN = /^(#{1,6}) /;

/** The lines under `heading` up to the next heading of its level or above outside a code fence, trimmed; null when the heading is absent. */
function sectionBodyOf(markdown: string, heading: string): string | null {
  const lines        = markdown.split('\n');
  const headingIndex = lines.indexOf(heading);
  if (headingIndex === -1) return null;
  const headingLevel = HEADING_PATTERN.exec(heading)?.[1]?.length ?? 0;

  let insideFence = false;
  let endIndex    = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (FENCE_PATTERN.test(line)) insideFence = !insideFence;
    const levelOfLine = insideFence ? null : HEADING_PATTERN.exec(line)?.[1]?.length;
    if (levelOfLine !== undefined && levelOfLine !== null && levelOfLine <= headingLevel) {
      endIndex = i;
      break;
    }
  }
  return lines.slice(headingIndex + 1, endIndex).join('\n').trim();
}

/** The headings whose copy no longer holds its source's body, so a failure names which section drifted. */
function driftedSectionsOf(documentationText: string, referenceText: string): string[] {
  return COPIED_SECTIONS.filter(({ sourceHeading, copyHeading }) => {
    const source = sectionBodyOf(documentationText, sourceHeading);
    const copy   = sectionBodyOf(referenceText, copyHeading);
    return source === null || copy === null || !copy.includes(source);
  }).map(({ copyHeading }) => copyHeading);
}

/** One word of `text` swapped, inside `phrase`, which must occur exactly once so the edit lands in the section the test means. */
function withOneWordChanged(text: string, phrase: string, word: string): string {
  const index = text.indexOf(phrase);
  if (index === -1 || text.indexOf(phrase, index + 1) !== -1) throw new Error(`the phrase \`${phrase}\` does not occur exactly once`);
  if (!phrase.includes(word)) throw new Error(`the word \`${word}\` is not in the phrase \`${phrase}\``);
  return `${text.slice(0, index)}${phrase.replace(word, 'changed')}${text.slice(index + phrase.length)}`;
}

describe('skills/agent-progress/Reference.md copies its three docs/cli.md sections verbatim', () => {
  test('every source and copy section is found, and each source is long enough to be the section rather than a stray match', () => {
    for (const { sourceHeading, copyHeading } of COPIED_SECTIONS) {
      const source = sectionBodyOf(DOCUMENTATION_TEXT, sourceHeading);
      expect(source, `\`${sourceHeading}\` in docs/cli.md`).not.toBeNull();
      expect(sectionBodyOf(REFERENCE_TEXT, copyHeading), `\`${copyHeading}\` in skills/agent-progress/Reference.md`).not.toBeNull();
      expect(source?.length ?? 0, `characters under \`${sourceHeading}\``).toBeGreaterThan(SMALLEST_COPIED_SECTION_CHARACTERS);
    }
  });

  test('the ticket file section runs past the markdown headings inside its example', () => {
    expect(sectionBodyOf(DOCUMENTATION_TEXT, COPIED_SECTIONS[0].sourceHeading)).toContain('gaps are tolerated, never filled.');
  });

  test('each copy holds its source byte for byte', () => {
    expect(driftedSectionsOf(DOCUMENTATION_TEXT, REFERENCE_TEXT), 'change docs/cli.md and skills/agent-progress/Reference.md together').toEqual([]);
  });

  test('a one-word edit to a copy alone is caught, in each section', () => {
    for (const { copyHeading, mutation } of COPIED_SECTIONS) {
      expect(driftedSectionsOf(DOCUMENTATION_TEXT, withOneWordChanged(REFERENCE_TEXT, mutation.phrase, mutation.word))).toEqual([copyHeading]);
    }
  });

  test('a one-word edit to a source alone is caught, in each section', () => {
    for (const { copyHeading, mutation } of COPIED_SECTIONS) {
      expect(driftedSectionsOf(withOneWordChanged(DOCUMENTATION_TEXT, mutation.phrase, mutation.word), REFERENCE_TEXT)).toEqual([copyHeading]);
    }
  });
});
