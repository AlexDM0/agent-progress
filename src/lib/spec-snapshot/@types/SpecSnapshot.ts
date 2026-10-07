import type { SpecLane, SpecStage, WorkItemState }     from '../constants/SpecSnapshotVocabulary.ts';
import type { SourcePhaseKind, SourceUnreadableEntry } from './SpecSnapshotSource.ts';

export type SpecArtefactKind = 'spec' | 'plan' | 'research' | 'data-model' | 'quickstart' | 'contracts' | 'tasks' | 'checklist';

export interface SnapshotDate {
  /** Local-offset ISO 8601. */
  readonly at:     string;
  readonly source: string;
}

export interface SnapshotArtefact {
  readonly kind:         SpecArtefactKind;
  readonly relativePath: string;
  readonly state:        'template' | 'filled';
  readonly created:      SnapshotDate | null;
  readonly modified:     SnapshotDate | null;
}

export interface TickCount {
  readonly ticked: number;
  readonly total:  number;
}

export interface WorkItemTask {
  readonly id:          string;
  readonly isDone:      boolean;
  readonly isParallel:  boolean;
  readonly storyNumber: number | null;
  readonly description: string;
}

/** One `tasks.md` phase. */
export interface WorkItem {
  /** The feature folder name, `-p` and the two-digit phase ordinal. */
  readonly id:                     string;
  readonly ordinal:                number;
  readonly kind:                   SourcePhaseKind;
  readonly storyNumber:            number | null;
  readonly priority:               number | null;
  readonly isMinimumViableProduct: boolean;
  readonly title:                  string;
  /** The story and priority labels as `tasks.md` writes them, null for a phase of no story. */
  readonly tagText:                string | null;
  readonly state:                  WorkItemState;
  readonly taskCount:              number;
  readonly tickedCount:            number;
  readonly tasks:                  readonly WorkItemTask[];
  readonly dependsOn:              readonly string[];
  readonly waitingOn:              readonly string[];
}

export interface SnapshotStory {
  readonly number:     number;
  readonly title:      string;
  readonly priority:   number;
  /** Null when `tasks.md` has no phase for the story. */
  readonly phaseState: WorkItemState | null;
}

export interface SpecCounts {
  readonly functionalRequirements: number;
  readonly successCriteria:        number;
  readonly openMarkers:            number;
  readonly clarificationSessions:  number;
  readonly clarificationAnswers:   number;
}

export interface SnapshotChecklist {
  readonly relativePath: string;
  readonly title:        string;
  readonly checked:      number;
  readonly total:        number;
}

export interface StageBoundary {
  readonly artefact: SpecArtefactKind;
  readonly date:     SnapshotDate | null;
}

export interface StageSpan {
  readonly stage:  SpecStage;
  readonly start:  StageBoundary;
  /** Null while the span is open. */
  readonly end:    StageBoundary | null;
  readonly isOpen: boolean;
}

export interface SpecStepper {
  readonly doneLanes:   readonly SpecLane[];
  /** Null once the spec is done. */
  readonly currentLane: SpecLane | null;
}

export interface SnapshotSpec {
  readonly folderName: string;
  /** The folder name's leading digits, null when it has none. */
  readonly number:     number | null;
  readonly title:      string;
  readonly colourSlot: number;
  readonly lane:       SpecLane;
  readonly stepper:    SpecStepper;
  readonly stories:    readonly SnapshotStory[];
  readonly counts:     SpecCounts;
  readonly artefacts:  readonly SnapshotArtefact[];
  readonly checklists: readonly SnapshotChecklist[];
  readonly tasks:      TickCount;
  readonly workItems:  readonly WorkItem[];
  readonly stageSpans: readonly StageSpan[];
}

export interface SnapshotConstitution {
  readonly state:       'template' | 'filled';
  readonly version:     string | null;
  readonly ratified:    string | null;
  readonly lastAmended: string | null;
  readonly principles:  readonly string[];
}

export interface SnapshotOpenMarker {
  readonly folderName:   string;
  readonly relativePath: string;
  readonly text:         string;
  readonly line:         number;
}

export interface SpecSnapshot {
  readonly project:        string;
  readonly repositoryKey:  string;
  readonly generatedAt:    string;
  readonly specKitVersion: string | null;
  readonly constitution:   SnapshotConstitution | null;
  readonly laneCounts:     Readonly<Record<SpecLane, number>>;
  readonly tasks:          TickCount;
  /** Every spec's open marker with its text; a filled `plan.md`'s markers count in its spec's counts, which carry no text. */
  readonly openMarkers:    readonly SnapshotOpenMarker[];
  readonly unreadable:     readonly SourceUnreadableEntry[];
  readonly specs:          readonly SnapshotSpec[];
}
