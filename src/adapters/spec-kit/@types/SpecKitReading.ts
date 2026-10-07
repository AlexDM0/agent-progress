/** What reading one spec-kit file gives: its parsed document, or a `malformed` verdict with its reason and line, never a throw. */
export type SpecKitReading<Document> =
  | { readonly verdict: 'parsed'; readonly document: Document }
  | { readonly verdict: 'malformed'; readonly reason: string; readonly line: number };

/** Spec-kit copies a template before an agent fills it, so a file still titled with its template's placeholder is no progress. */
export type SpecKitFillState = 'template' | 'filled';

/** A line the reader saw but could not take in, reported rather than dropped. */
export interface SpecKitUnreadLine {
  readonly reason: string;
  readonly line:   number;
}

export interface MarkdownLine {
  readonly text: string;
  readonly line: number;
}
