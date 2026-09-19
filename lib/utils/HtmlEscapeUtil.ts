/**
 * Every value on the page is text an agent or a person wrote, and `progress.html` is opened over
 * `file://`, so an injected `<script>` there runs with local-file access. Element text and the JSON
 * island `lib/render/Template.ts` embeds need different escapes, and neither replaces the other.
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

/**
 * Every `<` is escaped, not only the ones in `</`, so no value can reach the HTML tokenizer as markup
 * and close the island: a `<!--` alone puts the tokenizer into its double-escaped state, where the
 * next `</script>` stops closing the element. U+2028 and U+2029 go too — legal in JSON, illegal
 * inside a JavaScript string literal.
 */
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
