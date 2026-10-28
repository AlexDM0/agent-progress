import type { JobMoveTarget, JobState } from '../@types/Job.ts';

/**
 * Read as "to reach the key, the job has to be in one of these". Launching is reached only by a launch, and every state may end; a move
 * into `running` from a state with no process, `interrupted` or `awaiting-answer`, is a resume and spawns the next host instance.
 */
export const LEGAL_SOURCE_STATES_FOR_JOB_MOVE: Readonly<Record<JobMoveTarget, readonly JobState[]>> = {
  'launching':          [],
  'preparing':          ['launching'],
  'running':            ['launching', 'preparing', 'waiting-for-answer', 'interrupted', 'awaiting-answer'],
  'waiting-for-answer': ['running'],
  'interrupted':        ['preparing', 'running', 'waiting-for-answer', 'stopping'],
  // From `gating`: a review whose gate passed waits there, with no process, for User's answer to its waiver proposals.
  'awaiting-answer':    ['interrupted', 'gating'],
  'verifying':          ['running'],
  'gating':             ['verifying', 'merging'],
  'merging':            ['launching'],
  'landing':            ['gating'],
  'stopping':           ['launching', 'preparing', 'running', 'waiting-for-answer', 'interrupted', 'awaiting-answer', 'verifying', 'gating', 'merging', 'landing'],
  'ended':              [
    'launching',
    'preparing',
    'running',
    'waiting-for-answer',
    'interrupted',
    'awaiting-answer',
    'verifying',
    'gating',
    'merging',
    'landing',
    'stopping',
  ],
};

/** The states with no process, from which a move into `running` is a resume. */
export const PROCESSLESS_JOB_STATES = ['interrupted', 'awaiting-answer'] as const satisfies readonly JobState[];
