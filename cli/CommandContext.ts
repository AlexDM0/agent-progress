/**
 * Everything a command may know about its process, so every command spec runs in the test process
 * against a scratch directory and a frozen clock. It carries no environment access on purpose:
 * `src/shared/Environment.ts` is the one module that reads the environment.
 */
import { homedir, tmpdir } from 'node:os';
import { createInterface } from 'node:readline';

import type { AgentAdapter }                   from '../src/lib/agent-launch/AgentAdapter.ts';
import { CLAUDE_CODE_ADAPTER }                 from '../src/lib/claude-code/ClaudeCodeAdapter.ts';
import { createRenderState, type RenderState } from '../src/services/render/RenderState.ts';
import {
  executableSearchPath,
  fakeAgentIsOn,
  relayDirectory,
  runnerJobId
} from '../src/shared/Environment.ts';
import { RELAY_REPLY_INTERVAL_MILLISECONDS, RELAY_REPLY_TRIES } from '../src/shared/constants/RunnerLimits.ts';
import { fakeAgentAdapter }                                     from '../src/testing/FakeAgentAdapter.ts';

export interface CommandContext {
  currentDirectory:        string;
  now:                     () => Date;
  standardOutput:          (text: string) => void;
  standardError:           (text: string) => void;
  standardInputIsTerminal: boolean;
  /** Everything piped in, read once and to the end; a command a person typed gets the empty string rather than a wait nobody can see. */
  readStandardInput:       () => Promise<string>;
  confirm:                 (question: string) => Promise<boolean>;
  /** `process.platform`, carried here so a spec can choose the operating system a command believes it runs on. */
  platform:                string;
  /** `node:os`'s `homedir()`, carried here so a spec can point the Claude Code transcripts at a scratch tree. */
  homeDirectory:           string;
  /** The folders of this process's `PATH`, which a gate's `--writes` folder never makes writable. */
  executableSearchPath:    readonly string[];
  /** `temporaryDirectoriesOfThisMachine()`: a tracker under any of them is a scratch one the monitor registry leaves out. */
  temporaryDirectories:    readonly string[];
  /** The verb `cli/Main.ts` dispatched, such as `ticket finish`, which the monitor registry records; empty before the dispatch. */
  commandVerb:             string;
  /** Created once per invocation; holds the render service's memos, the page bundle and the configured Marked. */
  renderState:             RenderState;
  /** Present only when the runner launched this process for a job: then a mutating verb relays rather than opening the tracker. */
  job?:                    JobContext;
  /** The runtime and the entry point this process was started with, which `run --detach` starts again with the runner's arguments. */
  programCommand:          readonly string[];
  /** Calls `listener` on SIGTERM and SIGINT, which a foreground runner takes as a stop; returns the unsubscribe. */
  onStopSignal:            (listener: () => void) => () => void;
  /** What the runner launches its sessions through: Claude Code, or the scripted fake agent under the fake-agent switch. */
  agentAdapter:            AgentAdapter;
}

/** The one place outside `src/lib/claude-code/` the vendor's adapter is chosen; a spec-spawned binary always gets the fake. */
export function agentAdapterOfThisProcess(): AgentAdapter {
  return fakeAgentIsOn() ? fakeAgentAdapter() : CLAUDE_CODE_ADAPTER;
}

const STOP_SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

function onStopSignalOfThisProcess(listener: () => void): () => void {
  for (const signal of STOP_SIGNALS) process.on(signal, listener);
  return () => {
    for (const signal of STOP_SIGNALS) process.off(signal, listener);
  };
}

/** The script is `process.argv[1]`: Bun puts the runtime first and the entry point second. */
function programCommandOfThisProcess(): string[] {
  const entryPoint = process.argv[1];
  return entryPoint === undefined ? [process.execPath] : [process.execPath, entryPoint];
}

export interface JobContext {
  jobId:                     string;
  relayDirectory:            string;
  replyTries:                number;
  replyIntervalMilliseconds: number;
}

/** Both getters set, or no job: one alone is a session the runner did not launch whole, which runs as any other process does. */
function jobContextOfThisProcess(): JobContext | undefined {
  const jobId          = runnerJobId();
  const relayFolder    = relayDirectory();
  if (jobId === undefined || relayFolder === undefined) return undefined;
  return {
    jobId, relayDirectory: relayFolder, replyTries: RELAY_REPLY_TRIES, replyIntervalMilliseconds: RELAY_REPLY_INTERVAL_MILLISECONDS
  };
}

/** Beside `tmpdir()`, which on macOS is a per-user folder under `/var/folders`; Claude Code keeps its scratchpads under `/tmp`. */
const TEMPORARY_FOLDERS_OF_EVERY_UNIX_MACHINE = ['/tmp', '/var/tmp'];

/** The one set of temp roots the monitor registry leaves out, each compared after resolving symlinks. */
export function temporaryDirectoriesOfThisMachine(): string[] {
  return [tmpdir(), ...TEMPORARY_FOLDERS_OF_EVERY_UNIX_MACHINE];
}

/** A function, never a module constant: a constant would read `process.cwd()` at import time and hand every spec the test runner's directory. */
export function createProcessContext(): CommandContext {
  const job = jobContextOfThisProcess();
  return {
    ...(job === undefined ? {} : { job }),
    currentDirectory:        process.cwd(),
    now:                     () => new Date(),
    standardOutput:          (text: string) => console.log(text),
    standardError:           (text: string) => console.error(text),
    standardInputIsTerminal: process.stdin.isTTY === true,
    readStandardInput:       readEverythingOnStandardInput,
    confirm:                 confirmOnStandardInput,
    platform:                process.platform,
    homeDirectory:           homedir(),
    executableSearchPath:    executableSearchPath(),
    temporaryDirectories:    temporaryDirectoriesOfThisMachine(),
    commandVerb:             '',
    renderState:             createRenderState(),
    programCommand:          programCommandOfThisProcess(),
    onStopSignal:            onStopSignalOfThisProcess,
    agentAdapter:            agentAdapterOfThisProcess(),
  };
}

/**
 * A terminal is answered with the empty string rather than read: `agent-progress hook subagent-stop`
 * typed by hand would otherwise hang until whoever typed it found `Ctrl-D`.
 */
function readEverythingOnStandardInput(): Promise<string> {
  if (process.stdin.isTTY === true) return Promise.resolve('');
  return Bun.stdin.text();
}

/** Fail closed: anything but `y` or `yes` is a no, including an empty line and end of input. */
async function confirmOnStandardInput(question: string): Promise<boolean> {
  process.stdout.write(`${question} `);
  const readerInterface = createInterface({ input: process.stdin });
  try {
    const firstLine = await readerInterface[Symbol.asyncIterator]().next();
    const answer = firstLine.done === true ? '' : firstLine.value.trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    readerInterface.close();
    // Without this the still-flowing stream keeps the event loop alive and the command hangs.
    process.stdin.pause();
  }
}
