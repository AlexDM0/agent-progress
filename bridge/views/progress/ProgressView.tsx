/**
 * The Progress tab: the chart head's range menu and row options menu, the Gantt chart of `ProgressModel` with its rows grouped by epic
 * when the board has epics, and below it the dependencies view when any ticket depends on another. Bars, ticks, spans and the now line
 * are placed through the `style` prop, never a markup string. The range, the name column, the folded groups and the review-rows choice
 * are kept per viewer under the static page's keys; a row's label opens its ticket's detail panel.
 */
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject
} from 'react';

import type { ProgressBoardState }                                          from '../../@types/ProgressBoardState.ts';
import type { PreferenceStore }                                             from '../../preferences/PreferenceStore.ts';
import { HashRouter }                                                       from '../../shell/HashRouter.ts';
import { CustomRangePopover }                                               from './CustomRangePopover.tsx';
import { EpicRowGrouping, type EpicGroupHeadModel, type EpicRowGroup }      from './EpicRowGrouping.ts';
import { CLOSES_MENU_KEEPING_FOCUS, CLOSES_MENU_RETURNING_FOCUS, HeadMenu } from './HeadMenu.tsx';
import {
  ProgressModel,
  RANGE_PRESET_KEYS,
  type ProgressBarModel,
  type ProgressRowModel
} from './ProgressModel.ts';
import { progressPreferencesOf } from './ProgressPreferences.ts';
import { CUSTOM_RANGE_PRESET }   from './constants/ProgressChart.ts';
import { DependenciesModel }     from './dependencies/DependenciesModel.ts';
import { DependenciesView }      from './dependencies/DependenciesView.tsx';
import { AxisFitUtil }           from './utils/AxisFitUtil.ts';
import { ChartPreferenceUtil }   from './utils/ChartPreferenceUtil.ts';
import { RangePresetUtil }       from './utils/RangePresetUtil.ts';

export interface ProgressViewProps {
  readonly boardState:           ProgressBoardState;
  /** The board's own preferences; `null` until the Overseer named its tracker. */
  readonly boardStore:           PreferenceStore | null;
  readonly nowEpochMilliseconds: number;
  readonly todayCalendarDate:    string;
}

const FOLD_CARET = '▾';

function percent(value: number): string {
  return `${value}%`;
}

function presetLabelOf(presetKey: string): string {
  return RangePresetUtil.modeLabelOf(presetKey);
}

/** A choice read from the store until the viewer makes one, so a store that arrives after the first render is still read. */
function useStoredChoice<Choice>(read: () => Choice, write: (choice: Choice) => void): [Choice, (choice: Choice) => void] {
  const [chosen, setChosen] = useState<{ readonly choice: Choice } | null>(null);
  const stored = useMemo(() => read(), [read]);
  const choose = useCallback((choice: Choice) => {
    write(choice);
    setChosen({ choice });
  }, [write]);
  return [chosen === null ? stored : chosen.choice, choose];
}

/** The track's width in pixels as laid out, 0 where nothing is laid out. */
function useTrackWidthPixels(trackRef: RefObject<HTMLDivElement | null>): number {
  const [widthPixels, setWidthPixels] = useState(0);
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (track === null) return undefined;
    setWidthPixels(track.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setWidthPixels(track.clientWidth));
    observer.observe(track);
    return () => observer.disconnect();
  }, [trackRef]);
  return widthPixels;
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

function GroupHeadRow({ head, onToggle }: { readonly head: EpicGroupHeadModel; readonly onToggle: (groupKey: string) => void }) {
  const toggleOnKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onToggle(head.key);
  };
  return (
    <div
      className="bridge-progress-row bridge-progress-epic-head"
      data-epic-key={head.key}
      data-epic-slot={head.slot === null ? undefined : String(head.slot)}
      data-collapsed={head.isFolded ? '' : undefined}
      role="button"
      tabIndex={0}
      aria-expanded={!head.isFolded}
      onClick={() => onToggle(head.key)}
      onKeyDown={toggleOnKey}
    >
      <div className="bridge-progress-name">
        <span className="bridge-progress-epic-caret" aria-hidden="true">{FOLD_CARET}</span>
        <span className="bridge-progress-row-name">{head.label}</span>
        {head.sharedMemberCount === 0
          ? null
          : <span className="bridge-progress-epic-count" title={`${head.sharedMemberCount} of its tickets show under another epic`}>{`+${head.sharedMemberCount} shared`}</span>}
        <span className="bridge-progress-epic-count">{head.doneText ?? String(head.memberCount)}</span>
      </div>
      <div className="bridge-progress-track">
        {head.span === null
          ? null
          : (
            <div
              className="bridge-progress-epic-span"
              data-open={head.span.isOpen ? '' : undefined}
              title={head.span.title}
              style={{ left: percent(head.span.leftPercent), width: percent(head.span.widthPercent) }}
            />
          )}
      </div>
    </div>
  );
}

function ChartRows({ rows, groups, onToggleGroup }: {
  readonly rows:          readonly ProgressRowModel[];
  readonly groups:        readonly EpicRowGroup<ProgressRowModel>[] | null;
  readonly onToggleGroup: (groupKey: string) => void;
}) {
  if (rows.length === 0) return <p className="bridge-empty">No task has been recorded yet.</p>;
  if (groups === null) return <>{rows.map((row) => <ChartRow key={row.taskId} row={row} />)}</>;
  return (
    <>
      {groups.map((group) => [
        <GroupHeadRow key={`head-${group.head.key}`} head={group.head} onToggle={onToggleGroup} />,
        ...group.rows.map((row) => <ChartRow key={row.taskId} row={row} />),
      ])}
    </>
  );
}

export function ProgressView({
  boardState, boardStore, nowEpochMilliseconds, todayCalendarDate
}: ProgressViewProps) {
  const preferences = useMemo(() => progressPreferencesOf(boardStore), [boardStore]);
  const [override, chooseOverride] = useStoredChoice(preferences.readRangeOverride, preferences.writeRangeOverride);
  const [reviewRowsAreShown, chooseReviewRows] = useStoredChoice(preferences.readReviewRowsAreShown, preferences.writeReviewRowsAreShown);
  const [nameColumnWidth, chooseNameColumnWidth] = useStoredChoice(preferences.readNameColumnWidth, preferences.writeNameColumnWidth);
  const [foldedGroupKeys, chooseFoldedGroupKeys] = useStoredChoice(preferences.readFoldedEpicGroups, preferences.writeFoldedEpicGroups);
  const [customRangeIsOpen, setCustomRangeIsOpen] = useState(false);
  const rangeButtonRef = useRef<HTMLButtonElement | null>(null);
  const axisTrackRef = useRef<HTMLDivElement | null>(null);
  const trackWidthPixels = useTrackWidthPixels(axisTrackRef);

  const chart = useMemo(
    () => ProgressModel.progressChartOf(boardState, {
      override, reviewRowsAreShown, nowEpochMilliseconds, todayCalendarDate
    }),
    [boardState, override, reviewRowsAreShown, nowEpochMilliseconds, todayCalendarDate],
  );
  const groups = useMemo(() => EpicRowGrouping.epicRowGroupsOf(chart.rows, {
    epics:           boardState.page.payload.boardFacts.epics,
    tickets:         boardState.page.tickets,
    foldedGroupKeys: new Set(foldedGroupKeys),
    axis:            {
      fromEpochMilliseconds:   chart.fromEpochMilliseconds,
      toEpochMilliseconds:     chart.toEpochMilliseconds,
      nowEpochMilliseconds,
      minimumSpanWidthPercent: boardState.page.payload.limits.minimumBarWidthPercent,
      todayCalendarDate,
      slices:                  boardState.page.payload.limits,
    },
  }), [chart, boardState, foldedGroupKeys, nowEpochMilliseconds, todayCalendarDate]);
  const dependencies = useMemo(() => DependenciesModel.dependenciesModelOf(boardState, nowEpochMilliseconds), [boardState, nowEpochMilliseconds]);

  const axisPixelsNeeded = AxisFitUtil.axisPixelsNeededFor(chart.ticks);
  const axisWidthPixels = Math.max(trackWidthPixels, axisPixelsNeeded);
  const nowLabelSide = chart.nowPercent !== null && AxisFitUtil.nowLabelSitsLeftOfMarker(chart.nowPercent, axisWidthPixels) ? 'left' : undefined;
  const chartStyle = { '--progress-timeline-min-width': `${axisPixelsNeeded}px` } as CSSProperties;

  const choosePreset = (presetKey: string): void => chooseOverride(RangePresetUtil.overrideOfPreset(presetKey, override));
  const resolveBound = (text: string): number | null => ProgressModel.rangeBoundOf(boardState, text, nowEpochMilliseconds);
  const closeCustomRange = useCallback((returnFocus: boolean) => {
    setCustomRangeIsOpen(false);
    if (returnFocus) rangeButtonRef.current?.focus();
  }, []);
  const toggleGroup = (groupKey: string): void => chooseFoldedGroupKeys(EpicRowGrouping.foldedGroupKeysAfterToggle(foldedGroupKeys, groupKey));

  return (
    <div className="bridge-progress-view" data-name-column={nameColumnWidth}>
      <div className="bridge-progress-head">
        <HeadMenu
          label="Range"
          buttonRef={rangeButtonRef}
          buttonTitle={chart.rangeNoteTitle ?? chart.rangeNoteText}
          buttonContent={`${chart.modeLabel} ▾`}
        >
          <p className="bridge-progress-range-note" title={chart.rangeNoteTitle ?? undefined}>{chart.rangeNoteText}</p>
          {RANGE_PRESET_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className="bridge-menu-item"
              aria-pressed={key === chart.pressedPreset}
              data-closes-menu={CLOSES_MENU_RETURNING_FOCUS}
              onClick={() => choosePreset(key)}
            >
              {presetLabelOf(key)}
            </button>
          ))}
          <button
            type="button"
            className="bridge-menu-item"
            aria-pressed={chart.pressedPreset === CUSTOM_RANGE_PRESET}
            aria-expanded={customRangeIsOpen}
            data-closes-menu={CLOSES_MENU_KEEPING_FOCUS}
            onClick={() => setCustomRangeIsOpen(true)}
          >
            Custom…
          </button>
        </HeadMenu>
        {customRangeIsOpen
          ? (
            <CustomRangePopover
              appliedOverride={override}
              resolveBound={resolveBound}
              todayCalendarDate={todayCalendarDate}
              onApply={chooseOverride}
              onClose={closeCustomRange}
            />
          )
          : null}
        <HeadMenu label="Row options" buttonName="Row options" buttonContent="⋯">
          <button type="button" className="bridge-menu-item" aria-pressed={reviewRowsAreShown} onClick={() => chooseReviewRows(!reviewRowsAreShown)}>
            Review passes as rows
          </button>
          <button
            type="button"
            className="bridge-menu-item"
            aria-pressed={nameColumnWidth === 'wide'}
            onClick={() => chooseNameColumnWidth(ChartPreferenceUtil.toggledNameColumnWidth(nameColumnWidth))}
          >
            Wide titles
          </button>
        </HeadMenu>
      </div>
      <section className="bridge-progress-chart" aria-label="Progress chart" style={chartStyle}>
        <div className="bridge-progress-row bridge-progress-axis-row">
          <div className="bridge-progress-name" />
          <div ref={axisTrackRef} className="bridge-progress-track">
            {chart.ticks.map((tick) => (
              <span
                key={tick.leftPercent}
                className="bridge-progress-tick"
                data-label-side={AxisFitUtil.labelSitsLeftOfItsLine(tick, axisWidthPixels) ? 'left' : undefined}
                style={{ left: percent(tick.leftPercent) }}
              >
                {tick.label}
              </span>
            ))}
          </div>
        </div>
        <div className="bridge-progress-rows">
          <div className="bridge-progress-overlay" aria-hidden="true">
            {chart.ticks.map((tick) => <div key={tick.leftPercent} className="bridge-progress-grid-line" style={{ left: percent(tick.leftPercent) }} />)}
            {chart.nowPercent === null
              ? null
              : (
                <div className="bridge-progress-now" data-label-side={nowLabelSide} style={{ left: percent(chart.nowPercent) }}>
                  <span className="bridge-progress-now-label">now</span>
                </div>
              )}
          </div>
          <ChartRows rows={chart.rows} groups={groups} onToggleGroup={toggleGroup} />
        </div>
      </section>
      {dependencies === null ? null : <DependenciesView canvas={dependencies} />}
    </div>
  );
}
