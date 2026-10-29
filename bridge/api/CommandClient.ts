/**
 * Posts a `ControlCommand` to `/api/commands` with the session token, fetched same-origin from `/api/session-token` once and again after a
 * 401, since an Overseer start rotates it. A refusal is the Overseer's worded sentence, which the Bridge shows verbatim and never words
 * itself; a 423 means launches are held for an install change.
 */
export interface ControlCommandBody {
  readonly kind:            string;
  readonly [field: string]: unknown;
}

export type CommandOutcome =
  | { readonly verdict: 'applied'; readonly outcome: unknown; readonly result: unknown }
  | { readonly verdict: 'refused'; readonly refusal: string }
  | { readonly verdict: 'install-held'; readonly refusal: string }
  | { readonly verdict: 'unreachable' };

export type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>;

export interface CommandClient {
  readonly send: (command: ControlCommandBody) => Promise<CommandOutcome>;
}

const SESSION_TOKEN_PATH = '/api/session-token';
const COMMANDS_PATH = '/api/commands';

const HTTP_STATUS = {
  OK:           200,
  UNAUTHORIZED: 401,
  LOCKED:       423,
} as const;

async function refusalOf(response: Response): Promise<string> {
  try {
    const body = await response.json() as { refusal?: unknown };
    return typeof body.refusal === 'string' ? body.refusal : String(response.status);
  } catch {
    return String(response.status);
  }
}

function create(fetchOf: FetchFunction = (input, init) => fetch(input, init)): CommandClient {
  let token: string | null = null;

  const sessionToken = async (): Promise<string | null> => {
    if (token !== null) return token;
    const response = await fetchOf(SESSION_TOKEN_PATH, { credentials: 'same-origin' });
    if (response.status !== HTTP_STATUS.OK) return null;
    const body = await response.json() as { token?: unknown };
    token = typeof body.token === 'string' ? body.token : null;
    return token;
  };

  const post = async (command: ControlCommandBody): Promise<Response | null> => {
    const currentToken = await sessionToken();
    if (currentToken === null) return null;
    return fetchOf(COMMANDS_PATH, {
      method:  'POST',
      headers: { 'authorization': `Bearer ${currentToken}`, 'content-type': 'application/json' },
      body:    JSON.stringify(command),
    });
  };

  const send = async (command: ControlCommandBody): Promise<CommandOutcome> => {
    try {
      let response = await post(command);
      if (response?.status === HTTP_STATUS.UNAUTHORIZED) {
        token = null;
        response = await post(command);
      }
      if (response === null) return { verdict: 'unreachable' };
      if (response.status === HTTP_STATUS.OK) {
        const body = await response.json() as { outcome?: unknown; result?: unknown };
        return { verdict: 'applied', outcome: body.outcome, result: body.result };
      }
      if (response.status === HTTP_STATUS.LOCKED) return { verdict: 'install-held', refusal: await refusalOf(response) };
      return { verdict: 'refused', refusal: await refusalOf(response) };
    } catch {
      return { verdict: 'unreachable' };
    }
  };

  return { send };
}

export const CommandClient = Object.freeze({ create });
