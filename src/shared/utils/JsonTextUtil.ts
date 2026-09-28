const JSON_INDENT_SPACES = 2;

/** Indented, because people read what the tool prints. */
function indentedTextOf(value: unknown): string {
  return JSON.stringify(value, null, JSON_INDENT_SPACES);
}

/** Indented and newline-terminated, because people read and repair a stored file by hand. */
function storedFileTextOf(value: unknown): string {
  return `${indentedTextOf(value)}\n`;
}

export const JsonTextUtil = {
  indentedTextOf,
  storedFileTextOf,
} as const;
