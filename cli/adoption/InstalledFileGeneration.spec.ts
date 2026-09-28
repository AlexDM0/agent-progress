/**
 * The texts `init` and `update` install, computed before anything is written. The cases that matter: no placeholder survives, the definition
 * keeps its frontmatter at byte 0 with the default pair and the brief names it in prose (`Opus`), the brief and the block state `DISPATCH_PROTOCOL`'s
 * numbers, which the dispatcher's prompts also state, and name the paths the catalogue installs to, the dispatcher is a Workflow script with
 * its meta first and no path of this checkout in it, `--no-workflow` bundles nothing, and a failed bundle is a refusal the tool will not
 * repair. The spec builds the dispatcher by path, as the command does, and never imports `dispatcher/`.
 */
import { join, relative, sep } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { OperationRefusal }                              from '../../src/shared/OperationRefusal.ts';
import { DISPATCH_PROTOCOL }                             from '../../src/shared/constants/DispatchProtocol.ts';
import { installedFilePathsIn }                          from '../InstalledFiles.ts';
import { dispatcherScriptTextOf, installedFileTextsFor } from './InstalledFileGeneration.ts';

const TEXTS = await installedFileTextsFor({ generatesTheDispatcherScript: true });

const CHECKOUT_DIRECTORY = join(import.meta.dir, '..', '..');

const EXAMPLE_ROOT = join(sep, 'scratch', 'example-repository');

describe('the installed texts', () => {
  test('no text holds a placeholder left unfilled', () => {
    for (const [textName, text] of Object.entries(TEXTS)) expect(text ?? '', textName).not.toContain('{{');
  });

  test('the agent definition starts with its frontmatter and carries the default model and effort', () => {
    expect(TEXTS.agentDefinition).toStartWith('---\n');
    expect(TEXTS.agentDefinition).toContain('model: opus\n');
    expect(TEXTS.agentDefinition).toContain('effort: medium\n');
  });

  test('the brief names the default model by its display word and the default effort', () => {
    expect(TEXTS.agentBrief).toContain('Both run on Opus at medium effort unless their ticket names another');
  });

  test('the builder brief states the builder\'s call budget, and the review brief the reviewer\'s budget and the rework threshold', () => {
    expect(TEXTS.builderBrief).toContain(`One budget of\nabout ${DISPATCH_PROTOCOL.BUILDER_API_CALL_BUDGET} calls`);
    expect(TEXTS.builderBrief).toContain(`or at about ${DISPATCH_PROTOCOL.BUILDER_API_CALL_BUDGET} API calls`);
    expect(TEXTS.reviewBrief).toContain(`up to about ${DISPATCH_PROTOCOL.REVIEWER_API_CALL_BUDGET} API calls`);
    expect(TEXTS.reviewBrief).toContain(`Over ${DISPATCH_PROTOCOL.REWORK_ROUND_THRESHOLD_LINES} lines of code reworked`);
  });

  // Each dispatched agent reads only its own brief, so a block in the wrong one is either missing for its reader or paid for by the other.
  test('the builder\'s blocks and the reviewer\'s block each sit in their own brief only', () => {
    expect(TEXTS.builderBrief).toContain('## Ready to merge');
    expect(TEXTS.builderBrief).not.toContain('agent-progress release <id>');
    expect(TEXTS.reviewBrief).toContain('agent-progress release <id>');
    expect(TEXTS.reviewBrief).not.toContain('## Ready to merge');
    expect(TEXTS.agentBrief).not.toContain('## Ready to merge');
    expect(TEXTS.agentBrief).not.toContain('agent-progress release <id>');
  });

  test('the agent definition is named for the type the dispatcher starts its workers as, and preloads the tracker skill without the Skill tool', () => {
    expect(TEXTS.agentDefinition).toContain(`\nname: ${DISPATCH_PROTOCOL.WORKER_AGENT_TYPE}\n`);
    expect(TEXTS.agentDefinition).toContain('\nskills: agent-progress\n');
    const toolsLine = TEXTS.agentDefinition.split('\n').find((line) => line.startsWith('tools: ')) ?? '';
    expect(toolsLine.split(/[:,]\s*/)).not.toContain('Skill');
    expect(toolsLine).toContain('Bash, Read, Edit, Write');
  });

  test('the block states the rework threshold and names the installed brief and dispatcher by their paths in the repository', () => {
    const dispatcherPathInRepository = relative(EXAMPLE_ROOT, installedFilePathsIn(EXAMPLE_ROOT).dispatcherScript).split(sep).join('/');
    expect(TEXTS.claudeInstructionsBlockBody).toContain(`over ${DISPATCH_PROTOCOL.REWORK_ROUND_THRESHOLD_LINES} lines of code`);
    expect(TEXTS.claudeInstructionsBlockBody).toContain(`\`${DISPATCH_PROTOCOL.REVIEW_BRIEF_PATH_IN_REPOSITORY}\``);
    expect(TEXTS.claudeInstructionsBlockBody).toContain(`\`${dispatcherPathInRepository}\``);
  });

  test('the agent definition names the builder and review briefs by their paths in the repository', () => {
    expect(TEXTS.agentDefinition).toContain(`\`${DISPATCH_PROTOCOL.BUILDER_BRIEF_PATH_IN_REPOSITORY}\``);
    expect(TEXTS.agentDefinition).toContain(`\`${DISPATCH_PROTOCOL.REVIEW_BRIEF_PATH_IN_REPOSITORY}\``);
  });

  test('the dispatcher is a Workflow script: its meta first, no import or export, and the runner\'s call last', () => {
    const dispatcherScript = TEXTS.dispatcherScript ?? '';
    expect(dispatcherScript).toStartWith('export const meta = {\n');
    expect(dispatcherScript).toContain('"name": "agent-progress-dispatch"');
    expect(dispatcherScript).toMatch(/\nreturn await \w+\(\);\n$/);
    // The meta's export and the top-level return are the Workflow tool's own forms; between them is one plain module body.
    const moduleBody = dispatcherScript.replace('export const meta = ', 'const meta = ').replace(/\nreturn await \w+\(\);\n$/, '\n');
    const { imports, exports } = new Bun.Transpiler({ loader: 'js' }).scan(moduleBody);
    expect(imports).toEqual([]);
    expect(exports).toEqual([]);
  });

  test('the dispatcher names no path of this checkout', () => {
    expect(TEXTS.dispatcherScript).not.toContain(CHECKOUT_DIRECTORY);
  });

  test('with no dispatcher asked for, none is bundled', async () => {
    expect((await installedFileTextsFor({ generatesTheDispatcherScript: false })).dispatcherScript).toBeNull();
  });
});

describe('dispatcherScriptTextOf', () => {
  test('a bundle that failed is an unrepaired refusal naming its reason', () => {
    let thrown: unknown = null;
    try {
      dispatcherScriptTextOf({ verdict: 'failed', reason: 'no-single-runner-export', detail: '[]' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OperationRefusal);
    expect((thrown as OperationRefusal).status).toBe('unrepaired');
    expect((thrown as OperationRefusal).message).toContain('no-single-runner-export');
    expect((thrown as OperationRefusal).message).toContain('nothing was written');
  });
});
