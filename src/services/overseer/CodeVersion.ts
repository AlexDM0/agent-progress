/**
 * The version of the program's code as it stands on disk: a content hash over its shipping files, so a landing, a pull or an edit in
 * the checkout the binary links to reads as new code, while a spec, a timestamp or a checkout's path never does.
 */
import { createHash }                          from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative }                      from 'node:path';

const PROGRAM_ROOT = join(import.meta.dir, '..', '..', '..');

const SHIPPING_FILES   = ['agent-progress.ts', 'watcher.ts', 'package.json', 'bun.lock'];
const SHIPPING_FOLDERS = ['cli', 'src', 'bridge', 'resources', 'skills'];

const SKIPPED_FOLDER_NAMES = new Set(['node_modules', 'testing']);
const SPEC_SUFFIX          = '.spec.ts';

const CODE_VERSION_LENGTH = 12;

function filesUnder(folderPath: string): string[] {
  let entryNames: string[];
  try {
    entryNames = readdirSync(folderPath);
  } catch {
    return [];
  }
  return entryNames.flatMap((entryName) => {
    const entryPath = join(folderPath, entryName);
    const entry     = statSync(entryPath, { throwIfNoEntry: false });
    if (entry === undefined) return [];
    if (entry.isDirectory()) return SKIPPED_FOLDER_NAMES.has(entryName) ? [] : filesUnder(entryPath);
    return entryName.endsWith(SPEC_SUFFIX) ? [] : [entryPath];
  });
}

function codeVersionOf(programRoot: string): string {
  const filePaths = [
    ...SHIPPING_FILES.map((fileName) => join(programRoot, fileName)),
    ...SHIPPING_FOLDERS.flatMap((folderName) => filesUnder(join(programRoot, folderName))),
  ].sort();
  const digest = createHash('sha256');
  for (const filePath of filePaths) {
    let contents: Buffer;
    try {
      contents = readFileSync(filePath);
    } catch {
      continue;
    }
    digest.update(relative(programRoot, filePath)).update('\0').update(contents).update('\0');
  }
  return digest.digest('hex').slice(0, CODE_VERSION_LENGTH);
}

/** The code on disk of the program this module belongs to. */
function onDisk(): string {
  return codeVersionOf(PROGRAM_ROOT);
}

export const CodeVersion = Object.freeze({ onDisk, codeVersionOf });
