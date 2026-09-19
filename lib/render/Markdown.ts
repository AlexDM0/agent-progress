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

const LEADING_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/;

function decodeHrefEntitiesOnce(href: string): string {
  const withNamed = NAMED_ENTITY_REPLACEMENTS.reduce(
    (text, [entity, character]) => text.replaceAll(entity, character),
    href.toLowerCase(),
  );
  return withNamed
    .replace(/&#x([0-9a-f]+);/g, (_match, digits: string) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&#(\d+);/g, (_match, digits: string) => String.fromCodePoint(Number.parseInt(digits, 10)));
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

/** An href with no scheme is allowed and one with an unlisted scheme is not: a denylist would have to enumerate every scheme an attacker reaches for. */
function hrefIsAllowed(href: string): boolean {
  const normalised = normaliseHrefForJudgement(href);
  if (normalised.startsWith('#')) {
    return true;
  }
  if (ALLOWED_HREF_SCHEMES.some((scheme) => normalised.startsWith(scheme))) {
    return true;
  }
  return !LEADING_SCHEME_PATTERN.test(normalised);
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
