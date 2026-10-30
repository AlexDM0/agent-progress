/**
 * The `progress.html` the Bridge left behind: a stub saying where the live board is, or that no Overseer serves it. The monitor registry's
 * `progressHtml` names this file, so a monitor still has a page to open.
 */
import { writeFileAtomically } from '../../lib/atomic-file/AtomicFile.ts';
import { HtmlEscapeUtil }      from '../../lib/html-escape/HtmlEscapeUtil.ts';
import { PRODUCT_NAMES }       from '../../shared/constants/ProductNames.ts';

/** `liveUrl` is the live Baton's URL, or null when no Overseer serves the board. */
export function progressPageStubTextOf(liveUrl: string | null): string {
  const line = liveUrl === null
    ? `Overseer down. Start one with <code>${PRODUCT_NAMES.PROGRAM} run --detach</code>.`
    : `Live at <a href="${HtmlEscapeUtil.escapeHtml(liveUrl)}">${HtmlEscapeUtil.escapeHtml(liveUrl)}</a>.`;
  return [
    '<!doctype html>',
    '<html lang="en">',
    `<head><meta charset="utf-8"><title>${PRODUCT_NAMES.PROGRAM}</title></head>`,
    `<body><p>${line}</p></body>`,
    '</html>',
    '',
  ].join('\n');
}

export function createProgressPageStubWriter(htmlFilePath: string): { write(liveUrl: string | null): void } {
  return {
    write(liveUrl) {
      writeFileAtomically(htmlFilePath, progressPageStubTextOf(liveUrl));
    },
  };
}
