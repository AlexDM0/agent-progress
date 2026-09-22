/**
 * How each kind of source file writes a comment, which is what `agent-progress rework` needs to tell a
 * reworked line of code from a reworked comment. A file whose type is not listed has no entry, and every
 * non-blank line of it counts as code.
 */

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

export const DOCUMENTATION_EXTENSIONS: readonly string[] = ['md', 'mdx', 'rst', 'txt'];

/** Repository-rooted, like the `:!docs/` pathspec reviewers typed by hand: a `docs/` folder deeper in the tree holds code as far as this knows. */
export const DOCUMENTATION_DIRECTORY_PREFIX = 'docs/';

const SLASH_STAR_BLOCK: DelimiterPair = { opening: '/*', closing: '*/' };

const MARKUP_BLOCK: DelimiterPair = { opening: '<!--', closing: '-->' };

const TRIPLE_DOUBLE_QUOTES: DelimiterPair = { opening: '"""', closing: '"""' };

const TRIPLE_SINGLE_QUOTES: DelimiterPair = { opening: '\'\'\'', closing: '\'\'\'' };

const BACKTICKS: DelimiterPair = { opening: '`', closing: '`' };

const WITHOUT_COMMENTS: CommentSyntax = {
  lineCommentMarkers:     [],
  blockComments:          [],
  lineStartBlockComments: [],
  multiLineStrings:       [],
  stringQuotes:           [],
  embeddedLanguages:      [],
};

const C_FAMILY: CommentSyntax = {
  ...WITHOUT_COMMENTS,
  lineCommentMarkers: ['//'],
  blockComments:      [SLASH_STAR_BLOCK],
  stringQuotes:       ['"', '\''],
};

const JAVASCRIPT_FAMILY: CommentSyntax = { ...C_FAMILY, multiLineStrings: [BACKTICKS] };

const TRIPLE_QUOTED_C_FAMILY: CommentSyntax = { ...C_FAMILY, multiLineStrings: [TRIPLE_DOUBLE_QUOTES] };

const HASH_AND_C_FAMILY: CommentSyntax = { ...C_FAMILY, lineCommentMarkers: ['//', '#'] };

const CSS: CommentSyntax = {
  ...WITHOUT_COMMENTS,
  blockComments: [SLASH_STAR_BLOCK],
  stringQuotes:  ['"', '\''],
};

const CSS_WITH_LINE_COMMENTS: CommentSyntax = { ...CSS, lineCommentMarkers: ['//'] };

const HASH: CommentSyntax = { ...WITHOUT_COMMENTS, lineCommentMarkers: ['#'] };

const HASH_AND_SEMICOLON: CommentSyntax = { ...WITHOUT_COMMENTS, lineCommentMarkers: ['#', ';'] };

const PYTHON: CommentSyntax = {
  ...WITHOUT_COMMENTS,
  lineCommentMarkers:     ['#'],
  lineStartBlockComments: [TRIPLE_DOUBLE_QUOTES, TRIPLE_SINGLE_QUOTES],
  multiLineStrings:       [TRIPLE_DOUBLE_QUOTES, TRIPLE_SINGLE_QUOTES],
  stringQuotes:           ['"', '\''],
};

const RUBY: CommentSyntax = {
  ...WITHOUT_COMMENTS,
  lineCommentMarkers:     ['#'],
  lineStartBlockComments: [{ opening: '=begin', closing: '=end' }],
};

const POWERSHELL: CommentSyntax = {
  ...WITHOUT_COMMENTS,
  lineCommentMarkers: ['#'],
  blockComments:      [{ opening: '<#', closing: '#>' }],
};

const SQL: CommentSyntax = {
  ...WITHOUT_COMMENTS,
  lineCommentMarkers: ['--'],
  blockComments:      [SLASH_STAR_BLOCK],
  stringQuotes:       ['\''],
};

/** The block opener is `--[[`, which also starts with the line marker; blocks are tried first, so it is read as the block. */
const LUA: CommentSyntax = {
  ...WITHOUT_COMMENTS,
  lineCommentMarkers: ['--'],
  blockComments:      [{ opening: '--[[', closing: ']]' }],
  stringQuotes:       ['"', '\''],
};

const HASKELL: CommentSyntax = {
  ...WITHOUT_COMMENTS,
  lineCommentMarkers: ['--'],
  blockComments:      [{ opening: '{-', closing: '-}' }],
};

const HASH_AND_SLASH_STAR: CommentSyntax = {
  ...WITHOUT_COMMENTS,
  lineCommentMarkers: ['#'],
  blockComments:      [SLASH_STAR_BLOCK],
  stringQuotes:       ['"'],
};

const MARKUP: CommentSyntax = { ...WITHOUT_COMMENTS, blockComments: [MARKUP_BLOCK] };

/** Quotes are not tracked in the markup itself, since prose is full of apostrophes; only inside a `<script>` or `<style>`. */
const HTML: CommentSyntax = {
  ...MARKUP,
  embeddedLanguages: [
    { openingTag: '<script', closingTag: '</script', syntax: JAVASCRIPT_FAMILY },
    { openingTag: '<style', closingTag: '</style', syntax: CSS },
  ],
};

/** Keyed by the lower-cased extension without its dot. */
export const COMMENT_SYNTAX_BY_EXTENSION: Readonly<Record<string, CommentSyntax>> = {
  ts:         JAVASCRIPT_FAMILY,
  tsx:        JAVASCRIPT_FAMILY,
  mts:        JAVASCRIPT_FAMILY,
  cts:        JAVASCRIPT_FAMILY,
  js:         JAVASCRIPT_FAMILY,
  jsx:        JAVASCRIPT_FAMILY,
  mjs:        JAVASCRIPT_FAMILY,
  cjs:        JAVASCRIPT_FAMILY,
  go:         JAVASCRIPT_FAMILY,
  c:          C_FAMILY,
  h:          C_FAMILY,
  cc:         C_FAMILY,
  cpp:        C_FAMILY,
  cxx:        C_FAMILY,
  hh:         C_FAMILY,
  hpp:        C_FAMILY,
  hxx:        C_FAMILY,
  m:          C_FAMILY,
  mm:         C_FAMILY,
  cs:         C_FAMILY,
  rs:         C_FAMILY,
  dart:       C_FAMILY,
  proto:      C_FAMILY,
  jsonc:      C_FAMILY,
  json5:      C_FAMILY,
  java:       TRIPLE_QUOTED_C_FAMILY,
  kt:         TRIPLE_QUOTED_C_FAMILY,
  kts:        TRIPLE_QUOTED_C_FAMILY,
  swift:      TRIPLE_QUOTED_C_FAMILY,
  scala:      TRIPLE_QUOTED_C_FAMILY,
  groovy:     TRIPLE_QUOTED_C_FAMILY,
  gradle:     TRIPLE_QUOTED_C_FAMILY,
  php:        HASH_AND_C_FAMILY,
  css:        CSS,
  scss:       CSS_WITH_LINE_COMMENTS,
  sass:       CSS_WITH_LINE_COMMENTS,
  less:       CSS_WITH_LINE_COMMENTS,
  py:         PYTHON,
  pyi:        PYTHON,
  rb:         RUBY,
  rake:       RUBY,
  sh:         HASH,
  bash:       HASH,
  zsh:        HASH,
  fish:       HASH,
  yaml:       HASH,
  yml:        HASH,
  toml:       HASH,
  r:          HASH,
  pl:         HASH,
  pm:         HASH,
  ex:         HASH,
  exs:        HASH,
  jl:         HASH,
  cmake:      HASH,
  mk:         HASH,
  properties: HASH,
  conf:       HASH,
  ini:        HASH_AND_SEMICOLON,
  cfg:        HASH_AND_SEMICOLON,
  ps1:        POWERSHELL,
  psm1:       POWERSHELL,
  tf:         { ...HASH_AND_SLASH_STAR, lineCommentMarkers: ['#', '//'] },
  hcl:        { ...HASH_AND_SLASH_STAR, lineCommentMarkers: ['#', '//'] },
  nix:        HASH_AND_SLASH_STAR,
  sql:        SQL,
  lua:        LUA,
  hs:         HASKELL,
  xml:        MARKUP,
  svg:        MARKUP,
  xsl:        MARKUP,
  xslt:       MARKUP,
  plist:      MARKUP,
  xaml:       MARKUP,
  csproj:     MARKUP,
  html:       HTML,
  htm:        HTML,
  xhtml:      HTML,
  vue:        HTML,
  svelte:     HTML,
  json:       WITHOUT_COMMENTS,
};

/** For the files known by their whole name because they have no extension to go by. */
export const COMMENT_SYNTAX_BY_FILE_NAME: Readonly<Record<string, CommentSyntax>> = {
  'Dockerfile':     HASH,
  'Makefile':       HASH,
  'GNUmakefile':    HASH,
  'Gemfile':        RUBY,
  'Rakefile':       RUBY,
  '.gitignore':     HASH,
  '.gitattributes': HASH,
  '.dockerignore':  HASH,
  '.npmrc':         HASH_AND_SEMICOLON,
  '.editorconfig':  HASH_AND_SEMICOLON,
  '.env':           HASH,
};
