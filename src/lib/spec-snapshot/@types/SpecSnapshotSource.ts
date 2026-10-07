/** The scanned repository the snapshot derives from, as a structural type: any scan holding these fields is a source, with nothing mapped. */

export type SourceFillState = 'template' | 'filled';

export type SourcePhaseKind = 'setup' | 'foundational' | 'user-story' | 'polish' | 'convergence' | 'other';

export interface SourceFileDate {
  /** ISO 8601; text that does not parse counts as an unknown date. */
  readonly at:     string;
  readonly source: string;
}

export interface SourceFileDates {
  readonly created:  SourceFileDate | null;
  readonly modified: SourceFileDate | null;
}

export interface SourceArtefact<Document> {
  readonly relativePath: string;
  readonly fillState:    SourceFillState;
  readonly dates:        SourceFileDates;
  readonly document:     Document;
}

export interface SourceUserStory {
  readonly number:   number;
  readonly title:    string;
  readonly priority: number;
}

export interface SourceOpenClarification {
  readonly text: string;
  readonly line: number;
}

export interface SourceClarificationSession {
  readonly answers: readonly unknown[];
}

export interface SourceSpecDocument {
  readonly title:                 string;
  readonly userStories:           readonly SourceUserStory[];
  readonly requirementIds:        readonly string[];
  readonly successCriterionIds:   readonly string[];
  readonly openClarifications:    readonly SourceOpenClarification[];
  readonly clarificationSessions: readonly SourceClarificationSession[];
}

export interface SourcePlanDocument {
  readonly openClarificationCount: number;
}

export interface SourceTask {
  readonly id:          string;
  readonly isDone:      boolean;
  readonly isParallel:  boolean;
  readonly storyNumber: number | null;
  readonly description: string;
}

export interface SourceTaskPhase {
  /** The phase's place in file order, from 1. */
  readonly ordinal:                number;
  readonly name:                   string;
  readonly kind:                   SourcePhaseKind;
  readonly storyNumber:            number | null;
  readonly storyPriority:          number | null;
  readonly isMinimumViableProduct: boolean;
  readonly tasks:                  readonly SourceTask[];
}

export interface SourceTasksDocument {
  readonly phases: readonly SourceTaskPhase[];
}

export interface SourceChecklistDocument {
  readonly title: string;
  readonly items: readonly { readonly isChecked: boolean }[];
}

export interface SourceFolder {
  readonly relativePath: string;
  readonly fileCount:    number;
  readonly dates:        SourceFileDates;
}

export interface SourceFeature {
  readonly folderName:   string;
  readonly relativePath: string;
  readonly spec:         SourceArtefact<SourceSpecDocument>;
  readonly plan:         SourceArtefact<SourcePlanDocument> | null;
  readonly research:     SourceArtefact<unknown> | null;
  readonly dataModel:    SourceArtefact<unknown> | null;
  readonly quickstart:   SourceArtefact<unknown> | null;
  readonly contracts:    SourceFolder | null;
  readonly tasks:        SourceArtefact<SourceTasksDocument> | null;
  readonly checklists:   readonly SourceArtefact<SourceChecklistDocument>[];
}

export interface SourceConstitutionDocument {
  readonly version:         string | null;
  readonly ratifiedDate:    string | null;
  readonly lastAmendedDate: string | null;
  readonly principleNames:  readonly string[];
}

export interface SourceUnreadableEntry {
  readonly relativePath: string;
  readonly reason:       string;
  readonly line:         number | null;
}

export interface SpecSnapshotSource {
  readonly rootDirectory: string;
  readonly initOptions:   SourceArtefact<{ readonly speckitVersion: string }> | null;
  readonly constitution:  SourceArtefact<SourceConstitutionDocument> | null;
  /** In the order the snapshot keeps. */
  readonly features:      readonly SourceFeature[];
  readonly unreadable:    readonly SourceUnreadableEntry[];
}
