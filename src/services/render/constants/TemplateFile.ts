/** The page templates under `resources/`, and the placeholders in each that the render replaces, each exactly once. */
export const TEMPLATE_FILE_NAME = 'template.html';

export const TEMPLATE_TOKENS = {
  PROGRESS:        '__PROGRESS__',
  TICKETS:         '__TICKETS__',
  PAGE_SCRIPT:     '__PAGE_SCRIPT__',
  TITLE:           '<title>agent-progress</title>',
  PROJECT_HEADING: '<h1 class="ap-title" id="ap-project"></h1>',
} as const;

export const SPEC_TEMPLATE_FILE_NAME = 'spec-template.html';

export const SPEC_TEMPLATE_TOKENS = {
  DESIGN_STYLES: '__DESIGN_STYLES__',
  SPEC:          '__SPEC__',
  PAGE_SCRIPT:   '__PAGE_SCRIPT__',
  TITLE:         '<title>agent-progress spec</title>',
} as const;

/** The one element of `template.html` whose text the spec template takes in at render. */
export const DESIGN_STYLE_ELEMENT = {
  OPENING_TAG: '<style>',
  CLOSING_TAG: '</style>',
} as const;
