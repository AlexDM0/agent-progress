/**
 * The header against a fake command client. What matters: Pause, Resume and Restart post the ControlCommands they name, Restart only
 * with new code on disk; Stop Overseer posts `overseer-stop` only after its confirmation, and Cancel posts nothing; a Baton pass shows
 * `handing over` and withdraws the controls; the warnings and the notices are listed; the concurrency control posts the limit asked for.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen
} from '@testing-library/react';
import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';

import type { BoardStateDocument }        from '../@types/BoardStateDocument.ts';
import type { ControlCommandBody }        from '../api/CommandClient.ts';
import { boardStateFixture, FIXTURE_NOW } from '../testing/BoardStateFixture.ts';
import { ControlSurroundingsContext }     from './ControlAvailability.ts';
import { Header }                         from './Header.tsx';
import { HeaderModelUtil }                from './HeaderModel.ts';

function renderedHeader(state: BoardStateDocument): ControlCommandBody[] {
  const sent: ControlCommandBody[] = [];
  const surroundings = {
    availability:  'enabled' as const,
    commandClient: {
      send: (command: ControlCommandBody) => {
        sent.push(command);
        return Promise.resolve({ verdict: 'applied' as const, outcome: 'done', result: null });
      },
    },
    onInstallHeld: () => undefined,
  };
  render(
    <ControlSurroundingsContext.Provider value={surroundings}>
      <Header
        project="Example Agency"
        model={HeaderModelUtil.headerModelOf(state, FIXTURE_NOW)}
        selectedTab="kanban"
        themeChoice="auto"
        onThemeChoice={() => undefined}
      />
    </ControlSurroundingsContext.Provider>,
  );
  return sent;
}

async function clicked(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
});

describe('the Overseer controls', () => {
  test('Pause posts overseer-pause, and no Restart shows without new code', async () => {
    const sent = renderedHeader(boardStateFixture());
    expect(screen.queryByRole('button', { name: 'Restart' })).toBeNull();
    await clicked('Pause');
    expect(sent).toEqual([{ kind: 'overseer-pause' }]);
  });

  test('Resume posts overseer-resume while paused', async () => {
    const sent = renderedHeader(boardStateFixture({ overseer: { state: 'serving', paused: true, codeVersion: 'code-1' } }));
    await clicked('Resume');
    expect(sent).toEqual([{ kind: 'overseer-resume' }]);
  });

  test('with new code on disk Restart posts overseer-restart, beside the notice pointing at update', async () => {
    const sent = renderedHeader(boardStateFixture({ notices: [{ kind: 'new-code' }] }));
    expect(screen.getByRole('status').textContent).toEndWith(' update`');
    await clicked('Restart');
    expect(sent).toEqual([{ kind: 'overseer-restart', now: false }]);
  });

  test('Stop Overseer posts overseer-stop only once confirmed, and Cancel posts nothing', async () => {
    const sent = renderedHeader(boardStateFixture());
    await clicked('Stop Overseer');
    await clicked('Cancel');
    expect(sent).toEqual([]);
    await clicked('Stop Overseer');
    await clicked('Confirm stop');
    expect(sent).toEqual([{ kind: 'overseer-stop', now: false }]);
  });

  test('during a Baton pass the state reads handing over and no control is offered', () => {
    renderedHeader(boardStateFixture({ overseer: { state: 'passing-baton', paused: false, codeVersion: 'code-1' }, notices: [{ kind: 'new-code' }] }));
    expect(screen.getByText('Overseer handing over')).toBeDefined();
    expect(['Pause', 'Restart', 'Stop Overseer'].map((name) => screen.queryByRole('button', { name }))).toEqual([null, null, null]);
  });

  test('the concurrency control posts the limit asked for', async () => {
    const sent = renderedHeader(boardStateFixture());
    act(() => {
      fireEvent.change(screen.getByLabelText('Concurrency limit'), { target: { value: '6' } });
    });
    await clicked('Set');
    expect(sent).toEqual([{ kind: 'concurrency-set', limit: 6 }]);
  });
});

describe('the warnings and notices', () => {
  test('a defaulted incident, a failed Baton pass and a dirty main checkout are listed', () => {
    renderedHeader(boardStateFixture({
      overseer: {
        state: 'serving', paused: false, codeVersion: 'code-1', batonPassWarning: { successorCodeVersion: 'code-2', step: 'prepared', error: 'it exited' }
      },
      notices: [
        {
          kind: 'incident-defaulted', incidentId: 'I3', move: 'merge-abort', cause: 'no-assistant'
        },
        {
          kind: 'dirty-main-checkout', target: 'main', branch: 'main', blockingFiles: ['README.md']
        },
      ],
    }));
    expect(screen.getByRole('list', { name: '3 warnings' }).textContent).toContain('the Baton pass to code code-2 failed at prepared: it exited');
    expect(screen.getByRole('list', { name: '1 notices' }).textContent).toContain('README.md');
  });
});
