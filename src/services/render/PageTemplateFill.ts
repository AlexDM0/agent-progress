/**
 * Fills `resources/template.html` — two islands, the page script, the title and the project heading — from one progress file, its log
 * and its tickets. Both islands go through `escapeJsonForScriptTag` of `src/lib/html-escape/HtmlEscapeUtil.ts`, so none can close its
 * script tag; `generatedAt` is a parameter, not a clock.
 */

import { readFileSync }                               from 'node:fs';
import { HtmlEscapeUtil }                             from '../../lib/html-escape/HtmlEscapeUtil.ts';
import { resourceFilePathOf }                         from '../../shared/ResourceFilePath.ts';
import { assemblePagePayload, type PagePayloadInput } from './PagePayloadAssembly.ts';
import { substituteTemplateTokens }                   from './TemplateTokenSubstitution.ts';
import { TEMPLATE_FILE_NAME, TEMPLATE_TOKENS }        from './constants/TemplateFile.ts';
import { PageScriptTextUtil }                         from './utils/PageScriptTextUtil.ts';

interface PageTemplateFillInput extends PagePayloadInput {
  pageScript: string | null;
}

export function fillPageTemplate(input: PageTemplateFillInput): string {
  const { progress, pageScript, pageScriptFailure } = input;
  // Read per call, never at module load.
  const template = readFileSync(resourceFilePathOf(TEMPLATE_FILE_NAME), 'utf8');
  const { payload, tickets } = assemblePagePayload(input);

  const description = { templateFilePath: `resources/${TEMPLATE_FILE_NAME}`, tokens: Object.values(TEMPLATE_TOKENS) };
  return substituteTemplateTokens(template, description, {
    [TEMPLATE_TOKENS.TITLE]:           `<title>${HtmlEscapeUtil.escapeHtml(progress.project)} progress</title>`,
    // Written here as well as by the page script, so the heading never shows empty before the script runs.
    [TEMPLATE_TOKENS.PROJECT_HEADING]: `<h1 class="ap-title" id="ap-project">${HtmlEscapeUtil.escapeHtml(progress.project)}</h1>`,
    [TEMPLATE_TOKENS.PROGRESS]:        HtmlEscapeUtil.escapeJsonForScriptTag(JSON.stringify(payload)),
    [TEMPLATE_TOKENS.TICKETS]:         HtmlEscapeUtil.escapeJsonForScriptTag(JSON.stringify(tickets)),
    [TEMPLATE_TOKENS.PAGE_SCRIPT]:     pageScript ?? PageScriptTextUtil.bannerOnlyScriptOf(pageScriptFailure),
  });
}
