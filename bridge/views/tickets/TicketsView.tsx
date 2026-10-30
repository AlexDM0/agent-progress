/**
 * The Tickets view: the search, the type, epic and status chips, and the sortable table of `TicketsModel`, each row linking to its detail
 * panel. The search and the chips live in the view; the grouping by epic is kept per board under the static page's key.
 */
import { useState } from 'react';

import type { TicketsBoardState } from '../../@types/TicketsBoardState.ts';
import { FilterChipGroup }        from '../../chips/FilterChipGroup.tsx';
import type { PreferenceStore }   from '../../preferences/PreferenceStore.ts';
import { HashRouter }             from '../../shell/HashRouter.ts';
import type { MatchPiece }        from '../../utils/SearchMatchUtil.ts';
import {
  DEFAULT_TICKET_VIEW,
  TICKET_GROUPING_CHOICE_NAME,
  TICKET_SORT_KEYS,
  TICKET_STATUS_CHIPS,
  TICKET_TYPE_CHIPS,
  TICKETS_FLAT_CHOICE,
  TICKETS_GROUPED_BY_EPIC_CHOICE,
  TicketsModel,
  type TicketRowModel,
  type TicketSortKey,
  type TicketView
} from './TicketsModel.ts';

export interface TicketsViewProps {
  readonly boardState: TicketsBoardState;
  /** The board's own preferences; `null` until the Overseer named its tracker. */
  readonly boardStore: PreferenceStore | null;
}

function MatchedText({ pieces }: { readonly pieces: readonly MatchPiece[] }) {
  return (
    <>
      {pieces.map((piece, index) => (piece.isMatch
        ? <mark key={index} className="bridge-match">{piece.text}</mark>
        : piece.text))}
    </>
  );
}

function TicketRow({ row, showsEpicColumn }: { readonly row: TicketRowModel; readonly showsEpicColumn: boolean }) {
  return (
    <tr className="bridge-ticket-row" data-ticket-id={row.ticketId} data-state={row.stateToken}>
      <td className="bridge-ticket-id">
        <a className="bridge-link" href={HashRouter.fragmentOf({ tab: 'tickets', item: row.ticketId })}>{row.idText}</a>
      </td>
      <td>
        <MatchedText pieces={row.titlePieces} />
        {row.priority === null ? null : <span className="bridge-ticket-priority" data-priority={row.priority}>{row.priority}</span>}
        {row.groupPieces.length === 0 ? null : <span className="bridge-ticket-group"><MatchedText pieces={row.groupPieces} /></span>}
        {row.waitingOn.length === 0 ? null : <span className="bridge-ticket-waiting">{`waits on ${row.waitingOn.join(', ')}`}</span>}
      </td>
      {showsEpicColumn
        ? (
          <td>
            <span className="bridge-epic-chips">
              {row.epics.map((epic) => <span key={epic.key} className="bridge-epic-chip" data-epic-slot={String(epic.slot)}>{epic.title}</span>)}
            </span>
          </td>
        )
        : null}
      <td>{row.ticketType === null ? null : <span className="bridge-ticket-type" data-type={row.ticketType}>{row.ticketType}</span>}</td>
      <td><span className="bridge-state-badge" data-state={row.stateToken}>{row.stateLabel}</span></td>
      <td className="bridge-ticket-branch"><MatchedText pieces={row.branchPieces} /></td>
      <td className="bridge-ticket-task">{row.taskText}</td>
    </tr>
  );
}

const COLUMN_TITLE: Readonly<Record<TicketSortKey, string>> = {
  id:     'id',
  title:  'title',
  epic:   'epic',
  type:   'type',
  status: 'status',
  branch: 'branch',
};

export function TicketsView({ boardState, boardStore }: TicketsViewProps) {
  const [view, setView] = useState<TicketView>(DEFAULT_TICKET_VIEW);
  const [groupedChoice, setGroupedChoice] = useState<boolean | null>(null);
  const groupedByEpic = groupedChoice ?? boardStore?.readChoice(TICKET_GROUPING_CHOICE_NAME) === TICKETS_GROUPED_BY_EPIC_CHOICE;
  const model = TicketsModel.ticketsModelOf(boardState, view, groupedByEpic);
  const shownView = model.view;
  const sortedHeaders = TICKET_SORT_KEYS.filter((sortKey) => sortKey !== 'epic' || model.showsEpics);
  const columnCount = sortedHeaders.length + 1;

  const toggleGrouping = (): void => {
    setGroupedChoice(!groupedByEpic);
    boardStore?.writeChoice(TICKET_GROUPING_CHOICE_NAME, groupedByEpic ? TICKETS_FLAT_CHOICE : TICKETS_GROUPED_BY_EPIC_CHOICE, TICKETS_FLAT_CHOICE);
  };
  const toggleIn = <Value extends string>(values: readonly Value[], value: Value): Value[] => (
    values.includes(value) ? values.filter((candidate) => candidate !== value) : [...values, value]
  );
  const toggleStatus = (value: string): void => {
    const chip = TICKET_STATUS_CHIPS.find((candidate) => candidate === value);
    if (chip !== undefined) setView({ ...shownView, statusChips: toggleIn(shownView.statusChips, chip) });
  };
  const toggleType = (value: string): void => {
    const type = TICKET_TYPE_CHIPS.find((candidate) => candidate === value);
    if (type !== undefined) setView({ ...shownView, typeChips: toggleIn(shownView.typeChips, type) });
  };
  const toggleEpic = (value: string): void => setView({ ...shownView, epicChips: toggleIn(shownView.epicChips, value) });
  const clear = (): void => setView(TicketsModel.viewCleared(shownView));

  return (
    <section className="bridge-tickets" aria-label="Tickets">
      <div className="bridge-tickets-head">
        <span className="bridge-tickets-count" aria-live="polite">{model.countText}</span>
        {model.showsEpics
          ? <button type="button" className="bridge-button" aria-pressed={groupedByEpic} onClick={toggleGrouping}>Group by epic</button>
          : null}
      </div>
      <div className="bridge-tickets-toolbar" role="search">
        <input
          type="search"
          className="bridge-search"
          aria-label="Search tickets"
          placeholder="Search id, title, epic, branch, group, text"
          spellCheck={false}
          autoComplete="off"
          value={shownView.searchText}
          onChange={(event) => setView({ ...shownView, searchText: event.target.value })}
        />
        <FilterChipGroup label="Type" chips={model.typeChips} pressed={shownView.typeChips} countByChip={model.countByChip.type} onToggle={toggleType} />
        {model.showsEpics
          ? <FilterChipGroup label="Epic" chips={model.epicChips} pressed={shownView.epicChips} countByChip={model.countByChip.epic} onToggle={toggleEpic} />
          : null}
        {model.narrows ? <button type="button" className="bridge-button" onClick={clear}>Clear search and filters</button> : null}
        <FilterChipGroup label="Status" chips={model.statusChips} pressed={shownView.statusChips} countByChip={model.countByChip.status} onToggle={toggleStatus} />
      </div>
      <table className="bridge-tickets-table">
        <thead>
          <tr>
            {sortedHeaders.map((sortKey) => (
              <th key={sortKey} aria-sort={shownView.sortKey === sortKey ? shownView.sortDirection : undefined}>
                <button type="button" className="bridge-sort" onClick={() => setView(TicketsModel.viewSortedBy(shownView, sortKey))}>{COLUMN_TITLE[sortKey]}</button>
              </th>
            ))}
            <th>task</th>
          </tr>
        </thead>
        <tbody>
          {model.emptyText === null
            ? model.groups.map((group) => [
              group.showsHead
                ? (
                  <tr key={`head:${group.key}`} className="bridge-ticket-epic-head" data-epic-slot={group.epic === null ? undefined : String(group.epic.slot)}>
                    <th colSpan={columnCount} scope="rowgroup">{group.epic?.title ?? 'No epic'}</th>
                  </tr>
                )
                : null,
              ...group.rows.map((row) => <TicketRow key={row.ticketId} row={row} showsEpicColumn={model.showsEpics} />),
            ])
            : (
              <tr className="bridge-ticket-empty">
                <td colSpan={columnCount}>
                  <p>{model.emptyText}</p>
                  {model.narrows ? <button type="button" className="bridge-button" onClick={clear}>Clear search and filters</button> : null}
                </td>
              </tr>
            )}
        </tbody>
      </table>
    </section>
  );
}
