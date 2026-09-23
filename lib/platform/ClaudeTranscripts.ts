/**
 * Where the harness keeps one repository's transcripts, and which of them belong to subagents. It is
 * in `lib/platform/` because it is entirely a fact about this machine — a home directory and a naming
 * rule nobody here chose — and keeping it out of `cli/usage/UsageCommand.ts` is what lets the command
 * be driven against a scratch folder instead of against whatever the developer's own home happens to
 * hold.
 *
 * **The folder name is the repository root's absolute path with every character that is not a letter
 * or a digit replaced by `-`**, under `<home>/.claude/projects/`, and the separator is only the most
 * common of those characters. `/Users/alex/development/example` becomes
 * `-Users-alex-development-example`, leading separator and all; a dot goes the same way, so
 * `/Users/alex/.claude/ad-hoc-tooling` becomes `-Users-alex--claude-ad-hoc-tooling`, two dashes where
 * `/.` was; and a path with spaces in it, `…/BtC Ignite - Documents`, ends `…-BtC-Ignite---Documents`.
 * All three observed directly in that directory on 2026-09-19 — **replacing only `/` produced a folder
 * name no harness ever wrote**, and the command reported an empty cohort rather than a mistake.
 * A session run inside a worktree of the repository lands in the same folder, which is
 * why a tracker shared by several worktrees still reports one cohort rather than one per checkout.
 *
 * The home directory comes from `node:os`'s `homedir()` and never from `HOME`: `lib/platform/Environment.ts`
 * is the only module allowed to read `process.env`, and a guard spec fails the build on a read anywhere else.
 */
import type { Dirent }   from 'node:fs';
import { readdirSync }   from 'node:fs';
import { homedir }       from 'node:os';
import { join, resolve } from 'node:path';

const CLAUDE_DIRECTORY_NAME = '.claude';

const PROJECTS_DIRECTORY_NAME = 'projects';

const SUBAGENTS_DIRECTORY_NAME = 'subagents';

const WORKFLOWS_DIRECTORY_NAME = 'workflows';

const SUBAGENT_FILE_PREFIX = 'agent-';

const TRANSCRIPT_FILE_SUFFIX = '.jsonl';

/** Everything outside `[a-zA-Z0-9]`, because that is the whole of what the harness keeps in a folder name. */
const CHARACTER_THE_SLUG_REPLACES = /[^a-zA-Z0-9]/g;

/** The two identifiers are carried separately from the path because a report names the agent, and only a failure names the file. */
export interface SubagentTranscript {
  path:              string;
  sessionIdentifier: string;
  agentIdentifier:   string;
}

/** The home directory is a defaulted parameter rather than a read inside, so a spec can point the whole lookup at a scratch tree. */
export function transcriptFolderFor(repositoryRoot: string, homeDirectory: string = homedir()): string {
  const slug = resolve(repositoryRoot).replace(CHARACTER_THE_SLUG_REPLACES, '-');
  return join(homeDirectory, CLAUDE_DIRECTORY_NAME, PROJECTS_DIRECTORY_NAME, slug);
}

/** Fail closed: a directory that is missing, or that `readdir` refuses, reads as empty — the same answer as a repository nobody has run an agent in. */
function directoryEntriesOf(directory: string): Dirent<string>[] {
  try {
    return readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** A workflow run's journal and each agent's `.meta.json` sit beside its transcripts and fail the prefix or the suffix, so neither is read as one. */
function agentTranscriptsIn(directory: string, sessionIdentifier: string): SubagentTranscript[] {
  return directoryEntriesOf(directory)
    .filter((agentEntry) => agentEntry.isFile() && agentEntry.name.startsWith(SUBAGENT_FILE_PREFIX) && agentEntry.name.endsWith(TRANSCRIPT_FILE_SUFFIX))
    .map((agentEntry) => ({
      path:            join(directory, agentEntry.name),
      sessionIdentifier,
      agentIdentifier: agentEntry.name.slice(SUBAGENT_FILE_PREFIX.length, -TRANSCRIPT_FILE_SUFFIX.length),
    }));
}

/**
 * Every `agent-….jsonl` inside a session's `subagents/` folder, and inside each run folder of its
 * `subagents/workflows/`, where a workflow's agents are written; sorted by path so two runs of the
 * same command report the same order. The main session's own transcripts are deliberately left out:
 * a main session is the orchestrator, not a cost anyone delegated.
 *
 * An absent folder answers an empty list rather than throwing, because "no transcripts here" is a
 * normal answer the caller prints a sentence for.
 */
export function listSubagentTranscripts(transcriptFolder: string): SubagentTranscript[] {
  const transcripts: SubagentTranscript[] = [];

  for (const sessionEntry of directoryEntriesOf(transcriptFolder)) {
    if (!sessionEntry.isDirectory()) continue;

    const subagentsDirectory = join(transcriptFolder, sessionEntry.name, SUBAGENTS_DIRECTORY_NAME);
    transcripts.push(...agentTranscriptsIn(subagentsDirectory, sessionEntry.name));

    const workflowsDirectory = join(subagentsDirectory, WORKFLOWS_DIRECTORY_NAME);
    for (const runEntry of directoryEntriesOf(workflowsDirectory)) {
      if (!runEntry.isDirectory()) continue;
      transcripts.push(...agentTranscriptsIn(join(workflowsDirectory, runEntry.name), sessionEntry.name));
    }
  }

  transcripts.sort((a, b) => a.path.localeCompare(b.path));
  return transcripts;
}
