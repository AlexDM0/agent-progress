/**
 * A `CommandContext` whose two output streams are arrays, so a command spec can drive `runCommandLine` in-process and read back what a user would
 * have seen. The interface is declared here structurally rather than imported from `cli/CommandContext.ts`, because nothing under `lib/` may import
 * `cli/`; TypeScript still checks the two against each other at every call site that passes one of these to a command.
 */

export interface CapturedCommandContext {
  currentDirectory:        string;
  now:                     () => Date;
  standardOutput:          (text: string) => void;
  standardError:           (text: string) => void;
  standardInputIsTerminal: boolean;
  confirm:                 (question: string) => Promise<boolean>;
  outputText:              () => string;
  errorText:               () => string;
  questionsAsked:          () => string[];
}

export interface CapturedCommandContextOptions {
  currentDirectory?:        string;
  now?:                     () => Date;
  standardInputIsTerminal?: boolean;
  confirmAnswer?:           boolean;
}

const DEFAULT_SPEC_CLOCK_READING = '2026-09-18T20:11:03Z';

/** `confirm` answers `false` unless the options say otherwise, so a spec that forgot the option cannot run a destructive path while still passing. */
export function createCapturedCommandContext(options: CapturedCommandContextOptions = {}): CapturedCommandContext {
  const outputLines: string[] = [];
  const errorLines:  string[] = [];
  const questions:   string[] = [];

  return {
    currentDirectory:        options.currentDirectory ?? process.cwd(),
    now:                     options.now ?? (() => new Date(DEFAULT_SPEC_CLOCK_READING)),
    standardOutput:          (text: string) => { outputLines.push(text); },
    standardError:           (text: string) => { errorLines.push(text); },
    standardInputIsTerminal: options.standardInputIsTerminal ?? false,
    confirm:                 (question: string) => {
      questions.push(question);
      return Promise.resolve(options.confirmAnswer ?? false);
    },
    outputText:     () => outputLines.join('\n'),
    errorText:      () => errorLines.join('\n'),
    questionsAsked: () => [...questions],
  };
}
