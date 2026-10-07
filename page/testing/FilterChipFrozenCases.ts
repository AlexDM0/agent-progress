/**
 * The Tickets tab's status and type chips and the epic filter chips over a fixture of three epics, one with markup in its title, so the lane
 * dot, the swatch, the slot and the no-epic chip each show. `page/chips/FilterChipMarkup.frozen.spec.ts` compares it against
 * `page/testing/FrozenFilterChips.json`. Test-only: nothing that ships may import `page/testing/`.
 */
import type { EpicFrontmatter }               from '../../src/lib/tracker-model/@types/Epic.ts';
import { TICKET_TYPES }                       from '../../src/lib/tracker-model/constants/TicketFields.ts';
import { EpicMarkup }                         from '../epics/EpicMarkup.ts';
import { statusChipsMarkup, typeChipsMarkup } from '../tickets/TicketsMarkup.ts';
import { TICKET_STATUS_CHIPS }                from '../tickets/utils/TicketViewUtil.ts';
import { pageBoardFixture }                   from './PageBoardFixture.ts';

const EPICS: EpicFrontmatter[] = [
  {
    key: 'checkout', title: 'Checkout <redesign>', slot: 1, extra: []
  },
  {
    key: 'emails', title: 'Order "emails"', slot: 2, extra: []
  },
  {
    key: 'payments', title: 'Payment providers', slot: 7, extra: []
  },
];

const BOARD = pageBoardFixture({ tasks: [], epics: EPICS });

/** Each chip row's markup, keyed by the function that writes it. */
export function filterChipFrozenCases(): Record<string, string> {
  return {
    statusChipsMarkup:     statusChipsMarkup(TICKET_STATUS_CHIPS),
    typeChipsMarkup:       typeChipsMarkup(TICKET_TYPES),
    epicFilterChipsMarkup: EpicMarkup.epicFilterChipsMarkup(BOARD.epics),
  };
}
