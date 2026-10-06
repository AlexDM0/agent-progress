/**
 * The hover arrows' routing as numbers: which edge each arrow leaves and enters for a source left of, right of and in the same lane as
 * its target, that every curve ends horizontal, that the line stops at the arrowhead's base and the head's tip one pixel off the card,
 * and that tall cards are met at their head area.
 */

import { describe, expect, test } from 'bun:test';
import type { ArrowCardBox }      from './DependencyArrowUtil.ts';
import { DependencyArrowUtil }    from './DependencyArrowUtil.ts';

const { anchorYOf, dependencyArrowOf } = DependencyArrowUtil;

function box(left: number, top: number, width = 200, height = 30): ArrowCardBox {
  return {
    left, right: left + width, top, height
  };
}

/** The path's numbers as [x, y] pairs, in order. */
function pointsOf(path: string): [number, number][] {
  const numbers = (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  return Array.from({ length: numbers.length / 2 }, (_pair, i) => [numbers[2 * i] ?? Number.NaN, numbers[2 * i + 1] ?? Number.NaN]);
}

describe('anchorYOf', () => {
  test('meets a short card at its middle', () => {
    expect(anchorYOf(box(0, 100, 200, 30))).toBe(115);
  });

  test('meets a tall card 22px below its top, in its head area', () => {
    expect(anchorYOf(box(0, 100, 200, 120))).toBe(122);
  });
});

describe('dependencyArrowOf', () => {
  test('a source left of its target leaves its right edge and enters the target from the left', () => {
    const arrow = dependencyArrowOf(box(0, 100), box(300, 200), false);
    const [start, firstControl, secondControl, end] = pointsOf(arrow.linePath);

    expect(arrow.route).toBe('rightward');
    expect(start).toEqual([200, 115]);
    expect(end).toEqual([290, 215]);
    expect(firstControl?.[1]).toBe(115);
    expect(secondControl?.[1]).toBe(215);
    expect(pointsOf(arrow.headPath)).toEqual([[299, 215], [290, 210], [290, 220]]);
  });

  test('a source right of its target leaves its left edge and enters the target from the right', () => {
    const arrow = dependencyArrowOf(box(500, 100), box(0, 40), false);
    const [start, firstControl, secondControl, end] = pointsOf(arrow.linePath);

    expect(arrow.route).toBe('leftward');
    expect(start).toEqual([500, 115]);
    expect(end).toEqual([210, 55]);
    expect(firstControl?.[0]).toBeLessThan(500);
    expect(secondControl?.[0]).toBeGreaterThan(210);
    expect(pointsOf(arrow.headPath)).toEqual([[201, 55], [210, 50], [210, 60]]);
  });

  test('bends at least 30px even when the lanes almost touch', () => {
    const [start, firstControl] = pointsOf(dependencyArrowOf(box(0, 0), box(215, 0), false).linePath);

    expect((firstControl?.[0] ?? 0) - (start?.[0] ?? 0)).toBe(30);
  });

  test('a source in the same lane loops out to the right, bulging further the further apart the cards are, into the target\'s right edge', () => {
    const near = dependencyArrowOf(box(0, 0), box(0, 100), true);
    const far  = dependencyArrowOf(box(0, 0), box(0, 600), true);
    const [start, firstControl, secondControl, end] = pointsOf(near.linePath);

    expect(near.route).toBe('same-lane');
    expect(start).toEqual([200, 15]);
    expect(firstControl).toEqual([200 + 26 + 100 * 0.12, 15]);
    expect(end).toEqual([210, 115]);
    expect(secondControl).toEqual([210 + 26 + 100 * 0.12, 115]);
    expect(pointsOf(near.headPath)).toEqual([[201, 115], [210, 110], [210, 120]]);
    expect(pointsOf(far.linePath)[1]?.[0]).toBeGreaterThan(firstControl?.[0] ?? 0);
  });

  test('a same-lane source below its target still loops out to the right', () => {
    const [start, firstControl] = pointsOf(dependencyArrowOf(box(0, 300), box(0, 0), true).linePath);

    expect(start).toEqual([200, 315]);
    expect(firstControl?.[0]).toBeGreaterThan(200);
  });
});
