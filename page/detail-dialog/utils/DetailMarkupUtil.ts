import { HtmlEscapeUtil } from '../../../src/lib/utils/HtmlEscapeUtil.ts';

const { escapeHtml } = HtmlEscapeUtil;

function sectionMarkup(title: string, bodyMarkup: string): string {
  return `<section class="ap-detail-section"><h3 class="ap-detail-section-title">${escapeHtml(title)}</h3>${bodyMarkup}</section>`;
}

/** The value comes as its whole element, already escaped, so a stamp can carry its own title. */
function factMarkup(label: string, valueElementMarkup: string): string {
  return `<div><b>${escapeHtml(label)}</b>${valueElementMarkup}</div>`;
}

export const DetailMarkupUtil = { sectionMarkup, factMarkup } as const;
