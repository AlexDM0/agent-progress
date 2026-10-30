/**
 * The axis fit in pixels. The cases that matter: the short clock labels still get a floor width each, a longer label widens every tick, and a
 * label, the now label included, moves left of its line only once the pixels to the right edge cannot hold it.
 */

import { describe, expect, test } from 'bun:test';
import { AxisFitUtil }            from './AxisFitUtil.ts';

const { axisPixelsNeededFor, labelSitsLeftOfItsLine, nowLabelSitsLeftOfMarker } = AxisFitUtil;

describe('axisPixelsNeededFor', () => {
  test('asks for the label width per tick, with a floor for the short formats', () => {
    expect(axisPixelsNeededFor([{ leftPercent: 0, label: '20:30' }])).toBe(60);
    expect(axisPixelsNeededFor([{ leftPercent: 0, label: 'Thu 21:45' }])).toBe(81);
    expect(axisPixelsNeededFor([{ leftPercent: 0, label: '20:30' }, { leftPercent: 50, label: 'Thu 21:45' }])).toBe(162);
    expect(axisPixelsNeededFor([])).toBe(0);
  });
});

describe('labelSitsLeftOfItsLine', () => {
  test('moves a label to the left of its line only when the pixels run out', () => {
    expect(labelSitsLeftOfItsLine({ leftPercent: 98.97, label: '22:15' }, 900)).toBe(true);
    expect(labelSitsLeftOfItsLine({ leftPercent: 50, label: '22:15' }, 900)).toBe(false);
  });
});

describe('nowLabelSitsLeftOfMarker', () => {
  test('moves the now label to the left of its marker only within the label\'s room of the right edge', () => {
    expect(nowLabelSitsLeftOfMarker(100, 900)).toBe(true);
    expect(nowLabelSitsLeftOfMarker(96.1, 900)).toBe(true);
    expect(nowLabelSitsLeftOfMarker(96, 900)).toBe(false);
    expect(nowLabelSitsLeftOfMarker(50, 900)).toBe(false);
  });
});
