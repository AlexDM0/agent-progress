/** The Specs tab's constitution card: its version, ratified and last amended dates and principles, or the way to write one. */

import { HtmlEscapeUtil }            from '../../../src/lib/html-escape/HtmlEscapeUtil.ts';
import type { SnapshotConstitution } from '../../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import type { GroupFactModel }       from '../../@types/GroupMarks.ts';
import { GroupMarkup }               from '../../epics/GroupMarkup.ts';

const CONSTITUTION_PATH = '.specify/memory/constitution.md';

function titleMarkup(version: string | null): string {
  const versionMarkup = version === null ? '' : ` <span class="ap-spec-constitution-version">${HtmlEscapeUtil.escapeHtml(`v${version}`)}</span>`;
  return `<span class="ap-spec-constitution-title">Constitution${versionMarkup}</span>`;
}

function plainFactOf(label: string, value: string | null): GroupFactModel {
  return { label, valueMarkup: `<span>${HtmlEscapeUtil.escapeHtml(value ?? 'not set')}</span>` };
}

function emptyConstitutionCardMarkup(): string {
  return GroupMarkup.groupCardMarkup({
    slot:      null,
    ariaLabel: 'Constitution',
    head:      {
      titleMarkup: titleMarkup(null), keyText: CONSTITUTION_PATH, doneText: 'not written', doneTitleText: null
    },
    bodyParts: ['<p class="ap-spec-constitution-empty">No constitution yet: run <code>/speckit-constitution</code> to write one.</p>'],
  });
}

/** A missing constitution, or spec-kit's unfilled template, shows the way to write one. */
export function constitutionCardMarkup(constitution: SnapshotConstitution | null): string {
  if (constitution === null || constitution.state === 'template') {
    return emptyConstitutionCardMarkup();
  }
  const principles = constitution.principles.map((principle) => `<li class="ap-spec-principle">${HtmlEscapeUtil.escapeHtml(principle)}</li>`);
  return GroupMarkup.groupCardMarkup({
    slot:      null,
    ariaLabel: 'Constitution',
    head:      {
      titleMarkup:   titleMarkup(constitution.version),
      keyText:       CONSTITUTION_PATH,
      doneText:      `${constitution.principles.length} principles`,
      doneTitleText: null,
    },
    bodyParts: [
      GroupMarkup.factsLineMarkup([plainFactOf('ratified', constitution.ratified), plainFactOf('last amended', constitution.lastAmended)]),
      principles.length === 0 ? '' : `<ul class="ap-spec-principles" aria-label="Principles">${principles.join('')}</ul>`,
    ],
  });
}
