import type { WorkflowMeta }  from './@types/WorkflowRuntime.ts';
import { DISPATCH_ARGUMENTS } from './constants/DispatchArguments.ts';
import { DISPATCH_POLICY }    from './constants/DispatchPolicy.ts';

export const DISPATCH_META: WorkflowMeta = {
  name:        'agent-progress-dispatch',
  description: 'Run the agent-progress board: a builder per ready ticket and a clean reviewer per built one, never past the board limit',
  whenToUse:   `When the orchestrator hands the board, or with ticketIds one ticket, to the dispatcher. args: ${DISPATCH_ARGUMENTS.SUMMARY_TEXT}`,
  phases:      [
    { title: 'Survey', detail: 'read the concurrency block, the ready tickets and the reviews waiting', model: DISPATCH_POLICY.SURVEY_AGENT.model },
    { title: 'Build', detail: 'one builder per ready ticket, in the ticket worktree, at the ticket\'s model and effort' },
    { title: 'Review', detail: 'a clean reviewer per built ticket, round by round, at the ticket\'s model and effort' },
    { title: 'Park', detail: 'pause the row of a ticket the run stops working on, and close its review bar', model: DISPATCH_POLICY.PARKING_AGENT.model },
  ],
};
