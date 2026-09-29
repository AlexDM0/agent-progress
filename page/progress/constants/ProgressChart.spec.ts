/**
 * The Progress chart's fixed choices. The cases that matter: the presets answer exactly the ones the template offers, and the template keys
 * its widened column on the attribute the page sets.
 */

import { describe, expect, test }                           from 'bun:test';
import { NAME_COLUMN_WIDTH_ATTRIBUTE, RANGE_PRESET_BOUNDS } from './ProgressChart.ts';

describe('RANGE_PRESET_BOUNDS', () => {
  test('answers each data-preset the template offers, and only with relative text', () => {
    expect(Object.keys(RANGE_PRESET_BOUNDS).sort()).toEqual(['12h', '1h', '24h', '4h', '7d', 'fit']);
    expect(RANGE_PRESET_BOUNDS['fit']).toEqual({ fromText: null, toText: null });
    expect(RANGE_PRESET_BOUNDS['4h']).toEqual({ fromText: '-4h', toText: 'now' });
  });

  test('matches the template’s preset buttons exactly, All gone and Fit first', async () => {
    const templateText = await Bun.file(`${import.meta.dir}/../../../resources/template.html`).text();
    const presets      = [...templateText.matchAll(/data-preset="([a-z0-9]+)"/g)].map((match) => match[1]);

    expect(presets).toEqual(['fit', ...Object.keys(RANGE_PRESET_BOUNDS).filter((key) => key !== 'fit'), 'custom']);
  });
});

// The template's CSS override is keyed on this attribute; a rename on one side alone would leave the button doing nothing.
test('names the attribute the template keys its widened column on', async () => {
  const templateText = await Bun.file(`${import.meta.dir}/../../../resources/template.html`).text();

  expect(templateText).toContain(`:root[${NAME_COLUMN_WIDTH_ATTRIBUTE}="wide"] { --col-name: var(--col-name-wide); }`);
});
