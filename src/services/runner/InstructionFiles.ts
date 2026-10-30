/**
 * The instruction files the pipeline names for a role: the constitution first for the roles that touch code, then the role's own array, each
 * defaulting to its generated file in the data folder. A data-folder file is read from disk; any other is tracked, so it is read from the
 * main line, never from a ticket's branch.
 */
import { createHash }   from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { GitProcess }                       from '../../lib/git/GitProcess.ts';
import type { Job }                         from '../../lib/tracker-model/@types/Job.ts';
import type { Pipeline, PipelineAgentRole } from '../../lib/tracker-model/@types/Pipeline.ts';
import { PRODUCT_NAMES }                    from '../../shared/constants/ProductNames.ts';
import { AssistantBoot }                    from './AssistantBoot.ts';

export const INSTRUCTION_DEFAULTS_FOLDER = `${PRODUCT_NAMES.DATA_FOLDER}/briefs/defaults`;

export const CONSTITUTION_DEFAULT_PATH = `${INSTRUCTION_DEFAULTS_FOLDER}/constitution.md`;

const CONTENT_HASH_LENGTH = 16;

const ROLES_GIVEN_THE_CONSTITUTION: readonly PipelineAgentRole[] = ['builder', 'reviewer', 'merger'];

export interface InstructionFileRead {
  path:        string;
  contentHash: string;
}

export type InstructionReading =
  | { verdict: 'read'; text: string; files: readonly InstructionFileRead[] }
  | { verdict: 'instructions-missing'; path: string };

export function defaultInstructionPathOf(role: PipelineAgentRole): string {
  return `${INSTRUCTION_DEFAULTS_FOLDER}/${role}.md`;
}

/** The pipeline role whose files a job reads; `null` for a job no array speaks for. */
function instructionRoleOf(job: Readonly<Job>): PipelineAgentRole | null {
  if (AssistantBoot.isAssistantJob(job)) return 'assistant';
  if (job.kind === 'build') return 'builder';
  if (job.kind === 'review') return 'reviewer';
  if (job.role === 'merge-fix' || job.role === 'resolver' || job.role === 'resolution-review') return 'merger';
  if (job.role === 'product-owner') return 'productOwner';
  if (job.role === 'onboarder') return 'onboarder';
  return null;
}

function instructionPathsOf(pipeline: Readonly<Pipeline> | null, role: PipelineAgentRole): string[] {
  const constitution = ROLES_GIVEN_THE_CONSTITUTION.includes(role) ? pipeline?.constitution ?? [CONSTITUTION_DEFAULT_PATH] : [];
  return [...constitution, ...pipeline?.agents?.[role] ?? [defaultInstructionPathOf(role)]];
}

function isDataFolderPath(path: string): boolean {
  return path.startsWith(`${PRODUCT_NAMES.DATA_FOLDER}/`);
}

/** Every tracked file any array names, which a branch may change only where its ticket names it. */
function trackedInstructionPathsOf(pipeline: Readonly<Pipeline> | null): string[] {
  const named = [...pipeline?.constitution ?? [], ...Object.values(pipeline?.agents ?? {}).flat()];
  return [...new Set(named.filter((path) => !isDataFolderPath(path)))];
}

/** A path leaving the repository is read as missing, never followed. */
function fileTextOf(rootDirectory: string, mainLine: string, path: string): string | null {
  if (path.startsWith('/') || path.split('/').includes('..')) return null;
  if (isDataFolderPath(path)) {
    try {
      return readFileSync(join(rootDirectory, path), 'utf8');
    } catch {
      return null;
    }
  }
  const shown = GitProcess.run(rootDirectory, ['show', `${mainLine}:${path}`]);
  return GitProcess.succeeded(shown) ? shown.standardOutput : null;
}

function contentHashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, CONTENT_HASH_LENGTH);
}

/** Read whole at each launch, so a changed file, default or pipeline reaches the next launch or resume; one missing file refuses them all. */
function readingFor(rootDirectory: string, mainLine: string, pipeline: Readonly<Pipeline> | null, job: Readonly<Job>): InstructionReading {
  const role = instructionRoleOf(job);
  if (role === null) return { verdict: 'read', text: '', files: [] };
  const texts: string[] = [];
  const files: InstructionFileRead[] = [];
  for (const path of instructionPathsOf(pipeline, role)) {
    const text = fileTextOf(rootDirectory, mainLine, path);
    if (text === null) return { verdict: 'instructions-missing', path };
    texts.push(text.endsWith('\n') ? text : `${text}\n`);
    files.push({ path, contentHash: contentHashOf(text) });
  }
  return { verdict: 'read', text: texts.join('\n'), files };
}

export const InstructionFiles = Object.freeze({ readingFor, trackedInstructionPathsOf, instructionRoleOf });
