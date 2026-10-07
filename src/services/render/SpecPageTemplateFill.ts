/**
 * Fills `resources/spec-template.html` — the design's styles, the spec island, the page script and the title — from one snapshot. The island
 * goes through `escapeJsonForScriptTag` of `src/lib/html-escape/HtmlEscapeUtil.ts`, so no spec text can close its script tag.
 */
import { readFileSync } from 'node:fs';

import { HtmlEscapeUtil }                                                    from '../../lib/html-escape/HtmlEscapeUtil.ts';
import type { SpecSnapshot }                                                 from '../../lib/spec-snapshot/@types/SpecSnapshot.ts';
import type { PageLimits }                                                   from '../../shared/@types/PagePayload.ts';
import { resourceFilePathOf }                                                from '../../shared/ResourceFilePath.ts';
import { designStylesOf }                                                    from './DesignStyleExtraction.ts';
import { pageLimits }                                                        from './PageTemplateFill.ts';
import { substituteTemplateTokens }                                          from './TemplateTokenSubstitution.ts';
import { SPEC_TEMPLATE_FILE_NAME, SPEC_TEMPLATE_TOKENS, TEMPLATE_FILE_NAME } from './constants/TemplateFile.ts';
import { PageScriptTextUtil }                                                from './utils/PageScriptTextUtil.ts';

/** The spec island, which `page/spec/SpecPageStart.ts` reads. */
interface SpecPagePayload {
  snapshot: SpecSnapshot;
  limits:   PageLimits;
}

interface SpecPageTemplateFillInput {
  snapshot:          SpecSnapshot;
  pageScript:        string | null;
  pageScriptFailure: string | null;
}

export function fillSpecPageTemplate(input: SpecPageTemplateFillInput): string {
  const { snapshot, pageScript, pageScriptFailure } = input;
  // Both read per call, never at module load.
  const specTemplate      = readFileSync(resourceFilePathOf(SPEC_TEMPLATE_FILE_NAME), 'utf8');
  const trackerTemplate   = readFileSync(resourceFilePathOf(TEMPLATE_FILE_NAME), 'utf8');
  const payload: SpecPagePayload = { snapshot, limits: pageLimits() };

  const description = { templateFilePath: `resources/${SPEC_TEMPLATE_FILE_NAME}`, tokens: Object.values(SPEC_TEMPLATE_TOKENS) };
  return substituteTemplateTokens(specTemplate, description, {
    [SPEC_TEMPLATE_TOKENS.TITLE]:         `<title>${HtmlEscapeUtil.escapeHtml(snapshot.project)} spec</title>`,
    [SPEC_TEMPLATE_TOKENS.DESIGN_STYLES]: designStylesOf(trackerTemplate, `resources/${TEMPLATE_FILE_NAME}`),
    [SPEC_TEMPLATE_TOKENS.SPEC]:          HtmlEscapeUtil.escapeJsonForScriptTag(JSON.stringify(payload)),
    [SPEC_TEMPLATE_TOKENS.PAGE_SCRIPT]:   pageScript ?? PageScriptTextUtil.bannerOnlyScriptOf(pageScriptFailure),
  });
}
