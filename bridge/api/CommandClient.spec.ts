/**
 * The command client against a fake fetch. What matters: the token comes from `/api/session-token` once and rides every post as a bearer
 * header; a 401 (a rotated token) fetches it again and retries once; 200, 409, 423 and an unreachable Overseer each map to their verdict,
 * the refusal kept verbatim.
 */
import { describe, expect, test } from 'bun:test';

import { CommandClient, type FetchFunction } from './CommandClient.ts';

interface Call {
  readonly path:          string;
  readonly authorization: string | null;
}

function fakeFetch(answers: readonly ((path: string) => Response)[]): { fetchOf: FetchFunction; calls: Call[] } {
  const calls: Call[] = [];
  let answerIndex = 0;
  const fetchOf: FetchFunction = (input, init) => {
    calls.push({ path: input, authorization: new Headers(init?.headers).get('authorization') });
    const answer = answers[answerIndex] ?? answers.at(-1);
    answerIndex += 1;
    return answer === undefined ? Promise.reject(new Error('no answer')) : Promise.resolve(answer(input));
  };
  return { fetchOf, calls };
}

const tokenAnswer = (token: string) => () => Response.json({ token });

describe('the command client', () => {
  test('fetches the token once and sends it as a bearer header with every command', async () => {
    const { fetchOf, calls } = fakeFetch([tokenAnswer('token-1'), () => Response.json({ outcome: 'done', result: { kind: 'runner-pause' } })]);
    const client = CommandClient.create(fetchOf);
    expect(await client.send({ kind: 'runner-pause' })).toEqual({ verdict: 'applied', outcome: 'done', result: { kind: 'runner-pause' } });
    await client.send({ kind: 'runner-pause' });
    expect(calls).toEqual([
      { path: '/api/session-token', authorization: null },
      { path: '/api/commands', authorization: 'Bearer token-1' },
      { path: '/api/commands', authorization: 'Bearer token-1' },
    ]);
  });

  test('a 401 fetches the rotated token and retries once', async () => {
    const { fetchOf, calls } = fakeFetch([
      tokenAnswer('token-1'),
      () => Response.json({ refusal: 'unauthorized' }, { status: 401 }),
      tokenAnswer('token-2'),
      () => Response.json({ outcome: 'done', result: null }),
    ]);
    expect((await CommandClient.create(fetchOf).send({ kind: 'runner-resume' })).verdict).toBe('applied');
    expect(calls.map((call) => call.authorization)).toEqual([null, 'Bearer token-1', null, 'Bearer token-2']);
  });

  test('a 409 is refused with the Overseer\'s sentence verbatim, a 423 is install-held, and a network failure is unreachable', async () => {
    const refused = fakeFetch([tokenAnswer('token-1'), () => Response.json({ refusal: 'Ticket 042 is not ready.' }, { status: 409 })]);
    expect(await CommandClient.create(refused.fetchOf).send({ kind: 'ticket-ready' })).toEqual({ verdict: 'refused', refusal: 'Ticket 042 is not ready.' });
    const held = fakeFetch([tokenAnswer('token-1'), () => Response.json({ refusal: 'The install version changed.' }, { status: 423 })]);
    expect(await CommandClient.create(held.fetchOf).send({ kind: 'ticket-ready' })).toEqual({ verdict: 'install-held', refusal: 'The install version changed.' });
    expect(await CommandClient.create(() => Promise.reject(new Error('down'))).send({ kind: 'runner-pause' })).toEqual({ verdict: 'unreachable' });
  });

  test('a session token refused (no same-origin fetch) leaves the command unsent', async () => {
    const { fetchOf, calls } = fakeFetch([() => Response.json({ refusal: 'forbidden' }, { status: 403 })]);
    expect(await CommandClient.create(fetchOf).send({ kind: 'runner-pause' })).toEqual({ verdict: 'unreachable' });
    expect(calls.map((call) => call.path)).toEqual(['/api/session-token']);
  });
});
