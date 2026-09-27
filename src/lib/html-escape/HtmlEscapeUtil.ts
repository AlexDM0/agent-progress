/**
 * Text someone else wrote must never reach a page as markup. Element text and attributes need the
 * five-character escape; JSON embedded in a script tag needs its own, and neither replaces the other.
 * It depends on no other lib package.
 */

/** All five characters, because values also land in attributes; `&` is replaced first, or a just-written `&lt;` would come back out as `&amp;lt;`. */
function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
}

/** Every `<` and U+2028/U+2029 are escaped, so no value can close the script island or break a JavaScript string. */
function escapeJsonForScriptTag(json: string): string {
  return json
    .replaceAll('<', '\\u003C')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

export const HtmlEscapeUtil = {
  escapeHtml,
  escapeJsonForScriptTag,
} as const;
