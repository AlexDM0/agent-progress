#!/usr/bin/env bun
/**
 * The binary: the one file in this repository that calls `process.exit`, and the one module whose
 * import is the invocation, so no spec may import it — `cli/BinarySmoke.spec.ts` spawns it instead.
 */
import { createProcessContext } from './cli/CommandContext';
import { runCommandLine }       from './cli/Main';

process.exit(await runCommandLine(Bun.argv.slice(2), createProcessContext()));
