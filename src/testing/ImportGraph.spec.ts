/**
 * `reachablePathsFrom`, the walk the guards share. What matters: it follows imports through each other, keeps the entries, ignores package
 * imports and stops at a cycle; and on the real graph the page entry reaches its modules, which the template guards rely on to find the
 * modules they check.
 */
import { describe, expect, test } from 'bun:test';

import { createImportGraphScanner, reachablePathsFrom, repositoryRootOfThisCheckout } from './ImportGraph.ts';

const SCANNER = createImportGraphScanner(repositoryRootOfThisCheckout());

describe('reachablePathsFrom', () => {
  test('follows imports through each other, keeps the entries, skips packages and stops at a cycle', () => {
    const graph = SCANNER.graphWithPlantedFiles({
      'planted/Entry.ts':       'import { middle } from \'./Middle.ts\';\nimport ts from \'typescript\';\n',
      'planted/Middle.ts':      'export { leaf } from \'./nested/Leaf.ts\';\n',
      'planted/nested/Leaf.ts': 'import type { Entry } from \'../Entry.ts\';\n',
      'planted/Unreached.ts':   'import { middle } from \'./Middle.ts\';\n',
    });

    expect([...reachablePathsFrom(graph, ['planted/Entry.ts'])].sort()).toEqual(['planted/Entry.ts', 'planted/Middle.ts', 'planted/nested/Leaf.ts']);
  });

  test('on the real graph, the tracker page reaches its Kanban markup and its page shell', () => {
    const trackerReach = [...reachablePathsFrom(SCANNER.graph, ['page/PageStart.ts'])];

    expect(trackerReach).toContain('page/kanban/KanbanMarkup.ts');
    expect(trackerReach).toContain('page/shell/PageShell.ts');
  });
});
