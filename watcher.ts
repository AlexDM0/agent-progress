#!/usr/bin/env bun
/**
 * The Watcher binary the Overseer bundles and spawns as `<job folder> <instance>`: beside `agent-progress.ts`, the one file that calls
 * `process.exit`, and a module whose import is the invocation, so specs spawn it instead.
 */
import { runWatcher } from './src/lib/watcher/Watcher.ts';

// The Watcher's only clock: it stamps event-log entries, which are recorded and shown, never read to decide.
process.exit(await runWatcher(Bun.argv.slice(2), () => new Date().toISOString()));
