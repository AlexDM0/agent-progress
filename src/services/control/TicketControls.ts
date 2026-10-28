/** The ticket kinds of the control contract, each applied to the Board a `writeTracker` hold carries. */
import { readFileSync } from 'node:fs';

import { TicketAcceptanceUtil }               from '../../adapters/tickets/utils/TicketAcceptanceUtil.ts';
import type { ControlCommandOf as CommandOf } from '../../shared/@types/ControlCommand.ts';
import { filledTemplateOf }                   from '../../shared/FilledTemplate.ts';
import { resourceFilePathOf }                 from '../../shared/ResourceFilePath.ts';
import { createTicket }                       from '../tracker/TicketStore.ts';
import type { TrackerChange }                 from '../tracker/TrackerPipeline.ts';
import { ticketIdOfReference }                from './ControlTicketLookup.ts';

const TICKET_BODY_TEMPLATE_PATH = ['templates', 'TicketBody.md'];

function bodyForNewTicket(bodyText: string | null, ticketId: string, title: string): string {
  if (bodyText !== null && bodyText.trim() !== '') return bodyText;
  return filledTemplateOf(readFileSync(resourceFilePathOf(...TICKET_BODY_TEMPLATE_PATH), 'utf8'), { id: ticketId, title });
}

function addTicket(command: CommandOf<'ticket-add'>, change: TrackerChange) {
  const ticket = createTicket(change.workspace, {
    title:   command.title,
    type:    command.type,
    ...(command.priority === undefined ? {} : { priority: command.priority }),
    ...(command.group === undefined ? {} : { group: command.group }),
    bodyFor: (ticketId) => bodyForNewTicket(command.bodyText, ticketId, command.title),
    at:      change.at,
  });
  if (command.dependsOn.length > 0) ticket.frontmatter.dependsOn = [...command.dependsOn];
  if (command.epics.length > 0) ticket.frontmatter.epics = [...command.epics];
  if (command.introducedBy !== null) ticket.frontmatter.introducedBy = command.introducedBy;
  if (command.foundInReview !== null) ticket.frontmatter.foundInReview = command.foundInReview;
  if (command.size !== undefined) ticket.frontmatter.size = command.size;
  if (command.model !== undefined) ticket.frontmatter.model = command.model;
  if (command.effort !== undefined) ticket.frontmatter.effort = command.effort;
  const filing = change.board.fileTicket(ticket, change.at);
  if (command.network.length === 0) return filing;
  const networkSet = change.board.setTicketNetwork(ticket.frontmatter.id, command.network, change.at);
  return { ...filing, logged: [...filing.logged, ...networkSet.logged] };
}

function editTicket(command: CommandOf<'ticket-edit'>, change: TrackerChange) {
  return change.board.editTicket(ticketIdOfReference(change, command.ticketReference), {
    ...(command.title === undefined ? {} : { title: command.title }),
    ...(command.bodyText === null ? {} : { body: { text: command.bodyText, appends: command.appendsBody } }),
    allowsPastPending: command.allowsPastPending,
  }, change.at);
}

function setDependencies(command: CommandOf<'ticket-depends'>, change: TrackerChange) {
  const ticketId = ticketIdOfReference(change, command.ticketReference);
  if (command.edit === 'add') return change.board.addTicketDependencies(ticketId, command.ticketIds, change.at);
  if (command.edit === 'remove') return change.board.removeTicketDependencies(ticketId, command.ticketIds, change.at);
  return change.board.setTicketDependencies(ticketId, command.ticketIds, change.at);
}

function setEpics(command: CommandOf<'ticket-epic'>, change: TrackerChange) {
  const ticketId = ticketIdOfReference(change, command.ticketReference);
  if (command.edit === 'add') return change.board.addTicketEpics(ticketId, command.epicKeys, change.at);
  if (command.edit === 'remove') return change.board.removeTicketEpics(ticketId, command.epicKeys, change.at);
  return change.board.setTicketEpics(ticketId, command.epicKeys, change.at);
}

function abandonTicket(command: CommandOf<'ticket-abandon'>, change: TrackerChange) {
  return change.board.moveTicket(ticketIdOfReference(change, command.ticketReference), 'abandoned', {
    checksLegality: true,
    ...(command.branch === undefined ? {} : { branch: command.branch }),
    ...(command.commit === undefined ? {} : { commit: command.commit }),
    ...(command.reason === undefined ? {} : { reason: command.reason }),
    ...(command.tokens === undefined ? {} : { tokens: command.tokens }),
  }, change.at);
}

function readyTickets(command: CommandOf<'ticket-ready'>, change: TrackerChange) {
  const ticketIds = command.ticketReferences.map((reference) => ticketIdOfReference(change, reference));
  return change.board.readyDraftTickets(ticketIds, TicketAcceptanceUtil.readinessGapsOf, change.at);
}

export const TICKET_CONTROLS = {
  'ticket-add':      addTicket,
  'ticket-edit':     editTicket,
  'ticket-depends':  setDependencies,
  'ticket-priority': (command: CommandOf<'ticket-priority'>, change: TrackerChange) => change.board.setTicketPriority(
    ticketIdOfReference(change, command.ticketReference),
    command.priority,
    change.at,
  ),
  'ticket-epic':    setEpics,
  'ticket-abandon': abandonTicket,
  'ticket-ready':   readyTickets,
  'ticket-network': (command: CommandOf<'ticket-network'>, change: TrackerChange) => change.board.setTicketNetwork(
    ticketIdOfReference(change, command.ticketReference),
    command.domains,
    change.at,
  ),
  'ticket-hold': (command: CommandOf<'ticket-hold'>, change: TrackerChange) => change.board.holdTicket(
    ticketIdOfReference(change, command.ticketReference),
    command.reason,
    change.at,
  ),
  'ticket-unhold': (command: CommandOf<'ticket-unhold'>, change: TrackerChange) => change.board.unholdTicket(
    ticketIdOfReference(change, command.ticketReference),
    change.at,
  ),
} as const;
