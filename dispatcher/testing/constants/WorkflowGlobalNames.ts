/** The globals the Workflow tool hands a script, which a script's own top-level binding must not shadow. */
export const WORKFLOW_GLOBAL_NAMES = ['agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow'] as const;
