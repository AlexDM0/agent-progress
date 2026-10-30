/**
 * What `init` and `update` install for Claude Code: the parts, in report order, each with the files it writes or removes, the flag that
 * opts out of it and its report label. What install version 16 wrote and 17 removes is in `cli/adoption/constants/RetiredClaudeInstall.ts`.
 */
import type { CommandHook }                 from '../../../src/lib/claude-code/ClaudeSettings.ts';
import { PRODUCT_NAMES, type ProductNames } from '../../../src/shared/constants/ProductNames.ts';
import type { InstalledFilePaths }          from '../../InstalledFiles.ts';

export const INSTALL_OPT_OUT_FLAGS = ['no-hooks'] as const;

export type InstallOptOutFlag = typeof INSTALL_OPT_OUT_FLAGS[number];

export type InstalledFileName = Exclude<keyof InstalledFilePaths, 'installManifest'>;

export interface InstalledFile {
  name:             InstalledFileName;
  templateFileName: string;
}

/** A folder of this checkout's `skills/`, copied into the repository's `.claude/skills/` under the name the product gives that skill. */
export type SkillSourceFolderName = 'agent-po' | 'agent-progress-orchestrate';

/** A skill folder an earlier install version wrote under `.claude/skills/`, with the file names it installed there. */
export interface RetiredSkillFolder {
  skillName:          string;
  installedFileNames: readonly string[];
}

/** Each skill source folder's installed name, which its `SKILL.md` frontmatter is filled with too, so Claude Code knows it by its folder. */
export function installedSkillNamesFor(productNames: Pick<ProductNames, 'PRODUCT_OWNER_SKILL' | 'ORCHESTRATE_SKILL'>): Readonly<Record<SkillSourceFolderName, string>> {
  return {
    'agent-po':                   productNames.PRODUCT_OWNER_SKILL,
    'agent-progress-orchestrate': productNames.ORCHESTRATE_SKILL,
  };
}

export const INSTALLED_SKILL_NAMES = installedSkillNamesFor(PRODUCT_NAMES);

/** The retired skill was named after the program, so a build named beside it never removes the released program's folder. */
const RETIRED_SKILL_FOLDERS: readonly RetiredSkillFolder[] = [{ skillName: PRODUCT_NAMES.PROGRAM, installedFileNames: ['SKILL.md', 'Reference.md'] }];

/**
 * `briefs` replaces each file whole and asks the reader to re-read the last one, whose presence marks the files installed;
 * `claude-settings-hooks` writes no file text, only Claude Code settings entries, and takes out the retired ones; `skill-folders` rewrites
 * every file of each skill folder, leaves any other file in it alone, git-ignores the folder, and removes each retired folder's installed
 * files and its `.gitignore` entry; `ignored-folders` git-ignores folders the product makes later; `retired-managed-block` removes, once,
 * the managed CLAUDE.md block, and `retired-install` the hooks (unless `--no-hooks`) and files `cli/adoption/constants/RetiredClaudeInstall.ts`
 * names: what install version 16 wrote that 17 does not.
 */
export type InstalledPart =
  | { writing: 'briefs'; reportLabel: string; optOutFlag: null; files: readonly InstalledFile[] }
  | { writing: 'claude-settings-hooks'; reportLabel: string; optOutFlag: InstallOptOutFlag | null; hooks: readonly CommandHook[] }
  | {
    writing:             'skill-folders';
    reportLabel:         string;
    optOutFlag:          null;
    installedSkillNames: Readonly<Record<SkillSourceFolderName, string>>;
    retiredSkillFolders: readonly RetiredSkillFolder[];
  }
  | { writing: 'ignored-folders'; reportLabel: string; optOutFlag: null; folderNames: readonly string[] }
  | { writing: 'retired-managed-block'; reportLabel: string; optOutFlag: null }
  | { writing: 'retired-install'; reportLabel: string; optOutFlag: null };

/** Prints `session-instructions.md` to every session User opens, which is how a session learns how this repository tracks its work. */
const SESSION_START_HOOK: CommandHook = {
  event:          'SessionStart',
  matcher:        '',
  command:        `${PRODUCT_NAMES.PROGRAM} hook session-start`,
  timeoutSeconds: 10,
};

export const CLAUDE_CODE_INSTALL: { parts: readonly InstalledPart[] } = {
  parts: [
    { writing: 'retired-managed-block', reportLabel: 'CLAUDE.md', optOutFlag: null },
    { writing: 'retired-install', reportLabel: 'retired', optOutFlag: null },
    {
      writing:     'briefs',
      reportLabel: 'brief',
      optOutFlag:  null,
      files:       [
        { name: 'reference', templateFileName: 'Reference.md' },
        { name: 'assistantBrief', templateFileName: 'AssistantBrief.md' },
        { name: 'sessionInstructions', templateFileName: 'SessionInstructions.md' },
      ],
    },
    {
      writing:     'claude-settings-hooks',
      reportLabel: 'hooks',
      optOutFlag:  'no-hooks',
      hooks:       [SESSION_START_HOOK],
    },
    {
      writing:             'skill-folders',
      reportLabel:         'skills',
      optOutFlag:          null,
      installedSkillNames: INSTALLED_SKILL_NAMES,
      retiredSkillFolders: RETIRED_SKILL_FOLDERS,
    },
    {
      writing: 'ignored-folders', reportLabel: 'worktrees', optOutFlag: null, folderNames: [PRODUCT_NAMES.WORKTREES_FOLDER]
    },
  ],
};
