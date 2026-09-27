/** What `rework` prints for a person: one summary sentence, and with `--files` the files with code in them. */
import { CommitTextUtil }                from '../../utils/CommitTextUtil.ts';
import { ReworkCountUtil }               from '../utils/ReworkCountUtil.ts';
import type { FileRework, ReworkTotals } from '../utils/ReworkCountUtil.ts';
import type { CommitsPart, RebasePart }  from './ReworkReading.ts';

interface CountedScope {
  scope:  string;
  totals: ReworkTotals;
}

function commitsScope(part: CommitsPart): CountedScope {
  const commitWord = part.commitCount === 1 ? 'commit' : 'commits';
  return { scope: `in ${part.commitCount} ${commitWord} since ${CommitTextUtil.shortCommitOf(part.sinceCommit)}`, totals: ReworkCountUtil.totalReworkOf(part.files) };
}

function rebaseScope(part: RebasePart): CountedScope {
  return { scope: `in the rebase from ${CommitTextUtil.shortCommitOf(part.oldTipCommit)} onto ${part.mainLine}`, totals: ReworkCountUtil.totalReworkOf(part.files) };
}

function addedAndRemovedOf(totals: ReworkTotals): string {
  return `${totals.addedCodeLines} added, ${totals.removedCodeLines} removed`;
}

function linesOfCode(count: number): string {
  return `${count} ${count === 1 ? 'line' : 'lines'} of code`;
}

/** One scope reads as one sentence; two name each part's share of the total. */
export function summaryLine(totals: ReworkTotals, commitsPart: CommitsPart | undefined, rebasePart: RebasePart | undefined): string {
  const scopes = [
    ...(commitsPart === undefined ? [] : [commitsScope(commitsPart)]),
    ...(rebasePart === undefined ? [] : [rebaseScope(rebasePart)]),
  ];
  const [onlyScope] = scopes;
  if (scopes.length === 1 && onlyScope !== undefined) {
    return `Reworked ${linesOfCode(totals.reworkedCodeLines)} ${onlyScope.scope}: ${addedAndRemovedOf(totals)}.`;
  }
  const parts = scopes.map(({ scope, totals: partTotals }) => `${partTotals.reworkedCodeLines} ${scope} (${addedAndRemovedOf(partTotals)})`);
  return `Reworked ${linesOfCode(totals.reworkedCodeLines)}: ${parts.join(' and ')}.`;
}

/** Only the files with code in them are listed; what was left out is summed on the line after them. */
export function fileBreakdownLines(files: readonly FileRework[], totals: ReworkTotals): string[] {
  const filesWithCode = files.filter((file) => file.addedCodeLines + file.removedCodeLines > 0);
  const columnWidth   = Math.max(...filesWithCode.map((file) => Math.max(String(file.addedCodeLines).length, String(file.removedCodeLines).length)), 1) + 1;
  const lines         = filesWithCode.map((file) => `  ${`+${file.addedCodeLines}`.padStart(columnWidth)} ${`-${file.removedCodeLines}`.padStart(columnWidth)}  ${file.path}`);
  lines.push(`Not counted: ${totals.commentLines} comment, ${totals.blankLines} blank and ${totals.documentationLines} documentation lines.`);
  return lines;
}
