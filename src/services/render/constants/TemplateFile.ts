/** The page template under `resources/`, and the placeholders in it that the render replaces, each exactly once. */
export const TEMPLATE_FILE_NAME = 'template.html';

export const TEMPLATE_TOKENS = {
  PROGRESS:    '__PROGRESS__',
  TICKETS:     '__TICKETS__',
  PAGE_SCRIPT: '__PAGE_SCRIPT__',
  TITLE:       '<title>agent-progress</title>',
} as const;
