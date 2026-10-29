/**
 * The Bridge's entry point: sets the theme and the embedded mark before the first paint, then mounts the one React root inside the error
 * boundary, over the browser's own fetch, EventSource, storage and location.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { CommandClient }                                  from './api/CommandClient.ts';
import { EventStreamClient }                              from './api/EventStreamClient.ts';
import { IdentityClient }                                 from './api/IdentityClient.ts';
import { TranscriptStreamClient }                         from './api/TranscriptStreamClient.ts';
import { BROWSER_STORAGE_AREAS, sharedPreferenceStoreOf } from './preferences/PreferenceStore.ts';
import { BridgeApp, type BridgeServices }                 from './shell/BridgeApp.tsx';
import { BridgeErrorBoundary }                            from './shell/BridgeErrorBoundary.tsx';
import { EmbeddedChannel }                                from './shell/EmbeddedChannel.ts';
import { ThemeBootstrap }                                 from './shell/ThemeBootstrap.ts';
import { QuestionAlerts }                                 from './views/questions/QuestionAlerts.ts';

const ROOT_ELEMENT_ID = 'bridge-root';

const { embedded } = ThemeBootstrap.applyBeforeFirstPaint(sharedPreferenceStoreOf());

const services: BridgeServices = {
  commandClient:        CommandClient.create(),
  openEventStream:      (handlers) => EventStreamClient.open(handlers),
  fetchIdentity:        () => IdentityClient.fetchIdentity(),
  reload:               () => window.location.reload(),
  storage:              BROWSER_STORAGE_AREAS.local,
  embedded,
  embeddedSurroundings: EmbeddedChannel.browserSurroundings,
  now:                  () => new Date(),
  followTranscript:     (jobId, handlers) => TranscriptStreamClient.follow(jobId, handlers),
  questionNotifier:     QuestionAlerts.browserQuestionNotifier(),
};

const rootElement = document.getElementById(ROOT_ELEMENT_ID);
if (rootElement !== null) {
  createRoot(rootElement).render(
    <StrictMode>
      <BridgeErrorBoundary>
        <BridgeApp services={services} />
      </BridgeErrorBoundary>
    </StrictMode>,
  );
}
