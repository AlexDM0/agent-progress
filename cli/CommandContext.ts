/**
 * Everything a command may know about its process, so every command spec runs in the test process
 * against a scratch directory and a frozen clock. It carries no environment access on purpose:
 * `lib/platform/Environment.ts` is the one module that reads the environment.
 */
import { createInterface } from 'node:readline';

export interface CommandContext {
  currentDirectory:        string;
  now:                     () => Date;
  standardOutput:          (text: string) => void;
  standardError:           (text: string) => void;
  standardInputIsTerminal: boolean;
  /** Everything piped in, read once and to the end; a command a person typed gets the empty string rather than a wait nobody can see. */
  readStandardInput:       () => Promise<string>;
  confirm:                 (question: string) => Promise<boolean>;
}

/** A function, never a module constant: a constant would read `process.cwd()` at import time and hand every spec the test runner's directory. */
export function createProcessContext(): CommandContext {
  return {
    currentDirectory:        process.cwd(),
    now:                     () => new Date(),
    standardOutput:          (text: string) => console.log(text),
    standardError:           (text: string) => console.error(text),
    standardInputIsTerminal: process.stdin.isTTY === true,
    readStandardInput:       readEverythingOnStandardInput,
    confirm:                 confirmOnStandardInput,
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
