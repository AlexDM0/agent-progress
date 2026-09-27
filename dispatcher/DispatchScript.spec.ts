/**
 * The built Workflow script's shape, read through `dispatcher/testing/utils/WorkflowScriptSourceUtil.ts`: a pure meta equal as a value to the frozen
 * table's, no clock or randomness, no top-level binding that shadows a Workflow global, the same text on every build with no path of the
 * checkout in it, and one agent() call. Each guard is watched failing on a form planted in the bundle, since a clean verdict on its own proves nothing.
 */
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { DISPATCH_META }                                                            from './DispatchMeta.ts';
import { DispatchScriptBundleBookkeeping, builtScriptTextOf, bundleDispatchScript } from './testing/DispatchScriptBundle.ts';
import { readFrozenDispatchTraces }                                                 from './testing/DispatchTraceCapture.ts';
import { WORKFLOW_GLOBAL_NAMES }                                                    from './testing/constants/WorkflowGlobalNames.ts';
import { WorkflowScriptSourceUtil }                                                 from './testing/utils/WorkflowScriptSourceUtil.ts';

const BUNDLE_TEXT = builtScriptTextOf(await bundleDispatchScript());

const RUNNER_CALL_OPENING = '\nreturn await ';

const NAMES_DECLARED_AT_THE_BUNDLE_TOP_LEVEL = ['DispatchRun', 'runDispatcher', 'dispatchFromWorkflowGlobals'];

const META_NAME_LINE = '"name": "agent-progress-dispatch",';

// The floor proves the walk read the meta node by node, so a pure verdict is about a meta it actually walked.
const LITERAL_NODE_FLOOR = 15;

function plantedBeforeTheRunnerCall(statement: string): { source: string; plantedLine: number } {
  const runnerCallStart = BUNDLE_TEXT.lastIndexOf(RUNNER_CALL_OPENING) + 1;
  const textBefore = BUNDLE_TEXT.slice(0, runnerCallStart);
  return { source: `${textBefore}${statement}\n${BUNDLE_TEXT.slice(runnerCallStart)}`, plantedLine: textBefore.split('\n').length };
}

describe('the built dispatcher script', () => {
  test('ends in the call of its runner, the point every plant below goes in front of', () => {
    expect(BUNDLE_TEXT).toMatch(/\nreturn await \w+\(\);\n$/);
  });

  test('carries a pure meta whose value is DISPATCH_META and the frozen table\'s meta, key order included', () => {
    const frozenMeta = readFrozenDispatchTraces().meta;
    const metaRead = WorkflowScriptSourceUtil.metaLiteralValueOf(BUNDLE_TEXT);
    expect(WorkflowScriptSourceUtil.metaLiteralVerdictOf(BUNDLE_TEXT).verdict).toBe('pure');
    expect(metaRead).toEqual({ verdict: 'value', value: DISPATCH_META });
    expect(metaRead).toEqual({ verdict: 'value', value: frozenMeta });
    expect(metaRead.verdict === 'value' ? JSON.stringify(metaRead.value) : null).toBe(JSON.stringify(frozenMeta));
  });

  test('its meta walk reaches more than 15 literal nodes', () => {
    const verdict = WorkflowScriptSourceUtil.metaLiteralVerdictOf(BUNDLE_TEXT);
    expect(verdict.verdict === 'pure' ? verdict.literalNodeCount : 0).toBeGreaterThan(LITERAL_NODE_FLOOR);
  });

  test('an impurity planted in its meta is caught', () => {
    expect(BUNDLE_TEXT.split(META_NAME_LINE)).toHaveLength(2);
    const source = BUNDLE_TEXT.replace(META_NAME_LINE, '"name": `agent-progress-${1}`,');
    expect(WorkflowScriptSourceUtil.metaLiteralVerdictOf(source).verdict).toBe('impure');
  });

  test('calls no clock and no randomness', () => {
    expect(WorkflowScriptSourceUtil.nondeterministicCallsIn(BUNDLE_TEXT)).toEqual([]);
  });

  test.each([
    ['const plantedNow = Date.now();', 'Date.now'],
    ['const plantedPick = Math.random();', 'Math.random'],
    ['const plantedDate = new Date();', 'new Date()'],
    ['const plantedStamp = Date();', 'Date()'],
  ])('a clock or randomness planted in its body (%s) is caught', (statement, expectedForm) => {
    const { source, plantedLine } = plantedBeforeTheRunnerCall(statement);
    expect(WorkflowScriptSourceUtil.nondeterministicCallsIn(source)).toEqual([`${expectedForm} at line ${plantedLine}`]);
  });

  // The floor proves the walk reaches the body's own declarations, so an empty answer below means none shadows a global.
  test('binds no Workflow global at its top level, though its own declarations are found there', () => {
    expect(WorkflowScriptSourceUtil.topLevelBindingsNamed(BUNDLE_TEXT, NAMES_DECLARED_AT_THE_BUNDLE_TOP_LEVEL)).toHaveLength(NAMES_DECLARED_AT_THE_BUNDLE_TOP_LEVEL.length);
    expect(WorkflowScriptSourceUtil.topLevelBindingsNamed(BUNDLE_TEXT, WORKFLOW_GLOBAL_NAMES)).toEqual([]);
  });

  test.each([...WORKFLOW_GLOBAL_NAMES])('the Workflow global %s planted as a top-level binding in its body is caught', (globalName) => {
    const { source, plantedLine } = plantedBeforeTheRunnerCall(`let ${globalName};`);
    expect(WorkflowScriptSourceUtil.topLevelBindingsNamed(source, WORKFLOW_GLOBAL_NAMES)).toEqual([`${globalName} at line ${plantedLine}`]);
  });

  test('is the same text on a second build, and names no path of the checkout', async () => {
    DispatchScriptBundleBookkeeping.forgetMemoisedBundle();
    const buildsBeforeTheRebuild = DispatchScriptBundleBookkeeping.buildCount;
    const rebuiltText = builtScriptTextOf(await bundleDispatchScript());
    expect(DispatchScriptBundleBookkeeping.buildCount).toBe(buildsBeforeTheRebuild + 1);
    expect(rebuiltText).toBe(BUNDLE_TEXT);
    expect(BUNDLE_TEXT).not.toContain(join(import.meta.dir, '..'));
    expect(BUNDLE_TEXT).not.toContain('/Users/');
  });

  test('starts every agent through its one agent() call', () => {
    expect(BUNDLE_TEXT.split('.agent(')).toHaveLength(2);
  });
});
