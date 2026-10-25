import type { DependencyGraph }    from '../../@types/DependencyGraph.ts';
import type { KanbanCard }         from '../../@types/KanbanCard.ts';
import type { FinishedWorkChoice } from '../../@types/ViewerChoices.ts';
import type { TodoOrderChoice }    from '../../@types/ViewerChoices.ts';
import type { KanbanDraft }        from '../DraftCardModel.ts';
import type { NoteFormat }         from '../KanbanLaneText.ts';
import type { ClosedKanbanLane }   from '../constants/KanbanBoardLayout.ts';

export interface KanbanBoardInput extends NoteFormat {
  /** The cards of the tickets the Tickets tab shows. */
  cards:                   readonly KanbanCard[];
  /** Every open draft, in draft-number order: To do shows them first, above every ticket card. */
  drafts:                  readonly KanbanDraft[];
  finishedWork:            FinishedWorkChoice;
  /** The lane's tickets the finished-work choice leaves out. */
  hiddenCountByClosedLane: Readonly<Record<ClosedKanbanLane, number>>;
  shownCountByClosedLane:  Readonly<Record<ClosedKanbanLane, number>>;
  abandonedLaneIsOpen:     boolean;
  todoOrder:               TodoOrderChoice;
  /** Spans every ticket, finished ones included, so neither filter reshapes the waves. */
  dependencyGraph:         DependencyGraph;
  /** The Board's ready tickets less the held ones, as `PageBoard.readyTicketIds` holds them. */
  readyTicketIds:          ReadonlySet<string>;
}

export interface KanbanCardFormat extends NoteFormat {
  dependencyGraph:     DependencyGraph;
  /** The tickets some card on the board depends on directly: only their cards can show "needed first". */
  dependedOnTicketIds: ReadonlySet<string>;
}
