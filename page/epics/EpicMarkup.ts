/**
 * Every epic mark the page draws, shaped by the epic markup of `resources/template.html`: the chips, the roll-up's bar, legend and
 * facts, an epic's ticket list, its detail, the Epics tab's cards, the Tickets table's group rows and the epic filter chips. Every value
 * passes `escapeHtml` once, except an epic's `descriptionHtml`, already escaped by `src/services/render/MarkdownRenderer.ts`.
 */

import { HtmlEscapeUtil }              from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import { TokenCountUtil }              from '../../src/lib/token-count/TokenCountUtil.ts';
import type { DependencyGraph }        from '../@types/DependencyGraph.ts';
import type { GroupMarkupFormat }      from '../@types/GroupMarks.ts';
import type { BoardEpic, BoardTicket } from '../@types/PageBoard.ts';
import { filterChipMarkup }            from '../chips/FilterChipMarkup.ts';
import { DetailMarkupUtil }            from '../detail-dialog/utils/DetailMarkupUtil.ts';
import { MarkupUtil }                  from '../utils/MarkupUtil.ts';
import { EpicDependencyMarkup }        from './EpicDependencyMarkup.ts';
import { EpicGroupMarks }              from './EpicGroupMarks.ts';
import { EPIC_MARK_VOCABULARY }        from './EpicMarkVocabulary.ts';
import { GroupMarkup }                 from './GroupMarkup.ts';

/** The first paragraph of a rendered description, which the Epics tab's card shows as its summary. */
const FIRST_PARAGRAPH_PATTERN = /<p>([\s\S]*?)<\/p>/;

export type EpicMarkupFormat = GroupMarkupFormat;

const { doneTextOf, epicsInShownOrder, openTicketCountOf } = EpicGroupMarks;

function slotAttribute(epic: BoardEpic): string {
  return MarkupUtil.attribute('data-epic-slot', String(epic.slot));
}

/** Up to `limit` chips, then a "+N" naming the rest on hover. */
function epicChipsMarkup(epics: readonly BoardEpic[], limit = Number.POSITIVE_INFINITY): string {
  return GroupMarkup.groupChipsMarkup(epics, EPIC_MARK_VOCABULARY, limit);
}

function epicProgressMarkup(epic: BoardEpic): string {
  return GroupMarkup.rollupBarMarkup(EpicGroupMarks.epicRollupOf(epic));
}

function epicLegendMarkup(epic: BoardEpic): string {
  return GroupMarkup.rollupLegendMarkup(EpicGroupMarks.epicRollupOf(epic));
}

function plainFactMarkup(label: string, value: string): string {
  return DetailMarkupUtil.factMarkup(label, `<span>${HtmlEscapeUtil.escapeHtml(value)}</span>`);
}

function epicRollupFactsMarkup(epic: BoardEpic, format: EpicMarkupFormat): string {
  return GroupMarkup.factsLineMarkup(EpicGroupMarks.epicFactsOf(epic, format));
}

function otherEpicSquaresMarkup(epics: readonly BoardEpic[]): string {
  return GroupMarkup.otherGroupSquaresMarkup(epics, '+');
}

/** Newest first; each line opens its ticket's own detail. */
function epicTicketListMarkup(epic: BoardEpic, ticketById: ReadonlyMap<string, BoardTicket>): string {
  return GroupMarkup.groupItemListMarkup(EpicGroupMarks.epicItemRowsOf(epic, ticketById), EPIC_MARK_VOCABULARY);
}

function settledTextOf(epic: BoardEpic): string {
  if (epic.ticketIds.length === 0) {
    return 'no tickets';
  }
  const openCount = openTicketCountOf(epic);
  return openCount === 0 ? 'all settled' : `${openCount} open`;
}

function epicDetailMarkup(epic: BoardEpic, ticketById: ReadonlyMap<string, BoardTicket>, format: EpicMarkupFormat): string {
  return GroupMarkup.groupDetailMarkup({
    slot:      epic.slot,
    title:     epic.title,
    typeTags:  ['epic', settledTextOf(epic)],
    bodyParts: [
      `<div class="ap-ticket-meta">${plainFactMarkup('key', epic.key)}${plainFactMarkup('tickets', String(epic.ticketIds.length))}</div>`,
      DetailMarkupUtil.sectionMarkup('Progress', `${epicProgressMarkup(epic)}${epicLegendMarkup(epic)}${epicRollupFactsMarkup(epic, format)}`),
      epic.descriptionHtml === '' ? '' : DetailMarkupUtil.sectionMarkup('Description', `<div class="ap-ticket-body md">${epic.descriptionHtml}</div>`),
      DetailMarkupUtil.sectionMarkup('Tickets', epicTicketListMarkup(epic, ticketById)),
    ],
  });
}

function epicTitleButtonMarkup(epic: BoardEpic): string {
  return GroupMarkup.groupTitleButtonMarkup(epic, EPIC_MARK_VOCABULARY);
}

function epicCardMarkup(epic: BoardEpic, ticketById: ReadonlyMap<string, BoardTicket>, graph: DependencyGraph, format: EpicMarkupFormat): string {
  const summary = FIRST_PARAGRAPH_PATTERN.exec(epic.descriptionHtml)?.[1] ?? '';
  return GroupMarkup.groupCardMarkup({
    slot:      epic.slot,
    ariaLabel: epic.title,
    head:      {
      titleMarkup:   epicTitleButtonMarkup(epic),
      keyText:       epic.key,
      doneText:      openTicketCountOf(epic) === 0 ? settledTextOf(epic) : doneTextOf(epic),
      doneTitleText: null,
    },
    bodyParts: [
      summary === '' ? '' : `<p class="ap-epic-summary">${summary}</p>`,
      `<div>${epicProgressMarkup(epic)}${epicLegendMarkup(epic)}</div>`,
      epicRollupFactsMarkup(epic, format),
      EpicDependencyMarkup.epicDependencyRowsMarkup(epic, graph, ticketById),
      epicTicketListMarkup(epic, ticketById),
    ],
  });
}

function epicCardsMarkup(
  epics: readonly BoardEpic[],
  ticketById: ReadonlyMap<string, BoardTicket>,
  graph: DependencyGraph,
  format: EpicMarkupFormat
): string {
  return epicsInShownOrder(epics).map((epic) => epicCardMarkup(epic, ticketById, graph, format)).join('');
}

/** The Tickets table's head row of one epic's tickets, or of the tickets in none when `epic` is null. */
function epicGroupRowMarkup(epic: BoardEpic | null, columnCount: number, format: EpicMarkupFormat): string {
  if (epic === null) {
    return GroupMarkup.groupRowMarkup(null, columnCount, '<span class="ap-epic-title">No epic</span>');
  }
  return GroupMarkup.groupRowMarkup(epic.slot, columnCount, `${epicTitleButtonMarkup(epic)}${epicProgressMarkup(epic)}`
    + `<span class="ap-card-note">${HtmlEscapeUtil.escapeHtml(doneTextOf(epic))}</span>${epicRollupFactsMarkup(epic, format)}`);
}

/** One chip per epic in shown order, then the no-epic chip; the counts and pressed states are the controller's to set. */
function epicFilterChipsMarkup(epics: readonly BoardEpic[]): string {
  const { filterChipAttribute, noGroupChip } = EPIC_MARK_VOCABULARY;
  const chips = epicsInShownOrder(epics).map((epic) => filterChipMarkup(filterChipAttribute, { value: epic.key, label: epic.title, slot: epic.slot }));
  if (noGroupChip !== null) {
    chips.push(filterChipMarkup(filterChipAttribute, { value: noGroupChip.key, label: noGroupChip.label }));
  }
  return chips.join('');
}

/** The Kanban strip's roll-up of one pressed epic. */
function epicStripRollupMarkup(epic: BoardEpic): string {
  const opener = MarkupUtil.attribute(EPIC_MARK_VOCABULARY.titleOpenerAttribute, epic.key);
  return `<div class="ap-epic-strip-rollup" ${slotAttribute(epic)}>${epicProgressMarkup(epic)}`
    + `<span>${HtmlEscapeUtil.escapeHtml(`${doneTextOf(epic)} · ${TokenCountUtil.formatTokenCount(epic.tokens)} tokens`)}</span>`
    + `<button type="button" class="ap-link-button" ${opener}>${HtmlEscapeUtil.escapeHtml(epic.title)} details</button></div>`;
}

export const EpicMarkup = {
  epicChipsMarkup,
  epicsInShownOrder,
  epicDetailMarkup,
  epicCardsMarkup,
  epicGroupRowMarkup,
  epicFilterChipsMarkup,
  epicStripRollupMarkup,
  otherEpicSquaresMarkup,
  doneTicketCountOf: EpicGroupMarks.doneTicketCountOf,
  openTicketCountOf,
} as const;
