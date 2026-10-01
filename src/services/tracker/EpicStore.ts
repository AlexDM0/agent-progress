/**
 * The epics directory as a store: `<key>.md` per epic. Nothing here throws because an epic file is bad: a malformed file is a listing
 * entry, so one broken file cannot take down `status` or `render`.
 */
import { readdirSync, unlinkSync }  from 'node:fs';
import { join }                     from 'node:path';
import { EpicFileIngestion }        from '../../adapters/epics/EpicFileIngestion.ts';
import type { Epic }                from '../../lib/tracker-model/@types/Epic.ts';
import type { MalformedTicketFile } from './TicketStore.ts';
import type { Workspace }           from './Workspace.ts';

/** The same report a malformed ticket file makes: the file, why, and the line. */
export type MalformedEpicFile = MalformedTicketFile;

export interface EpicListing {
  epics:     Epic[];
  malformed: MalformedEpicFile[];
}

const EPIC_FILE_EXTENSION = '.md';

/** A missing epics directory reads as "no epics" rather than as a failure, so a tracker that never added one reads as it always did. */
function epicFileNamesIn(workspace: Workspace): string[] {
  let entries: string[];
  try {
    entries = readdirSync(workspace.epicsDirectory);
  } catch {
    return [];
  }
  return entries.filter((entry) => entry.endsWith(EPIC_FILE_EXTENSION)).sort();
}

/** An epic is its file name: a file whose `key` says otherwise is listed as malformed, since which of the two is the epic cannot be judged. */
export function listEpics(workspace: Workspace): EpicListing {
  const epics: Epic[]                   = [];
  const malformed: MalformedEpicFile[]  = [];

  for (const fileName of epicFileNamesIn(workspace)) {
    const filePath = join(workspace.epicsDirectory, fileName);
    const reading  = new EpicFileIngestion(filePath).read();
    const keyInName = fileName.slice(0, -EPIC_FILE_EXTENSION.length);

    if (reading.verdict === 'malformed') malformed.push({ filePath, reason: reading.reason, line: reading.line });
    else if (reading.epic.frontmatter.key !== keyInName) {
      malformed.push({ filePath, reason: `the file name says ${keyInName} but its \`key\` is ${reading.epic.frontmatter.key}`, line: 0 });
    }
    else epics.push(reading.epic);
  }
  return { epics, malformed };
}

/** `clear --all`: the Board already removed every epic it read, so this takes the files it could not read. */
export function deleteEveryEpicFile(workspace: Workspace): void {
  for (const fileName of epicFileNamesIn(workspace)) unlinkSync(join(workspace.epicsDirectory, fileName));
}

export function epicFilePathOf(workspace: Workspace, epicKey: string): string {
  return join(workspace.epicsDirectory, `${epicKey}${EPIC_FILE_EXTENSION}`);
}
