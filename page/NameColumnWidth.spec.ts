/** The task column's width attribute. The case that matters: the template keys its widened column on the attribute the page sets. */

import { expect, test }                from 'bun:test';
import { NAME_COLUMN_WIDTH_ATTRIBUTE } from './NameColumnWidth.ts';

// The template's CSS override is keyed on this attribute; a rename on one side alone would leave the button doing nothing.
test('names the attribute the template keys its widened column on', async () => {
  const templateText = await Bun.file(`${import.meta.dir}/../resources/template.html`).text();

  expect(templateText).toContain(`:root[${NAME_COLUMN_WIDTH_ATTRIBUTE}="wide"] { --col-name: var(--col-name-wide); }`);
});
