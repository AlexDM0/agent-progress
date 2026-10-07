import { LocalTimeUtil }                        from '../../local-time/LocalTimeUtil.ts';
import type { SnapshotDate }                    from '../@types/SpecSnapshot.ts';
import type { SourceFileDate, SourceFileDates } from '../@types/SpecSnapshotSource.ts';

/** A date whose text does not parse is unknown, as is a missing one. */
function snapshotDateOf(date: SourceFileDate | null): SnapshotDate | null {
  const parsed = date === null ? null : LocalTimeUtil.parseIso(date.at);
  return date === null || parsed === null ? null : { at: LocalTimeUtil.formatLocalIso(parsed), source: date.source };
}

function snapshotDatesOf(dates: SourceFileDates): { readonly created: SnapshotDate | null; readonly modified: SnapshotDate | null } {
  return { created: snapshotDateOf(dates.created), modified: snapshotDateOf(dates.modified) };
}

export const SpecDateUtil = { snapshotDateOf, snapshotDatesOf } as const;
