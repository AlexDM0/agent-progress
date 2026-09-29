/** One display format for token counts, so every surface that prints one shows the same units. It depends on no other lib package. */

/** Not 1024: these are counts a model reported, and every model's own dashboard shows them in thousands. */
const THOUSAND_TOKENS = 1000;

const MILLION_TOKENS = THOUSAND_TOKENS * THOUSAND_TOKENS;

const BILLION_TOKENS = MILLION_TOKENS * THOUSAND_TOKENS;

const SHORTENED_DECIMAL_PLACES = 1;

/** Billions keep their trailing zeros: `1.20B`, never `1.2B`. */
const BILLIONS_DECIMAL_PLACES = 2;

const TOKEN_COUNT_PATTERN = /^(\d+)(?:\.(\d+))?\s*([km])?$/i;

/**
 * Reads `12000`, `12k`, `12.3k` or `1.2m`; `null` for anything else, which a caller turns into a
 * refusal. A fractional part is legal only with a suffix, because a bare `12.5` is a count that
 * cannot exist and is far likelier to be a typo for `12500`.
 */
function parseTokenCount(text: string): number | null {
  const match = TOKEN_COUNT_PATTERN.exec(text.trim());
  if (match === null) return null;

  const wholePart      = match[1] ?? '';
  const fractionalPart = match[2];
  const suffix         = match[3]?.toLowerCase();

  if (fractionalPart !== undefined && suffix === undefined) return null;

  const scale  = suffix === 'm' ? MILLION_TOKENS : suffix === 'k' ? THOUSAND_TOKENS : 1;
  const scaled = Math.round(Number(`${wholePart}.${fractionalPart ?? '0'}`) * scale);
  return Number.isSafeInteger(scaled) ? scaled : null;
}

/** `950`, `12.3k`, `1.2M`, `1.20B`; a value that rounds up to a full thousand of its unit is promoted, so 999,999 reads as `1M` and never as `1000k`. */
function formatTokenCount(count: number): string {
  if (count < THOUSAND_TOKENS) return String(count);

  const inThousands = shortened(count / THOUSAND_TOKENS);
  if (count < MILLION_TOKENS && Number(inThousands) < THOUSAND_TOKENS) return `${inThousands}k`;

  const inMillions = shortened(count / MILLION_TOKENS);
  if (count < BILLION_TOKENS && Number(inMillions) < THOUSAND_TOKENS) return `${inMillions}M`;
  return `${(count / BILLION_TOKENS).toFixed(BILLIONS_DECIMAL_PLACES)}B`;
}

function shortened(value: number): string {
  return String(Number(value.toFixed(SHORTENED_DECIMAL_PLACES)));
}

export const TokenCountUtil = {
  formatTokenCount,
  parseTokenCount,
} as const;
