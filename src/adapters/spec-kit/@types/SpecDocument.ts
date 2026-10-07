import type { SpecKitFillState } from './SpecKitReading.ts';

export interface SpecUserStory {
  readonly number:   number;
  readonly title:    string;
  readonly priority: number;
  readonly line:     number;
}

export interface SpecOpenClarification {
  readonly text: string;
  readonly line: number;
}

export interface SpecClarificationAnswer {
  readonly question: string;
  readonly answer:   string;
  readonly line:     number;
}

export interface SpecClarificationSession {
  readonly dateText: string;
  readonly line:     number;
  readonly answers:  readonly SpecClarificationAnswer[];
}

export interface SpecDocument {
  readonly fillState:             SpecKitFillState;
  readonly title:                 string;
  readonly createdText:           string | null;
  readonly userStories:           readonly SpecUserStory[];
  readonly requirementIds:        readonly string[];
  readonly successCriterionIds:   readonly string[];
  readonly openClarifications:    readonly SpecOpenClarification[];
  readonly clarificationSessions: readonly SpecClarificationSession[];
}

export interface PlanDocument {
  readonly fillState:              SpecKitFillState;
  readonly title:                  string;
  readonly openClarificationCount: number;
}
