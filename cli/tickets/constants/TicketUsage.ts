export const TICKET_USAGE = [
  'agent-progress ticket add "<title>" [--type bug|change|feature] [--priority low|normal|high] [--model <m>] [--effort <e>] [--group <name>] '
  + '[--depends-on <ids>] [--body <markdown> | --body-file <path|->] [--at <when>]',
  'agent-progress ticket list [--status <s>] [--priority <p>] [--json]',
  'agent-progress ticket show <id> [--json]',
  'agent-progress ticket start|finish|approve|deliver|abandon|reopen <id> [--branch <b>] [--commit <sha>] [--reason <text>] [--tokens <n>] [--at <when>]',
  'agent-progress ticket finish|rereview <id> --start-review [--owner <who>] [--note <text>] [--at <when>]',
  'agent-progress ticket claim <id> [<id>...] [--owner <who>] [--note <text>] [--at <when>]',
  'agent-progress ticket rereview <id> [--at <when>]',
  'agent-progress ticket status <id> <status> [...same options]',
  'agent-progress ticket link <ticketId> <taskId> [--force]',
  'agent-progress ticket depends <id> [<id>...] | --add <ids> | --remove <ids> [--json]',
  'agent-progress ticket priority <id> low|normal|high [--at <when>]',
  'agent-progress ticket agent <id> [--model <m>] [--effort <e>] [--at <when>]',
  'agent-progress ticket hold <id> [--reason <text>] [--at <when>]',
  'agent-progress ticket unhold <id> [--at <when>]',
].join('\n         ');
