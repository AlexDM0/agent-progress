/** The banners the shell shows above every view: the Overseer unreachable while the event stream is down, and launches held for an install change. */
import { PRODUCT_NAMES } from '../../src/shared/constants/ProductNames.ts';

export interface ConnectionBannersProps {
  readonly streamIsDown:       boolean;
  /** When the last whole board arrived, as the browser's local time; `null` before the first. */
  readonly boardShownAsOf:     string | null;
  /** The Overseer's own 423 sentence when a command brought it, otherwise `null` while held by the board's word, `undefined` when not held. */
  readonly installHeldRefusal: string | null | undefined;
}

export function ConnectionBanners({ streamIsDown, boardShownAsOf, installHeldRefusal }: ConnectionBannersProps) {
  return (
    <>
      {streamIsDown ? (
        <div className="bridge-banner bridge-banner-unreachable" role="alert">
          {`Overseer unreachable, reconnecting; ${boardShownAsOf === null ? 'no board received yet' : `showing the board as of ${boardShownAsOf}`}.`}
        </div>
      ) : null}
      {installHeldRefusal === undefined ? null : (
        <div className="bridge-banner bridge-banner-install" role="alert">
          {installHeldRefusal ?? `The install version changed: run \`${PRODUCT_NAMES.PROGRAM} update\`.`}
        </div>
      )}
    </>
  );
}
