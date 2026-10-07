/**
 * The spec page's browser entry: it reads the spec island of `resources/spec-template.html` and fills the frame through the shared shell, the
 * status line as a snapshot's, the header from the spec header model, the edition badge and the unreadable entries' banner, and wires the
 * detail panel on the spec page's own targets.
 */

import type { SpecSnapshot } from '../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import type { PageLimits }   from '../../src/shared/@types/PagePayload.ts';
import {
  CHART_ELEMENT_ID,
  DETAIL_BODY_ELEMENT_ID,
  GENERATED_STAMP_ELEMENT_ID,
  KANBAN_BOARD_ELEMENT_ID,
  PROJECT_NAME_ELEMENT_ID,
  STATUS_LABEL_ELEMENT_ID,
  SUMMARY_ELEMENT_ID,
} from '../constants/TemplateIds.ts';
import { createDetailPanelController } from '../detail-dialog/DetailPanelController.ts';
import { headerStatisticsMarkup }      from '../header/HeaderMarkup.ts';
import { showStatusLine }              from '../header/StatusLine.ts';
import { HeaderFigureUtil }            from '../header/utils/HeaderFigureUtil.ts';
import { createFragmentRouter }        from '../shell/FragmentRouter.ts';
import { PageShell }                   from '../shell/PageShell.ts';
import { DomUtil }                     from '../utils/DomUtil.ts';
import { TimeUtil }                    from '../utils/TimeUtil.ts';
import { unreadableEntriesMarkup }     from './UnreadableEntriesMarkup.ts';
import { specDetailTargetsOf }         from './detail-dialog/SpecDetailTargets.ts';
import { specEditionBadgeMarkup }      from './header/SpecEditionBadgeMarkup.ts';
import { specHeaderModelOf }           from './header/SpecHeaderModel.ts';

interface SpecPagePayload {
  readonly snapshot: SpecSnapshot;
  readonly limits:   PageLimits;
}

const SPEC_ISLAND_ELEMENT_ID = 'ap-spec-data';

const TAB_NAMES = ['kanban', 'progress', 'tickets', 'specs', 'dependencies'];

const EDITION_BADGE_ELEMENT_ID     = 'ap-spec-edition';
const UNREADABLE_BANNER_ELEMENT_ID = 'ap-spec-unreadable';
const UNREADABLE_LIST_ELEMENT_ID   = 'ap-spec-unreadable-list';

const KANBAN_EMPTY_ELEMENT_ID       = 'ap-spec-kanban-empty';
const PROGRESS_EMPTY_ELEMENT_ID     = 'ap-spec-progress-empty';
const TICKETS_EMPTY_ELEMENT_ID      = 'ap-spec-tickets-empty';
const SPECS_EMPTY_ELEMENT_ID        = 'ap-spec-specs-empty';
const DEPENDENCIES_EMPTY_ELEMENT_ID = 'ap-spec-dependencies-empty';

const VIEW_CONTAINER_IDS = [KANBAN_BOARD_ELEMENT_ID, CHART_ELEMENT_ID, 'ap-spec-tickets', 'ap-spec-specs', 'ap-spec-dependencies'];

const OWNED_MARKUP_CONTAINER_IDS = [
  SUMMARY_ELEMENT_ID, EDITION_BADGE_ELEMENT_ID, UNREADABLE_LIST_ELEMENT_ID, DETAIL_BODY_ELEMENT_ID, ...VIEW_CONTAINER_IDS,
];
const OWNED_TEXT_CONTAINER_IDS   = [PROJECT_NAME_ELEMENT_ID, STATUS_LABEL_ELEMENT_ID, GENERATED_STAMP_ELEMENT_ID];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Checks the fields the frame reads; the render writes the island from a validated snapshot, so the rest is taken as written. */
function specPagePayloadFrom(islandContents: unknown): SpecPagePayload | null {
  if (!isRecord(islandContents)) {
    return null;
  }
  const { snapshot, limits } = islandContents;
  if (!isRecord(snapshot) || !isRecord(limits)) {
    return null;
  }
  const fieldsAreReadable = typeof snapshot['project'] === 'string'
    && typeof snapshot['generatedAt'] === 'string'
    && Array.isArray(snapshot['specs'])
    && Array.isArray(snapshot['openMarkers'])
    && Array.isArray(snapshot['unreadable'])
    && isRecord(snapshot['laneCounts'])
    && isRecord(snapshot['tasks']);
  return fieldsAreReadable ? islandContents as unknown as SpecPagePayload : null;
}

function showHeader(snapshot: SpecSnapshot, limits: PageLimits): void {
  const nowEpochMilliseconds = Date.now();
  const generatedAt          = TimeUtil.epochMillisecondsOf(snapshot.generatedAt) ?? nowEpochMilliseconds;
  const { ageText }          = HeaderFigureUtil.freshnessOf(generatedAt, nowEpochMilliseconds, limits);
  showStatusLine(generatedAt, { isLive: false, ageText }, TimeUtil.calendarDateOf(nowEpochMilliseconds));

  const headerModel = specHeaderModelOf(snapshot);
  DomUtil.setText(PROJECT_NAME_ELEMENT_ID, headerModel.projectTitle);
  DomUtil.setMarkup(SUMMARY_ELEMENT_ID, headerStatisticsMarkup(headerModel.statistics));

  const badgeMarkup = specEditionBadgeMarkup(snapshot.specKitVersion, snapshot.constitution?.version ?? null);
  DomUtil.setMarkup(EDITION_BADGE_ELEMENT_ID, badgeMarkup ?? '');
  DomUtil.setHidden(EDITION_BADGE_ELEMENT_ID, badgeMarkup === null);
}

function startSpecPage(): void {
  PageShell.clearOwnedContainers(OWNED_MARKUP_CONTAINER_IDS, OWNED_TEXT_CONTAINER_IDS);
  const payload = specPagePayloadFrom(PageShell.islandContentsOf(SPEC_ISLAND_ELEMENT_ID));
  if (payload === null) {
    PageShell.showLayoutFailure('The spec data island is missing or could not be read, so the spec view could not be built.');
    return;
  }
  const { snapshot, limits } = payload;
  showHeader(snapshot, limits);

  DomUtil.setMarkup(UNREADABLE_LIST_ELEMENT_ID, unreadableEntriesMarkup(snapshot.unreadable));
  DomUtil.setHidden(UNREADABLE_BANNER_ELEMENT_ID, snapshot.unreadable.length === 0);
  // One call per empty state, each naming its id's constant, so the template guards resolve every id the page hides.
  const snapshotHasSpecs = snapshot.specs.length > 0;
  DomUtil.setHidden(KANBAN_EMPTY_ELEMENT_ID, snapshotHasSpecs);
  DomUtil.setHidden(PROGRESS_EMPTY_ELEMENT_ID, snapshotHasSpecs);
  DomUtil.setHidden(TICKETS_EMPTY_ELEMENT_ID, snapshotHasSpecs);
  DomUtil.setHidden(SPECS_EMPTY_ELEMENT_ID, snapshotHasSpecs);
  DomUtil.setHidden(DEPENDENCIES_EMPTY_ELEMENT_ID, snapshotHasSpecs);

  createDetailPanelController({
    targets:              specDetailTargetsOf(snapshot),
    linkOpeners:          [],
    observedContainerIds: VIEW_CONTAINER_IDS,
    updateOverflow:       () => undefined,
  }).wire();

  const fragmentRouter = createFragmentRouter({ tabNames: TAB_NAMES, openItemFragment: () => false });
  window.addEventListener('hashchange', () => fragmentRouter.applyFragment(window.location.hash));
  fragmentRouter.applyFragment(window.location.hash);
}

// The one deliberate exception to "no work at module load": a browser entry has no caller.
PageShell.startWhenReady(startSpecPage);
