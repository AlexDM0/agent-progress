/**
 * The Kanban: the epic chips over the seven lanes of `KanbanModel`, each card with the marks of the static page's card and the controls its
 * lane offers. A card whose state moved since the previous board is marked once; hovering a card draws arrows from the cards it depends
 * on. The pressed epics, the Ready order, the closed lanes' pages and the Abandoned fold are kept per board under the static page's keys.
 */
import { useRef, useState }               from 'react';
import type { CSSProperties, MouseEvent } from 'react';

import type { KanbanBoardState }                       from '../../@types/KanbanBoardState.ts';
import { ChipFilterUtil }                              from '../../chips/ChipFilterUtil.ts';
import { FilterChipGroup }                             from '../../chips/FilterChipGroup.tsx';
import type { PreferenceStore }                        from '../../preferences/PreferenceStore.ts';
import { CommandButton }                               from '../../shell/CommandButton.tsx';
import { KanbanChangeHighlightModel }                  from './KanbanChangeHighlightModel.ts';
import { KanbanDependencyArrowUtil }                   from './KanbanDependencyArrowUtil.ts';
import type { ArrowCardBox, DependencyArrow }          from './KanbanDependencyArrowUtil.ts';
import { KANBAN_EPIC_FILTER_CHOICE_NAME, KanbanModel } from './KanbanModel.ts';
import {
  ABANDONED_LANE_CLOSED_CHOICE,
  ABANDONED_LANE_OPEN_CHOICE,
  CLOSED_LANE_FIRST_PAGE_CARDS,
  CLOSED_LANE_SHOWN_CHOICE_NAME,
  DEFAULT_KANBAN_LAYOUT,
  KANBAN_ABANDONED_LANE_CHOICE_NAME,
  KANBAN_READY_ORDER_CHOICE_NAME,
  KANBAN_READY_ORDERS
} from './KanbanModel.ts';
import type {
  KanbanCardModel,
  KanbanClosedLaneKey,
  KanbanDependencyArrowLink,
  KanbanLaneModel,
  KanbanLanePaging,
  KanbanLayoutChoices,
  KanbanReadyOrder
} from './KanbanModel.ts';

export interface KanbanViewProps {
  readonly boardState: KanbanBoardState;
  /** The board's own preferences; `null` until the Overseer named its tracker. */
  readonly boardStore: PreferenceStore | null;
}

const NOTHING_CHANGED: ReadonlySet<string> = new Set();

interface KanbanCardProps {
  readonly card:          KanbanCardModel;
  readonly isChanged:     boolean;
  readonly isSelected:    boolean | null;
  /** A card the hovered card directly depends on. */
  readonly isNeededFirst: boolean;
  readonly onSelect:      (ticketId: string) => void;
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
  card, isChanged, isSelected, isNeededFirst, onSelect
}: KanbanCardProps) {
  const { ticketId, heldCount } = card;
  const hasMarks = card.waitingOn.length > 0 || card.heldTitle !== null;
  return (
    <article
      className="bridge-kanban-card"
      data-card={card.key}
      data-ticket-id={ticketId ?? undefined}
      data-state={card.stateToken}
      data-changed={isChanged ? '' : undefined}
      data-needed-first={isNeededFirst ? '' : undefined}
      aria-label={card.ariaLabel}
    >
      <div className="bridge-kanban-card-head">
        {isSelected === null || ticketId === null
          ? null
          : <input type="checkbox" className="bridge-kanban-select" aria-label={`Select ${card.idText}`} checked={isSelected} onChange={() => onSelect(ticketId)} />}
        <span className="bridge-kanban-id">{card.idText}</span>
        {card.size === null ? null : <span className="bridge-kanban-size" data-size={card.size} title={`Size ${card.size}`}>{card.size}</span>}
        {card.priority === null || card.priority === 'normal' ? null : <span className="bridge-kanban-priority" data-priority={card.priority}>{card.priority}</span>}
        {card.ticketType === null ? null : <span className="bridge-kanban-type" data-type={card.ticketType}>{card.ticketType}</span>}
        {card.hasNeededFirst ? <span className="bridge-kanban-needed-first" aria-hidden="true">needed first</span> : null}
        {heldCount === null
          ? null
          : <span className="bridge-kanban-held-count" data-heavy={heldCount.isHeavy ? '' : undefined} title={heldCount.title}>{`↦ ${heldCount.count}`}</span>}
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
  readonly lane:                KanbanLaneModel;
  readonly changedCardKeys:     ReadonlySet<string>;
  readonly neededFirstCardKeys: ReadonlySet<string>;
  readonly selectedTicketIds:   readonly string[];
  readonly onSelect:            (ticketId: string) => void;
  /** The Ready lane's order switch, `null` on every other lane and on a board without dependencies. */
  readonly readyOrderSwitch:    { readonly order: KanbanReadyOrder; readonly onChoose: (order: KanbanReadyOrder) => void } | null;
  readonly onToggleCollapse:    () => void;
  readonly onShowCount:         (lane: KanbanClosedLaneKey, shownCount: number) => void;
}

const READY_ORDER_LABEL: Readonly<Record<KanbanReadyOrder, string>> = { 'filed': 'Filed', 'by-wave': 'By wave' };

function KanbanLanePagingControls({ lane, paging, onShowCount }: {
  readonly lane:        KanbanClosedLaneKey;
  readonly paging:      KanbanLanePaging;
  readonly onShowCount: KanbanLaneProps['onShowCount'];
}) {
  const {
    shownCount, laneCount, nextPageSize, firstPageSize
  } = paging;
  const showMore = (): void => onShowCount(lane, KanbanModel.shownCountAfterMore(shownCount, laneCount));
  return (
    <div className="bridge-lane-more">
      <span>{`${shownCount} of ${laneCount} shown`}</span>
      {nextPageSize > 0 ? <button type="button" className="bridge-lane-page" onClick={showMore}>{`Show ${nextPageSize} more`}</button> : null}
      {firstPageSize === null
        ? null
        : <button type="button" className="bridge-lane-page" onClick={() => onShowCount(lane, firstPageSize)}>{`Latest ${firstPageSize}`}</button>}
    </div>
  );
}

function KanbanLane({
  lane, changedCardKeys, neededFirstCardKeys, selectedTicketIds, onSelect, readyOrderSwitch, onToggleCollapse, onShowCount
}: KanbanLaneProps) {
  const selectable = new Set(lane.readyableTicketIds);
  const selectedHere = lane.readyableTicketIds.filter((ticketId) => selectedTicketIds.includes(ticketId));
  const isCollapsed = lane.collapse?.isCollapsed === true;
  const cardOf = (card: KanbanCardModel) => (
    <KanbanCard
      key={card.key}
      card={card}
      isChanged={changedCardKeys.has(card.key)}
      isSelected={card.ticketId !== null && selectable.has(card.ticketId) ? selectedHere.includes(card.ticketId) : null}
      isNeededFirst={neededFirstCardKeys.has(card.key)}
      onSelect={onSelect}
    />
  );
  return (
    <section className="bridge-lane" data-lane={lane.key} data-collapsed={isCollapsed ? '' : undefined} aria-label={lane.title}>
      <div className="bridge-lane-head" data-state={lane.dotState}>
        <h2 className="bridge-lane-title">{lane.title}</h2>
        <span className="bridge-lane-count">{lane.count}</span>
        {lane.collapse === null
          ? null
          : (
            <button
              type="button"
              className="bridge-lane-toggle"
              aria-expanded={!isCollapsed}
              aria-label={lane.collapse.toggleTitle}
              title={lane.collapse.toggleTitle}
              onClick={onToggleCollapse}
            >
              {isCollapsed ? '▸' : '▾'}
            </button>
          )}
        {selectable.size === 0
          ? null
          : <CommandButton label="Ready selected" command={{ kind: 'ticket-ready', ticketReferences: selectedHere }} hasNothingToSend={selectedHere.length === 0} />}
        {readyOrderSwitch === null
          ? null
          : (
            <div className="bridge-kanban-order" role="group" aria-label="Order Ready">
              {KANBAN_READY_ORDERS.map((order) => (
                <button
                  key={order}
                  type="button"
                  className="bridge-kanban-order-choice"
                  aria-pressed={readyOrderSwitch.order === order}
                  onClick={() => readyOrderSwitch.onChoose(order)}
                >
                  {READY_ORDER_LABEL[order]}
                </button>
              ))}
            </div>
          )}
      </div>
      {isCollapsed
        ? null
        : (
          <div className="bridge-lane-cards">
            {lane.cards.length === 0 ? <p className="bridge-lane-empty">{lane.emptyText}</p> : null}
            {lane.waveGroups === null
              ? lane.cards.map(cardOf)
              : lane.waveGroups.map((group) => (
                <div key={group.key} className="bridge-lane-wave" data-wave={group.key} data-narrow={group.isNarrow ? '' : undefined}>
                  {group.label === null
                    ? null
                    : <p className="bridge-lane-wave-head">{group.label} <span className="bridge-lane-wave-note">{group.note}</span></p>}
                  {group.cards.map(cardOf)}
                </div>
              ))}
          </div>
        )}
      {isCollapsed || lane.paging === null || (lane.key !== 'done' && lane.key !== 'abandoned')
        ? null
        : <KanbanLanePagingControls lane={lane.key} paging={lane.paging} onShowCount={onShowCount} />}
    </section>
  );
}

const ARROW_STAGGER_MILLISECONDS = 90;

interface ShownArrows {
  readonly hoveredTicketId: string;
  readonly arrows:          readonly DependencyArrow[];
  /** The first drawing animates in; a re-measure after a lane scroll draws still. */
  readonly drawsIn:         boolean;
}

/** A card's box relative to the frame, or `null` for a card not laid out. */
function cardBoxWithin(frame: HTMLElement, frameBox: DOMRect, cardKey: string): ArrowCardBox | null {
  const element = [...frame.querySelectorAll('[data-card]')].find((candidate) => candidate.getAttribute('data-card') === cardKey);
  const box = element?.getBoundingClientRect();
  if (box === undefined || (box.width === 0 && box.height === 0)) return null;
  return {
    left: box.left - frameBox.left, right: box.right - frameBox.left, top: box.top - frameBox.top, height: box.height
  };
}

function measuredArrowsOf(frame: HTMLElement, hoveredTicketId: string, links: readonly KanbanDependencyArrowLink[]): DependencyArrow[] {
  const frameBox = frame.getBoundingClientRect();
  const targetBox = cardBoxWithin(frame, frameBox, `ticket:${hoveredTicketId}`);
  if (targetBox === null) return [];
  return links.flatMap((link) => {
    const sourceBox = cardBoxWithin(frame, frameBox, link.dependencyCardKey);
    return sourceBox === null ? [] : [KanbanDependencyArrowUtil.dependencyArrowOf(sourceBox, targetBox, link.isSameLane)];
  });
}

function readyOrderFrom(stored: string | null): KanbanReadyOrder {
  return stored === 'by-wave' ? 'by-wave' : 'filed';
}

function storedShownCountOf(boardStore: PreferenceStore | null, lane: KanbanClosedLaneKey): number {
  return Number(boardStore?.readChoice(CLOSED_LANE_SHOWN_CHOICE_NAME[lane]) ?? Number.NaN);
}

export function KanbanView({ boardState, boardStore }: KanbanViewProps) {
  const [pressedChipsChoice, setPressedChipsChoice] = useState<readonly string[] | null>(null);
  const [selectedTicketIds, setSelectedTicketIds] = useState<readonly string[]>([]);
  const [shownBoardState, setShownBoardState] = useState(boardState);
  const [changedCardKeys, setChangedCardKeys] = useState<ReadonlySet<string>>(NOTHING_CHANGED);
  const [readyOrderChoice, setReadyOrderChoice] = useState<KanbanReadyOrder | null>(null);
  const [abandonedLaneIsOpenChoice, setAbandonedLaneIsOpenChoice] = useState<boolean | null>(null);
  const [shownCountChoice, setShownCountChoice] = useState<Partial<Record<KanbanClosedLaneKey, number>>>({});
  const [shownArrows, setShownArrows] = useState<ShownArrows | null>(null);
  const frameReference = useRef<HTMLDivElement>(null);
  if (boardState !== shownBoardState) {
    setChangedCardKeys(KanbanChangeHighlightModel.changedCardKeysBetween(shownBoardState, boardState));
    setShownBoardState(boardState);
    setShownArrows(null);
  }

  const storedPressedChips = pressedChipsChoice ?? boardStore?.readTextList(KANBAN_EPIC_FILTER_CHOICE_NAME) ?? [];
  const layout: KanbanLayoutChoices = {
    readyOrder:             readyOrderChoice ?? readyOrderFrom(boardStore?.readChoice(KANBAN_READY_ORDER_CHOICE_NAME) ?? null),
    abandonedLaneIsOpen:    abandonedLaneIsOpenChoice ?? boardStore?.readChoice(KANBAN_ABANDONED_LANE_CHOICE_NAME) === ABANDONED_LANE_OPEN_CHOICE,
    shownCountByClosedLane: {
      done:      shownCountChoice.done ?? storedShownCountOf(boardStore, 'done'),
      abandoned: shownCountChoice.abandoned ?? storedShownCountOf(boardStore, 'abandoned'),
    },
  };
  const model = KanbanModel.kanbanModelOf(boardState, storedPressedChips, layout);
  const hoveredLinks = shownArrows === null ? [] : KanbanModel.dependencyArrowLinksOf(model, shownArrows.hoveredTicketId);
  const neededFirstCardKeys = new Set(hoveredLinks.map((link) => link.dependencyCardKey));

  const toggleChip = (chip: string): void => {
    const pressedChips = ChipFilterUtil.toggledChips(model.pressedChips, chip);
    setPressedChipsChoice(pressedChips);
    setShownArrows(null);
    boardStore?.writeTextList(KANBAN_EPIC_FILTER_CHOICE_NAME, pressedChips);
  };
  const toggleSelection = (ticketId: string): void => {
    setSelectedTicketIds((selected) => ChipFilterUtil.toggledChips(selected, ticketId));
  };
  const chooseReadyOrder = (order: KanbanReadyOrder): void => {
    setReadyOrderChoice(order);
    setShownArrows(null);
    boardStore?.writeChoice(KANBAN_READY_ORDER_CHOICE_NAME, order, DEFAULT_KANBAN_LAYOUT.readyOrder);
  };
  const toggleAbandonedLane = (): void => {
    const laneIsOpen = !layout.abandonedLaneIsOpen;
    setAbandonedLaneIsOpenChoice(laneIsOpen);
    setShownArrows(null);
    boardStore?.writeChoice(KANBAN_ABANDONED_LANE_CHOICE_NAME, laneIsOpen ? ABANDONED_LANE_OPEN_CHOICE : ABANDONED_LANE_CLOSED_CHOICE, ABANDONED_LANE_CLOSED_CHOICE);
  };
  const showCount = (lane: KanbanClosedLaneKey, shownCount: number): void => {
    setShownCountChoice((choice) => ({ ...choice, [lane]: shownCount }));
    setShownArrows(null);
    boardStore?.writeChoice(CLOSED_LANE_SHOWN_CHOICE_NAME[lane], String(shownCount), String(CLOSED_LANE_FIRST_PAGE_CARDS));
  };
  // Cards are laid out already when the pointer reaches one, and the hover marks change no layout, so the arrows are measured here.
  const drawArrows = (hoveredTicketId: string, drawsIn: boolean): void => {
    const frame = frameReference.current;
    if (frame === null) return;
    const arrows = measuredArrowsOf(frame, hoveredTicketId, KanbanModel.dependencyArrowLinksOf(model, hoveredTicketId));
    setShownArrows({ hoveredTicketId, arrows, drawsIn });
  };
  const hoverCard = (event: MouseEvent<HTMLDivElement>): void => {
    const card = event.target instanceof Element ? event.target.closest('[data-ticket-id]') : null;
    const hoveredTicketId = card?.getAttribute('data-ticket-id') ?? null;
    if (hoveredTicketId !== null && hoveredTicketId !== shownArrows?.hoveredTicketId) drawArrows(hoveredTicketId, true);
  };
  const remeasureArrows = (): void => {
    if (shownArrows !== null) drawArrows(shownArrows.hoveredTicketId, false);
  };

  return (
    <section className="bridge-kanban" aria-label="Kanban">
      {model.epicChips.length === 0
        ? null
        : <FilterChipGroup label="Epics" chips={model.epicChips} pressed={model.pressedChips} countByChip={model.countByChip} onToggle={toggleChip} />}
      <div className="bridge-kanban-frame" ref={frameReference} onMouseOver={hoverCard} onMouseLeave={() => setShownArrows(null)}>
        <div className="bridge-kanban-lanes" onScroll={remeasureArrows}>
          {model.lanes.map((lane) => (
            <KanbanLane
              key={lane.key}
              lane={lane}
              changedCardKeys={changedCardKeys}
              neededFirstCardKeys={neededFirstCardKeys}
              selectedTicketIds={selectedTicketIds}
              onSelect={toggleSelection}
              readyOrderSwitch={lane.key === 'ready' && model.boardHasDependencies ? { order: model.readyOrder, onChoose: chooseReadyOrder } : null}
              onToggleCollapse={toggleAbandonedLane}
              onShowCount={showCount}
            />
          ))}
        </div>
        {shownArrows === null || shownArrows.arrows.length === 0
          ? null
          : (
            <svg className="bridge-kanban-arrows" aria-hidden="true" data-still={shownArrows.drawsIn ? undefined : ''}>
              {shownArrows.arrows.map((arrow, index) => (
                <g key={arrow.linePath} data-route={arrow.route} style={{ '--arrow-delay': `${index * ARROW_STAGGER_MILLISECONDS}ms` } as CSSProperties}>
                  <path className="bridge-kanban-arrow-line" pathLength={1} d={arrow.linePath} />
                  <path className="bridge-kanban-arrow-head" d={arrow.headPath} />
                </g>
              ))}
            </svg>
          )}
      </div>
    </section>
  );
}
