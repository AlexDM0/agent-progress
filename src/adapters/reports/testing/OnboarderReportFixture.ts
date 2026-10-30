/** A valid onboarder report for specs, its head commit given, every array starting from the installed defaults. */

const DEFAULT_ARRAYS = {
  builder:      ['.agent-progress-v2/briefs/defaults/builder.md'],
  reviewer:     ['.agent-progress-v2/briefs/defaults/reviewer.md'],
  merger:       ['.agent-progress-v2/briefs/defaults/merger.md'],
  productOwner: ['.agent-progress-v2/briefs/defaults/productOwner.md'],
  onboarder:    ['.agent-progress-v2/briefs/defaults/onboarder.md'],
  assistant:    ['.agent-progress-v2/briefs/defaults/assistant.md'],
};

export function onboarderReportOf(headCommit: string, overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    role:    'onboarder',
    mode:    'setup',
    headCommit,
    prepare: [{ name: 'install', run: 'bun install' }],
    gates:   [{
      name: 'tests', run: 'bun test', definedBy: ['package.json'], network: [], writes: []
    }],
    review:        { name: 'review', model: null, effort: null },
    constitution:  ['.agent-progress-v2/briefs/defaults/constitution.md', 'CLAUDE.md'],
    agents:        DEFAULT_ARRAYS,
    optimisations: [],
    notes:         'Read package.json and the README.',
    ...overrides,
  };
}
