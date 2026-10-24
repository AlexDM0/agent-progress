/**
 * The filing cabinet as a store: `D<n>.json` per open draft. Nothing here throws because a draft file is bad: a malformed file is a listing
 * entry, so one broken file cannot take down `status` or `render`.
 */
import { readdirSync }              from 'node:fs';
import { join }                     from 'node:path';
import { DraftFileIngestion }       from '../../adapters/drafts/DraftFileIngestion.ts';
import type { Draft }               from '../../lib/tracker-model/@types/Draft.ts';
import type { MalformedTicketFile } from './TicketStore.ts';
import type { Workspace }           from './Workspace.ts';

/** The same report a malformed ticket file makes; a JSON draft has no line to point at, so `line` is 0. */
export type MalformedDraftFile = MalformedTicketFile;

export interface DraftListing {
  drafts:    Draft[];
  malformed: MalformedDraftFile[];
}

const DRAFT_FILE_EXTENSION = '.json';

/** A missing folder reads as "no drafts", so a tracker that never opened one reads as it always did. */
function draftFileNamesIn(workspace: Workspace): string[] {
  let entries: string[];
  try {
    entries = readdirSync(workspace.draftsDirectory);
  } catch {
    return [];
  }
  return entries.filter((entry) => entry.endsWith(DRAFT_FILE_EXTENSION)).sort();
}

/** A draft is its file name: a file whose `id` says otherwise is listed as malformed, since which of the two is the draft cannot be judged. */
export function listDrafts(workspace: Workspace): DraftListing {
  const drafts: Draft[]                = [];
  const malformed: MalformedDraftFile[] = [];

  for (const fileName of draftFileNamesIn(workspace)) {
    const filePath  = join(workspace.draftsDirectory, fileName);
    const reading   = new DraftFileIngestion(filePath).read();
    const idInName  = fileName.slice(0, -DRAFT_FILE_EXTENSION.length);

    if (reading.verdict === 'malformed') malformed.push({ filePath, reason: reading.reason, line: 0 });
    else if (reading.draft.id !== idInName) {
      malformed.push({ filePath, reason: `the file name says ${idInName} but its \`id\` is ${reading.draft.id}`, line: 0 });
    }
    else drafts.push(reading.draft);
  }
  return { drafts, malformed };
}

export function draftFilePathOf(workspace: Workspace, draftId: string): string {
  return join(workspace.draftsDirectory, `${draftId}${DRAFT_FILE_EXTENSION}`);
}
