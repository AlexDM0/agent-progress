/**
 * The Kanban: the epic chips over the seven lanes of `KanbanModel`, each card with the marks of `page/kanban/`'s card and the controls its
 * lane offers. A card whose state moved since the previous board is marked once; the pressed epics are kept per board under the static
 * page's key.
 */
import { useState } from 'react';

import type { KanbanBoardState }                       from '../../@types/KanbanBoardState.ts';
import { ChipFilterUtil }                              from '../../chips/ChipFilterUtil.ts';
import { FilterChipGroup }                             from '../../chips/FilterChipGroup.tsx';
import type { PreferenceStore }                        from '../../preferences/PreferenceStore.ts';
import { CommandButton }                               from '../../shell/CommandButton.tsx';
import { KanbanChangeHighlightModel }                  from './KanbanChangeHighlightModel.ts';
import { KANBAN_EPIC_FILTER_CHOICE_NAME, KanbanModel } from './KanbanModel.ts';
import type { KanbanCardModel, KanbanLaneModel }       from './KanbanModel.ts';

export interface KanbanViewProps {
  readonly boardState: KanbanBoardState;
  /** The board's own preferences; `null` until the Overseer named its tracker. */
  readonly boardStore: PreferenceStore | null;
}

const NOTHING_CHANGED: ReadonlySet<string> = new Set();

interface KanbanCardProps {
  readonly card:       KanbanCardModel;
  readonly isChanged:  boolean;
  readonly isSelected: boolean | null;
  readonly onSelect:   (ticketId: string) => void;
}

function KanbanCardActions({ card }: { readonly card: KanbanCardModel }) {
  const { ticketId, actions } = card;
  if (ticketId === null || (!actions.readies && actions.holdMove === null)) return null;
  return (
    <div className="bridge-kanban-actions">
      {actions.readies ? <CommandButton label="Ready" command={{ kind: 'ticket-ready', ticketReferences: [ticketId] }} /> : null}
      {actions.holdMove === 'hold' ? <CommandButton label="Hold" command={{ kind: 'ticket-hold', ticketReference: ticketId, reason: '' }} /> : null}
      {actions.holdMove === 'unhold' ? <CommandButton label="Unhold" command={{ kind: 'ticket-unhold', ticketReference: ticketId }} /> : null}
      {actions.priorityChoices.map((priority) => (
        <CommandButton key={priority} label={`Priority ${priority}`} command={{ kind: 'ticket-priority', ticketReference: ticketId, priority }} />
      ))}
    </div>
  );
}

function KanbanCard({
  card, isChanged, isSelected, onSelect
}: KanbanCardProps) {
  const { ticketId } = card;
  const hasMarks = card.waitingOn.length > 0 || card.heldTitle !== null;
  return (
    <article className="bridge-kanban-card" data-card={card.key} data-state={card.stateToken} data-changed={isChanged ? '' : undefined} aria-label={card.ariaLabel}>
      <div className="bridge-kanban-card-head">
        {isSelected === null || ticketId === null
          ? null
          : <input type="checkbox" className="bridge-kanban-select" aria-label={`Select ${card.idText}`} checked={isSelected} onChange={() => onSelect(ticketId)} />}
        <span className="bridge-kanban-id">{card.idText}</span>
        {card.size === null ? null : <span className="bridge-kanban-size" data-size={card.size} title={`Size ${card.size}`}>{card.size}</span>}
        {card.priority === null || card.priority === 'normal' ? null : <span className="bridge-kanban-priority" data-priority={card.priority}>{card.priority}</span>}
        {card.ticketType === null ? null : <span className="bridge-kanban-type" data-type={card.ticketType}>{card.ticketType}</span>}
        {card.tokensText === null ? null : <span className="bridge-kanban-tokens">{card.tokensText}</span>}
      </div>
      <p className="bridge-kanban-title" title={card.title}>{card.title}</p>
      {card.draftLabel === null ? null : <p className="bridge-kanban-label">{card.draftLabel}</p>}
      {card.epics.length === 0
        ? null
        : (
          <div className="bridge-epic-chips">
            {card.epics.map((epic) => <span key={epic.key} className="bridge-epic-chip" data-epic-slot={String(epic.slot)}>{epic.title}</span>)}
          </div>
        )}
      {hasMarks
        ? (
          <div className="bridge-kanban-marks">
            {card.waitingOn.map((idText) => <span key={idText} className="bridge-kanban-waiting">{`waits on ${idText}`}</span>)}
            {card.heldTitle === null ? null : <span className="bridge-kanban-held" title={card.heldTitle}>held</span>}
          </div>
        )
        : null}
      {card.note === null ? null : <p className="bridge-kanban-note">{card.note}</p>}
      <KanbanCardActions card={card} />
    </article>
  );
}

interface KanbanLaneProps {
  readonly lane:              KanbanLaneModel;
  readonly changedCardKeys:   ReadonlySet<string>;
  readonly selectedTicketIds: readonly string[];
  readonly onSelect:          (ticketId: string) => void;
}

function KanbanLane({
  lane, changedCardKeys, selectedTicketIds, onSelect
}: KanbanLaneProps) {
  const selectable = new Set(lane.readyableTicketIds);
  const selectedHere = lane.readyableTicketIds.filter((ticketId) => selectedTicketIds.includes(ticketId));
  return (
    <section className="bridge-lane" data-lane={lane.key} aria-label={lane.title}>
      <div className="bridge-lane-head" data-state={lane.dotState}>
        <h2 className="bridge-lane-title">{lane.title}</h2>
        <span className="bridge-lane-count">{lane.cards.length}</span>
        {selectable.size === 0
          ? null
          : <CommandButton label="Ready selected" command={{ kind: 'ticket-ready', ticketReferences: selectedHere }} hasNothingToSend={selectedHere.length === 0} />}
      </div>
      <div className="bridge-lane-cards">
        {lane.cards.length === 0
          ? <p className="bridge-lane-empty">{lane.emptyText}</p>
          : lane.cards.map((card) => (
            <KanbanCard
              key={card.key}
              card={card}
              isChanged={changedCardKeys.has(card.key)}
              isSelected={card.ticketId !== null && selectable.has(card.ticketId) ? selectedHere.includes(card.ticketId) : null}
              onSelect={onSelect}
            />
          ))}
      </div>
    </section>
  );
}

export function KanbanView({ boardState, boardStore }: KanbanViewProps) {
  const [pressedChipsChoice, setPressedChipsChoice] = useState<readonly string[] | null>(null);
  const [selectedTicketIds, setSelectedTicketIds] = useState<readonly string[]>([]);
  const [shownBoardState, setShownBoardState] = useState(boardState);
  const [changedCardKeys, setChangedCardKeys] = useState<ReadonlySet<string>>(NOTHING_CHANGED);
  if (boardState !== shownBoardState) {
    setChangedCardKeys(KanbanChangeHighlightModel.changedCardKeysBetween(shownBoardState, boardState));
    setShownBoardState(boardState);
  }

  const storedPressedChips = pressedChipsChoice ?? boardStore?.readTextList(KANBAN_EPIC_FILTER_CHOICE_NAME) ?? [];
  const model = KanbanModel.kanbanModelOf(boardState, storedPressedChips);

  const toggleChip = (chip: string): void => {
    const pressedChips = ChipFilterUtil.toggledChips(model.pressedChips, chip);
    setPressedChipsChoice(pressedChips);
    boardStore?.writeTextList(KANBAN_EPIC_FILTER_CHOICE_NAME, pressedChips);
  };
  const toggleSelection = (ticketId: string): void => {
    setSelectedTicketIds((selected) => ChipFilterUtil.toggledChips(selected, ticketId));
  };

  return (
    <section className="bridge-kanban" aria-label="Kanban">
      {model.epicChips.length === 0
        ? null
        : <FilterChipGroup label="Epics" chips={model.epicChips} pressed={model.pressedChips} countByChip={model.countByChip} onToggle={toggleChip} />}
      <div className="bridge-kanban-lanes">
        {model.lanes.map((lane) => (
          <KanbanLane key={lane.key} lane={lane} changedCardKeys={changedCardKeys} selectedTicketIds={selectedTicketIds} onSelect={toggleSelection} />
        ))}
      </div>
    </section>
  );
}
