/** The timeout for a spec case that waits out a held tracker lock's whole retry budget before the refusal. */
import { LIMITS } from '../shared/constants/Limits.ts';

/** Headroom over the bare retry budget, so a loaded machine's scheduling delays do not time the case out before the refusal arrives. */
const HELD_LOCK_TIMEOUT_SAFETY_FACTOR = 3;

export const HELD_LOCK_CASE_TIMEOUT_MILLISECONDS = LIMITS.LOCK_RETRY_COUNT * LIMITS.LOCK_RETRY_INTERVAL_MILLISECONDS * HELD_LOCK_TIMEOUT_SAFETY_FACTOR;
