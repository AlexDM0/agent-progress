/**
 * The two checkbox documents, `tasks.md` and a file under `checklists/`, read into their parsed shapes, or a `malformed` verdict, never
 * a throw. A checkbox line the reader cannot take in is reported with its line rather than dropped.
 */
import type { MarkdownLine, SpecKitReading, SpecKitUnreadLine } from '../@types/SpecKitReading.ts';
import type {
  ChecklistDocument,
  ChecklistItem,
  SpecKitTask,
  TaskPhase,
  TaskPhaseKind,
  TasksDocument
} from '../@types/TasksDocument.ts';
import {
  DONE_CHECKBOX_MARKS,
  MINIMUM_VIABLE_PRODUCT_MARK,
  PARALLEL_TASK_MARK,
  PHASE_HEADING_PREFIX,
  SECTION_HEADING_PREFIX
} from '../constants/SpecKitMarkers.ts';
import { CHECKLIST_TEMPLATE_TITLE, TASKS_TEMPLATE_TITLE } from '../constants/SpecKitTemplateTitles.ts';
import { SpecKitMarkdownUtil }                            from './SpecKitMarkdownUtil.ts';

const { capturedTextOf, titledDocumentOf } = SpecKitMarkdownUtil;

const CHECKBOX_LINE       = /^\s*[-*]\s+\[(?<mark>[ xX])\]\s*(?<rest>.*)$/;
const TASK_ID             = /^(?<id>T\d+)(?=\s|$)/;
const STORY_LABEL         = /^\[US(?<number>\d+)\]/;
const CHECKLIST_ITEM_ID   = /^(?<id>CHK\d+)(?=\s|$)/;
const PHASE_HEADING_REST  = /^\s*(?<label>[^:]*?)\s*(?::\s*(?<name>.*))?$/;
const PHASE_NUMBER        = /^\d+$/;
const PHASE_HEADING       = new RegExp(`^${PHASE_HEADING_PREFIX}(?=[\\s:]|$)`);
const STORY_PHASE_NAME    = /^User Story (?<number>\d+)\b/i;
const STORY_PRIORITY      = /\(Priority: P(?<priority>\d+)\)/;
const WORD_BOUNDED_MINIMUM_VIABLE_PRODUCT_MARK = new RegExp(`\\b${MINIMUM_VIABLE_PRODUCT_MARK}\\b`);

const PHASE_KIND_BY_NAME_PREFIX: ReadonlyArray<readonly [string, TaskPhaseKind]> = [
  ['setup', 'setup'],
  ['foundational', 'foundational'],
  ['polish', 'polish'],
  ['convergence', 'convergence'],
];

interface CollectedPhase extends Omit<TaskPhase, 'tasks'> {
  readonly tasks: SpecKitTask[];
}

interface CheckboxLine {
  readonly isChecked: boolean;
  readonly rest:      string;
}

function checkboxLineOf(lineText: string): CheckboxLine | null {
  const checkbox = CHECKBOX_LINE.exec(lineText);
  if (checkbox === null) return null;
  return { isChecked: DONE_CHECKBOX_MARKS.has(capturedTextOf(checkbox, 'mark')), rest: capturedTextOf(checkbox, 'rest') };
}

function phaseKindOf(name: string): TaskPhaseKind {
  if (STORY_PHASE_NAME.test(name)) return 'user-story';
  const lowerCaseName = name.toLowerCase();
  const kindEntry     = PHASE_KIND_BY_NAME_PREFIX.find(([namePrefix]) => lowerCaseName.startsWith(namePrefix));
  return kindEntry === undefined ? 'other' : kindEntry[1];
}

function phaseOf(headingLine: MarkdownLine, ordinal: number): CollectedPhase {
  const headingRest = headingLine.text.slice(PHASE_HEADING_PREFIX.length);
  const parts       = PHASE_HEADING_REST.exec(headingRest);
  const label       = parts === null ? '' : capturedTextOf(parts, 'label');
  const name        = parts === null ? headingRest.trim() : capturedTextOf(parts, 'name').trim();
  const kind        = phaseKindOf(name);
  const story       = STORY_PHASE_NAME.exec(name);
  const priority    = STORY_PRIORITY.exec(name);
  return {
    ordinal,
    number:                 PHASE_NUMBER.test(label) ? Number(label) : null,
    name,
    kind,
    storyNumber:            kind === 'user-story' && story !== null ? Number(capturedTextOf(story, 'number')) : null,
    storyPriority:          kind === 'user-story' && priority !== null ? Number(capturedTextOf(priority, 'priority')) : null,
    isMinimumViableProduct: WORD_BOUNDED_MINIMUM_VIABLE_PRODUCT_MARK.test(name),
    line:                   headingLine.line,
    tasks:                  [],
  };
}

/** A task line's text after its checkbox: `T012 [P] [US1] Description`, the marks optional and in that order. */
function taskOf(checkbox: CheckboxLine, line: number): SpecKitTask | null {
  const id = TASK_ID.exec(checkbox.rest);
  if (id === null) return null;
  let remainder    = checkbox.rest.slice(capturedTextOf(id, 'id').length).trimStart();
  const isParallel = remainder.startsWith(PARALLEL_TASK_MARK);
  if (isParallel) remainder = remainder.slice(PARALLEL_TASK_MARK.length).trimStart();
  const story = STORY_LABEL.exec(remainder);
  if (story !== null) remainder = remainder.slice(story[0].length).trimStart();
  return {
    id:          capturedTextOf(id, 'id'),
    isDone:      checkbox.isChecked,
    isParallel,
    storyNumber: story === null ? null : Number(capturedTextOf(story, 'number')),
    description: remainder.trim(),
    line,
  };
}

/** Phases keep file order; a `## ` heading that is no phase closes the open one, so its lines belong to no phase. */
function tasksReadingOf(text: string): SpecKitReading<TasksDocument> {
  const titled = titledDocumentOf(text, TASKS_TEMPLATE_TITLE, true);
  if (titled.verdict === 'malformed') return titled;

  const phases: CollectedPhase[]         = [];
  const unreadLines: SpecKitUnreadLine[] = [];
  let openPhase: CollectedPhase | null   = null;

  for (const markdownLine of titled.document.lines) {
    const { text: lineText, line } = markdownLine;
    if (PHASE_HEADING.test(lineText)) {
      openPhase = phaseOf(markdownLine, phases.length + 1);
      phases.push(openPhase);
      if (openPhase.number === null) unreadLines.push({ reason: 'the phase heading has no number', line });
      continue;
    }
    if (lineText.startsWith(SECTION_HEADING_PREFIX)) {
      openPhase = null;
      continue;
    }
    const checkbox = checkboxLineOf(lineText);
    if (checkbox === null) continue;
    const task = taskOf(checkbox, line);
    if (task === null) unreadLines.push({ reason: 'the task line has no `T###` id', line });
    else if (openPhase === null) unreadLines.push({ reason: 'the task line is outside any phase', line });
    else openPhase.tasks.push(task);
  }

  return {
    verdict:  'parsed',
    document: {
      fillState: titled.document.fillState, title: titled.document.title, phases, unreadLines
    },
  };
}

function checklistReadingOf(text: string): SpecKitReading<ChecklistDocument> {
  const titled = titledDocumentOf(text, CHECKLIST_TEMPLATE_TITLE, false);
  if (titled.verdict === 'malformed') return titled;

  const items: ChecklistItem[]           = [];
  const unreadLines: SpecKitUnreadLine[] = [];
  for (const { text: lineText, line } of titled.document.lines) {
    const checkbox = checkboxLineOf(lineText);
    if (checkbox === null) continue;
    const id = CHECKLIST_ITEM_ID.exec(checkbox.rest);
    if (id === null) {
      unreadLines.push({ reason: 'the checklist line has no `CHK###` id', line });
      continue;
    }
    const itemId = capturedTextOf(id, 'id');
    items.push({
      id: itemId, isChecked: checkbox.isChecked, text: checkbox.rest.slice(itemId.length).trim(), line
    });
  }

  return {
    verdict:  'parsed',
    document: {
      fillState: titled.document.fillState, title: titled.document.title, items, unreadLines
    },
  };
}

export const SpecKitChecklistUtil = { checklistReadingOf, tasksReadingOf } as const;
