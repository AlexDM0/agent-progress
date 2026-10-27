import { PRODUCT_NAMES } from '../../../src/shared/constants/ProductNames.ts';

export const DRAFT_USAGE = [
  'open "<title>" --owner <who> [--request <text> | --request-file <path|->] [--json]',
  'claim D<n> --owner <who> [--force] [--json]',
  'release D<n> [--json]',
  'note D<n> "<text>" [--assumption] [--json]',
  'ask D<n> "<question>" --context <text> --option <text> --option <text> [--option …] --recommended <letters> [--multiple] [--under Q<k>] [--json]',
  'answer D<n> Q<k> "<answer>" [--json]',
  'drop D<n> N<k>|Q<k> [--json]',
  'close D<n> --tickets <ids> [--json]',
  'abandon D<n> --reason <text> [--json]',
  'show D<n> [--json]',
  'list [--json]',
].map((usage) => `${PRODUCT_NAMES.PROGRAM} draft ${usage}`).join('\n         ');
