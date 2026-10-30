/**
 * The Progress tab: the range presets and the review-rows choice, the Gantt chart of `ProgressModel`, and below it the dependencies view
 * when any ticket depends on another. Bars, ticks and the now line are placed through the `style` prop, never a markup string. The
 * review-rows choice is kept per board under the static page's key; a row's label opens its ticket's detail panel.
 */
import { useMemo, useState } from 'react';

import type { ProgressBoardState } from '../../@types/ProgressBoardState.ts';
import type { PreferenceStore }    from '../../preferences/PreferenceStore.ts';
import { HashRouter }              from '../../shell/HashRouter.ts';
import { DependenciesModel }       from '../dependencies/DependenciesModel.ts';
import { DependenciesView }        from '../dependencies/DependenciesView.tsx';
import {
  DEFAULT_REVIEW_ROWS_CHOICE,
  ProgressModel,
  RANGE_PRESET_KEYS,
  REVIEW_ROWS_CHOICE_NAME,
  REVIEW_ROWS_SHOWN_CHOICE,
  type ProgressBarModel,
  type ProgressRowModel
} from './ProgressModel.ts';
import { FIT_RANGE_PRESET } from './constants/ProgressChart.ts';

export interface ProgressViewProps {
  readonly boardState:           ProgressBoardState;
  /** The board's own preferences; `null` until the Overseer named its tracker. */
  readonly boardStore:           PreferenceStore | null;
  readonly nowEpochMilliseconds: number;
  readonly todayCalendarDate:    string;
}

function percent(value: number): string {
  return `${value}%`;
}

function ChartBar({ bar }: { readonly bar: ProgressBarModel }) {
  return (
    <div
      className="bridge-progress-bar"
      data-state={bar.stateToken}
      data-live={bar.isLive ? '' : undefined}
      data-review-pass={bar.isReviewPass ? '' : undefined}
      hidden={bar.isHidden}
      title={bar.title ?? undefined}
      style={{ left: percent(bar.leftPercent), width: percent(bar.widthPercent) }}
    />
  );
}

function ChartRow({ row }: { readonly row: ProgressRowModel }) {
  return (
    <div
      className="bridge-progress-row"
      data-task-id={String(row.taskId)}
      data-state={row.stateToken}
      data-review-of={row.nestedWithTicket ?? undefined}
      data-live={row.isLive ? '' : undefined}
    >
      <div className="bridge-progress-name">
        {row.linkedTicketId === null
          ? <span className="bridge-progress-label">{row.labelText}</span>
          : <a className="bridge-link" href={HashRouter.fragmentOf({ tab: 'tickets', item: row.linkedTicketId })}>{row.labelText}</a>}
        <span className="bridge-progress-row-name" title={row.nameTitle}>{row.nameText}</span>
        <span className="bridge-state-badge" data-state={row.stateToken} title={row.chipTitle}>{row.chipText}</span>
      </div>
      <div className="bridge-progress-track">
        <span className="bridge-progress-clip" data-side="left" hidden={!row.clippedLeft} />
        {row.bars.map((bar) => <ChartBar key={bar.key} bar={bar} />)}
        <span className="bridge-progress-clip" data-side="right" hidden={!row.clippedRight} />
      </div>
    </div>
  );
}

function presetLabelOf(presetKey: string): string {
  return presetKey === FIT_RANGE_PRESET ? 'Fit' : presetKey;
}

export function ProgressView({
  boardState, boardStore, nowEpochMilliseconds, todayCalendarDate
}: ProgressViewProps) {
  const [presetKey, setPresetKey] = useState(FIT_RANGE_PRESET);
  const [reviewRowsAreShown, setReviewRowsAreShown] = useState(() => boardStore?.readChoice(REVIEW_ROWS_CHOICE_NAME) === REVIEW_ROWS_SHOWN_CHOICE);
  const chart = useMemo(
    () => ProgressModel.progressChartOf(boardState, {
      presetKey, reviewRowsAreShown, nowEpochMilliseconds, todayCalendarDate
    }),
    [boardState, presetKey, reviewRowsAreShown, nowEpochMilliseconds, todayCalendarDate],
  );
  const dependencies = useMemo(() => DependenciesModel.dependenciesModelOf(boardState, nowEpochMilliseconds), [boardState, nowEpochMilliseconds]);

  const chooseReviewRows = (shown: boolean): void => {
    setReviewRowsAreShown(shown);
    boardStore?.writeChoice(REVIEW_ROWS_CHOICE_NAME, shown ? REVIEW_ROWS_SHOWN_CHOICE : DEFAULT_REVIEW_ROWS_CHOICE, DEFAULT_REVIEW_ROWS_CHOICE);
  };

  return (
    <div className="bridge-progress-view">
      <div className="bridge-progress-toolbar">
        <div className="bridge-chips" role="group" aria-label="Range">
          {RANGE_PRESET_KEYS.map((key) => (
            <button key={key} type="button" className="bridge-chip" aria-pressed={key === presetKey} onClick={() => setPresetKey(key)}>{presetLabelOf(key)}</button>
          ))}
        </div>
        <label className="bridge-progress-choice">
          <input type="checkbox" checked={reviewRowsAreShown} onChange={(event) => chooseReviewRows(event.target.checked)} />
          Review rows
        </label>
        <span className="bridge-progress-range-note" title={chart.rangeNoteTitle ?? undefined}>{chart.rangeNoteText}</span>
      </div>
      <section className="bridge-progress-chart" aria-label="Progress chart">
        <div className="bridge-progress-row bridge-progress-axis-row">
          <div className="bridge-progress-name" />
          <div className="bridge-progress-track">
            {chart.ticks.map((tick) => <span key={tick.leftPercent} className="bridge-progress-tick" style={{ left: percent(tick.leftPercent) }}>{tick.label}</span>)}
          </div>
        </div>
        <div className="bridge-progress-rows">
          <div className="bridge-progress-overlay" aria-hidden="true">
            {chart.ticks.map((tick) => <div key={tick.leftPercent} className="bridge-progress-grid-line" style={{ left: percent(tick.leftPercent) }} />)}
            {chart.nowPercent === null ? null : <div className="bridge-progress-now" style={{ left: percent(chart.nowPercent) }} />}
          </div>
          {chart.rows.length === 0
            ? <p className="bridge-empty">No task has been recorded yet.</p>
            : chart.rows.map((row) => <ChartRow key={row.taskId} row={row} />)}
        </div>
      </section>
      {dependencies === null ? null : <DependenciesView canvas={dependencies} />}
    </div>
  );
}
