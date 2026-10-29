/**
 * `POST /api/commands`' answers that need no running Overseer. What matters: while launches are held for an install change a board command
 * is refused 423 before the tracker is opened, while `runner-stop` and `runner-restart` still reach the Overseer; and a body with no known
 * kind, or a runtime command whose `now` is no boolean, is 400 and reaches nothing.
 */
import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';

import { createScratchDirectory, removeScratchDirectory }  from '../../../src/testing/ScratchWorkspace.ts';
import { createArgumentParser }                            from '../../arguments/ArgumentParser.ts';
import { createCapturedCommandContext }                    from '../../testing/CapturedCommandContext.ts';
import { answerControlCommand, type RuntimeRunnerCommand } from './CommandRoute.ts';

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

function heldRoute(launchesHeld: boolean) {
  const directory = createScratchDirectory('command-route');
  scratchDirectories.push(directory);
  const runtimeCommands: RuntimeRunnerCommand[] = [];
  const wakes: string[] = [];
  const request = {
    commandArguments: createArgumentParser([]),
    context:          createCapturedCommandContext({ currentDirectory: directory }),
    launchesHeld:     () => launchesHeld,
    onRuntimeCommand: (command: RuntimeRunnerCommand) => runtimeCommands.push(command),
    wake:             () => wakes.push('wake'),
  };
  return { request, runtimeCommands, wakes };
}

describe('answerControlCommand', () => {
  test('a board command while launches are held for an install change is 423; runner-stop still reaches the Overseer', async () => {
    const { request, runtimeCommands, wakes } = heldRoute(true);
    const held = await answerControlCommand({ kind: 'runner-pause' }, request);
    expect(held.status).toBe(423);
    expect(held.body).toEqual({ refusal: expect.stringContaining('update') });
    expect(await answerControlCommand({ kind: 'runner-stop', now: true }, request)).toEqual({ status: 200, body: { outcome: 'done', result: { kind: 'runner-stop' } } });
    expect(runtimeCommands).toEqual([{ kind: 'runner-stop', now: true }]);
    expect(wakes).toEqual([]);
  });

  test('an unknown kind, a body that is no object and a runtime command whose now is no boolean are 400 and reach nothing', async () => {
    const { request, runtimeCommands } = heldRoute(false);
    for (const body of [{ kind: 'no-such-command' }, ['runner-stop'], null, { kind: 'runner-stop', now: 'yes' }]) {
      expect((await answerControlCommand(body, request)).status).toBe(400);
    }
    expect(runtimeCommands).toEqual([]);
  });
});
