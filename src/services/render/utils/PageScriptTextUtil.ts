import { HtmlEscapeUtil } from '../../../lib/html-escape/HtmlEscapeUtil.ts';

const UNBUILT_PAGE_SCRIPT_REASON = 'the page script could not be built';

/** An HTML parser ends a `<script>` at the first `</script`, inside a JavaScript string literal or not, so every one of them is escaped. */
function withScriptEndEscaped(script: string): string {
  return script.replace(/<\/(script)/gi, '<\\/$1');
}

/** A `<!--` inside a `<script>` makes `</script>` stop closing the element, and it cannot be escaped in place, so such a bundle fails instead. */
function scriptWouldOpenAnHtmlComment(script: string): boolean {
  return script.includes('<!--');
}

/** What a page carries in place of a bundle that failed: it shows the template's `#ap-error` banner with the reason in `#ap-error-text`. */
function bannerOnlyScriptOf(reason: string | null): string {
  const message = HtmlEscapeUtil.escapeJsonForScriptTag(JSON.stringify(reason ?? UNBUILT_PAGE_SCRIPT_REASON));
  return [
    '(function(){',
    'var banner=document.getElementById("ap-error");',
    'var text=document.getElementById("ap-error-text");',
    `if(text){text.textContent=${message};}`,
    'if(banner){banner.hidden=false;}',
    '})();',
  ].join('');
}

export const PageScriptTextUtil = { withScriptEndEscaped, scriptWouldOpenAnHtmlComment, bannerOnlyScriptOf } as const;
