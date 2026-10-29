/**
 * The prompts of the two Airlock agents a merge's incident may call for (design section 6.3): `MergeFixPrompt.md` for the merge-gate fixer
 * and `ResolutionReviewPrompt.md` for the resolution reviewer. What matters: each is filled with the ticket and its Airlock facts (the
 * Airlock worktree, `branchTip`, `targetTip`, and the failed gate's tail or the merge commit) with no placeholder left; each says the role
 * cannot ask and reports a malformed ticket or a system blocker as `cannot-resolve` with `reportKind` set and the case named in `notes`
 * (owner answers Q33 and Q40); the fixer files out-of-scope findings by the build prompt's rule (owner answers Q42 and Q44); and each
 * states its own call budget.
 */
import { describe, expect, test } from 'bun:test';

import type { Job }                          from '../../src/lib/tracker-model/@types/Job.ts';
import type { AirlockFacts, JobLaunchFacts } from '../../src/services/runner/DrivePass.ts';
import { DISPATCH_PROTOCOL }                 from '../../src/shared/constants/DispatchProtocol.ts';
import { PRODUCT_NAMES }                     from '../../src/shared/constants/ProductNames.ts';
import { RunnerWording }                     from './RunnerWording.ts';

const AIRLOCK: AirlockFacts = {
  worktree:    '/example-agency/storefront/.example-worktrees/ticket-012',
  branchTip:   '1111111111111111111111111111111111111111',
  targetTip:   '2222222222222222222222222222222222222222',
  mergeCommit: '3333333333333333333333333333333333333333',
  gateTail:    'FAIL basket.spec.ts\nexpected 2, received 3',
};

const FACTS: JobLaunchFacts = {
  tickets:                [{ id: '012', title: 'Example basket total', body: '## Acceptance\nA1. Example basket adds up.\n' }],
  checksLine:             'bun run verify',
  earlierSessionReplaced: false,
  intake:                 null,
  airlock:                AIRLOCK,
  assistant:              null,
};

function messageOf(role: 'merge-fix' | 'resolution-review'): string {
  const job = {
    id: 'J9', kind: 'merge-agent', role, ticketIds: ['012'], parentJobId: 'J8', attempt: 1, target: 'main'
  } as unknown as Readonly<Job>;
  return RunnerWording.launchTextOf(job, FACTS).firstMessage;
}

const PROMPTS = [
  ['merge-fix', AIRLOCK.gateTail, DISPATCH_PROTOCOL.MERGE_FIXER_API_CALL_BUDGET],
  ['resolution-review', AIRLOCK.mergeCommit, DISPATCH_PROTOCOL.RESOLUTION_REVIEWER_API_CALL_BUDGET],
] as const;

describe.each(PROMPTS)('the %s prompt', (role, ownFact, callBudget) => {
  const message = messageOf(role);

  test('is filled with the ticket, the checks line and every Airlock fact, no placeholder left', () => {
    for (const fact of ['#012', 'Example basket total', 'A1. Example basket adds up.', 'bun run verify', AIRLOCK.worktree, AIRLOCK.branchTip, AIRLOCK.targetTip, ownFact]) {
      expect(message).toContain(fact);
    }
    expect(message).not.toMatch(/\{\{\w+\}\}/);
  });

  test('says the role cannot ask, and reports a malformed ticket or a system blocker as cannot-resolve with reportKind and notes', () => {
    expect(message).toContain('## You cannot ask');
    expect(message).toContain('the question tool is disallowed');
    for (const phrase of ['`cannot-resolve`', '`reportKind`', '`malformed-ticket`', '`system-blocker`', '`notes`']) expect(message).toContain(phrase);
  });

  test('states its own call budget', () => {
    expect(message).toContain(`You have ${callBudget} calls`);
  });
});

describe('the merge-gate fixer prompt', () => {
  test('files an out-of-scope finding low with a numbered Acceptance and a Brief, --needs-user only for User\'s decision', () => {
    const message = messageOf('merge-fix');
    expect(message).toContain(`${PRODUCT_NAMES.PROGRAM} ticket add "<title>" --priority low`);
    expect(message).toContain('numbered Acceptance');
    expect(message).toContain('`## Brief`');
    expect(message).toContain('Add `--needs-user` only when User\'s input is needed');
    expect(message).toContain('awaits the orchestrator\'s decision when this ticket is delivered');
  });
});

describe('the resolution reviewer prompt', () => {
  test('parks a resolution whose claims do not hold as merge-resolution-rejected, reportKind null', () => {
    const message = messageOf('resolution-review');
    expect(message).toContain('`cannot-resolve` with `reportKind` `null`');
    expect(message).toContain('`merge-resolution-rejected`');
  });
});
