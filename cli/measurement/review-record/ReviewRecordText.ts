/** What `review record` prints for a person: the pass it recorded and the total the reviewer reports as `reworkedLines`. */

interface RecordedReviewPass {
  ticketId:                string;
  taskId:                  number;
  round:                   number;
  verdict:                 string;
  reworkedLines:           number;
  fixReworkedCodeLines:    number;
  rebaseReworkedCodeLines: number;
  findingCount:            number;
}

export function recordedLine(pass: RecordedReviewPass): string {
  const findingWord = pass.findingCount === 1 ? 'finding' : 'findings';
  return `Recorded review ${pass.round} of #${pass.ticketId} on row #${pass.taskId}: ${pass.verdict}, ${pass.findingCount} ${findingWord}. `
    + `reworkedLines: ${pass.reworkedLines} (${pass.fixReworkedCodeLines} in the fixes, ${pass.rebaseReworkedCodeLines} in the rebases).`;
}
