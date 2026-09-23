/**
 * The slug rule, which is the whole reason this module exists and the one thing no caller can check
 * for itself; the workflow layout one level deeper; and the listing's refusals: a folder that is not
 * there, a file beside the subagents that is not one, and the main session's own transcript.
 *
 * Every transcript here is a constructed empty file in a scratch directory: the claim is about which
 * paths are found, never about what any recorded session contains.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join }                     from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
} from 'bun:test';

import { createScratchDirectory, removeScratchDirectory } from '../tooling/dev/ScratchWorkspace';
import { listSubagentTranscripts, transcriptFolderFor }   from './ClaudeTranscripts';

let scratchDirectory = '';

function createTranscript(relativePath: string): void {
  const absolutePath = join(scratchDirectory, relativePath);
  mkdirSync(join(absolutePath, '..'), { recursive: true });
  writeFileSync(absolutePath, '');
}

beforeEach(() => {
  scratchDirectory = createScratchDirectory('claude-transcripts');
});

afterEach(() => {
  removeScratchDirectory(scratchDirectory);
});

describe('the folder a repository\'s transcripts live in', () => {
  test('is the root\'s absolute path with every separator turned into a dash, leading one included', () => {
    expect(transcriptFolderFor('/Users/alex/development/example', '/Users/alex'))
      .toBe('/Users/alex/.claude/projects/-Users-alex-development-example');
  });

  /** A relative root would otherwise produce a slug no harness ever wrote, and the command would report an empty cohort rather than a mistake. */
  test('a relative root is resolved first, so the slug is never built from a partial path', () => {
    const projectsFolder = '/home/example/.claude/projects/';
    const folder         = transcriptFolderFor('.', '/home/example');

    expect(folder.startsWith(`${projectsFolder}-`)).toBe(true);
    expect(folder.slice(projectsFolder.length), 'the slug is one name, so no separator survives inside it').not.toContain('/');
  });

  /**
   * The case a slug that replaced only `/` got wrong: a dotted directory is where a tool's own
   * checkout routinely sits, and the folder the harness wrote was never the one the command looked in.
   */
  test('a dot is replaced too, so `/.claude/` leaves two dashes rather than a dot between them', () => {
    expect(transcriptFolderFor('/Users/alex/.claude/ad-hoc-tooling', '/Users/alex'))
      .toBe('/Users/alex/.claude/projects/-Users-alex--claude-ad-hoc-tooling');
  });

  test('a space is replaced like any other character, so a run of them becomes a run of dashes', () => {
    expect(transcriptFolderFor('/Users/alex/BtC Ignite - Documents', '/Users/alex'))
      .toBe('/Users/alex/.claude/projects/-Users-alex-BtC-Ignite---Documents');
  });

  test('a root with a trailing separator produces the same folder as one without', () => {
    expect(transcriptFolderFor('/srv/work/', '/home/example')).toBe(transcriptFolderFor('/srv/work', '/home/example'));
  });
});

describe('the subagent transcripts under a folder', () => {
  test('are every agent file one level down, with the session and agent identifiers split off the path', () => {
    createTranscript(join('session-one', 'subagents', 'agent-alpha.jsonl'));
    createTranscript(join('session-one', 'subagents', 'agent-beta.jsonl'));
    createTranscript(join('session-two', 'subagents', 'agent-gamma.jsonl'));

    const found = listSubagentTranscripts(scratchDirectory);

    expect(found).toHaveLength(3);
    expect(found.map((transcript) => transcript.agentIdentifier)).toEqual(['alpha', 'beta', 'gamma']);
    expect(found.map((transcript) => transcript.sessionIdentifier)).toEqual(['session-one', 'session-one', 'session-two']);
    expect(found[0]?.path).toContain(join('session-one', 'subagents', 'agent-alpha.jsonl'));
  });

  // The main session's transcript sits beside the session directory and is the orchestrator, not a delegated cost.
  test('leave the main session\'s own transcript and any other stray file out', () => {
    createTranscript('session-one.jsonl');
    createTranscript(join('session-one', 'subagents', 'agent-alpha.jsonl'));
    createTranscript(join('session-one', 'subagents', 'notes.md'));
    createTranscript(join('session-one', 'subagents', 'summary.jsonl'));
    createTranscript(join('session-one', 'shell-snapshots', 'agent-decoy.jsonl'));

    expect(listSubagentTranscripts(scratchDirectory).map((transcript) => transcript.agentIdentifier)).toEqual(['alpha']);
  });

  // A workflow's agents are written one level deeper than a plain subagent's; missing them left every one of them out of `usage`.
  test('include a workflow run\'s agents beside the plain ones, and never its journal or an agent\'s metadata', () => {
    createTranscript(join('session-one', 'subagents', 'agent-alpha.jsonl'));
    createTranscript(join('session-one', 'subagents', 'workflows', 'run-one', 'agent-beta.jsonl'));
    createTranscript(join('session-one', 'subagents', 'workflows', 'run-one', 'agent-beta.meta.json'));
    createTranscript(join('session-one', 'subagents', 'workflows', 'run-one', 'journal.jsonl'));
    createTranscript(join('session-two', 'subagents', 'workflows', 'run-two', 'agent-gamma.jsonl'));
    createTranscript(join('session-two', 'subagents', 'workflows', 'agent-stray.jsonl'));

    const found = listSubagentTranscripts(scratchDirectory);

    expect(found.map((transcript) => transcript.agentIdentifier)).toEqual(['alpha', 'beta', 'gamma']);
    expect(found.map((transcript) => transcript.sessionIdentifier)).toEqual(['session-one', 'session-one', 'session-two']);
    expect(found[1]?.path).toContain(join('workflows', 'run-one', 'agent-beta.jsonl'));
  });

  /** "No transcripts here" is a normal answer the command prints a sentence for, so it must not arrive as a throw. */
  test('a folder that is not there is an empty list rather than an error', () => {
    expect(listSubagentTranscripts(join(scratchDirectory, 'never-created'))).toEqual([]);
  });

  test('a folder with sessions but no subagents in them is empty too', () => {
    createTranscript(join('session-one', 'other', 'agent-alpha.jsonl'));

    expect(listSubagentTranscripts(scratchDirectory)).toEqual([]);
  });
});
