/**
 * Answering an onboarder's `pipeline-proposal`: Accept writes every proposed prepare step and gate through the `gate` verbs' Board moves in
 * the answering hold, an empty gate list as `gate none`; Decline, or a proposal the Overseer never stored, changes nothing but the answer.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
} from 'bun:test';
import { onboarderReportOf }                              from '../../adapters/reports/testing/OnboarderReportFixture.ts';
import type { Board }                                     from '../../lib/tracker-model/Board.ts';
import { boardFixture }                                   from '../../testing/BoardFixtures.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { OnboardingProposal, type PipelineProposal }      from '../lifecycle/OnboardingProposal.ts';
import type { TrackerChange }                             from '../tracker/TrackerPipeline.ts';
import { ControlService }                                 from './ControlService.ts';

const AT = '2026-10-28T10:00:00+01:00';
const JOB_ID = 'J4';

const PROPOSAL_OPTIONS = [{ label: 'Accept the prepare steps and gates', description: '' }, { label: 'Decline', description: '' }];

let trackerDirectory = '';

function changeOf(board: Board): TrackerChange {
  // The decision applier reads the Board, the stamp and, for a proposal, the tracker folder the Overseer stored it in.
  return { board, at: AT, workspace: { trackerDirectory } } as unknown as TrackerChange;
}

function proposalWith(gates: PipelineProposal['gates']): PipelineProposal {
  return { ...OnboardingProposal.proposalOf(onboarderReportOf('a'.repeat(40))), gates };
}

function storeProposal(proposal: PipelineProposal): void {
  OnboardingProposal.storeOutcome(trackerDirectory, JOB_ID, {
    verdict:            'proposed',
    proposal,
    runRecord:          { snapshotCommit: 'a'.repeat(40), prepare: { failedSteps: [null, null], output: '' }, gates: [] },
    cachingSuggestions: [],
  });
}

function boardWithOpenProposal(): Board {
  const { board } = boardFixture();
  board.openDecision({
    kind:      'pipeline-proposal',
    ticketIds: [],
    jobId:     JOB_ID,
    askedBy:   'overseer',
    requestId: null,
    questions: [{
      question: 'Accept it?', header: 'pipeline-proposal', multiSelect: false, options: PROPOSAL_OPTIONS
    }],
    context: '',
  }, AT);
  return board;
}

function answer(board: Board, letter: string): string[] {
  const [decision] = board.decisions();
  const { result } = ControlService.apply({ kind: 'decision-answer', decisionId: decision?.id ?? '', answer: { form: 'letters', choices: [letter] } }, changeOf(board));
  return result.logged.map((record) => record.kind);
}

beforeEach(() => {
  trackerDirectory = createScratchDirectory('pipeline-proposal');
});

afterEach(() => {
  removeScratchDirectory(trackerDirectory);
});

describe('a pipeline proposal is written only when User accepts it', () => {
  test('Accept writes the prepare step and every gate, each value kept, in the answering hold', () => {
    storeProposal(proposalWith([
      {
        name: 'lint', run: 'bun run lint', definedBy: ['eslint.config.js'], network: [], writes: []
      },
      {
        name: 'tests', run: 'bun test', definedBy: [], network: ['registry.npmjs.org'], writes: ['~/.cache/example']
      },
    ]));
    const board = boardWithOpenProposal();

    expect(answer(board, 'a')).toEqual(['decision-answered', 'pipeline-prepare-step-set', 'pipeline-gate-added', 'pipeline-gate-added']);
    expect(board.pipeline()).toEqual({
      prepare: [{ name: 'install', run: 'bun install' }],
      gates:   [
        { name: 'lint', run: 'bun run lint', definedBy: ['eslint.config.js'] },
        {
          name: 'tests', run: 'bun test', network: ['registry.npmjs.org'], writes: ['~/.cache/example']
        },
      ],
    });
    expect(board.pipelineChanged()).toBe(true);
  });

  test('Accept of a proposal with no gates stores no gates on purpose', () => {
    storeProposal(proposalWith([]));
    const board = boardWithOpenProposal();

    expect(answer(board, 'a')).toContain('pipeline-gates-none');
    expect(board.pipeline()?.gates).toEqual([]);
  });

  test('Decline changes nothing but the answer', () => {
    storeProposal(proposalWith([{
      name: 'tests', run: 'bun test', definedBy: [], network: [], writes: []
    }]));
    const board = boardWithOpenProposal();

    expect(answer(board, 'b')).toEqual(['decision-answered']);
    expect(board.pipeline()).toBeNull();
  });

  test('Accept with no stored proposal writes nothing', () => {
    const board = boardWithOpenProposal();

    expect(answer(board, 'a')).toEqual(['decision-answered']);
    expect(board.pipeline()).toBeNull();
  });
});
