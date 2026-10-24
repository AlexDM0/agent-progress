/**
 * Drafts as records: opened, claimed, released, closed into the tickets filed from them, or abandoned. A draft is not a ticket: it has no
 * status, row or move, and only `claimDraft` looks at who holds it.
 */
import type { DraftChanged, DraftClaimChanged }   from './@types/BoardChanges.ts';
import type { Draft, DraftOpening, DraftSummary } from './@types/Draft.ts';
import type { BoardRecords }                      from './BoardRecords.ts';
import { BoardRefusal }                           from './BoardRefusal.ts';
import { FIRST_DRAFT_NUMBER }                     from './constants/DraftFields.ts';
import { DraftIdUtil }                            from './utils/DraftIdUtil.ts';

export class Drafts {
  constructor(private readonly records: BoardRecords) {}

  openDraft(opening: DraftOpening, at: string): DraftChanged {
    const { title, request, owner } = opening;
    const draft: Draft = {
      id:       DraftIdUtil.draftIdOf(this.takeNextDraftNumber()),
      title,
      request,
      openedAt: at,
      claim:    { owner, claimedAt: at },
      extra:    [],
    };
    this.records.draftRecords.push(draft);
    this.records.markDraftChanged(draft);
    return { logged: [this.records.logger.log({ kind: 'draft-opened', draftId: draft.id, fields: { title, owner } }, at)], draft };
  }

  /** Never judges how long ago the holder claimed it: only `forces` takes a draft another owner holds. */
  claimDraft(draftId: string, request: { owner: string; forces: boolean }, at: string): DraftClaimChanged {
    const draft         = this.requireDraft(draftId);
    const previousOwner = draft.claim?.owner ?? null;
    if (previousOwner === request.owner) return { logged: [], draft, changed: false };
    if (previousOwner !== null && !request.forces) throw new BoardRefusal({ reason: 'draft-claimed-by-another-owner', draftId, owner: previousOwner });

    draft.claim = { owner: request.owner, claimedAt: at };
    this.records.markDraftChanged(draft);
    const fields = previousOwner === null ? { owner: request.owner } : { owner: request.owner, takenFrom: previousOwner };
    return { logged: [this.records.logger.log({ kind: 'draft-claimed', draftId, fields }, at)], draft, changed: true };
  }

  releaseDraft(draftId: string, at: string): DraftClaimChanged {
    const draft = this.requireDraft(draftId);
    if (draft.claim === null) return { logged: [], draft, changed: false };

    const { owner } = draft.claim;
    draft.claim     = null;
    this.records.markDraftChanged(draft);
    return { logged: [this.records.logger.log({ kind: 'draft-released', draftId, fields: { owner } }, at)], draft, changed: true };
  }

  /** Every reference must name a ticket the board holds; the log keeps the ids the draft became, as the tickets store them. */
  closeDraft(draftId: string, ticketReferences: readonly string[], at: string): DraftChanged {
    const draft             = this.requireDraft(draftId);
    const missingReferences = ticketReferences.filter((reference) => this.records.ticketRecordByReference(reference) === undefined);
    if (missingReferences.length > 0) {
      throw new BoardRefusal({ reason: 'draft-closed-into-unknown-tickets', draftId, missingTicketReferences: missingReferences });
    }
    const ticketIds = [...new Set(ticketReferences.flatMap((reference) => this.records.ticketRecordByReference(reference)?.frontmatter.id ?? []))];
    this.removeDraftRecord(draft);
    return { logged: [this.records.logger.log({ kind: 'draft-closed', draftId, fields: { ticketIds } }, at)], draft };
  }

  abandonDraft(draftId: string, reason: string, at: string): DraftChanged {
    const draft = this.requireDraft(draftId);
    this.removeDraftRecord(draft);
    return { logged: [this.records.logger.log({ kind: 'draft-abandoned', draftId, fields: { reason } }, at)], draft };
  }

  /** In id order. */
  openDraftSummaries(): DraftSummary[] {
    return this.draftsInIdOrder().map((draft) => ({
      id: draft.id, title: draft.title, claimOwner: draft.claim?.owner ?? null, openedAt: draft.openedAt
    }));
  }

  draftsInIdOrder(): Draft[] {
    return [...this.records.draftRecords].sort((a, b) => (DraftIdUtil.draftNumberOf(a.id) ?? 0) - (DraftIdUtil.draftNumberOf(b.id) ?? 0));
  }

  private requireDraft(draftId: string): Draft {
    const draft = this.records.draftRecordById(draftId);
    if (draft === undefined) throw new BoardRefusal({ reason: 'unknown-draft', draftId });
    return draft;
  }

  private removeDraftRecord(draft: Draft): void {
    this.records.draftRecords.splice(this.records.draftRecords.indexOf(draft), 1);
    const changedIndex = this.records.changedDraftRecords.indexOf(draft);
    if (changedIndex !== -1) this.records.changedDraftRecords.splice(changedIndex, 1);
    this.records.removedDraftRecords.push(draft);
  }

  /** The counter is stored and never wound back, so a closed or abandoned draft's id is never handed to a new one. */
  private takeNextDraftNumber(): number {
    const highestExistingNumber = this.records.draftRecords.reduce((highest, draft) => Math.max(highest, DraftIdUtil.draftNumberOf(draft.id) ?? 0), 0);
    const allocated             = Math.max(this.records.progress.nextDraftId ?? FIRST_DRAFT_NUMBER, highestExistingNumber + 1);
    this.records.progress.nextDraftId = allocated + 1;
    return allocated;
  }
}
