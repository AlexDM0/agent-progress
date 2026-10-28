/**
 * The prose wrap reviewers hold: a paragraph line of the repository's rules, skills, installed templates and CLI reference is at most
 * 120 columns. Table rows, fenced code, frontmatter and a line holding one code span alone are left alone, since none can wrap. The scan
 * first proves it read paragraph lines of every file, and each form is planted to prove the guard names it and passes what it skips.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { describe, expect, test } from 'bun:test';

import { repositoryRootOfThisCheckout } from './testing/ImportGraph.ts';

const PROSE_WIDTH_COLUMNS = 120;
const FENCE = /^\s*(```|~~~)/;
const TABLE_ROW = /^\s*\|/;
const LONE_CODE_SPAN = /^\s*(— )?`[^`]+`[.,;:]?$/;
const FRONTMATTER_FENCE = '---';

function wrappedProseFilePaths(repositoryRoot: string): string[] {
  const globbed = ['skills/**/*.md', 'resources/templates/*.md', 'resources/prompts/*.md'].flatMap((pattern) => [...new Bun.Glob(pattern).scanSync({ cwd: repositoryRoot })]);
  return ['CLAUDE.md', 'docs/cli.md', 'docs/backlog.md', ...globbed.sort()];
}

function paragraphLineNumbersOf(text: string): number[] {
  const lines = text.split('\n');
  const paragraphLineNumbers: number[] = [];
  let insideFence = false;
  let insideFrontmatter = lines[0] === FRONTMATTER_FENCE;
  lines.forEach((line, index) => {
    if (insideFrontmatter) {
      insideFrontmatter = index === 0 || line !== FRONTMATTER_FENCE;
      return;
    }
    if (FENCE.test(line)) {
      insideFence = !insideFence;
      return;
    }
    if (!insideFence && !TABLE_ROW.test(line) && !LONE_CODE_SPAN.test(line) && line.trim() !== '') paragraphLineNumbers.push(index + 1);
  });
  return paragraphLineNumbers;
}

function overlongProseLinesOf(path: string, text: string): string[] {
  const lines = text.split('\n');
  return paragraphLineNumbersOf(text)
    .filter((lineNumber) => (lines[lineNumber - 1] ?? '').length > PROSE_WIDTH_COLUMNS)
    .map((lineNumber) => `${path}:${lineNumber} is ${(lines[lineNumber - 1] ?? '').length} columns`);
}

const REPOSITORY_ROOT = repositoryRootOfThisCheckout();
const PROSE_FILES = wrappedProseFilePaths(REPOSITORY_ROOT).map((path) => ({ path, text: readFileSync(join(REPOSITORY_ROOT, path), 'utf8') }));

describe('prose wraps at 120 columns', () => {
  test('the scan reads paragraph lines of the rules, both skills, the templates, the reference and the runner\'s prompts', () => {
    for (const expectedPath of ['CLAUDE.md',
      'docs/cli.md',
      'skills/agent-po/SKILL.md',
      'skills/agent-progress-orchestrate/SKILL.md',
      'resources/templates/AgentBrief.md',
      'resources/templates/Reference.md',
      'resources/prompts/BuildPrompt.md',
      'resources/prompts/WindDownMessage.md']) {
      const file = PROSE_FILES.find((prose) => prose.path === expectedPath);
      expect(paragraphLineNumbersOf(file?.text ?? '').length, expectedPath).toBeGreaterThan(0);
    }
  });

  test('no paragraph line in those files runs past 120 columns', () => {
    expect(PROSE_FILES.flatMap((file) => overlongProseLinesOf(file.path, file.text))).toEqual([]);
  });

  const overlong = 'word '.repeat(PROSE_WIDTH_COLUMNS / 'word '.length + 1);

  test.each([
    ['a paragraph line', `Intro.\n${overlong}\n`],
    ['a list item', `- ${overlong}\n`],
    ['a line after a closed fence', `\`\`\`\ncode\n\`\`\`\n${overlong}\n`],
    ['a line after the frontmatter', `---\nname: example\n---\n${overlong}\n`],
  ])('a planted overlong %s is named', (_form, plantedText) => {
    expect(overlongProseLinesOf('Planted.md', plantedText)).toEqual([expect.stringContaining('Planted.md:')]);
  });

  test('a table row, fenced code, frontmatter and a lone code span pass however long', () => {
    const plantedText = `---\ndescription: ${overlong}\n---\n| ${overlong} |\n\`\`\`\n${overlong}\n\`\`\`\n  \`${overlong}\`.\nShort.\n`;
    expect(overlongProseLinesOf('Planted.md', plantedText)).toEqual([]);
  });
});
