/** Words an `OperationRefusal` wherever the command line prints one: its own message, or its detail, worded here or by the util that words that kind. */
import type { OperationRefusal }     from '../../shared/OperationRefusal.ts';
import { BoardRefusalWordingUtil }   from './BoardRefusalWordingUtil.ts';
import { InstallVersionWordingUtil } from './InstallVersionWordingUtil.ts';
import { TrackerReadingWordingUtil } from './TrackerReadingWordingUtil.ts';

function noTrackerAtOverrideText(overrideDirectory: string): string {
  return `No agent-progress tracker was found in ${overrideDirectory}, which AGENT_PROGRESS_ROOT names. `
    + 'Run `agent-progress init` there, or unset AGENT_PROGRESS_ROOT to search upwards from the current directory instead.';
}

function noTrackerFoundText(searchedFrom: string): string {
  return `No agent-progress tracker was found in ${searchedFrom} or any directory above it. Run \`agent-progress init\` in the repository you want tracked.`;
}

function trackerLockHeldText(lockDirectoryPath: string): string {
  return `Another agent-progress command is holding ${lockDirectoryPath} and did not release it. If nothing else is running, remove that path and try again.`;
}

function templateTokenNotUniqueText(templateFilePath: string, token: string, occurrenceCount: number): string {
  return `the page template ${templateFilePath} holds ${occurrenceCount} occurrences of ${token}, not exactly one`;
}

function messageOf(refusal: OperationRefusal): string {
  const { detail } = refusal;
  if (detail === null) return refusal.message;
  switch (detail.kind) {
    case 'board-refusal':
      return BoardRefusalWordingUtil.messageOf(detail.boardRefusal);
    case 'unreadable-tracker':
      return TrackerReadingWordingUtil.refusalMessageOf(detail.reading);
    case 'no-tracker-at-override':
      return noTrackerAtOverrideText(detail.overrideDirectory);
    case 'no-tracker-found':
      return noTrackerFoundText(detail.searchedFrom);
    case 'tracker-lock-held':
      return trackerLockHeldText(detail.lockDirectoryPath);
    case 'template-token-not-unique':
      return templateTokenNotUniqueText(detail.templateFilePath, detail.token, detail.occurrenceCount);
    case 'install-version-mismatch':
      return InstallVersionWordingUtil.messageOf(detail);
  }
}

export const OperationRefusalWordingUtil = { messageOf } as const;
