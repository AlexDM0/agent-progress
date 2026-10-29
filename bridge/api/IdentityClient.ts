/** `GET /api/identity`, which needs no token: the board's tracker id and the code version the Overseer runs. */
import type { OverseerIdentity } from '../@types/BoardStateDocument.ts';
import type { FetchFunction }    from './CommandClient.ts';

const IDENTITY_PATH = '/api/identity';

/** `null` when the Overseer cannot be reached or answers something that is not an identity. */
async function fetchIdentity(fetchOf: FetchFunction = (input, init) => fetch(input, init)): Promise<OverseerIdentity | null> {
  try {
    const response = await fetchOf(IDENTITY_PATH);
    const body = await response.json() as Partial<Record<keyof OverseerIdentity, unknown>>;
    const { trackerId, project, codeVersion } = body;
    if (typeof trackerId !== 'string' || typeof project !== 'string' || typeof codeVersion !== 'string') return null;
    return { trackerId, project, codeVersion };
  } catch {
    return null;
  }
}

export const IdentityClient = Object.freeze({ fetchIdentity, IDENTITY_PATH });
