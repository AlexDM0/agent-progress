/**
 * The texts `init` and `update` install, computed before anything is written. The cases that matter: the product's names are filled and
 * only the instruction defaults keep placeholders, the ones the Overseer fills at each launch; the session instructions and the Assistant
 * brief name no retired verb, hook or file; the brief whose presence marks the install is the session instructions; and neither skill
 * names a Claude-only tool.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { describe, expect, test } from 'bun:test';

import { PRODUCT_NAMES }         from '../../src/shared/constants/ProductNames.ts';
import { installedFileTextsFor } from './InstalledFileGeneration.ts';
import { CLAUDE_CODE_INSTALL }   from './constants/ClaudeCodeInstall.ts';

const TEXTS = installedFileTextsFor();

const CHECKOUT_DIRECTORY = join(import.meta.dir, '..', '..');

const CLAUDE_ONLY_TOOL_NAMES = ['Workflow(', 'AskUserQuestion', 'Monitor', 'subagent_type', 'the Agent tool'];

/** What install version 17 retired, which no text it installs may send a session to. */
const RETIRED_NAMES = ['dispatcher', 'agent-brief.md', 'builder-brief.md', 'review-brief.md', 'subagent-stop', 'post-tool-use', 'ticket claim', '--tokens'];

const PLACEHOLDERS_THE_OVERSEER_FILLS = ['{{callBudget}}', '{{jobId}}'];

describe('the installed texts', () => {
  test('every brief is generated, and only the instruction defaults keep placeholders, the ones their launch fills', () => {
    expect(Object.keys(TEXTS).sort()).toEqual([
      'assistantDefault',
      'builderDefault',
      'constitutionDefault',
      'mergerDefault',
      'onboarderDefault',
      'productOwnerDefault',
      'reference',
      'reviewerDefault',
      'sessionInstructions',
    ]);
    expect(TEXTS.reference).not.toContain('{{');
    expect(TEXTS.sessionInstructions).not.toContain('{{');
    expect(TEXTS.constitutionDefault).not.toContain('{{');
    expect(TEXTS.onboarderDefault).not.toContain('{{');
    expect([...(TEXTS.assistantDefault ?? '').matchAll(/\{\{\w+\}\}/g)].map(([placeholder]) => placeholder).sort())
      .toEqual(PLACEHOLDERS_THE_OVERSEER_FILLS);
    expect(TEXTS.builderDefault).toContain('{{ticketBody}}');
    expect(TEXTS.builderDefault).not.toContain('{{program}}');
    expect(TEXTS.sessionInstructions).toContain(`\`${PRODUCT_NAMES.PROGRAM} status --json\``);
    expect(TEXTS.sessionInstructions).toContain(`\`${PRODUCT_NAMES.DATA_FOLDER}/reference.md\``);
  });

  test('neither the session instructions nor the Assistant brief name a retired verb, hook or file', () => {
    for (const text of [TEXTS.sessionInstructions ?? '', TEXTS.assistantDefault ?? '']) {
      for (const retiredName of RETIRED_NAMES) expect(text, retiredName).not.toContain(retiredName);
    }
  });

  test('the session instructions are the last brief, the one whose presence marks the files installed', () => {
    const briefs = CLAUDE_CODE_INSTALL.parts.find((part) => part.writing === 'briefs');
    expect(briefs?.writing === 'briefs' ? briefs.files.at(-1)?.name : null).toBe('sessionInstructions');
  });

  test('neither skill nor the reference names a Claude-only tool', () => {
    const filePaths = ['skills/agent-po/SKILL.md', 'resources/templates/Reference.md', 'skills/agent-progress-orchestrate/SKILL.md'];
    for (const filePath of filePaths) {
      const text = readFileSync(join(CHECKOUT_DIRECTORY, filePath), 'utf8');
      for (const claudeOnlyToolName of CLAUDE_ONLY_TOOL_NAMES) expect(text, `${filePath} names ${claudeOnlyToolName}`).not.toContain(claudeOnlyToolName);
    }
  });
});
