import type { SpecKitFillState, SpecKitUnreadLine } from './SpecKitReading.ts';

export type TaskPhaseKind = 'setup' | 'foundational' | 'user-story' | 'polish' | 'convergence' | 'other';

export interface SpecKitTask {
  readonly id:          string;
  readonly isDone:      boolean;
  readonly isParallel:  boolean;
  readonly storyNumber: number | null;
  readonly description: string;
  readonly line:        number;
}

export interface TaskPhase {
  /** The phase's place in file order, from 1; convergence phases may repeat, so this, not `number`, tells phases apart. */
  readonly ordinal:                number;
  readonly number:                 number | null;
  readonly name:                   string;
  readonly kind:                   TaskPhaseKind;
  readonly storyNumber:            number | null;
  readonly storyPriority:          number | null;
  readonly isMinimumViableProduct: boolean;
  readonly line:                   number;
  readonly tasks:                  readonly SpecKitTask[];
}

export interface TasksDocument {
  readonly fillState:   SpecKitFillState;
  readonly title:       string;
  readonly phases:      readonly TaskPhase[];
  readonly unreadLines: readonly SpecKitUnreadLine[];
}

export interface ChecklistItem {
  readonly id:        string;
  readonly isChecked: boolean;
  readonly text:      string;
  readonly line:      number;
}

export interface ChecklistDocument {
  readonly fillState:   SpecKitFillState;
  readonly title:       string;
  readonly items:       readonly ChecklistItem[];
  readonly unreadLines: readonly SpecKitUnreadLine[];
}
