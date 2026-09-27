/** An HTML parser ends a `<script>` at the first `</script`, inside a JavaScript string literal or not, so every one of them is escaped. */
function withScriptEndEscaped(script: string): string {
  return script.replace(/<\/(script)/gi, '<\\/$1');
}

/** A `<!--` inside a `<script>` makes `</script>` stop closing the element, and it cannot be escaped in place, so such a bundle fails instead. */
function scriptWouldOpenAnHtmlComment(script: string): boolean {
  return script.includes('<!--');
}

export const PageScriptTextUtil = { withScriptEndEscaped, scriptWouldOpenAnHtmlComment } as const;
