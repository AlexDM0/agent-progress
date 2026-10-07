/** Whether a parsed progress-spec.json is a document this build wrote, and if not, the reason naming the offending field by its path. */
import { JsonRecordUtil }                               from '../../../lib/json-record/JsonRecordUtil.ts';
import type { SpecArtefactKind }                        from '../../../lib/spec-snapshot/@types/SpecSnapshot.ts';
import type { SourcePhaseKind }                         from '../../../lib/spec-snapshot/@types/SpecSnapshotSource.ts';
import { SPEC_LANES, WORK_ITEM_STATES, type SpecStage } from '../../../lib/spec-snapshot/constants/SpecLanes.ts';
import { StoredValueUtil }                              from '../../utils/StoredValueUtil.ts';
import type { StoredSpecSnapshotFile }                  from '../@types/StoredSpecSnapshotFile.ts';
import { CURRENT_SPEC_SNAPSHOT_FILE_VERSION }           from '../constants/SpecSnapshotFile.ts';

/** `null` when the value at `path` has its stored shape; otherwise the problem, naming the path. */
type ShapeCheck = (value: unknown, path: string) => string | null;

// Keyed records, so the compiler holds each list complete against its type.
const SPEC_STAGES = Object.keys({ specify: true, plan: true, implement: true } satisfies Record<SpecStage, true>);
const SPEC_ARTEFACT_KINDS = Object.keys({
  spec:         true,
  plan:         true,
  research:     true,
  'data-model': true,
  quickstart:   true,
  contracts:    true,
  tasks:        true,
  checklist:    true,
} satisfies Record<SpecArtefactKind, true>);
const PHASE_KINDS = Object.keys({
  setup:        true,
  foundational: true,
  'user-story': true,
  polish:       true,
  convergence:  true,
  other:        true,
} satisfies Record<SourcePhaseKind, true>);
const ARTEFACT_STATES = ['template', 'filled'];

const text: ShapeCheck = (value, path) => typeof value === 'string' ? null : `${path} is not a string`;

const truthValue: ShapeCheck = (value, path) => typeof value === 'boolean' ? null : `${path} is not true or false`;

const wholeNumber: ShapeCheck = (value, path) => StoredValueUtil.valueIsAWholeNumber(value) ? null : `${path} is not a whole number`;

function nullable(check: ShapeCheck): ShapeCheck {
  return (value, path) => value === null ? null : check(value, path);
}

function oneOf(values: readonly string[]): ShapeCheck {
  return (value, path) => typeof value === 'string' && values.includes(value) ? null : `${path} is ${JSON.stringify(value)}, which is not one of ${values.join(', ')}`;
}

function listOf(check: ShapeCheck): ShapeCheck {
  return (value, path) => {
    if (!Array.isArray(value)) return `${path} is not an array`;
    for (const [index, item] of value.entries()) {
      const problem = check(item, `${path}[${index}]`);
      if (problem !== null) return problem;
    }
    return null;
  };
}

function fieldPathOf(path: string, field: string): string {
  return path === '' ? field : `${path}.${field}`;
}

function objectOf(fields: Readonly<Record<string, ShapeCheck>>): ShapeCheck {
  return (value, path) => {
    if (!JsonRecordUtil.valueIsAPlainObject(value)) return path === '' ? 'the document is not a JSON object' : `${path} is not an object`;
    for (const [field, check] of Object.entries(fields)) {
      const problem = check(value[field], fieldPathOf(path, field));
      if (problem !== null) return problem;
    }
    return null;
  };
}

function everyKeyOf(keys: readonly string[], check: ShapeCheck): ShapeCheck {
  return objectOf(Object.fromEntries(keys.map((key) => [key, check])));
}

const currentVersion: ShapeCheck = (value, path) => value === CURRENT_SPEC_SNAPSHOT_FILE_VERSION
  ? null
  : `${path} is ${JSON.stringify(value)}, and this build of agent-progress reads version ${CURRENT_SPEC_SNAPSHOT_FILE_VERSION}`;

const snapshotDate = nullable(objectOf({ at: text, source: text }));

const tickCount = objectOf({ ticked: wholeNumber, total: wholeNumber });

const artefactState = oneOf(ARTEFACT_STATES);

const stageBoundary = objectOf({ artefact: oneOf(SPEC_ARTEFACT_KINDS), date: snapshotDate });

const workItemShape = objectOf({
  id:                     text,
  ordinal:                wholeNumber,
  kind:                   oneOf(PHASE_KINDS),
  storyNumber:            nullable(wholeNumber),
  priority:               nullable(wholeNumber),
  isMinimumViableProduct: truthValue,
  title:                  text,
  tagText:                nullable(text),
  state:                  oneOf(WORK_ITEM_STATES),
  taskCount:              wholeNumber,
  tickedCount:            wholeNumber,
  tasks:                  listOf(objectOf({
    id:          text,
    isDone:      truthValue,
    isParallel:  truthValue,
    storyNumber: nullable(wholeNumber),
    description: text,
  })),
  dependsOn: listOf(text),
  waitingOn: listOf(text),
});

const specShape = objectOf({
  folderName: text,
  number:     nullable(wholeNumber),
  title:      text,
  colourSlot: wholeNumber,
  lane:       oneOf(SPEC_LANES),
  stepper:    objectOf({ doneLanes: listOf(oneOf(SPEC_LANES)), currentLane: nullable(oneOf(SPEC_LANES)) }),
  stories:    listOf(objectOf({
    number: wholeNumber, title: text, priority: wholeNumber, phaseState: nullable(oneOf(WORK_ITEM_STATES))
  })),
  counts:    everyKeyOf(['functionalRequirements', 'successCriteria', 'openMarkers', 'clarificationSessions', 'clarificationAnswers'], wholeNumber),
  artefacts: listOf(objectOf({
    kind: oneOf(SPEC_ARTEFACT_KINDS), relativePath: text, state: artefactState, created: snapshotDate, modified: snapshotDate
  })),
  checklists: listOf(objectOf({
    relativePath: text, title: text, checked: wholeNumber, total: wholeNumber
  })),
  tasks:      tickCount,
  workItems:  listOf(workItemShape),
  stageSpans: listOf(objectOf({
    stage: oneOf(SPEC_STAGES), start: stageBoundary, end: nullable(stageBoundary), isOpen: truthValue
  })),
});

const storedDocumentShape = objectOf({
  version:        currentVersion,
  project:        text,
  repositoryKey:  text,
  generatedAt:    text,
  specKitVersion: nullable(text),
  constitution:   nullable(objectOf({
    state:       artefactState,
    version:     nullable(text),
    ratified:    nullable(text),
    lastAmended: nullable(text),
    principles:  listOf(text),
  })),
  laneCounts:  everyKeyOf(SPEC_LANES, wholeNumber),
  tasks:       tickCount,
  openMarkers: listOf(objectOf({
    folderName: text, relativePath: text, text, line: wholeNumber
  })),
  unreadable: listOf(objectOf({ relativePath: text, reason: text, line: nullable(wholeNumber) })),
  specs:      listOf(specShape),
});

/** `null` for a document this build reads; the first problem found otherwise, in the stored order of its fields. */
function documentProblemOf(parsed: unknown): string | null {
  return storedDocumentShape(parsed, '');
}

/** The checks above are the stored format's type written as checks, so a document they find nothing wrong with is one of that type. */
function documentIsStored(parsed: unknown, problemFound: string | null): parsed is StoredSpecSnapshotFile {
  return problemFound === null && JsonRecordUtil.valueIsAPlainObject(parsed);
}

function readingOf(parsed: unknown): { verdict: 'readable'; document: StoredSpecSnapshotFile } | { verdict: 'unreadable'; reason: string } {
  const problem = documentProblemOf(parsed);
  if (problem !== null) return { verdict: 'unreadable', reason: problem };
  return documentIsStored(parsed, problem) ? { verdict: 'readable', document: parsed } : { verdict: 'unreadable', reason: 'the document is not a JSON object' };
}

export const SpecSnapshotFileValidationUtil = { documentProblemOf, readingOf } as const;
