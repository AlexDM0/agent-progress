/** The marks spec-kit 1.1.0's templates and commands write, which the readers look for. */
export const TITLE_HEADING_PREFIX        = '# ';
export const SECTION_HEADING_PREFIX      = '## ';
export const SUBSECTION_HEADING_PREFIX   = '### ';
export const PHASE_HEADING_PREFIX        = '## Phase';
export const CLARIFICATIONS_HEADING      = '## Clarifications';
export const CORE_PRINCIPLES_HEADING     = '## Core Principles';
export const NEEDS_CLARIFICATION_MARKER  = 'NEEDS CLARIFICATION';
export const MINIMUM_VIABLE_PRODUCT_MARK = 'MVP';
export const PARALLEL_TASK_MARK          = '[P]';
export const DONE_CHECKBOX_MARKS: ReadonlySet<string> = new Set(['x', 'X']);
export const FRONTMATTER_FENCE           = '---';
export const CODE_FENCE                  = '```';
export const HTML_COMMENT_OPENING        = '<!--';
export const HTML_COMMENT_CLOSING        = '-->';
export const SPECKIT_VERSION_KEY         = 'speckit_version';
