/** What `release` was asked to do, read from its arguments and refused before anything is touched when it cannot be meant. */
import { resolve } from 'node:path';

import type { CommandContext } from '../../CommandContext.ts';
import type { ArgumentParser } from '../../arguments/ArgumentParser.ts';
import { DEFAULT_MAIN_LINE }   from '../../constants/GitDefaults.ts';
import { refuseTheRelease }    from './ReleaseRefusal.ts';

const USAGE = 'agent-progress release <id> [<id>...] --branch <branch> [--worktree <path>] [--main <line>] [--json]';

const KNOWN_OPTION_NAMES = ['branch', 'worktree', 'main', 'json'];

const OPTION_PREFIX = '-';

export interface ReleaseRequest {
  references:    string[];
  branch:        string;
  mainLine:      string;
  worktreePath?: string;
}

export function releaseRequestFrom(commandArguments: ArgumentParser, context: CommandContext): ReleaseRequest {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);

  // Several ids are the tickets of one bundle, which share the branch: they are released by the one fast-forward.
  const references = [...new Set(commandArguments.positionals())];
  const branch     = commandArguments.option('branch');
  if (references.length === 0 || branch === undefined || branch.trim() === '') {
    refuseTheRelease('invalid-request', `agent-progress release needs a ticket id and --branch: ${USAGE}.`);
  }
  const mainLine = commandArguments.option('main') ?? DEFAULT_MAIN_LINE;
  // A name git would read as an option is refused here, since `git branch -d` is handed it verbatim.
  if (branch.startsWith(OPTION_PREFIX) || mainLine.startsWith(OPTION_PREFIX)) {
    refuseTheRelease('invalid-request', `A branch name cannot begin with "${OPTION_PREFIX}".`);
  }
  if (branch === mainLine) {
    refuseTheRelease('invalid-request', `--branch names the main line ${mainLine} itself; name the reviewed branch to release into it.`);
  }
  const worktreeOption = commandArguments.option('worktree');
  return {
    references,
    branch,
    mainLine,
    ...(worktreeOption === undefined ? {} : { worktreePath: resolve(context.currentDirectory, worktreeOption) }),
  };
}
