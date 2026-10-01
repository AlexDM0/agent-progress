function valueIsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Every text of a list, in order, dropping anything else; a value that is no list reads as an empty one. */
function textListOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

export const JsonValueUtil = {
  valueIsRecord,
  finiteNumberOrNull,
  textOrNull,
  textListOf,
} as const;
