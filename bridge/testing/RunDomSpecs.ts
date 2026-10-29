/**
 * Runs every Bridge DOM spec, `bridge/**\/*.dom.tsx`, which `bun test` does not discover: each in a run of its own under the skip report
 * and the happy-dom preload, so a DOM never leaks into the main run or from one spec into the next. Finding no DOM spec is a failure, so
 * a renamed folder cannot pass by running nothing. `bun run verify` runs it after `bun test`.
 */
import { join } from 'node:path';

const REPOSITORY_ROOT = join(import.meta.dir, '..', '..');
const DOM_SPEC_PATTERN = 'bridge/**/*.dom.tsx';
const PRELOADS = ['./src/testing/TestRunReport.ts', './bridge/testing/HappyDom.ts'];

const domSpecPaths = [...new Bun.Glob(DOM_SPEC_PATTERN).scanSync({ cwd: REPOSITORY_ROOT })].sort();

if (domSpecPaths.length === 0) {
  console.error(`No DOM spec matches ${DOM_SPEC_PATTERN}.`);
  process.exitCode = 1;
} else {
  const failedPaths = domSpecPaths.filter((domSpecPath) => {
    const preloadArguments = PRELOADS.flatMap((preload) => ['--preload', preload]);
    const finished = Bun.spawnSync(['bun', 'test', ...preloadArguments, `./${domSpecPath}`], { cwd: REPOSITORY_ROOT, stdout: 'inherit', stderr: 'inherit' });
    return finished.exitCode !== 0;
  });
  if (failedPaths.length > 0) {
    console.error(`DOM specs failed: ${failedPaths.join(', ')}`);
    process.exitCode = 1;
  }
}
