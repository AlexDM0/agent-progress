/**
 * Preloaded into a spawned binary by `cli/testing/CliProcess.ts` to make it the other program: the product names it is built under are
 * swapped for the other set before any module reads them, so a spec runs both programs' branches before the names are flipped for good.
 */
import { readFileSync } from 'node:fs';

const PRODUCT_NAMES_DECLARATION = /(export const PRODUCT_NAMES: Readonly<ProductNames> = )(SIDE_BY_SIDE_PRODUCT_NAMES|ORIGINAL_PRODUCT_NAMES);/;

function swappedProductNamesSource(source: string, path: string): string {
  if (!PRODUCT_NAMES_DECLARATION.test(source)) throw new Error(`${path} no longer declares PRODUCT_NAMES as one of the two name sets, so it cannot be swapped.`);
  return source.replace(PRODUCT_NAMES_DECLARATION, (_wholeDeclaration, declaration: string, chosenSet: string) =>
    `${declaration}${chosenSet === 'SIDE_BY_SIDE_PRODUCT_NAMES' ? 'ORIGINAL_PRODUCT_NAMES' : 'SIDE_BY_SIDE_PRODUCT_NAMES'};`);
}

Bun.plugin({
  name: 'other-product-names',
  setup(build) {
    build.onLoad({ filter: /[\\/]src[\\/]shared[\\/]constants[\\/]ProductNames\.ts$/ }, ({ path }) => ({
      contents: swappedProductNamesSource(readFileSync(path, 'utf8'), path),
      loader:   'ts',
    }));
  },
});
