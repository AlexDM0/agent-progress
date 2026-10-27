import { PRODUCT_NAMES } from '../../../src/shared/constants/ProductNames.ts';

export const TICKET_USAGE = [
  'add "<title>" --type ticket|bug|research [--priority low|normal|high] [--size XS|S|M|L|XL|XXL] [--model <m>] [--effort <e>] [--group <name>] '
  + '[--depends-on <ids>] [--epic <keys>] [--introduced-by <id>] [--found-in-review <id>] [--body <markdown> | --body-file <path|->] [--at <when>]',
  'list [--status <s>] [--priority <p>] [--json]',
  'show <id> [--json]',
  'edit <id> [--title "<title>"] [--append] [--body <markdown> | --body-file <path|->] [--force] [--at <when>] [--json]',
  'start|finish|approve|deliver|abandon|reopen <id> [--branch <b>] [--commit <sha>] [--reason <text>] [--tokens <n>] [--at <when>]',
  'finish|rereview <id> --start-review [--owner <who>] [--note <text>] [--at <when>]',
  'claim <id> [<id>...] [--owner <who>] [--note <text>] [--after <id>] [--at <when>]',
  'rereview <id> [--at <when>]',
  'status <id> <status> [...same options]',
  'link <ticketId> <taskId> [--force]',
  'depends <id> [<id>...] | --add <ids> | --remove <ids> [--json]',
  'epic <id> [<key>...] | --add <keys> | --remove <keys> [--at <when>] [--json]',
  'introduced-by <id> [<cause id>] [--at <when>] [--json]',
  'priority <id> low|normal|high [--at <when>]',
  'size <id> XS|S|M|L|XL|XXL [--at <when>]',
  'agent <id> [--model <m>] [--effort <e>] [--at <when>]',
  'hold <id> [--reason <text>] [--at <when>]',
  'unhold <id> [--at <when>]',
  'release-of <id> [--clear] [--at <when>]',
].map((usage) => `${PRODUCT_NAMES.PROGRAM} ticket ${usage}`).join('\n         ');
