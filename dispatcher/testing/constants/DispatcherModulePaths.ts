/** The modules a claim's mutant may rewrite, each the one that holds the decisions it names. */
export const DISPATCHER_MODULE_PATHS = {
  DISPATCH_RUN:               'dispatcher/run/DispatchRun.ts',
  GROUP_DISPATCH_RUN:         'dispatcher/run/GroupDispatchRun.ts',
  GROUP_AGENT_PROMPT_UTIL:    'dispatcher/run/utils/GroupAgentPromptUtil.ts',
  DISPATCHER:                 'dispatcher/Dispatcher.ts',
  AGENT_STARTER:              'dispatcher/run/AgentStarter.ts',
  WORKFLOW_INPUT_UTIL:        'dispatcher/utils/WorkflowInputUtil.ts',
  ROUND_VERDICT_UTIL:         'dispatcher/run/utils/RoundVerdictUtil.ts',
  AGENT_PROMPT_UTIL:          'dispatcher/run/utils/AgentPromptUtil.ts',
  DISPATCH_WORDING_UTIL:      'dispatcher/utils/DispatchWordingUtil.ts',
  DISPATCHER_CLAIM_NOTE_UTIL: 'src/shared/utils/DispatcherClaimNoteUtil.ts',
} as const;
