/** The page's status line: its Live or Snapshot label, its generated text, and its `data-freshness` on `#ap-status`. */

import { GENERATED_STAMP_ELEMENT_ID, STATUS_LABEL_ELEMENT_ID } from '../constants/TemplateIds.ts';
import { DomUtil }                                             from '../utils/DomUtil.ts';
import { freshnessLabel, freshnessText }                       from './HeaderMarkup.ts';
import type { PageFreshness }                                  from './utils/HeaderFigureUtil.ts';

const STATUS_LINE_ELEMENT_ID = 'ap-status';

export function showStatusLine(generatedAtEpochMilliseconds: number, freshness: PageFreshness, todayCalendarDate: string): void {
  document.getElementById(STATUS_LINE_ELEMENT_ID)?.setAttribute('data-freshness', freshness.isLive ? 'live' : 'snapshot');
  DomUtil.setText(STATUS_LABEL_ELEMENT_ID, freshnessLabel(freshness));
  DomUtil.setShortenedText(GENERATED_STAMP_ELEMENT_ID, freshnessText(generatedAtEpochMilliseconds, freshness, todayCalendarDate));
}
