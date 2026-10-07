import type { ConstitutionDocument, InitOptionsDocument } from './ConstitutionDocument.ts';
import type { PlanDocument, SpecDocument }                from './SpecDocument.ts';
import type { SpecKitFillState }                          from './SpecKitReading.ts';
import type { ChecklistDocument, TasksDocument }          from './TasksDocument.ts';

/** What the file system reports for one path, in epoch milliseconds; a birth time of 0 or less means it reports none. */
export interface FileTimes {
  readonly birthTimeMs:        number;
  readonly modificationTimeMs: number;
}

export type FileTimesReader = (path: string) => FileTimes;

export type FileDateSource = 'birth-time' | 'modification-time';

export interface FileDate {
  /** ISO 8601 in UTC. */
  readonly at:     string;
  readonly source: FileDateSource;
}

export interface FileDates {
  readonly created:  FileDate;
  readonly modified: FileDate;
}

/** A file found and read. `relativePath` is from the repository root, with `/` separators. */
export interface SpecKitArtefact<Document> {
  readonly relativePath: string;
  readonly fillState:    SpecKitFillState;
  readonly dates:        FileDates;
  readonly document:     Document;
}

/** A file spec-kit keeps no template for, so one present is filled; its text is not parsed. */
export type SpecKitPlainArtefact = SpecKitArtefact<null>;

export interface SpecKitContractsFolder {
  readonly relativePath: string;
  readonly fileCount:    number;
  readonly dates:        FileDates;
}

export interface SpecKitFeature {
  /** The folder's name under `specs/`, such as `001-customer-login`. */
  readonly folderName:   string;
  readonly relativePath: string;
  readonly spec:         SpecKitArtefact<SpecDocument>;
  readonly plan:         SpecKitArtefact<PlanDocument> | null;
  readonly research:     SpecKitPlainArtefact | null;
  readonly dataModel:    SpecKitPlainArtefact | null;
  readonly quickstart:   SpecKitPlainArtefact | null;
  readonly contracts:    SpecKitContractsFolder | null;
  readonly tasks:        SpecKitArtefact<TasksDocument> | null;
  /** In file name order; empty when the feature has no `checklists/` folder. */
  readonly checklists:   readonly SpecKitArtefact<ChecklistDocument>[];
}

/** A path the scan could not take in, and why; `line` is null where the reason concerns no line. */
export interface SpecKitUnreadableEntry {
  readonly relativePath: string;
  readonly reason:       string;
  readonly line:         number | null;
}

export interface SpecKitScan {
  readonly rootDirectory: string;
  readonly initOptions:   SpecKitArtefact<InitOptionsDocument> | null;
  readonly constitution:  SpecKitArtefact<ConstitutionDocument> | null;
  /** In folder name order. */
  readonly features:      readonly SpecKitFeature[];
  readonly unreadable:    readonly SpecKitUnreadableEntry[];
}

export type SpecKitRootVerdict =
  | { readonly verdict: 'found'; readonly rootDirectory: string }
  | { readonly verdict: 'not-found'; readonly searchedDirectory: string };
