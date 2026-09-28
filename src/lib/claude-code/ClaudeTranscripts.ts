/**
 * Where Claude Code keeps one repository's transcripts, and which of them belong to subagents. As the claude-code building block's
 * main module it also stands for its siblings, which merge the `SubagentStop` hook into the settings, write a marker-delimited block in a `CLAUDE.md`
 * and build Workflow scripts with Bun's bundler. The package depends on `src/lib/atomic-file`, `src/lib/json-record` and `src/lib/local-time`.
 */
import type { Dirent }               from 'node:fs';
import { readdirSync, readFileSync } from 'node:fs';
import {
  basename,
  dirname,
  join,
  resolve
} from 'node:path';

import { JsonRecordUtil }        from '../json-record/JsonRecordUtil.ts';
import { CLAUDE_DIRECTORY_NAME } from './constants/ClaudeCodePaths.ts';

const PROJECTS_DIRECTORY_NAME = 'projects';

const SUBAGENTS_DIRECTORY_NAME = 'subagents';

const WORKFLOWS_DIRECTORY_NAME = 'workflows';

const SUBAGENT_FILE_PREFIX = 'agent-';

const TRANSCRIPT_FILE_SUFFIX = '.jsonl';

const AGENT_METADATA_FILE_SUFFIX = '.meta.json';

/** Everything outside `[a-zA-Z0-9]`, because that is the whole of what the harness keeps in a folder name. */
const CHARACTER_THE_SLUG_REPLACES = /[^a-zA-Z0-9]/g;

/** The two identifiers are carried separately from the path because a report names the agent, and only a failure names the file. */
export interface SubagentTranscript {
  path:              string;
  sessionIdentifier: string;
  agentIdentifier:   string;
}

/**
 * `<home>/.claude/projects/` plus the repository root's absolute path with every character outside `[a-zA-Z0-9]` replaced by `-`, so every
 * worktree resolves to one folder. The caller supplies the home, since the package reads nothing from the process.
 */
export function transcriptFolderFor(repositoryRoot: string, homeDirectory: string): string {
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

/** Subagent transcripts only, including workflow runs, sorted by path; an absent folder is an empty list. */
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

/** The run folder of a transcript at `…/workflows/<runId>/agent-<id>.jsonl`; `undefined` for any other path, a plain subagent's among them. */
export function workflowRunIdentifierOf(transcriptPath: string): string | undefined {
  const runDirectory = dirname(transcriptPath);
  if (basename(dirname(runDirectory)) !== WORKFLOWS_DIRECTORY_NAME) return undefined;
  const runIdentifier = basename(runDirectory);
  return runIdentifier.length > 0 ? runIdentifier : undefined;
}

/** The `description` in the `.meta.json` the harness writes beside a transcript; `undefined` when the file, its JSON or the field is missing. */
export function agentDescriptionBeside(transcriptPath: string): string | undefined {
  if (!transcriptPath.endsWith(TRANSCRIPT_FILE_SUFFIX)) return undefined;
  const metadataText = transcriptTextAt(`${transcriptPath.slice(0, -TRANSCRIPT_FILE_SUFFIX.length)}${AGENT_METADATA_FILE_SUFFIX}`);
  if (metadataText === undefined) return undefined;
  let parsedMetadata: unknown;
  try {
    parsedMetadata = JSON.parse(metadataText);
  } catch {
    return undefined;
  }
  const description = JsonRecordUtil.recordOf(parsedMetadata)?.['description'];
  return typeof description === 'string' && description.length > 0 ? description : undefined;
}

export function transcriptTextAt(transcriptPath: string): string | undefined {
  try {
    return readFileSync(transcriptPath, 'utf8');
  } catch {
    // A transcript that vanished or will not open reads as none: the folder is the harness's and may be pruned while it is read.
    return undefined;
  }
}
