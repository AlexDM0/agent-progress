/**
 * `hook bash-domains`, the network guard. What matters: a Bash call asking for a domain outside `--allow`, or a WebFetch of a host outside
 * it, is denied through the PreToolUse JSON; a call inside the list, a call naming no domain and any other tool pass silently, granting
 * nothing; and every failure (no input, not JSON, no `--allow`, a url with no host, a malformed domain list) answers deny, always at exit 0.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
} from 'bun:test';
import { createScratchDirectory, removeScratchDirectory } from '../../src/testing/ScratchWorkspace.ts';
import { runCommandLine }                                 from '../Main.ts';
import { createCapturedCommandContext }                   from '../testing/CapturedCommandContext.ts';

let scratchDirectory = '';

beforeEach(() => {
  scratchDirectory = createScratchDirectory('bash-domains-hook');
});

afterEach(() => {
  removeScratchDirectory(scratchDirectory);
});

const ALLOW = ['--allow', 'registry.example.com,*.example.org'];

async function answerOf(hookInput: unknown, allowArguments: readonly string[] = ALLOW): Promise<{ exitCode: number; output: string }> {
  const standardInputText = typeof hookInput === 'string' ? hookInput : JSON.stringify(hookInput);
  const context = createCapturedCommandContext({ currentDirectory: scratchDirectory, standardInputText });
  const exitCode = await runCommandLine(['hook', 'bash-domains', ...allowArguments], context);
  return { exitCode, output: context.outputText() };
}

function decisionOf(output: string): string | null {
  if (output.trim() === '') return null;
  return (JSON.parse(output) as { hookSpecificOutput: { permissionDecision: string } }).hookSpecificOutput.permissionDecision;
}

function bashCall(allowedDomains: unknown): unknown {
  return { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'curl https://example.net', allowed_domains: allowedDomains } };
}

function webFetch(url: unknown): unknown {
  return { hook_event_name: 'PreToolUse', tool_name: 'WebFetch', tool_input: { url, prompt: 'Summarise' } };
}

describe('denies what leaves the list', () => {
  test.each([
    ['a Bash call asking for an unlisted domain', bashCall(['registry.example.com', 'example.net'])],
    ['a Bash call asking for a wildcard the list does not hold', bashCall('*.example.com')],
    ['a Bash call asking for the bare domain of a wildcard entry', bashCall(['example.org'])],
    ['a WebFetch of an unlisted host', webFetch('https://example.net/page')],
    ['a WebFetch of loopback', webFetch('http://127.0.0.1:8080/')],
  ])('%s is denied through the PreToolUse JSON at exit 0', async (_case, hookInput) => {
    const { exitCode, output } = await answerOf(hookInput);
    expect(exitCode).toBe(0);
    expect(JSON.parse(output)).toMatchObject({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' } });
  });
});

describe('passes what stays inside it, granting nothing', () => {
  test.each([
    ['a Bash call asking for listed domains', bashCall(['Registry.Example.com', 'cdn.example.org'])],
    ['a Bash call naming no domain', bashCall(undefined)],
    ['a WebFetch of a listed host', webFetch('https://registry.example.com/package')],
    ['a WebFetch of a subdomain under a wildcard entry', webFetch('https://docs.example.org/')],
    ['any other tool', { tool_name: 'Read', tool_input: { file_path: '/example' } }],
  ])('%s prints nothing at exit 0', async (_case, hookInput) => {
    expect(await answerOf(hookInput)).toEqual({ exitCode: 0, output: '' });
  });
});

describe('answers deny on any failure', () => {
  test.each([
    ['no input', ''],
    ['input that is not JSON', '{'],
    ['input that is a list', '[]'],
    ['a WebFetch whose url names no host', webFetch('not a url')],
    ['a Bash call whose allowed_domains is no list of domains', bashCall([1, 2])],
  ])('%s', async (_case, hookInput) => {
    const { exitCode, output } = await answerOf(hookInput);
    expect(exitCode).toBe(0);
    expect(decisionOf(output)).toBe('deny');
  });

  test('with no --allow every requested domain is outside the list', async () => {
    const { exitCode, output } = await answerOf(bashCall(['registry.example.com']), []);
    expect(exitCode).toBe(0);
    expect(decisionOf(output)).toBe('deny');
  });
});
