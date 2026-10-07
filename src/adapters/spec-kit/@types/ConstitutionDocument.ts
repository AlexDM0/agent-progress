import type { SpecKitFillState } from './SpecKitReading.ts';

export interface ConstitutionDocument {
  readonly fillState:       SpecKitFillState;
  readonly title:           string;
  readonly version:         string | null;
  readonly ratifiedDate:    string | null;
  readonly lastAmendedDate: string | null;
  readonly principleNames:  readonly string[];
}

export interface InitOptionsDocument {
  readonly speckitVersion: string;
}
