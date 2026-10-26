/** The tracker page's Waves tab: its tickets as the shared wave graph's nodes, with the board's slot meter and its Done wording. */

import type { DependencyGraph }                                                 from '../@types/DependencyGraph.ts';
import type { BoardTicket }                                                     from '../@types/PageBoard.ts';
import { LiveStateUtil }                                                        from '../utils/LiveStateUtil.ts';
import { TimeUtil }                                                             from '../utils/TimeUtil.ts';
import type { DurationUnits }                                                   from '../utils/TimeUtil.ts';
import { WaveForecastUtil }                                                     from '../utils/WaveForecastUtil.ts';
import type { DependencyGraphOptions, DependencyNodeChip, DependencyNodeModel } from './WaveGraphMarkup.ts';
import { waveGraphMarkup }                                                      from './WaveGraphMarkup.ts';

function boardHasDependencies(tickets: readonly BoardTicket[]): boolean {
  return tickets.some((ticket) => (ticket.dependsOn ?? []).length > 0);
}

/** Ready only as the Board lists it; a held pending ticket wears the held chip instead, and a low one nothing. */
function chipsOf(ticket: BoardTicket, readyTicketIds: ReadonlySet<string>): DependencyNodeChip[] {
  if (readyTicketIds.has(ticket.id)) {
    return [{ kind: 'ready' }];
  }
  if (ticket.status === 'pending' && ticket.hold !== undefined) {
    return [{ kind: 'held', reason: ticket.hold }];
  }
  if (ticket.status !== 'in-progress' && ticket.status !== 'in-review') {
    return [];
  }
  return [{ kind: 'state', displayState: ticket.displayState }];
}

function dependencyNodeOf(ticket: BoardTicket, readyTicketIds: ReadonlySet<string>): DependencyNodeModel {
  return {
    id:         ticket.id,
    idLabel:    `#${ticket.id}`,
    title:      ticket.title,
    dependsOn:  ticket.dependsOn ?? [],
    tone:       ticket.displayState,
    isInReview: ticket.status === 'in-review',
    isLive:     LiveStateUtil.displayStateIsLive(ticket.displayState),
    chips:      chipsOf(ticket, readyTicketIds),
  };
}

/** Asked for only while the dispatcher runs; the forecast is shown, never decides anything. */
export interface WaveForecastRequest {
  nowEpochMilliseconds: number;
  units:                DurationUnits;
}

/** "ETA 25m–50m": the wave's p50 to p80 finish from now. */
function waveForecastTextOf(graph: DependencyGraph, ticketById: ReadonlyMap<string, BoardTicket>, request: WaveForecastRequest) {
  const forecastById = WaveForecastUtil.ticketFinishForecastsOf([...ticketById.values()], {
    concurrencyLimit:     graph.boardSlots,
    pacePathTicketIds:    graph.pacePathNodeIds,
    nowEpochMilliseconds: request.nowEpochMilliseconds,
  });
  return (waveTicketIds: readonly string[]): string | null => {
    const forecast = WaveForecastUtil.waveFinishForecastOf(waveTicketIds, ticketById, forecastById);
    if (forecast === null) return null;
    const p50Text = TimeUtil.formatDuration(forecast.p50FinishEpochMilliseconds - request.nowEpochMilliseconds, request.units);
    const p80Text = TimeUtil.formatDuration(forecast.p80FinishEpochMilliseconds - request.nowEpochMilliseconds, request.units);
    return p50Text === null || p80Text === null ? null : `ETA ${p50Text}–${p80Text}`;
  };
}

function trackerGraphOptionsOf(ticketById: ReadonlyMap<string, BoardTicket>): DependencyGraphOptions {
  return {
    showsSlots:      true,
    doneCountTextOf: (doneTicketIds) => {
      const deliveredCount = doneTicketIds.filter((ticketId) => ticketById.get(ticketId)?.status === 'delivered').length;
      const reviewedCount  = doneTicketIds.length - deliveredCount;
      return reviewedCount === 0 ? `${deliveredCount} delivered` : `${deliveredCount} delivered · ${reviewedCount} awaiting merge`;
    },
    openAttribute: 'data-open-ticket',
    emptyText:     'No open ticket waits on another.',
  };
}

/** Without a forecast request, as while the dispatcher is not running, no head carries a forecast. */
function dependencyGraphMarkup(
  graph: DependencyGraph,
  ticketById: ReadonlyMap<string, BoardTicket>,
  readyTicketIds: ReadonlySet<string>,
  forecastRequest: WaveForecastRequest | null = null,
): string {
  const nodeById = new Map([...ticketById].map(([ticketId, ticket]) => [ticketId, dependencyNodeOf(ticket, readyTicketIds)] as const));
  const options  = trackerGraphOptionsOf(ticketById);
  return waveGraphMarkup(graph, nodeById, forecastRequest === null ? options : { ...options, waveForecastTextOf: waveForecastTextOf(graph, ticketById, forecastRequest) });
}

export const DependencyMarkup = { boardHasDependencies, dependencyNodeOf, dependencyGraphMarkup } as const;
