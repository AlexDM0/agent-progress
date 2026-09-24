/**
 * Renders a ticket body to HTML at generation time, so the page carries no markdown parser. Two of marked's defaults are unacceptable for a
 * document opened over `file://`: raw HTML in the source is escaped rather than passed through, and only an allowlisted scheme survives.
 */

import { Marked }                      from 'marked';
import type { RendererObject, Tokens } from 'marked';
import { HtmlEscapeUtil }              from '../utils/HtmlEscapeUtil.ts';

const { escapeHtml } = HtmlEscapeUtil;

const ALLOWED_HREF_SCHEMES = ['http:', 'https:', 'mailto:'] as const;

const NAMED_ENTITY_REPLACEMENTS: ReadonlyArray<readonly [entity: string, character: string]> = [
  ['&colon;', ':'],
  ['&tab;', '\t'],
  ['&newline;', '\n'],
  ['&sol;', '/'],
  ['&amp;', '&'],
];

const HREF_DECODE_PASSES = 3;

const HEXADECIMAL_RADIX = 16;

const DECIMAL_RADIX = 10;

const LAST_UNICODE_CODE_POINT = 0x10ffff;

const REPLACEMENT_CHARACTER = '�';

/** Everything before the first path, query or fragment delimiter, which is the only place a scheme can be. */
const SCHEME_REGION_PATTERN = /^[^/?#]*/;

function characterForCodePoint(codePoint: number): string {
  if (codePoint === 0 || codePoint > LAST_UNICODE_CODE_POINT) {
    return REPLACEMENT_CHARACTER;
  }
  return String.fromCodePoint(codePoint);
}

/** A browser decodes a numeric reference with or without its `;`, so the semicolon is optional here too. */
function decodeHrefEntitiesOnce(href: string): string {
  const withNamed = NAMED_ENTITY_REPLACEMENTS.reduce(
    (text, [entity, character]) => text.replaceAll(entity, character),
    href.toLowerCase(),
  );
  return withNamed
    .replace(/&#x([0-9a-f]+);?/g, (_match, digits: string) => characterForCodePoint(Number.parseInt(digits, HEXADECIMAL_RADIX)))
    .replace(/&#(\d+);?/g, (_match, digits: string) => characterForCodePoint(Number.parseInt(digits, DECIMAL_RADIX)));
}

function normaliseHrefForJudgement(href: string): string {
  let normalised = href;
  for (let pass = 0; pass < HREF_DECODE_PASSES; pass++) {
    const decoded = decodeHrefEntitiesOnce(normalised);
    if (decoded === normalised) {
      break;
    }
    normalised = decoded;
  }
  return normalised.replace(/[\u0000-\u0020]+/g, '');
}

/**
 * An href with no colon before its first `/`, `?` or `#` is allowed and one with an unlisted scheme is not: a denylist would have to enumerate every
 * scheme an attacker reaches for. A reference still undecoded in that region leaves the scheme unjudgeable, so the href is dropped.
 */
function hrefIsAllowed(href: string): boolean {
  const normalised = normaliseHrefForJudgement(href);
  const schemeRegion = SCHEME_REGION_PATTERN.exec(normalised)?.[0] ?? '';
  if (schemeRegion.includes('&')) {
    return false;
  }
  if (!schemeRegion.includes(':')) {
    return true;
  }
  return ALLOWED_HREF_SCHEMES.some((scheme) => schemeRegion.startsWith(scheme));
}

const PAGE_RENDERER: RendererObject = {
  html({ text }: Tokens.HTML | Tokens.Tag): string {
    return escapeHtml(text);
  },
  link(token: Tokens.Link): string | false {
    if (hrefIsAllowed(token.href)) {
      return false;
    }
    return this.parser.parseInline(token.tokens);
  },
  image(token: Tokens.Image): string | false {
    if (hrefIsAllowed(token.href)) {
      return false;
    }
    return escapeHtml(token.text);
  },
};

let memoisedMarked: Marked | null = null;

function markedInstance(): Marked {
  memoisedMarked ??= new Marked({ gfm: true, renderer: PAGE_RENDERER });
  return memoisedMarked;
}

export function renderMarkdown(markdown: string): string {
  return markedInstance().parse(markdown, { async: false });
}
