/**
 * What a session is told comes from the pipeline's instruction files, read by the Overseer at launch. What matters: a builder's first
 * message holds the constitution files, then its own array's files, in array order, each as the main line holds it while the checked-out
 * branch holds another version; the data-folder default is read from disk and filled; each file read leaves its content hash; and one
 * missing file, named or default, refuses the launch naming it.
 */
import { createHash }               from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join }            from 'node:path';

import {
  afterEach,
  beforeEach,
  expect,
  test
}                                                                                                              from 'bun:test';
import type { Job }                                   from '../../src/lib/tracker-model/@types/Job.ts';
import type { Pipeline }                              from '../../src/lib/tracker-model/@types/Pipeline.ts';
import type { JobLaunchFacts }                        from '../../src/services/runner/DrivePass.ts';
import { InstructionFiles, defaultInstructionPathOf } from '../../src/services/runner/InstructionFiles.ts';
import {
  commitFile,
  createScratchGitRepository,
  gitOutputIn,
  removeScratchDirectory
} from '../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent } from '../../src/testing/ToolGuard.ts';
import { RunnerWording }            from './RunnerWording.ts';

const BUILD_JOB = {
  id: 'J4', kind: 'build', role: 'builder', ticketIds: ['012'], attempt: 1
} as unknown as Readonly<Job>;

const BUILDER_DEFAULT = 'Build ticket #{{ticketId}} as job {{jobId}}: {{ticketTitle}}.\n';

const PIPELINE: Pipeline = {
  prepare:      [],
  gates:        [],
  constitution: ['example-constitution.md', 'example-style.md'],
  agents:       { builder: [defaultInstructionPathOf('builder'), 'example-builder-extra.md'] },
};

let repositoryDirectory = '';
let mainLine = '';

function contentHashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function writeDataFolderFile(path: string, text: string): void {
  mkdirSync(dirname(join(repositoryDirectory, path)), { recursive: true });
  writeFileSync(join(repositoryDirectory, path), text);
}

function factsWith(instructions: string): JobLaunchFacts {
  return {
    tickets:                [{ id: '012', title: 'Example basket total', body: '## Acceptance\nA1. Example basket adds up.\n' }],
    checksLine:             null,
    gates:                  null,
    earlierSessionReplaced: false,
    intake:                 null,
    airlock:                null,
    assistant:              null,
    instructions,
  };
}

beforeEach(() => {
  repositoryDirectory = createScratchGitRepository('instruction-files');
  mainLine = gitOutputIn(repositoryDirectory, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  commitFile(repositoryDirectory, 'example-constitution.md', 'Main line rule: name things fully.\n');
  commitFile(repositoryDirectory, 'example-style.md', 'Main line style: one purpose per file.\n');
  commitFile(repositoryDirectory, 'example-builder-extra.md', 'Main line extra: run the example checks.\n');
  writeDataFolderFile(defaultInstructionPathOf('builder'), BUILDER_DEFAULT);
  gitOutputIn(repositoryDirectory, ['checkout', '-q', '-b', 'ticket-012']);
  commitFile(repositoryDirectory, 'example-constitution.md', 'Branch rule: anything goes.\n');
  commitFile(repositoryDirectory, 'example-builder-extra.md', 'Branch extra: skip the checks.\n');
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('the instruction files a launch reads', () => {
  test('a builder\'s first message holds the constitution files then its own, in array order, as the main line holds them', () => {
    const reading = InstructionFiles.readingFor(repositoryDirectory, mainLine, PIPELINE, BUILD_JOB);
    if (reading.verdict !== 'read') throw new Error(`the reading was ${reading.verdict}`);
    const { firstMessage } = RunnerWording.launchTextOf(BUILD_JOB, factsWith(reading.text));
    const parts = [
      'Main line rule: name things fully.',
      'Main line style: one purpose per file.',
      'Build ticket #012 as job J4: Example basket total.',
      'Main line extra: run the example checks.',
    ];
    const positions = parts.map((part) => firstMessage.indexOf(part));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(firstMessage).not.toContain('Branch');
  });

  test('each file read leaves its path and the content hash of the version it was given', () => {
    const reading = InstructionFiles.readingFor(repositoryDirectory, mainLine, PIPELINE, BUILD_JOB);

    expect(reading.verdict === 'read' ? reading.files : []).toEqual([
      { path: 'example-constitution.md', contentHash: contentHashOf('Main line rule: name things fully.\n') },
      { path: 'example-style.md', contentHash: contentHashOf('Main line style: one purpose per file.\n') },
      { path: defaultInstructionPathOf('builder'), contentHash: contentHashOf(BUILDER_DEFAULT) },
      { path: 'example-builder-extra.md', contentHash: contentHashOf('Main line extra: run the example checks.\n') },
    ]);
  });

  test('a named file the main line lacks, even one the branch has, refuses the launch naming it', () => {
    commitFile(repositoryDirectory, 'example-branch-only.md', 'Only on the branch.\n');
    const pipeline: Pipeline = { ...PIPELINE, agents: { builder: ['example-builder-extra.md', 'example-branch-only.md'] } };

    expect(InstructionFiles.readingFor(repositoryDirectory, mainLine, pipeline, BUILD_JOB)).toEqual({ verdict: 'instructions-missing', path: 'example-branch-only.md' });
  });

  test('with no pipeline stored a missing default refuses too, and a path leaving the repository is read as missing', () => {
    const constitutionDefault = `${dirname(defaultInstructionPathOf('builder'))}/constitution.md`;
    expect(InstructionFiles.readingFor(repositoryDirectory, mainLine, null, BUILD_JOB)).toEqual({ verdict: 'instructions-missing', path: constitutionDefault });
    const leaving: Pipeline = { ...PIPELINE, constitution: ['../example-outside.md'] };

    expect(InstructionFiles.readingFor(repositoryDirectory, mainLine, leaving, BUILD_JOB)).toEqual({ verdict: 'instructions-missing', path: '../example-outside.md' });
  });
});
