/**
 * A spec-kit repository read from disk, writing nothing: its init options, its constitution and every feature folder under `specs/`, each
 * file parsed by the readers in `utils/` and dated. A file that cannot be read or parses as `malformed` is an unreadable entry, never a stop.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join }                                from 'node:path';

import type { SpecKitFillState, SpecKitReading } from './@types/SpecKitReading.ts';
import type {
  FileDates,
  FileTimesReader,
  SpecKitArtefact,
  SpecKitContractsFolder,
  SpecKitFeature,
  SpecKitPlainArtefact,
  SpecKitScan,
  SpecKitUnreadableEntry
} from './@types/SpecKitScan.ts';
import { SpecFeatureDocumentUtil } from './utils/SpecFeatureDocumentUtil.ts';
import { SpecKitChecklistUtil }    from './utils/SpecKitChecklistUtil.ts';
import { SpecKitMemoryUtil }       from './utils/SpecKitMemoryUtil.ts';

const INIT_OPTIONS_PATH     = '.specify/init-options.json';
const CONSTITUTION_PATH     = '.specify/memory/constitution.md';
const SPECS_DIRECTORY       = 'specs';
const SPEC_FILE_NAME        = 'spec.md';
const PLAN_FILE_NAME        = 'plan.md';
const RESEARCH_FILE_NAME    = 'research.md';
const DATA_MODEL_FILE_NAME  = 'data-model.md';
const QUICKSTART_FILE_NAME  = 'quickstart.md';
const CONTRACTS_FOLDER_NAME = 'contracts';
const TASKS_FILE_NAME       = 'tasks.md';
const CHECKLISTS_FOLDER     = 'checklists';
const MARKDOWN_EXTENSION    = '.md';

function fileTimesFromTheFileSystem(path: string): { birthTimeMs: number; modificationTimeMs: number } {
  const status = statSync(path);
  return { birthTimeMs: status.birthtimeMs, modificationTimeMs: status.mtimeMs };
}

/** A document spec-kit copies from no template, `init-options.json`, has no fill state and is filled once present. */
function fillStateOf(document: object): SpecKitFillState {
  return 'fillState' in document && document.fillState === 'template' ? 'template' : 'filled';
}

function reasonOf(problem: unknown): string {
  return problem instanceof Error ? problem.message : String(problem);
}

function pathExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/** A missing folder lists as empty, so a repository without `specs/` or a feature without `checklists/` reads as having none. */
function sortedEntriesOf(directory: string): { name: string; isDirectory: boolean }[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch {
    return [];
  }
}

export function createSpecKitRepositoryScan(fileTimesOf: FileTimesReader = fileTimesFromTheFileSystem): { scan(rootDirectory: string): SpecKitScan } {
  function datesOf(absolutePath: string): FileDates {
    const { birthTimeMs, modificationTimeMs } = fileTimesOf(absolutePath);
    const modified = { at: new Date(modificationTimeMs).toISOString(), source: 'modification-time' } as const;
    // A clock exception, recorded and shown only: a file system without birth times reports 0, and the modification time is the nearest stand-in.
    const created = birthTimeMs > 0 ? { at: new Date(birthTimeMs).toISOString(), source: 'birth-time' } as const : modified;
    return { created, modified };
  }

  function scan(rootDirectory: string): SpecKitScan {
    const unreadable: SpecKitUnreadableEntry[] = [];

    /** Null when the file is absent; an unreadable entry and null when it cannot be read or parses as malformed. */
    function parsedArtefactOf<Document extends object>(
      relativePath: string,
      readingOf: (text: string) => SpecKitReading<Document>,
    ): SpecKitArtefact<Document> | null {
      const absolutePath = join(rootDirectory, relativePath);
      if (!pathExists(absolutePath)) return null;
      try {
        const reading = readingOf(readFileSync(absolutePath, 'utf8'));
        if (reading.verdict === 'malformed') {
          unreadable.push({ relativePath, reason: reading.reason, line: reading.line });
          return null;
        }
        return {
          relativePath, fillState: fillStateOf(reading.document), dates: datesOf(absolutePath), document: reading.document
        };
      } catch (problem) {
        unreadable.push({ relativePath, reason: reasonOf(problem), line: null });
        return null;
      }
    }

    function plainArtefactOf(relativePath: string): SpecKitPlainArtefact | null {
      const absolutePath = join(rootDirectory, relativePath);
      if (!pathExists(absolutePath)) return null;
      try {
        return {
          relativePath, fillState: 'filled', dates: datesOf(absolutePath), document: null
        };
      } catch (problem) {
        unreadable.push({ relativePath, reason: reasonOf(problem), line: null });
        return null;
      }
    }

    function contractsFolderOf(relativePath: string): SpecKitContractsFolder | null {
      const absolutePath = join(rootDirectory, relativePath);
      if (!pathExists(absolutePath)) return null;
      try {
        const fileCount = readdirSync(absolutePath, { withFileTypes: true }).filter((entry) => entry.isFile()).length;
        return { relativePath, fileCount, dates: datesOf(absolutePath) };
      } catch (problem) {
        unreadable.push({ relativePath, reason: reasonOf(problem), line: null });
        return null;
      }
    }

    function featureOf(folderName: string): SpecKitFeature | null {
      const relativePath = `${SPECS_DIRECTORY}/${folderName}`;
      if (!pathExists(join(rootDirectory, relativePath, SPEC_FILE_NAME))) {
        unreadable.push({ relativePath, reason: `the feature folder has no \`${SPEC_FILE_NAME}\``, line: null });
        return null;
      }
      const spec = parsedArtefactOf(`${relativePath}/${SPEC_FILE_NAME}`, SpecFeatureDocumentUtil.specReadingOf);
      if (spec === null) return null;

      const checklistsPath = `${relativePath}/${CHECKLISTS_FOLDER}`;
      const checklists = sortedEntriesOf(join(rootDirectory, checklistsPath))
        .filter((entry) => !entry.isDirectory && entry.name.endsWith(MARKDOWN_EXTENSION))
        .map((entry) => parsedArtefactOf(`${checklistsPath}/${entry.name}`, SpecKitChecklistUtil.checklistReadingOf))
        .filter((checklist) => checklist !== null);

      return {
        folderName,
        relativePath,
        spec,
        plan:       parsedArtefactOf(`${relativePath}/${PLAN_FILE_NAME}`, SpecFeatureDocumentUtil.planReadingOf),
        research:   plainArtefactOf(`${relativePath}/${RESEARCH_FILE_NAME}`),
        dataModel:  plainArtefactOf(`${relativePath}/${DATA_MODEL_FILE_NAME}`),
        quickstart: plainArtefactOf(`${relativePath}/${QUICKSTART_FILE_NAME}`),
        contracts:  contractsFolderOf(`${relativePath}/${CONTRACTS_FOLDER_NAME}`),
        tasks:      parsedArtefactOf(`${relativePath}/${TASKS_FILE_NAME}`, SpecKitChecklistUtil.tasksReadingOf),
        checklists,
      };
    }

    const initOptions = parsedArtefactOf(INIT_OPTIONS_PATH, SpecKitMemoryUtil.initOptionsReadingOf);
    const constitution = parsedArtefactOf(CONSTITUTION_PATH, SpecKitMemoryUtil.constitutionReadingOf);
    const features = sortedEntriesOf(join(rootDirectory, SPECS_DIRECTORY))
      .filter((entry) => entry.isDirectory)
      .map((entry) => featureOf(entry.name))
      .filter((feature) => feature !== null);

    return {
      rootDirectory, initOptions, constitution, features, unreadable
    };
  }

  return { scan };
}
