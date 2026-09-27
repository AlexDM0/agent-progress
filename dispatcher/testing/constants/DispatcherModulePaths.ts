/** The modules a claim's mutant may rewrite, each the one that holds the decisions it names. */
export const DISPATCHER_MODULE_PATHS = {
  DISPATCH_RUN:               'dispatcher/run/DispatchRun.ts',
  DISPATCHER:                 'dispatcher/Dispatcher.ts',
  AGENT_STARTER:              'dispatcher/run/AgentStarter.ts',
  WORKFLOW_INPUT_UTIL:        'dispatcher/utils/WorkflowInputUtil.ts',
  ROUND_VERDICT_UTIL:         'dispatcher/utils/RoundVerdictUtil.ts',
  AGENT_PROMPT_UTIL:          'dispatcher/utils/AgentPromptUtil.ts',
  DISPATCH_WORDING_UTIL:      'dispatcher/utils/DispatchWordingUtil.ts',
  DISPATCHER_CLAIM_NOTE_UTIL: 'src/shared/utils/DispatcherClaimNoteUtil.ts',
} as const;
