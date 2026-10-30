/** Where each file the tool installs into a tracked repository lives. */
import { join } from 'node:path';

import { CONSTITUTION_DEFAULT_PATH, defaultInstructionPathOf } from '../src/services/runner/InstructionFiles.ts';
import { TRACKER_FILES }                                       from '../src/services/tracker/constants/TrackerFiles.ts';

const INSTALL_MANIFEST_FILE_NAME = 'version.json';

const REFERENCE_FILE_NAME = 'reference.md';

const SESSION_INSTRUCTIONS_FILE_NAME = 'session-instructions.md';

export interface InstalledFilePaths {
  /** The file formats, the moves and the exit codes, which the skills cite for a session to read on demand. */
  reference:           string;
  /** The default instruction files a pipeline's `constitution` and `agents` arrays name, generated and refreshed each version. */
  constitutionDefault: string;
  builderDefault:      string;
  reviewerDefault:     string;
  mergerDefault:       string;
  productOwnerDefault: string;
  onboarderDefault:    string;
  assistantDefault:    string;
  /** What the SessionStart hook prints to each session User opens; its presence marks the files installed. */
  sessionInstructions: string;
  installManifest:     string;
}

/** Claude Code reads a project's skills from `.claude/skills/<name>/`, written with `/` as `.gitignore` takes it. */
export function installedSkillFolderInRepository(skillName: string): string {
  return `.claude/skills/${skillName}`;
}

export function installedFilePathsIn(rootDirectory: string): InstalledFilePaths {
  return {
    reference:           join(rootDirectory, TRACKER_FILES.TRACKER_DIRECTORY_NAME, REFERENCE_FILE_NAME),
    constitutionDefault: join(rootDirectory, CONSTITUTION_DEFAULT_PATH),
    builderDefault:      join(rootDirectory, defaultInstructionPathOf('builder')),
    reviewerDefault:     join(rootDirectory, defaultInstructionPathOf('reviewer')),
    mergerDefault:       join(rootDirectory, defaultInstructionPathOf('merger')),
    productOwnerDefault: join(rootDirectory, defaultInstructionPathOf('productOwner')),
    onboarderDefault:    join(rootDirectory, defaultInstructionPathOf('onboarder')),
    assistantDefault:    join(rootDirectory, defaultInstructionPathOf('assistant')),
    sessionInstructions: join(rootDirectory, TRACKER_FILES.TRACKER_DIRECTORY_NAME, SESSION_INSTRUCTIONS_FILE_NAME),
    installManifest:     join(rootDirectory, TRACKER_FILES.TRACKER_DIRECTORY_NAME, INSTALL_MANIFEST_FILE_NAME),
  };
}
