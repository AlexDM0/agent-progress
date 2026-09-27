/** What the dispatcher's Workflow script is bundled from, relative to `dispatcher/`: `init`, `update` and the specs build the same request from it. */
export const DISPATCHER_SCRIPT_BUILD = {
  ENTRY_FILE_NAME:       'DispatchFromWorkflowGlobals.ts',
  META_MODULE_FILE_NAME: 'DispatchMeta.ts',
  META_EXPORT_NAME:      'DISPATCH_META',
} as const;
