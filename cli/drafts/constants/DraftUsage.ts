export const DRAFT_USAGE = [
  'agent-progress draft open "<title>" --owner <who> [--request <text> | --request-file <path|->] [--json]',
  'agent-progress draft claim D<n> --owner <who> [--force] [--json]',
  'agent-progress draft release D<n> [--json]',
  'agent-progress draft note D<n> "<text>" [--assumption] [--json]',
  'agent-progress draft ask D<n> "<question>" --context <text> --option <text> --option <text> [--option …] --recommended <letters> [--multiple] [--under Q<k>] [--json]',
  'agent-progress draft answer D<n> Q<k> "<answer>" [--json]',
  'agent-progress draft drop D<n> N<k>|Q<k> [--json]',
  'agent-progress draft close D<n> --tickets <ids> [--json]',
  'agent-progress draft abandon D<n> --reason <text> [--json]',
  'agent-progress draft show D<n> [--json]',
  'agent-progress draft list [--json]',
].join('\n         ');
