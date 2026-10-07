/**
 * `tasks.md` and a checklist read from literal text, modelled on spec-kit 1.1.0's templates and its `converge` command, without a disk.
 * The cases that matter: `[x]` and `[X]` both read as done; a task line with no `T###` id and a phase heading with no number are reported
 * with their lines, never dropped silently or thrown; repeated Convergence phases stay two phases and an unknown phase keeps its place; an
 * untouched template copy reads as `template`; and empty, binary-looking and truncated text is a verdict, never a throw.
 */
import { describe, expect, test } from 'bun:test';

import {
  CHECKLIST_TEMPLATE_TEXT,
  HOSTILE_TEXTS,
  TASKS_TEMPLATE_TEXT,
  truncationsOf
} from '../testing/SpecKitTemplateTexts.ts';
import { SpecKitChecklistUtil } from './SpecKitChecklistUtil.ts';

const { checklistReadingOf, tasksReadingOf } = SpecKitChecklistUtil;

const CONVERGED_TASKS_TEXT = `# Tasks: Example Checkout

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 Create project structure per implementation plan
- [X] T002 [P] Configure linting and formatting tools

## Phase 2: Review Notes

- [ ] T003 Write down what the review found

## Phase 3: Convergence

- [ ] T004 CRITICAL Restore the checkout total per Constitution II (contradicts)

## Phase 4: Convergence

- [ ] T005 Add the saved-card list per FR-003 (missing)
`;

const PLANTED_MALFORMED_TASKS_TEXT = `# Tasks: Example Checkout

## Phase: Setup

- [ ] T001 Create project structure per implementation plan
- [ ] Configure linting and formatting tools
`;

function parsedTasksOf(text: string) {
  const reading = tasksReadingOf(text);
  if (reading.verdict === 'malformed') throw new Error(reading.reason);
  return reading.document;
}

describe('tasks.md', () => {
  test('an untouched template copy reads as template, its frontmatter skipped', () => {
    const document = parsedTasksOf(TASKS_TEMPLATE_TEXT);
    expect(document.fillState).toBe('template');
    expect(document.title).toBe('Tasks: [FEATURE NAME]');
  });

  test('the same file with its title filled reads as filled, though `[###-feature-name]` stays', () => {
    expect(parsedTasksOf(TASKS_TEMPLATE_TEXT.replace('# Tasks: [FEATURE NAME]', '# Tasks: Example Checkout')).fillState).toBe('filled');
  });

  test('the template phases read in file order with kind, number, story and MVP mark', () => {
    const phases = parsedTasksOf(TASKS_TEMPLATE_TEXT).phases.map(({ tasks: _tasks, name: _name, ...phase }) => phase);
    expect(phases).toEqual([
      {
        ordinal: 1, number: 1, kind: 'setup', storyNumber: null, storyPriority: null, isMinimumViableProduct: false, line: 14
      },
      {
        ordinal: 2, number: 2, kind: 'foundational', storyNumber: null, storyPriority: null, isMinimumViableProduct: false, line: 22
      },
      {
        ordinal: 3, number: 3, kind: 'user-story', storyNumber: 1, storyPriority: 1, isMinimumViableProduct: true, line: 29
      },
      {
        ordinal: 4, number: 4, kind: 'user-story', storyNumber: 2, storyPriority: 2, isMinimumViableProduct: false, line: 38
      },
      {
        ordinal: 5, number: null, kind: 'polish', storyNumber: null, storyPriority: null, isMinimumViableProduct: false, line: 44
      },
    ]);
  });

  test('a task line reads its id, parallel mark, story label and description', () => {
    const storyPhase = parsedTasksOf(TASKS_TEMPLATE_TEXT).phases[2];
    expect(storyPhase?.tasks).toEqual([
      {
        id: 'T012', isDone: false, isParallel: true, storyNumber: 1, description: 'Create [Entity1] model in src/models/[entity1].py', line: 33
      },
      {
        id:          'T014',
        isDone:      false,
        isParallel:  false,
        storyNumber: 1,
        description: 'Implement [Service] in src/services/[service].py (depends on T012, T013)',
        line:        34,
      },
    ]);
  });

  test('the template\'s `TXXX` line and its `Phase N` heading are reported, and the fenced example is no task', () => {
    expect(parsedTasksOf(TASKS_TEMPLATE_TEXT).unreadLines).toEqual([
      { reason: 'the phase heading has no number', line: 44 },
      { reason: 'the task line has no `T###` id', line: 46 },
    ]);
  });

  test('`[x]` and `[X]` both read as done', () => {
    const [setup] = parsedTasksOf(CONVERGED_TASKS_TEXT).phases;
    expect(setup?.tasks.map((task) => task.isDone)).toEqual([true, true]);
  });

  test('two Convergence phases read as two phases of kind convergence, and an unknown heading keeps its place as other', () => {
    const { phases } = parsedTasksOf(CONVERGED_TASKS_TEXT);
    expect(phases.map((phase) => [phase.ordinal, phase.number, phase.kind])).toEqual([
      [1, 1, 'setup'], [2, 2, 'other'], [3, 3, 'convergence'], [4, 4, 'convergence'],
    ]);
    expect(phases.map((phase) => phase.tasks.map((task) => task.id))).toEqual([['T001', 'T002'], ['T003'], ['T004'], ['T005']]);
  });

  test('a planted phase heading with no number and a task line with no id are reported lines, never a throw', () => {
    const document = parsedTasksOf(PLANTED_MALFORMED_TASKS_TEXT);
    expect(document.phases.map((phase) => [phase.number, phase.kind, phase.tasks.length])).toEqual([[null, 'setup', 1]]);
    expect(document.unreadLines).toEqual([
      { reason: 'the phase heading has no number', line: 3 },
      { reason: 'the task line has no `T###` id', line: 6 },
    ]);
  });

  test('a task before any phase is reported, and a heading that is no phase closes the open one', () => {
    const text = '# Tasks: Example Checkout\n\n- [ ] T001 Early\n\n## Phase 1: Setup\n\n## Notes\n\n- [ ] T002 After the notes\n';
    const document = parsedTasksOf(text);
    expect(document.phases[0]?.tasks).toEqual([]);
    expect(document.unreadLines.map((unread) => unread.line)).toEqual([3, 9]);
  });

  test('a frontmatter that never closes is malformed', () => {
    expect(tasksReadingOf('---\ndescription: "Task list"\n# Tasks: Example Checkout\n')).toMatchObject({ verdict: 'malformed' });
  });

  test('an unclosed frontmatter is reported at the file\'s last line, even past fenced code', () => {
    const text = '---\ndescription: "Task list"\n```\nexample\n```\n# Tasks: Example Checkout\n';
    expect(tasksReadingOf(text)).toMatchObject({ verdict: 'malformed', line: 7 });
  });

  for (const [description, text] of HOSTILE_TEXTS) {
    test(`${description} is a verdict, never a throw`, () => {
      expect(tasksReadingOf(text).verdict).toBe('malformed');
    });
  }

  test('every truncation of a tasks file reads without a throw', () => {
    for (const truncated of truncationsOf(TASKS_TEMPLATE_TEXT)) expect(['parsed', 'malformed']).toContain(tasksReadingOf(truncated).verdict);
  });
});

describe('a checklist', () => {
  test('an untouched template copy reads as template with its CHK items', () => {
    const reading = checklistReadingOf(CHECKLIST_TEMPLATE_TEXT);
    expect(reading).toEqual({
      verdict:  'parsed',
      document: {
        fillState: 'template',
        title:     '[CHECKLIST TYPE] Checklist: [FEATURE NAME]',
        items:     [
          {
            id: 'CHK001', isChecked: false, text: 'First checklist item with clear action', line: 7
          },
          {
            id: 'CHK002', isChecked: false, text: 'Second checklist item', line: 8
          },
        ],
        unreadLines: [],
      },
    });
  });

  test('checked items read as checked, either case, and a checkbox line with no CHK id is reported', () => {
    const text = '# UX Checklist: Example Checkout\n\n- [x] CHK001 Totals are stated\n- [X] CHK002 Errors are named\n- [ ] Unnumbered\n';
    expect(checklistReadingOf(text)).toMatchObject({
      verdict:  'parsed',
      document: {
        fillState:   'filled',
        items:       [{ id: 'CHK001', isChecked: true }, { id: 'CHK002', isChecked: true }],
        unreadLines: [{ reason: 'the checklist line has no `CHK###` id', line: 5 }],
      },
    });
  });

  for (const [description, text] of HOSTILE_TEXTS) {
    test(`${description} is a verdict, never a throw`, () => {
      expect(checklistReadingOf(text).verdict).toBe('malformed');
    });
  }

  test('every truncation of a checklist reads without a throw', () => {
    for (const truncated of truncationsOf(CHECKLIST_TEMPLATE_TEXT)) {
      expect(['parsed', 'malformed']).toContain(checklistReadingOf(truncated).verdict);
    }
  });
});
