/**
 * The text of every file `init` and `update` install, computed before any of them is written, so a failure here leaves the repository
 * as it was. The markdown is read from `resources/templates/` and the skills from `skills/`, each filled with the product's names.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep }       from 'node:path';

import { filledTemplateOf, productNameTemplateValuesOf } from '../../src/shared/FilledTemplate.ts';
import { OperationRefusal }                              from '../../src/shared/OperationRefusal.ts';
import { resourceFilePathOf }                            from '../../src/shared/ResourceFilePath.ts';
import { PRODUCT_NAMES }                                 from '../../src/shared/constants/ProductNames.ts';
import {
  CLAUDE_CODE_INSTALL,
  type InstalledFile,
  type InstalledFileName,
  type SkillSourceFolderName
} from './constants/ClaudeCodeInstall.ts';

/** Each installed file's text; a placeholder the product's names do not fill, such as the Assistant brief's job id, is left for its reader. */
export type InstalledFileTexts = Readonly<Partial<Record<InstalledFileName, string>>>;

function templateTextOf(file: InstalledFile): string {
  return readFileSync(resourceFilePathOf(file.resourceFolder ?? 'templates', file.templateFileName), 'utf8');
}

/** Each installed skill's files under its installed name, keyed by their path inside the skill folder written with `/`, in path order. */
export type InstalledSkillFileTexts = Readonly<Partial<Record<string, ReadonlyMap<string, string>>>>;

/** Resolves from the installed package like `resources/`, because the `bun link`ed binary runs from any repository. */
export function skillSourceDirectoryOf(sourceFolderName: SkillSourceFolderName): string {
  return join(import.meta.dir, '..', '..', 'skills', sourceFolderName);
}

/**
 * A skill folder that cannot be read or holds no file is a defect of this checkout, not of the repository being written to. Each file is
 * filled with the skill's installed name, which its `SKILL.md` frontmatter names it by.
 */
function skillFileTextsOf(sourceDirectory: string, installedName: string): ReadonlyMap<string, string> {
  const unreadable = () => new OperationRefusal('unrepaired', `The skill folder ${sourceDirectory} could not be read, so nothing was written.`);
  try {
    const filePaths = readdirSync(sourceDirectory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name))
      .sort();
    if (filePaths.length === 0) throw unreadable();
    return new Map(filePaths.map((filePath) => [
      relative(sourceDirectory, filePath).split(sep).join('/'),
      filledTemplateOf(readFileSync(filePath, 'utf8'), { ...productNameTemplateValuesOf(PRODUCT_NAMES), skillName: installedName }),
    ]));
  } catch (error) {
    if (error instanceof OperationRefusal) throw error;
    throw unreadable();
  }
}

export function installedSkillFileTexts(): InstalledSkillFileTexts {
  const texts: Partial<Record<string, ReadonlyMap<string, string>>> = {};
  for (const part of CLAUDE_CODE_INSTALL.parts) {
    if (part.writing !== 'skill-folders') continue;
    for (const [sourceFolderName, installedName] of Object.entries(part.installedSkillNames) as [SkillSourceFolderName, string][]) {
      texts[installedName] = skillFileTextsOf(skillSourceDirectoryOf(sourceFolderName), installedName);
    }
  }
  return texts;
}

export function installedFileTextsFor(): InstalledFileTexts {
  const templateValues = productNameTemplateValuesOf(PRODUCT_NAMES);
  const texts: Partial<Record<InstalledFileName, string>> = {};
  for (const part of CLAUDE_CODE_INSTALL.parts) {
    if (part.writing !== 'briefs') continue;
    for (const file of part.files) texts[file.name] = filledTemplateOf(templateTextOf(file), templateValues);
  }
  return texts;
}
