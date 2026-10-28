/**
 * Usage limits, design section 7.5: a top-level refusal in a job's stream interrupts the job (cause `usage-limit`, resumed by id after the
 * reset) and is written to the machine-wide marker, which every runner reads back as the `usageResetsAt` its lifecycle policy holds by.
 */
import { type UsageMarkerReading, UsageMarkerFile } from '../../adapters/usage-marker/UsageMarkerFile.ts';
import type { AgentSessionEvent }                   from '../../lib/agent-launch/AgentSessionEvent.ts';
import type { Board }                               from '../../lib/tracker-model/Board.ts';

export interface UsageLimitHit {
  jobId:    string;
  window:   string;
  resetsAt: string;
}

/** Only a top-level refusal stops requests; a per-window warning, or a window rejected under allowed overage, is shown and writes nothing. */
function refusalOf(event: AgentSessionEvent): { window: string; resetsAt: string } | null {
  return event.kind === 'usage-window' && event.requestsRefused ? { window: event.window, resetsAt: event.resetsAt } : null;
}

/** The runner's own stop: never a crash, so never counted toward `JOB_RESUMES_BEFORE_FRESH` and never a failed pass. */
function interruptLimitedJob(board: Board, hit: UsageLimitHit, at: string): void {
  board.interruptJob(hit.jobId, 'usage-limit', at);
  board.recordUsageLimitHit(hit.jobId, { window: hit.window, resetsAt: hit.resetsAt }, at);
}

function latestResetOf(hits: readonly UsageLimitHit[]): UsageLimitHit | null {
  return hits.reduce<UsageLimitHit | null>((latest, hit) => (latest === null || Date.parse(hit.resetsAt) > Date.parse(latest.resetsAt) ? hit : latest), null);
}

/** The marker's reset and this pass's own hits alike, so a limit met in this hold already holds the launches it decides. */
function usageResetsAtOf(reading: UsageMarkerReading, hits: readonly UsageLimitHit[]): string | null {
  const markedReset = reading.verdict === 'read' ? [reading.marker.resetsAt] : [];
  const resets = [...markedReset, ...hits.map((hit) => hit.resetsAt)];
  return resets.reduce<string | null>((latest, reset) => (latest === null || Date.parse(reset) > Date.parse(latest) ? reset : latest), null);
}

/** Written only when it moves the reset later, so a runner never shortens a limit another board met. */
function markHits(monitorFolder: string, vendor: string, trackerId: string, hits: readonly UsageLimitHit[]): void {
  const latest = latestResetOf(hits);
  if (latest === null) return;
  const reading = UsageMarkerFile.read(monitorFolder);
  if (reading.verdict === 'read' && Date.parse(reading.marker.resetsAt) >= Date.parse(latest.resetsAt)) return;
  UsageMarkerFile.write(monitorFolder, {
    vendor, window: latest.window, resetsAt: latest.resetsAt, seenBy: { trackerId, jobId: latest.jobId }
  });
}

/** A longer timer delay overflows and fires at once; a pass woken early schedules the rest. */
const LONGEST_TIMER_DELAY_MILLISECONDS = 2_147_483_647;

/** Schedule only: how long until the reset, or `null` once it passed, for the DrivePass the runner wakes at it. */
function millisecondsUntilReset(usageResetsAt: string | null, now: Date): number | null {
  if (usageResetsAt === null) return null;
  const remaining = Date.parse(usageResetsAt) - now.getTime();
  return remaining > 0 ? Math.min(remaining, LONGEST_TIMER_DELAY_MILLISECONDS) : null;
}

export const UsageLimits = Object.freeze({
  refusalOf, interruptLimitedJob, usageResetsAtOf, markHits, millisecondsUntilReset
});
