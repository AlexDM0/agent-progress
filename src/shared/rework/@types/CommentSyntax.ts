export interface DelimiterPair {
  opening: string;
  closing: string;
}

/** A language nested in another one's markup, such as a `<script>` in HTML: its own syntax holds between the two tags. */
export interface EmbeddedLanguage {
  openingTag: string;
  closingTag: string;
  syntax:     CommentSyntax;
}

export interface CommentSyntax {
  lineCommentMarkers:     readonly string[];
  blockComments:          readonly DelimiterPair[];
  /** A comment only where it is the first thing on its line: Python's docstrings and Ruby's `=begin`. */
  lineStartBlockComments: readonly DelimiterPair[];
  /** Strings that may run across lines, whose content is code however much it looks like a comment. */
  multiLineStrings:       readonly DelimiterPair[];
  /** Strings that end with their line; tracked so a comment marker inside one is not read as a comment. */
  stringQuotes:           readonly string[];
  embeddedLanguages:      readonly EmbeddedLanguage[];
}
