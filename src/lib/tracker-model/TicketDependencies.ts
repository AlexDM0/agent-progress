/** What a ticket waits on: its dependency list set, added to and removed from, each refused when it names a missing ticket or closes a loop. */
import type { TicketDependenciesChanged } from './@types/BoardChanges.ts';
import type { BoardRecords }              from './BoardRecords.ts';
import { BoardRefusal }                   from './BoardRefusal.ts';
import { TicketDependencyUtil }           from './utils/TicketDependencyUtil.ts';

export class TicketDependencies {
  constructor(private readonly records: BoardRecords) {}

  setTicketDependencies(ticketId: string, dependsOn: readonly string[], at: string): TicketDependenciesChanged {
    const ticket = this.records.requireTicket(ticketId);
    this.refuseAnUnworkableDependencyList(ticketId, dependsOn);
    const previousDependsOn = ticket.frontmatter.dependsOn ?? [];
    if (dependsOn.length === 0) delete ticket.frontmatter.dependsOn;
    else ticket.frontmatter.dependsOn = [...dependsOn];
    this.records.markChanged(ticket);
    const droppedTicketIds = previousDependsOn.filter((dependencyId) => !dependsOn.includes(dependencyId));
    return {
      logged:                    [this.records.logger.log({ kind: 'ticket-dependencies-set', ticketId, fields: { dependsOn } }, at)],
      ticket,
      addedTicketIds:            dependsOn.filter((dependencyId) => !previousDependsOn.includes(dependencyId)),
      droppedTicketIds,
      droppedUnsettledTicketIds: TicketDependencyUtil.unsettledDependenciesOf(droppedTicketIds, this.records.ticketStatusById()),
    };
  }

  /** An id already listed is kept where it stands rather than refused, so adding twice is the same as adding once. */
  addTicketDependencies(ticketId: string, addedTicketIds: readonly string[], at: string): TicketDependenciesChanged {
    const currentDependsOn = this.records.requireTicket(ticketId).frontmatter.dependsOn ?? [];
    const newTicketIds     = addedTicketIds.filter((dependencyId) => !currentDependsOn.includes(dependencyId));
    return this.setTicketDependencies(ticketId, [...currentDependsOn, ...newTicketIds], at);
  }

  removeTicketDependencies(ticketId: string, removedTicketIds: readonly string[], at: string): TicketDependenciesChanged {
    const currentDependsOn = this.records.requireTicket(ticketId).frontmatter.dependsOn ?? [];
    return this.setTicketDependencies(ticketId, currentDependsOn.filter((dependencyId) => !removedTicketIds.includes(dependencyId)), at);
  }

  refuseAnUnworkableDependencyList(ticketId: string, dependsOn: readonly string[]): void {
    const missingTicketIds = dependsOn.filter((dependencyId) => this.records.ticketRecordById(dependencyId) === undefined);
    if (missingTicketIds.length > 0) throw new BoardRefusal({ reason: 'unknown-dependency', missingTicketIds });
    const dependsOnById = new Map(this.records.ticketRecords.map((candidate) => [candidate.frontmatter.id, candidate.frontmatter.dependsOn ?? []]));
    const loopTicketIds = TicketDependencyUtil.dependencyLoopFrom(ticketId, dependsOn, dependsOnById);
    if (loopTicketIds !== null) throw new BoardRefusal({ reason: 'dependency-loop', loopTicketIds });
  }
}
