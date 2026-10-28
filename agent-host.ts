#!/usr/bin/env bun
/**
 * The host binary the runner bundles and spawns as `<job folder> <instance>`: beside `agent-progress.ts`, the one file that calls
 * `process.exit`, and a module whose import is the invocation, so specs spawn it instead.
 */
import { runHost } from './src/lib/agent-host/AgentHost.ts';

process.exit(await runHost(Bun.argv.slice(2)));
