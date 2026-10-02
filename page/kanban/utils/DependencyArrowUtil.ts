/** The geometry of the Kanban's hover arrows, from a dependency's card to the card that waits on it. DOM-free: boxes in, SVG paths out. */

/** A card's box relative to the arrow overlay, in pixels. */
export interface ArrowCardBox {
  left:   number;
  right:  number;
  top:    number;
  height: number;
}

export type ArrowRoute = 'rightward' | 'leftward' | 'same-lane';

export interface DependencyArrow {
  route:    ArrowRoute;
  /** Ends at the arrowhead's base, so the head sits cleanly on the line. */
  linePath: string;
  headPath: string;
}

/** Arrows meet a tall card at its head area rather than its middle. */
const ANCHOR_MAXIMUM_DROP_PIXELS     = 22;
const ARROWHEAD_LENGTH_PIXELS        = 9;
const ARROWHEAD_WIDTH_PIXELS         = 10;
const ARROWHEAD_TIP_GAP_PIXELS       = 1;
const MINIMUM_CROSS_LANE_BEND_PIXELS = 30;
const SAME_LANE_BULGE_PIXELS         = 26;
/** How much further a same-lane loop bulges per pixel the two cards stand apart. */
const SAME_LANE_BULGE_PER_DROP_PIXEL = 0.12;

function anchorYOf(box: ArrowCardBox): number {
  return box.top + Math.min(box.height / 2, ANCHOR_MAXIMUM_DROP_PIXELS);
}

function routeOf(source: ArrowCardBox, target: ArrowCardBox, sameLane: boolean): ArrowRoute {
  if (sameLane) {
    return 'same-lane';
  }
  return source.left < target.left ? 'rightward' : 'leftward';
}

function coordinate(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function point(x: number, y: number): string {
  return `${coordinate(x)} ${coordinate(y)}`;
}

/**
 * A horizontal cubic from the source's edge to the arrowhead's base beside the target: rightward exits the source's right edge into the
 * target's left, leftward the source's left edge into the target's right, and a same-lane arrow loops out to the right into the target's right.
 */
function dependencyArrowOf(source: ArrowCardBox, target: ArrowCardBox, sameLane: boolean): DependencyArrow {
  const route        = routeOf(source, target, sameLane);
  const sourceY      = anchorYOf(source);
  const targetY      = anchorYOf(target);
  const entersOnLeft = route === 'rightward';
  // The direction the arrow points as it enters the target: +1 to the right, -1 to the left.
  const direction    = entersOnLeft ? 1 : -1;
  const tipX         = entersOnLeft ? target.left - ARROWHEAD_TIP_GAP_PIXELS : target.right + ARROWHEAD_TIP_GAP_PIXELS;
  const baseX        = tipX - direction * ARROWHEAD_LENGTH_PIXELS;
  const halfWidth    = ARROWHEAD_WIDTH_PIXELS / 2;
  const headPath     = `M ${point(tipX, targetY)} L ${point(baseX, targetY - halfWidth)} L ${point(baseX, targetY + halfWidth)} Z`;

  if (route === 'same-lane') {
    const bulge = SAME_LANE_BULGE_PIXELS + Math.abs(targetY - sourceY) * SAME_LANE_BULGE_PER_DROP_PIXEL;
    const linePath = `M ${point(source.right, sourceY)} C ${point(source.right + bulge, sourceY)}, ${point(baseX + bulge, targetY)}, ${point(baseX, targetY)}`;
    return { route, linePath, headPath };
  }
  const startX   = entersOnLeft ? source.right : source.left;
  const bend     = Math.max(MINIMUM_CROSS_LANE_BEND_PIXELS, Math.abs(baseX - startX) / 2);
  const linePath = `M ${point(startX, sourceY)} C ${point(startX + direction * bend, sourceY)}, ${point(baseX - direction * bend, targetY)}, ${point(baseX, targetY)}`;
  return { route, linePath, headPath };
}

export const DependencyArrowUtil = { anchorYOf, dependencyArrowOf } as const;
