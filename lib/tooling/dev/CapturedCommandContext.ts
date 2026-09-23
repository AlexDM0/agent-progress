/**
 * A `CommandContext` whose two output streams are arrays, so a command spec can drive `runCommandLine` in-process and read back what a user would
 * have seen. The interface is declared here structurally rather than imported from `cli/CommandContext.ts`, because nothing under `lib/` may import
 * `cli/`; TypeScript still checks the two against each other at every call site that passes one of these to a command.
 */
import { requireTrackerIsolation } from './TrackerIsolation';

export interface CapturedCommandContext {
  currentDirectory:        string;
  now:                     () => Date;
  standardOutput:          (text: string) => void;
  standardError:           (text: string) => void;
  standardInputIsTerminal: boolean;
  readStandardInput:       () => Promise<string>;
  confirm:                 (question: string) => Promise<boolean>;
  outputText:              () => string;
  errorText:               () => string;
  questionsAsked:          () => string[];
}

export interface CapturedCommandContextOptions {
  /** Required, and checked to be a scratch directory: a default of the test runner's own directory hands a command the repository's real tracker. */
  currentDirectory:         string;
  now?:                     () => Date;
  standardInputIsTerminal?: boolean;
  /** What a spec pipes in: a spec that names none gets the empty string, which is the "nothing was piped" case every reader handles anyway. */
  standardInputText?:       string;
  confirmAnswer?:           boolean;
}

const DEFAULT_SPEC_CLOCK_READING = '2026-09-18T20:11:03Z';

/** The `cwd` a piped hook input names, since `agent-progress hook subagent-stop` resolves its tracker from that rather than from the context. */
function directoryNamedByPipedHookInput(standardInputText: string | undefined): string | null {
  if (standardInputText === undefined) return null;
  try {
    const parsedInput: unknown = JSON.parse(standardInputText);
    if (typeof parsedInput !== 'object' || parsedInput === null || !Object.hasOwn(parsedInput, 'cwd')) return null;
    const { cwd: namedDirectory } = parsedInput as { cwd: unknown };
    return typeof namedDirectory === 'string' ? namedDirectory : null;
  } catch {
    return null;
  }
}

/** `confirm` answers `false` unless the options say otherwise, so a spec that forgot the option cannot run a destructive path while still passing. */
export function createCapturedCommandContext(options: CapturedCommandContextOptions): CapturedCommandContext {
  requireTrackerIsolation(options.currentDirectory);
  const hookInputDirectory = directoryNamedByPipedHookInput(options.standardInputText);
  if (hookInputDirectory !== null) requireTrackerIsolation(hookInputDirectory);

  const outputLines: string[] = [];
  const errorLines:  string[] = [];
  const questions:   string[] = [];

  return {
    currentDirectory:        options.currentDirectory,
    now:                     options.now ?? (() => new Date(DEFAULT_SPEC_CLOCK_READING)),
    standardOutput:          (text: string) => { outputLines.push(text); },
    standardError:           (text: string) => { errorLines.push(text); },
    standardInputIsTerminal: options.standardInputIsTerminal ?? false,
    readStandardInput:       () => Promise.resolve(options.standardInputText ?? ''),
    confirm:                 (question: string) => {
      questions.push(question);
      return Promise.resolve(options.confirmAnswer ?? false);
    },
    outputText:     () => outputLines.join('\n'),
    errorText:      () => errorLines.join('\n'),
    questionsAsked: () => [...questions],
  };
}
