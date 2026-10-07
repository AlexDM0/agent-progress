/** Each page edition's browser entry, as path segments from the repository root, which the bundler resolves from its own location. */
export const PAGE_ENTRY_POINTS = {
  TRACKER: ['page', 'PageStart.ts'],
  SPEC:    ['page', 'spec', 'SpecPageStart.ts'],
} as const;
