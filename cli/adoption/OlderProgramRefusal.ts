import { existsSync } from 'node:fs';
import { join }       from 'node:path';

import { OperationRefusal }                                         from '../../src/shared/OperationRefusal.ts';
import { ORIGINAL_PRODUCT_NAMES, PRODUCT_NAMES, type ProductNames } from '../../src/shared/constants/ProductNames.ts';

/**
 * Checked by `init` and `update` before the first write: a build named beside the released program installs only where the released one
 * keeps no data folder, so it never writes into a repository the released program tracks. The released program itself is never refused.
 */
export function refuseBesideAnOlderProgram(rootDirectory: string, productNames: Readonly<ProductNames> = PRODUCT_NAMES): void {
  if (productNames.PROGRAM === ORIGINAL_PRODUCT_NAMES.PROGRAM) return;
  const olderDataFolderPath = join(rootDirectory, ORIGINAL_PRODUCT_NAMES.DATA_FOLDER);
  if (!existsSync(olderDataFolderPath)) return;
  throw new OperationRefusal('refused', {
    kind:         'older-program-present',
    rootDirectory,
    olderDataFolderPath,
    program:      productNames.PROGRAM,
    olderProgram: ORIGINAL_PRODUCT_NAMES.PROGRAM,
  });
}
