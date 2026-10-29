/**
 * Renders a view under enabled controls whose command client records every command and answers with the outcomes a spec queues, then
 * `applied`; and a transcript follower a spec feeds by hand. For the views' DOM specs.
 */
import { act, render, type RenderResult }   from '@testing-library/react';
import { createElement, type ReactElement } from 'react';

import type { CommandOutcome, ControlCommandBody }                from '../api/CommandClient.ts';
import type { TranscriptEntryDocument, TranscriptStreamHandlers } from '../api/TranscriptStreamClient.ts';
import { ControlSurroundingsContext }                             from '../shell/ControlAvailability.ts';

export interface FakeControls {
  readonly sent:           ControlCommandBody[];
  readonly answerNextWith: (outcome: CommandOutcome) => void;
  readonly render:         (element: ReactElement) => RenderResult;
}

export function fakeControls(): FakeControls {
  const sent: ControlCommandBody[] = [];
  const queuedOutcomes: CommandOutcome[] = [];
  const commandClient = {
    send: (command: ControlCommandBody): Promise<CommandOutcome> => {
      sent.push(command);
      return Promise.resolve(queuedOutcomes.shift() ?? { verdict: 'applied', outcome: 'done', result: null });
    },
  };
  return {
    sent,
    answerNextWith: (outcome) => {
      queuedOutcomes.push(outcome);
    },
    render: (element) => render(createElement(
      ControlSurroundingsContext.Provider,
      { value: { availability: 'enabled', commandClient, onInstallHeld: () => undefined } },
      element,
    )),
  };
}

export interface FakeTranscripts {
  readonly follow:       (jobId: string, handlers: TranscriptStreamHandlers) => { close: () => void };
  readonly followedJobs: () => string[];
  readonly feed:         (jobId: string, entries: readonly TranscriptEntryDocument[]) => void;
}

export function fakeTranscripts(): FakeTranscripts {
  const handlersByJob = new Map<string, TranscriptStreamHandlers>();
  return {
    follow: (jobId, handlers) => {
      handlersByJob.set(jobId, handlers);
      return { close: () => handlersByJob.delete(jobId) };
    },
    followedJobs: () => [...handlersByJob.keys()],
    feed:         (jobId, entries) => act(() => handlersByJob.get(jobId)?.onEntries(entries)),
  };
}

/** Clicks a control and lets its command's promise settle inside `act`. */
export async function clickSettled(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
}
