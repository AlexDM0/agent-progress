/**
 * The DOM preload for the Bridge's `.dom.tsx` specs alone: registering happy-dom replaces `fetch` and the other globals for every spec in
 * the run, so it is never a preload of the main `bun test` run. `bridge/testing/RunDomSpecs.ts` passes it with `--preload`.
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://127.0.0.1:4930/' });
