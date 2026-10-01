export const EPIC_USAGE = [
  'agent-progress epic add <key> "<title>" [--body <markdown> | --body-file <path|->] [--at <when>] [--json]',
  'agent-progress epic edit <key> [--title "<title>"] [--append] [--body <markdown> | --body-file <path|->] [--at <when>] [--json]',
  'agent-progress epic list [--json]',
  'agent-progress epic show <key> [--json]',
  'agent-progress epic remove <key> [--at <when>] [--json]',
].join('\n         ');
