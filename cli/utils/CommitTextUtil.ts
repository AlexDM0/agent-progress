import { SHORT_COMMIT_LENGTH_CHARACTERS } from '../constants/GitDefaults.ts';

function shortCommitOf(commit: string): string {
  return commit.slice(0, SHORT_COMMIT_LENGTH_CHARACTERS);
}

export const CommitTextUtil = { shortCommitOf } as const;
