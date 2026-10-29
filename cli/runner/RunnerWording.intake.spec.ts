/**
 * What the runner tells a product owner and puts to User when its intake ends. What matters: the session's first line runs the
 * product-owner skill on User's request, a fresh session taking over a replaced one reads its drafts and the answers in that same first
 * message, the session runs with skills on, the web open and Bash on no domain, and the `ready-drafts` decision lists every draft with
 * its priority and `network` domains, one option per proposed set naming its tickets as `#<id>`, then "None".
 */
import { describe, expect, test } from 'bun:test';

import type { WorkerProfile }  from '../../src/lib/agent-launch/WorkerProfile.ts';
import type { Job }            from '../../src/lib/tracker-model/@types/Job.ts';
import type { JobLaunchFacts } from '../../src/services/runner/DrivePass.ts';
import { IntakeSessions }      from '../../src/services/runner/IntakeSessions.ts';
import { PRODUCT_NAMES }       from '../../src/shared/constants/ProductNames.ts';
import { RunnerWording }       from './RunnerWording.ts';

const SESSION_FOLDER = '/Users/example/development/example-repository/.example-worktrees/sessions/J3';

const PRODUCT_OWNER_JOB = {
  id: 'J3', kind: 'product-owner', role: 'product-owner', ticketIds: [], parentJobId: null, attempt: 1, target: null,
} as unknown as Readonly<Job>;

function launchFactsWith(intake: JobLaunchFacts['intake']): JobLaunchFacts {
  return {
    tickets: [], checksLine: null, earlierSessionReplaced: false, intake, airlock: null, assistant: null
  };
}

const SESSION_PROFILE: WorkerProfile = {
  writableRoots:          [SESSION_FOLDER],
  deniedWritableRoots:    [],
  deniedReadableRoots:    [],
  bashNetworkDomains:     ['registry.example.com'],
  webNetworkDomains:      'none',
  relayDirectory:         '/Users/example/development/example-repository/.example-worktrees/relay/J3',
  allowedCommandPrefixes: [],
  deniedCommandPrefixes:  [],
  askUser:                false,
  skills:                 false,
  subagents:              [],
  attribution:            'none',
  instructionsRoot:       '/Users/example/development/example-repository',
  gitHooksDirectory:      '/Users/example/development/example-repository/.githooks',
  commitSigning:          { kind: 'unsigned' },
  networkDomainGuard:     { allowedDomains: ['registry.example.com'], commandArgv: ['example-program', 'guard'] },
};

describe('the product owner launch', () => {
  test('the first line runs the product-owner skill on the request, and nothing else is in a first intake\'s message', () => {
    const intake = { text: 'Alex Example asks for a basket', drafts: [], carriedAnswers: [] };
    const text = RunnerWording.launchTextOf(PRODUCT_OWNER_JOB, launchFactsWith(intake));

    expect(text.firstMessage).toBe(`/${PRODUCT_NAMES.PRODUCT_OWNER_SKILL} Alex Example asks for a basket`);
    expect(text.roleBrief).toContain('job J3');
  });

  test('a fresh session taking over reads the drafts filed so far and the answers given, below the same first line', () => {
    const drafts = [{ id: '004', title: 'Example basket' }];
    const carriedAnswers = [{ 'Which currency?': 'Euro' }];
    const text = RunnerWording.launchTextOf(PRODUCT_OWNER_JOB, launchFactsWith({ text: 'A basket', drafts, carriedAnswers }));
    const lines = text.firstMessage.split('\n');

    expect(lines[0]).toBe(`/${PRODUCT_NAMES.PRODUCT_OWNER_SKILL} A basket`);
    expect(lines).toContain('- #004 Example basket');
    expect(text.firstMessage).toContain('- Which currency?\n  Answer: Euro');
  });

  // `src/lib/claude-code/ClaudeCodeAdapter.spec.ts` holds this profile's rendering: no disallowed tool, slash commands on.
  test('the session runs with skills on, WebFetch and WebSearch allowed and Bash allowed no domain', () => {
    const profile = IntakeSessions.productOwnerProfileOf(SESSION_PROFILE);

    expect(profile).toMatchObject({
      skills: true, askUser: true, webNetworkDomains: 'any', bashNetworkDomains: [], writableRoots: [SESSION_FOLDER], networkDomainGuard: null
    });
  });
});

describe('the ready-drafts decision', () => {
  test('lists each draft with its priority and network, an option per proposed set naming its tickets, then None', () => {
    const wording = RunnerWording.decisionWordingOf({
      kind:        'ready-drafts',
      ticketIds:   ['004', '005', '006'],
      jobId:       null,
      readyDrafts: {
        drafts: [
          {
            id: '004', title: 'Example basket', priority: 'high', network: ['registry.example.com'], readiable: true
          },
          {
            id: '005', title: 'Example wishlist', priority: 'normal', network: [], readiable: true
          },
          {
            id: '006', title: 'Example sketch', priority: 'low', network: [], readiable: false
          },
        ],
        proposedSets: [['004'], ['004', '005']],
      },
    });
    const [question] = wording.questions;

    expect(question?.header).toBe('ready-drafts');
    expect(question?.options.map((option) => option.label)).toEqual(['Ready #004', 'Ready #004, #005', 'None']);
    expect(wording.context.split('\n')).toEqual([
      '#004 Example basket (high, network registry.example.com)',
      '#005 Example wishlist (normal, no network)',
      '#006 Example sketch (low, no network)',
      '#006 is not readiable: it needs a numbered Acceptance and a Brief.',
    ]);
  });
});
