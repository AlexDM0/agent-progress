/**
 * A session under a job, driven in-process with the job carried on its context (never the environment): every relayed verb writes one
 * request of its own kind and prints `queued` when no reply comes; every read-only verb runs directly and relays nothing; every other verb
 * is refused before it runs. The three lists are exact both ways over the verbs the table answers. A reply, once the runner writes one, is
 * printed: a done reply as done, a refusal worded as a direct run would word it, at its exit code.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test
} from 'bun:test';

import type { RelayRequest }                                         from '../src/adapters/relay/@types/RelayFormat.ts';
import { RelayFormatUtil }                                           from '../src/adapters/relay/utils/RelayFormatUtil.ts';
import { OperationRefusalWordingUtil }                               from '../src/adapters/utils/OperationRefusalWordingUtil.ts';
import { ControlService }                                            from '../src/services/control/ControlService.ts';
import { RoleCommandPolicy }                                         from '../src/services/control/RoleCommandPolicy.ts';
import { createRenderState }                                         from '../src/services/render/RenderState.ts';
import { writeTracker }                                              from '../src/services/tracker/TrackerPipeline.ts';
import { requireWorkspace }                                          from '../src/services/tracker/Workspace.ts';
import type { ControlCommandKind }                                   from '../src/shared/@types/ControlCommand.ts';
import { OperationRefusal }                                          from '../src/shared/OperationRefusal.ts';
import { PRODUCT_NAMES }                                             from '../src/shared/constants/ProductNames.ts';
import { createScratchDirectory, removeScratchDirectory }            from '../src/testing/ScratchWorkspace.ts';
import type { CommandContext }                                       from './CommandContext.ts';
import { COMMAND_NAMES }                                             from './CommandTable.ts';
import { runCommandLine }                                            from './Main.ts';
import { READ_ONLY_VERBS_UNDER_A_JOB, RELAYED_VERB_OF_CONTROL_KIND } from './constants/JobVerbs.ts';
import { DRAFT_SUBCOMMAND_NAMES }                                    from './drafts/DraftCommand.ts';
import { EPIC_SUBCOMMAND_NAMES }                                     from './epics/EpicCommand.ts';
import { INTAKE_SUBCOMMAND_NAMES }                                   from './intake/IntakeCommand.ts';
import { JOB_SUBCOMMAND_NAMES }                                      from './jobs/JobCommand.ts';
import { RUN_SUBCOMMAND_NAMES }                                      from './runner/RunCommand.ts';
import { createCapturedCommandContext, type CapturedCommandContext } from './testing/CapturedCommandContext.ts';
import { createInitializedScratchRepository }                        from './testing/InitializedScratchRepository.ts';
import { TICKET_SUBCOMMAND_NAMES }                                   from './tickets/TicketCommand.ts';

const SPEC_CLOCK = (): Date => new Date('2026-09-18T20:11:03Z');

const ARGUMENTS_OF_KIND: { readonly [Kind in ControlCommandKind]: readonly string[] } = {
  'ticket-add':                  ['ticket', 'add', 'Found beside the work', '--type', 'bug', '--priority', 'low', '--needs-user', '--body', '## Report\nSeen.\n'],
  'ticket-edit':                 ['ticket', 'edit', '1', '--title', 'Sharper title'],
  'ticket-depends':              ['ticket', 'depends', '1', '--add', '2'],
  'ticket-priority':             ['ticket', 'priority', '1', 'high'],
  'ticket-epic':                 ['ticket', 'epic', '1', '--add', 'checkout'],
  'ticket-abandon':              ['ticket', 'abandon', '1', '--reason', 'superseded by #2'],
  'ticket-ready':                ['ticket', 'ready', '1'],
  'ticket-network':              ['ticket', 'network', '1', 'api.example.com'],
  'ticket-hold':                 ['ticket', 'hold', '1', '--reason', 'waiting on Alex Example'],
  'ticket-unhold':               ['ticket', 'unhold', '1'],
  'epic-add':                    ['epic', 'add', 'search', 'Search'],
  'draft-open':                  ['draft', 'open', 'Another intake', '--owner', 'Alex Example'],
  'draft-claim':                 ['draft', 'claim', 'D1', '--owner', 'Alex Example'],
  'draft-release':               ['draft', 'release', 'D1'],
  'draft-note':                  ['draft', 'note', 'D1', 'Assumed EUR.', '--assumption'],
  'draft-ask':                   ['draft', 'ask', 'D1', 'Which currency?', '--context', 'Prices', '--option', 'EUR', '--option', 'USD', '--recommended', 'A'],
  'draft-answer':                ['draft', 'answer', 'D1', 'Q1', 'EUR'],
  'draft-drop':                  ['draft', 'drop', 'D1', 'N1'],
  'draft-close':                 ['draft', 'close', 'D1', '--tickets', '1'],
  'draft-abandon':               ['draft', 'abandon', 'D1', '--reason', 'dropped'],
  'decision-answer':             ['decide', 'E1', 'a'],
  'job-stop':                    ['job', 'stop', 'J1'],
  'job-fresh':                   ['job', 'fresh', 'J1'],
  'job-stop-all':                ['job', 'stop', '--all'],
  'job-message':                 ['job', 'message', 'J1', '--', 'Keep the basket page.'],
  'intake-start':                ['intake', '--', 'Alex Example asks for a basket.'],
  'intake-close':                ['intake', 'close', '--set', '1'],
  'runner-pause':                ['run', 'pause'],
  'runner-resume':               ['run', 'resume'],
  'runner-stop':                 ['run', 'stop', '--now'],
  'runner-restart':              ['run', 'restart'],
  'concurrency-set':             ['concurrency', '3'],
  'checks-set':                  ['checks', 'bun test'],
  'install-command-set':         ['checks', '--install', 'bun install'],
  'checks-definition-files-set': ['checks', '--definition-files', 'pyproject.toml noxfile.py'],
  'gate-key-command-set':        ['checks', '--key-command', 'bun --version'],
  'gate-cache-paths-set':        ['checks', '--cache-paths', '~/.cache/example-tool'],
};

const ARGUMENTS_OF_READ_ONLY_VERB: Readonly<Record<string, readonly string[]>> = {
  'help':              ['help'],
  'status':            ['status'],
  'usage':             ['usage'],
  'review-stats':      ['review-stats'],
  'ticket show':       ['ticket', 'show', '1'],
  'ticket list':       ['ticket', 'list'],
  'epic show':         ['epic', 'show', 'checkout'],
  'epic list':         ['epic', 'list'],
  'draft show':        ['draft', 'show', 'D1'],
  'draft list':        ['draft', 'list'],
  'hook bash-domains': ['hook', 'bash-domains', '--allow', 'registry.example.com'],
};

let repositoryDirectory = '';
let relayDirectory      = '';

beforeAll(async () => {
  repositoryDirectory = await createInitializedScratchRepository('relay-under-job', ['--project', 'Example Agency', '--no-claude-md', '--no-hooks'], SPEC_CLOCK);
  for (const setupArguments of [
    ['ticket', 'add', 'Export dialog', '--type', 'ticket'],
    ['epic', 'add', 'checkout', 'Checkout'],
    ['draft', 'open', 'Intake', '--owner', 'Alex Example'],
  ]) {
    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: SPEC_CLOCK });
    expect(await runCommandLine(setupArguments, context), context.errorText()).toBe(0);
  }
});

afterAll(() => {
  removeScratchDirectory(repositoryDirectory);
});

function jobContext(replyTries = 1): CapturedCommandContext & Required<Pick<CommandContext, 'job'>> {
  relayDirectory = createScratchDirectory('relay-folder');
  return {
    ...createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: SPEC_CLOCK }),
    job: {
      jobId: 'J7', relayDirectory, replyTries, replyIntervalMilliseconds: 10
    },
  };
}

function requestsWritten(): RelayRequest[] {
  const requestsFolder = join(relayDirectory, 'requests');
  if (!existsSync(requestsFolder)) return [];
  return readdirSync(requestsFolder).map((fileName) => JSON.parse(readFileSync(join(requestsFolder, fileName), 'utf8')) as RelayRequest);
}

function progressFileText(): string {
  return readFileSync(join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'progress.json'), 'utf8');
}

/** Every verb the command table answers, as `cli/Main.ts` names it. */
function everyVerb(): string[] {
  return COMMAND_NAMES.flatMap((command) => {
    if (command === 'ticket') return TICKET_SUBCOMMAND_NAMES.map((subcommand) => `ticket ${subcommand}`);
    if (command === 'epic') return EPIC_SUBCOMMAND_NAMES.map((subcommand) => `epic ${subcommand}`);
    if (command === 'draft') return DRAFT_SUBCOMMAND_NAMES.map((subcommand) => `draft ${subcommand}`);
    if (command === 'run') return [command, ...RUN_SUBCOMMAND_NAMES.map((subcommand) => `run ${subcommand}`)];
    if (command === 'hook') return [command, 'hook bash-domains'];
    if (command === 'job') return JOB_SUBCOMMAND_NAMES.map((subcommand) => `job ${subcommand}`);
    if (command === 'intake') return [command, ...INTAKE_SUBCOMMAND_NAMES.map((subcommand) => `intake ${subcommand}`)];
    return [command];
  });
}

describe('relayed verbs', () => {
  test.each(Object.keys(ARGUMENTS_OF_KIND) as ControlCommandKind[])('%s writes one request of its kind and prints queued with no reply', async (kind) => {
    const progressBefore = progressFileText();
    const context        = jobContext();
    const commandLine    = ARGUMENTS_OF_KIND[kind];
    expect(commandLine.slice(0, RELAYED_VERB_OF_CONTROL_KIND[kind].split(' ').length).join(' ')).toBe(RELAYED_VERB_OF_CONTROL_KIND[kind]);

    expect(await runCommandLine(commandLine, context), context.errorText()).toBe(0);

    const [request, ...others] = requestsWritten();
    expect(others).toEqual([]);
    expect(request?.relayFormatVersion).toBe(1);
    expect(request?.command.kind).toBe(kind);
    expect(context.outputText()).toBe(`queued ${request?.requestId}`);
    expect(progressFileText()).toBe(progressBefore);
  });

  test('a filing carries --needs-user and its body beside the command, and names no job or role', async () => {
    const context = jobContext();
    expect(await runCommandLine(ARGUMENTS_OF_KIND['ticket-add'], context)).toBe(0);
    const [request] = requestsWritten();
    expect(request?.bodyText).toBe('## Report\nSeen.\n');
    expect(request?.command).toMatchObject({
      kind: 'ticket-add', needsUser: true, priority: 'low', bodyText: null
    });
    expect(Object.keys(request ?? {}).sort()).toEqual(['bodyText', 'command', 'relayFormatVersion', 'requestId']);
  });
});

describe('read-only and refused verbs', () => {
  test('every verb the table answers is relayed, read-only or refused, and each list names only verbs the table answers', () => {
    const relayedVerbs = Object.values(RELAYED_VERB_OF_CONTROL_KIND);
    expect(Object.keys(ARGUMENTS_OF_READ_ONLY_VERB).sort()).toEqual([...READ_ONLY_VERBS_UNDER_A_JOB].sort());
    expect([...relayedVerbs, ...READ_ONLY_VERBS_UNDER_A_JOB].filter((verb) => !everyVerb().includes(verb))).toEqual([]);
  });

  test.each([...READ_ONLY_VERBS_UNDER_A_JOB])('%s runs directly under a job and relays nothing', async (verb) => {
    const progressBefore = progressFileText();
    const context        = jobContext();
    expect(await runCommandLine(ARGUMENTS_OF_READ_ONLY_VERB[verb] ?? [], context), context.errorText()).toBe(0);
    expect(requestsWritten()).toEqual([]);
    expect(progressFileText()).toBe(progressBefore);
  });

  test('every other verb is refused before it runs, naming the verb and the job, with nothing relayed or written', async () => {
    const placedVerbs  = new Set([...Object.values(RELAYED_VERB_OF_CONTROL_KIND), ...READ_ONLY_VERBS_UNDER_A_JOB]);
    const refusedVerbs = everyVerb().filter((verb) => !placedVerbs.has(verb));
    const progressBefore = progressFileText();
    expect(refusedVerbs).toContain('ticket start');
    for (const verb of refusedVerbs) {
      const context = jobContext();
      expect(await runCommandLine(verb.split(' '), context), verb).toBe(1);
      expect(context.errorText(), verb).toContain('cannot run under job J7');
      expect(requestsWritten(), verb).toEqual([]);
    }
    expect(progressFileText()).toBe(progressBefore);
  });
});

describe('the runner\'s reply', () => {
  async function runAnswering(reply: (requestId: string) => object): Promise<{ exitCode: number; context: CapturedCommandContext }> {
    const context  = jobContext(100);
    const running  = runCommandLine(ARGUMENTS_OF_KIND['ticket-add'], context);
    let requestId: string | undefined;
    while (requestId === undefined) {
      await Bun.sleep(5);
      requestId = requestsWritten()[0]?.requestId;
    }
    mkdirSync(join(relayDirectory, 'replies'), { recursive: true });
    writeFileSync(join(relayDirectory, 'replies', `${requestId}.json`), JSON.stringify({ relayFormatVersion: 1, requestId, ...reply(requestId) }));
    return { exitCode: await running, context };
  }

  test('a done reply prints the request id and the filed ticket at exit 0', async () => {
    const { exitCode, context } = await runAnswering(() => ({ outcome: 'done', ticketIds: ['014'] }));
    expect(exitCode).toBe(0);
    expect(context.outputText()).toMatch(/^done [0-9a-f-]+ \(#014\): the runner applied the request\.$/);
  });

  test('a refused reply is worded by the refusal-wording util and exits 1', async () => {
    const detail = { kind: 'role-command-refused', reason: 'worker-filing-limit', commandKind: 'ticket-add' } as const;
    const { exitCode, context } = await runAnswering(() => ({ outcome: 'refused', status: 'refused', detail }));
    expect(exitCode).toBe(1);
    expect(context.errorText()).toBe(OperationRefusalWordingUtil.messageOf(new OperationRefusal('refused', detail)));
  });

  test('a reply that cannot be read is unrepaired at exit 2', async () => {
    const { exitCode, context } = await runAnswering(() => ({ outcome: 'perhaps' }));
    expect(exitCode).toBe(2);
    expect(context.errorText()).toContain('cannot be read');
  });
});

describe('the runner applying an admitted filing', () => {
  test('the admission stamps filedByJob and findingRoute on the filed draft', async () => {
    const context = jobContext();
    expect(await runCommandLine(ARGUMENTS_OF_KIND['ticket-add'], context)).toBe(0);
    const reading = RelayFormatUtil.requestReadingOf(JSON.stringify(requestsWritten()[0]));
    if (reading.verdict !== 'read') throw new Error(`the request did not read back: ${reading.reason}`);
    const verdict = RoleCommandPolicy.verdictOf({
      id: 'J7', role: 'builder', filedTickets: [], deliveredIncidents: []
    }, reading.command);
    if (verdict.verdict !== 'admitted') throw new Error(`the filing was refused: ${verdict.reason}`);

    const written = await writeTracker({
      workspace:   requireWorkspace(repositoryDirectory),
      at:          '2026-09-18T22:11:03+02:00',
      now:         SPEC_CLOCK,
      renderState: createRenderState(),
      mutate:      (change) => ControlService.apply(verdict.command, change).result,
    });
    const filed = written.result as { ticket: { filePath: string } };
    const text  = readFileSync(filed.ticket.filePath, 'utf8');
    expect(text).toContain('status: "draft"');
    expect(text).toContain('filedByJob: "J7"\nfindingRoute: "user"\n');
  });
});

describe('outside a job', () => {
  test('--needs-user is refused worker-filing-flag and nothing is filed', async () => {
    const progressBefore = progressFileText();
    const context        = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: SPEC_CLOCK });
    expect(await runCommandLine(ARGUMENTS_OF_KIND['ticket-add'], context)).toBe(1);
    expect(context.errorText()).toContain('(worker-filing-flag)');
    expect(progressFileText()).toBe(progressBefore);
  });

  test('a ticket filed directly carries neither filedByJob nor findingRoute', async () => {
    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: SPEC_CLOCK });
    expect(await runCommandLine(['ticket', 'add', 'Direct filing', '--type', 'bug', '--priority', 'low', '--json'], context)).toBe(0);
    const filed = JSON.parse(context.outputText()) as { filePath: string };
    const text  = readFileSync(filed.filePath, 'utf8');
    expect(text).not.toContain('filedByJob');
    expect(text).not.toContain('findingRoute');
  });
});
