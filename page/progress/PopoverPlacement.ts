/** Hangs an absolutely placed popover under its anchor button, kept inside the box it is placed in. */

const POPOVER_GAP_PIXELS            = 6;
const POPOVER_EDGE_CLEARANCE_PIXELS = 8;

export function placeUnderAnchor(popoverElement: HTMLElement, anchor: HTMLElement): void {
  const placementBox = popoverElement.offsetParent;
  if (!(placementBox instanceof HTMLElement)) {
    return;
  }
  const placementBoxRectangle = placementBox.getBoundingClientRect();
  const anchorRectangle       = anchor.getBoundingClientRect();
  const furthestLeft          = placementBoxRectangle.width - popoverElement.offsetWidth - POPOVER_EDGE_CLEARANCE_PIXELS;
  popoverElement.style.top  = `${anchorRectangle.bottom - placementBoxRectangle.top + POPOVER_GAP_PIXELS}px`;
  popoverElement.style.left = `${Math.max(POPOVER_EDGE_CLEARANCE_PIXELS, Math.min(anchorRectangle.left - placementBoxRectangle.left, furthestLeft))}px`;
}
