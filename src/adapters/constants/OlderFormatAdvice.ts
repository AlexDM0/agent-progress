import { PRODUCT_NAMES } from '../../shared/constants/ProductNames.ts';

/** Appended to the reason a stored file is refused for a version or a word an earlier release wrote and this one no longer reads. */
export const OLDER_FORMAT_ADVICE = `if an earlier ${PRODUCT_NAMES.PROGRAM} wrote it, run \`${PRODUCT_NAMES.PROGRAM} update\` with a release that still reads it, `
  + 'then use this one';
