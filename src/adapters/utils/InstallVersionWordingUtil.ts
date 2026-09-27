/** Words the install-version mismatch as one paragraph, so the SubagentStop hook's one-report rule holds when it carries this refusal. */
import type { OperationRefusalDetail } from '../../shared/OperationRefusal.ts';

type InstallVersionMismatchDetail = Extract<OperationRefusalDetail, { kind: 'install-version-mismatch' }>;

function messageOf(detail: InstallVersionMismatchDetail): string {
  const {
    rootDirectory,
    manifestFilePath,
    installVersion,
    mismatch,
  } = detail;
  const runUpdateSentence = `Run \`agent-progress update\` in ${rootDirectory}.`;
  switch (mismatch.reason) {
    case 'older':
      return `The files agent-progress installed in ${rootDirectory} are install version ${mismatch.installedVersion}, from an older agent-progress, `
        + `and this one needs install version ${installVersion}, so nothing was done. ${runUpdateSentence}`;
    case 'newer':
      return `The files agent-progress installed in ${rootDirectory} are install version ${mismatch.installedVersion}, from a newer agent-progress `
        + `than this one (install version ${installVersion}), so nothing was done. Update agent-progress itself, then run \`agent-progress update\` in ${rootDirectory}.`;
    case 'unversioned':
      return `The files agent-progress installed in ${rootDirectory} carry no install version (${manifestFilePath} is missing), so they are from `
        + `an agent-progress older than this one, which needs install version ${installVersion}; nothing was done. ${runUpdateSentence}`;
    case 'unreadable':
      return `${manifestFilePath} gives no install version: ${mismatch.manifestProblem}. So the install version of the files agent-progress installed in `
        + `${rootDirectory} is unknown and nothing was done. ${runUpdateSentence}`;
    case 'manifest-is-a-directory':
      return `${manifestFilePath} is a directory where agent-progress keeps its install version file, so nothing was done. `
        + `Remove that directory, then run \`agent-progress update\` in ${rootDirectory}.`;
  }
}

export const InstallVersionWordingUtil = { messageOf } as const;
