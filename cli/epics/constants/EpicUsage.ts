import { PRODUCT_NAMES } from '../../../src/shared/constants/ProductNames.ts';

export const EPIC_USAGE = [
  'add <key> "<title>" [--body <markdown> | --body-file <path|->] [--at <when>] [--json]',
  'edit <key> [--title "<title>"] [--append] [--body <markdown> | --body-file <path|->] [--at <when>] [--json]',
  'list [--json]',
  'show <key> [--json]',
  'remove <key> [--at <when>] [--json]',
].map((usage) => `${PRODUCT_NAMES.PROGRAM} epic ${usage}`).join('\n         ');
