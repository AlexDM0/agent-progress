/** A ticket's group worded as where it lands: the group branch its bundle shares and the ticket whose release lets it into the main line. */

import { HtmlEscapeUtil }        from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import type { PageTicket }       from '../../src/shared/@types/PagePayload.ts';
import { MarkupUtil }            from './MarkupUtil.ts';
import type { TicketLinkTarget } from './WorkItemMarkupUtil.ts';
import { WorkItemMarkupUtil }    from './WorkItemMarkupUtil.ts';

/** `docs/cli.md`'s name for the branch a group's bundle is built on. */
const GROUP_BRANCH_PREFIX = 'group-';

const BRANCH_ICON_MARKUP = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="4" cy="3.5" r="1.8" fill="none" stroke="currentColor" stroke-width="1.4"/>'
  + '<circle cx="4" cy="12.5" r="1.8" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="5.5" r="1.8" fill="none" stroke="currentColor" stroke-width="1.4"/>'
  + '<path d="M4 5.3v5.4M12 7.3c0 2.5-3 2.7-6.6 4.2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';

interface Integration {
  group:           string;
  branch:          string;
  releaseTicketId: string | null;
  /** The group's other tickets, in the order the tickets island lists them. */
  otherTicketIds:  string[];
}

function integrationOf(ticket: PageTicket, allTickets: readonly PageTicket[]): Integration | null {
  const { group } = ticket;
  if (group === undefined || group === '') {
    return null;
  }
  const members = allTickets.filter((candidate) => candidate.group === group);
  return {
    group,
    branch:          `${GROUP_BRANCH_PREFIX}${group}`,
    releaseTicketId: members.find((candidate) => candidate.releasesGroup === true)?.id ?? null,
    otherTicketIds:  members.filter((candidate) => candidate.id !== ticket.id).map((candidate) => candidate.id),
  };
}

function plainIntegrationText(ticket: PageTicket, integration: Integration): string {
  if (integration.releaseTicketId === ticket.id) {
    return `Releases ${integration.branch} with ${integration.otherTicketIds.map((ticketId) => `#${ticketId}`).join(', ')}`;
  }
  return `Lands together on ${integration.branch}${integration.releaseTicketId === null ? ', no release ticket yet' : `, released with #${integration.releaseTicketId}`}`;
}

/** The detail panel's integration value, or '' for a ticket in no group. */
function integrationFactValueMarkup(ticket: PageTicket, allTickets: readonly PageTicket[], linkTarget: TicketLinkTarget): string {
  const integration = integrationOf(ticket, allTickets);
  if (integration === null) {
    return '';
  }
  const branch = `<span class="ap-integration-branch">${HtmlEscapeUtil.escapeHtml(integration.branch)}</span>`;
  if (integration.releaseTicketId === ticket.id) {
    return `<span class="ap-integration">releases ${branch} with ${WorkItemMarkupUtil.ticketLinksMarkup(integration.otherTicketIds, linkTarget)}</span>`;
  }
  const release = integration.releaseTicketId === null
    ? ', no release ticket yet'
    : `, released with ${WorkItemMarkupUtil.ticketLinksMarkup([integration.releaseTicketId], linkTarget)}`;
  return `<span class="ap-integration">lands together on ${branch}${release}</span>`;
}

/** The small branch mark a grouped ticket's title carries in the Tickets table, or '' for a ticket in no group. */
function integrationMarkMarkup(ticket: PageTicket, allTickets: readonly PageTicket[], groupMarkup: string): string {
  const integration = integrationOf(ticket, allTickets);
  if (integration === null) {
    return '';
  }
  return `<span class="ap-integration-mark" ${MarkupUtil.attribute('title', plainIntegrationText(ticket, integration))}>${BRANCH_ICON_MARKUP}${groupMarkup}</span>`;
}

export const IntegrationMarkupUtil = { integrationFactValueMarkup, integrationMarkMarkup } as const;
