/**
 * `hook bash-domains --allow <domains>`, the `PreToolUse` guard design section 4.4 renders for a role with a `network` line: auto mode's
 * classifier may grant a Bash call's `allowed_domains`, or a WebFetch, outside the ticket's domains, and this denies it. It exits 0 whatever
 * happens and answers deny on any failure, since a hook that errors would let the call through.
 */
import { refusalIsOperationRefusal } from '../../src/shared/OperationRefusal.ts';
import { PRODUCT_NAMES }             from '../../src/shared/constants/ProductNames.ts';
import type { CommandContext }       from '../CommandContext.ts';
import type { ArgumentParser }       from '../arguments/ArgumentParser.ts';

const ALLOW_OPTION_NAME = 'allow';

const USAGE = `${PRODUCT_NAMES.PROGRAM} hook bash-domains --allow <domain>,<domain>…  (the PreToolUse hook JSON arrives on standard input)`;
const WILDCARD_PREFIX = '*.';

type Verdict = { kind: 'pass' } | { kind: 'deny'; reason: string };

function normalisedDomainOf(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, '');
}

function domainsOfList(listText: string): string[] {
  return listText.split(/[\s,]+/).map(normalisedDomainOf).filter((domain) => domain.length > 0);
}

/** An entry `*.example.com` admits every subdomain of example.com, never example.com itself; any other entry admits exactly itself. */
function domainIsAllowed(domain: string, allowedDomains: readonly string[]): boolean {
  return allowedDomains.some((allowed) => allowed === domain
    || (allowed.startsWith(WILDCARD_PREFIX) && !domain.startsWith(WILDCARD_PREFIX) && domain.endsWith(allowed.slice(1))));
}

function requestedBashDomainsOf(toolInput: Record<string, unknown>): string[] | null {
  const requested = toolInput['allowed_domains'];
  if (requested === undefined || requested === null) return [];
  if (typeof requested === 'string') return domainsOfList(requested);
  if (Array.isArray(requested) && requested.every((domain) => typeof domain === 'string')) return requested.map(normalisedDomainOf);
  return null;
}

function webFetchHostOf(toolInput: Record<string, unknown>): string | null {
  const { url } = toolInput;
  if (typeof url !== 'string') return null;
  try {
    const host = normalisedDomainOf(new URL(url).hostname);
    return host.length === 0 ? null : host;
  } catch {
    return null;
  }
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function verdictOf(hookInputText: string, allowedDomains: readonly string[]): Verdict {
  const hookInput = recordOf(JSON.parse(hookInputText));
  if (hookInput === null) return { kind: 'deny', reason: 'the hook input is not a JSON object' };
  const toolName = hookInput['tool_name'];
  const toolInput = recordOf(hookInput['tool_input']) ?? {};
  const allowedText = allowedDomains.length === 0 ? 'no domain' : allowedDomains.join(', ');
  if (toolName === 'Bash') {
    const requested = requestedBashDomainsOf(toolInput);
    if (requested === null) return { kind: 'deny', reason: 'its allowed_domains is not a list of domains' };
    const outside = requested.filter((domain) => !domainIsAllowed(domain, allowedDomains));
    return outside.length === 0 ? { kind: 'pass' } : { kind: 'deny', reason: `it asks for ${outside.join(', ')}, and this ticket's network allows ${allowedText}` };
  }
  if (toolName === 'WebFetch') {
    const host = webFetchHostOf(toolInput);
    if (host === null) return { kind: 'deny', reason: 'its url names no host' };
    return domainIsAllowed(host, allowedDomains) ? { kind: 'pass' } : { kind: 'deny', reason: `it fetches ${host}, and this ticket's network allows ${allowedText}` };
  }
  return { kind: 'pass' };
}

function denialDocumentOf(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName:            'PreToolUse',
      permissionDecision:       'deny',
      permissionDecisionReason: `Denied by the ticket's network line: ${reason}.`,
    },
  });
}

/** A pass prints nothing, so the call goes on to the session's own permission rules; it never grants anything. */
export async function guardTheNetworkDomains(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  try {
    commandArguments.rejectUnknownOptions([ALLOW_OPTION_NAME], USAGE);
  } catch (refusal) {
    if (!refusalIsOperationRefusal(refusal)) throw refusal;
    context.standardOutput(denialDocumentOf('the guard was given an option it does not know'));
    return;
  }
  let verdict: Verdict;
  try {
    const allowList = commandArguments.option(ALLOW_OPTION_NAME);
    verdict = verdictOf(await context.readStandardInput(), typeof allowList === 'string' ? domainsOfList(allowList) : []);
  } catch (failure) {
    verdict = { kind: 'deny', reason: `the guard could not read its call (${failure instanceof Error ? failure.message : String(failure)})` };
  }
  if (verdict.kind === 'deny') context.standardOutput(denialDocumentOf(verdict.reason));
}
