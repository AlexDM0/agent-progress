/** The reviewer's findings file, read and checked whole before the lock, so a file breaking any rule records nothing. */
import { readFileSync } from 'node:fs';
import { resolve }      from 'node:path';

import { ReviewRecordFieldsUtil }                         from '../../../src/adapters/log/utils/ReviewRecordFieldsUtil.ts';
import { StoredValueUtil }                                from '../../../src/adapters/utils/StoredValueUtil.ts';
import { JsonRecordUtil }                                 from '../../../src/lib/json-record/JsonRecordUtil.ts';
import type { ReviewClaim, ReviewFinding, ReviewVerdict } from '../../../src/lib/tracker-model/@types/ReviewRecord.ts';
import { OperationRefusal }                               from '../../../src/shared/OperationRefusal.ts';
import type { CommandContext }                            from '../../CommandContext.ts';

const STANDARD_INPUT_MARKER = '-';

export interface ReviewFindings {
  verdict:  ReviewVerdict;
  claims:   ReviewClaim[];
  findings: ReviewFinding[];
}

function refuseTheFile(findingsFile: string, problem: string): never {
  throw new OperationRefusal('refused', `--findings-file ${findingsFile} was refused, and nothing was recorded: ${problem}.`);
}

async function findingsTextOf(findingsFile: string, context: CommandContext): Promise<string> {
  if (findingsFile === STANDARD_INPUT_MARKER) return context.readStandardInput();
  try {
    return readFileSync(resolve(context.currentDirectory, findingsFile), 'utf8');
  } catch (problem) {
    throw new OperationRefusal('refused', `--findings-file ${findingsFile} could not be read: ${problem instanceof Error ? problem.message : String(problem)}`);
  }
}

export async function readFindingsFile(findingsFile: string, context: CommandContext): Promise<ReviewFindings> {
  const parsed = StoredValueUtil.parsedJsonOf(await findingsTextOf(findingsFile, context));
  if (parsed.verdict === 'unparseable') refuseTheFile(findingsFile, parsed.problem);
  const document = parsed.value;
  if (!JsonRecordUtil.valueIsAPlainObject(document)) refuseTheFile(findingsFile, 'it is not a JSON object');
  const problem = ReviewRecordFieldsUtil.verdictProblem(document['verdict'], 'verdict')
    ?? ReviewRecordFieldsUtil.claimsProblem(document['claims'], 'claims')
    ?? ReviewRecordFieldsUtil.findingsProblem(document['findings'], 'findings');
  if (problem !== null) refuseTheFile(findingsFile, problem);
  return {
    verdict:  document['verdict'] as ReviewVerdict,
    claims:   ReviewRecordFieldsUtil.claimsCopyOf(document['claims']),
    findings: ReviewRecordFieldsUtil.findingsCopyOf(document['findings']),
  };
}
