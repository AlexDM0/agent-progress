/**
 * Synthetic spec-kit repositories on disk, written from a description of their features, optionally dated days apart in the past, and
 * the one example later specs and browser checks share. Test-only: nothing that ships may import `src/testing/`.
 */
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join }                                 from 'node:path';

export interface SpecKitStoryDescription {
  readonly title:    string;
  readonly priority: number;
}

export interface SpecKitPhaseDescription {
  readonly name:          string;
  readonly doneTaskCount: number;
  readonly taskCount:     number;
  /** Labels the phase's tasks `[US<n>]`. */
  readonly storyNumber?:  number;
}

export interface SpecKitClarificationSessionDescription {
  readonly dateText: string;
  readonly answers:  readonly { readonly question: string; readonly answer: string }[];
}

export type SpecKitSupportingFileName = 'research.md' | 'data-model.md' | 'quickstart.md';

export interface SpecKitFeatureDescription {
  readonly folderName:             string;
  readonly title:                  string;
  readonly userStories:            readonly SpecKitStoryDescription[];
  readonly clarificationSessions?: readonly SpecKitClarificationSessionDescription[];
  /** Each becomes one `[NEEDS CLARIFICATION: …]` requirement in `spec.md`. */
  readonly openClarifications?:    readonly string[];
  readonly hasPlan?:               boolean;
  readonly supportingFiles?:       readonly SpecKitSupportingFileName[];
  /** Absent: no `contracts/` folder. */
  readonly contractFileCount?:     number;
  /** Absent: no `checklists/requirements.md`; otherwise one item per entry, true where it is checked. */
  readonly requirementsChecklist?: readonly boolean[];
  /** Absent: no `tasks.md`. */
  readonly phases?:                readonly SpecKitPhaseDescription[];
}

export interface SpecKitConstitutionDescription {
  readonly version:         string;
  readonly ratifiedDate:    string;
  readonly lastAmendedDate: string;
  readonly principleNames:  readonly string[];
}

export interface SpecKitRepositoryDescription {
  readonly projectName:    string;
  readonly speckitVersion: string;
  readonly constitution:   SpecKitConstitutionDescription;
  readonly features:       readonly SpecKitFeatureDescription[];
}

export interface SpecKitFileDatingOptions {
  /** Dates each feature's `spec.md` before its `plan.md`, before its `tasks.md`, days apart and all before `now`. */
  readonly datesFilesInThePast: boolean;
  readonly now?:                Date;
}

const MILLISECONDS_PER_DAY        = 86_400_000;
const DAYS_BETWEEN_FEATURES       = 3;
const DAYS_BEFORE_NOW_AT_THE_LEAST = 3;
const DAYS_FROM_SPEC_TO_PLAN      = 1;
const DAYS_FROM_SPEC_TO_TASKS     = 2;
const IDENTIFIER_DIGITS           = 3;

/** Spec-kit's zero-padded ids: `T001`, `CHK001`, `FR-001`. */
function numberedIdentifier(prefix: string, number: number): string {
  return `${prefix}${String(number).padStart(IDENTIFIER_DIGITS, '0')}`;
}

function specTextOf(feature: SpecKitFeatureDescription): string {
  const stories = feature.userStories.flatMap((story, index) => [
    `### User Story ${index + 1} - ${story.title} (Priority: P${story.priority})`,
    '',
    `An example shopper can ${story.title.toLowerCase()}.`,
    '',
  ]);
  const requirements = [
    `- **FR-001**: The system MUST support ${feature.title.toLowerCase()}.`,
    ...(feature.openClarifications ?? [])
      .map((question, index) => `- **${numberedIdentifier('FR-', index + 2)}**: The system MUST [NEEDS CLARIFICATION: ${question}]`),
  ];
  const clarifications = (feature.clarificationSessions ?? []).length === 0 ? [] : [
    '## Clarifications',
    '',
    ...(feature.clarificationSessions ?? []).flatMap((session) => [
      `### Session ${session.dateText}`,
      '',
      ...session.answers.map(({ question, answer }) => `- Q: ${question} → A: ${answer}`),
      '',
    ]),
  ];
  return [
    `# Feature Specification: ${feature.title}`,
    '',
    `**Feature Branch**: \`${feature.folderName}\``,
    '**Created**: 2026-09-01',
    '**Status**: Draft',
    '',
    ...clarifications,
    '## User Scenarios & Testing *(mandatory)*',
    '',
    ...stories,
    '## Requirements *(mandatory)*',
    '',
    ...requirements,
    '',
    '## Success Criteria *(mandatory)*',
    '',
    `- **SC-001**: An example shopper finishes ${feature.title.toLowerCase()} in under a minute.`,
    '',
  ].join('\n');
}

function planTextOf(feature: SpecKitFeatureDescription): string {
  return [
    `# Implementation Plan: ${feature.title}`,
    '',
    `**Branch**: \`${feature.folderName}\` | **Date**: 2026-09-02 | **Spec**: [spec.md](spec.md)`,
    '',
    '## Summary',
    '',
    `An example plan for ${feature.title.toLowerCase()}.`,
    '',
  ].join('\n');
}

function tasksTextOf(feature: SpecKitFeatureDescription, phases: readonly SpecKitPhaseDescription[]): string {
  let taskNumber = 0;
  const phaseLines = phases.flatMap((phase, phaseIndex) => {
    const storyLabel = phase.storyNumber === undefined ? '' : ` [US${phase.storyNumber}]`;
    const taskLines = Array.from({ length: phase.taskCount }, (_unused, taskIndex) => {
      taskNumber += 1;
      const checkbox = taskIndex < phase.doneTaskCount ? '[x]' : '[ ]';
      return `- ${checkbox} ${numberedIdentifier('T', taskNumber)}${storyLabel} Example task ${taskNumber}`;
    });
    return [`## Phase ${phaseIndex + 1}: ${phase.name}`, '', ...taskLines, ''];
  });
  return [`# Tasks: ${feature.title}`, '', ...phaseLines].join('\n');
}

function checklistTextOf(feature: SpecKitFeatureDescription, checkedItems: readonly boolean[]): string {
  const itemLines = checkedItems.map((isChecked, index) => `- [${isChecked ? 'x' : ' '}] ${numberedIdentifier('CHK', index + 1)} Example requirement ${index + 1}`);
  return [`# Requirements Checklist: ${feature.title}`, '', ...itemLines, ''].join('\n');
}

function constitutionTextOf(projectName: string, constitution: SpecKitConstitutionDescription): string {
  const principles = constitution.principleNames.flatMap((name) => [`### ${name}`, '', `An example principle: ${name}.`, '']);
  return [
    `# ${projectName} Constitution`,
    '',
    '## Core Principles',
    '',
    ...principles,
    '## Governance',
    '',
    `**Version**: ${constitution.version} | **Ratified**: ${constitution.ratifiedDate} | **Last Amended**: ${constitution.lastAmendedDate}`,
    '',
  ].join('\n');
}

function writeTextFile(path: string, text: string): string {
  writeFileSync(path, text);
  return path;
}

function dateDaysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * MILLISECONDS_PER_DAY);
}

/** Setting an earlier time moves a file's birth time back with it on file systems that keep one. */
function dateEach(paths: readonly string[], date: Date): void {
  for (const path of paths) utimesSync(path, date, date);
}

export function writeSpecKitRepository(directory: string, description: SpecKitRepositoryDescription, dating: SpecKitFileDatingOptions): void {
  const now = dating.now ?? new Date();
  const featureCount = description.features.length;

  mkdirSync(join(directory, '.specify', 'memory'), { recursive: true });
  const memoryPaths = [
    writeTextFile(join(directory, '.specify', 'init-options.json'), `${JSON.stringify({ ai: 'claude', script: 'sh', speckit_version: description.speckitVersion }, null, 2)}\n`),
    writeTextFile(join(directory, '.specify', 'memory', 'constitution.md'), constitutionTextOf(description.projectName, description.constitution)),
  ];
  if (dating.datesFilesInThePast) dateEach(memoryPaths, dateDaysBefore(now, (featureCount + 1) * DAYS_BETWEEN_FEATURES + DAYS_BEFORE_NOW_AT_THE_LEAST));

  description.features.forEach((feature, featureIndex) => {
    const featureDirectory = join(directory, 'specs', feature.folderName);
    mkdirSync(featureDirectory, { recursive: true });
    const specPaths = [writeTextFile(join(featureDirectory, 'spec.md'), specTextOf(feature))];
    const planPaths: string[] = [];
    const tasksPaths: string[] = [];

    if (feature.requirementsChecklist !== undefined) {
      mkdirSync(join(featureDirectory, 'checklists'));
      specPaths.push(writeTextFile(join(featureDirectory, 'checklists', 'requirements.md'), checklistTextOf(feature, feature.requirementsChecklist)));
    }
    if (feature.hasPlan === true) planPaths.push(writeTextFile(join(featureDirectory, 'plan.md'), planTextOf(feature)));
    for (const fileName of feature.supportingFiles ?? []) {
      planPaths.push(writeTextFile(join(featureDirectory, fileName), `# ${feature.title}: ${fileName}\n\nExample content.\n`));
    }
    if (feature.contractFileCount !== undefined) {
      const contractsDirectory = join(featureDirectory, 'contracts');
      mkdirSync(contractsDirectory);
      for (let i = 1; i <= feature.contractFileCount; i++) {
        planPaths.push(writeTextFile(join(contractsDirectory, `example-contract-${i}.yaml`), `openapi: 3.0.0\ninfo:\n  title: Example contract ${i}\n`));
      }
      planPaths.push(contractsDirectory);
    }
    if (feature.phases !== undefined) tasksPaths.push(writeTextFile(join(featureDirectory, 'tasks.md'), tasksTextOf(feature, feature.phases)));

    if (!dating.datesFilesInThePast) return;
    const specDaysAgo = (featureCount - featureIndex) * DAYS_BETWEEN_FEATURES + DAYS_BEFORE_NOW_AT_THE_LEAST;
    dateEach(specPaths, dateDaysBefore(now, specDaysAgo));
    dateEach(planPaths, dateDaysBefore(now, specDaysAgo - DAYS_FROM_SPEC_TO_PLAN));
    dateEach(tasksPaths, dateDaysBefore(now, specDaysAgo - DAYS_FROM_SPEC_TO_TASKS));
  });
}

/** Throws on a story number the list lacks, so a mistyped example fails its spec rather than writing a phase with no story. */
function userStoryPhase(storyNumber: number, stories: readonly SpecKitStoryDescription[], doneTaskCount: number, taskCount: number): SpecKitPhaseDescription {
  const story = stories[storyNumber - 1];
  if (story === undefined) throw new Error(`the example has no user story ${storyNumber}`);
  const minimumViableProductMark = story.priority === 1 ? ' 🎯 MVP' : '';
  return {
    name: `User Story ${storyNumber} - ${story.title} (Priority: P${story.priority})${minimumViableProductMark}`, doneTaskCount, taskCount, storyNumber,
  };
}

function setupPhase(doneTaskCount: number, taskCount: number): SpecKitPhaseDescription {
  return { name: 'Setup (Shared Infrastructure)', doneTaskCount, taskCount };
}

function foundationalPhase(doneTaskCount: number, taskCount: number): SpecKitPhaseDescription {
  return { name: 'Foundational (Blocking Prerequisites)', doneTaskCount, taskCount };
}

function polishPhase(doneTaskCount: number, taskCount: number): SpecKitPhaseDescription {
  return { name: 'Polish & Cross-Cutting Concerns', doneTaskCount, taskCount };
}

function storiesOf(...entries: readonly (readonly [string, number])[]): SpecKitStoryDescription[] {
  return entries.map(([title, priority]) => ({ title, priority }));
}

const EVERY_SUPPORTING_FILE: readonly SpecKitSupportingFileName[] = ['research.md', 'data-model.md', 'quickstart.md'];

/** The one example spec-kit repository: "Example Storefront", eight features from finished to barely specified. */
export function exampleSpecKitRepositoryDescription(): SpecKitRepositoryDescription {
  const customerLoginStories = storiesOf(['Sign in with email and password', 1], ['Reset a forgotten password', 2]);
  const productSearchStories = storiesOf(['Search products by keyword', 1], ['Filter results by category', 2], ['Sort results by price', 3]);
  const wishlistStories      = storiesOf(['Save a product to the wishlist', 1], ['Share a wishlist with a friend', 2]);
  const giftCardStories      = storiesOf(['Buy a gift card', 1], ['Redeem a gift card at checkout', 2], ['Check a gift card balance', 3]);
  return {
    projectName:    'Example Storefront',
    speckitVersion: '1.1.0',
    constitution:   {
      version:         '1.2.0',
      ratifiedDate:    '2026-09-01',
      lastAmendedDate: '2026-09-30',
      principleNames:  [
        'I. Example Library-First',
        'II. Example Command Line Interface',
        'III. Example Test-First',
        'IV. Example Integration Testing',
        'V. Example Observability',
        'VI. Example Simplicity',
      ],
    },
    features: [
      {
        folderName:            '001-customer-login',
        title:                 'Customer Login',
        userStories:           customerLoginStories,
        hasPlan:               true,
        supportingFiles:       EVERY_SUPPORTING_FILE,
        contractFileCount:     1,
        requirementsChecklist: [true, true, true],
        phases:                [
          setupPhase(2, 2),
          foundationalPhase(4, 4),
          userStoryPhase(1, customerLoginStories, 8, 8),
          userStoryPhase(2, customerLoginStories, 6, 6),
          polishPhase(4, 4),
        ],
      },
      {
        folderName:            '002-product-search',
        title:                 'Product Search',
        userStories:           productSearchStories,
        hasPlan:               true,
        supportingFiles:       EVERY_SUPPORTING_FILE,
        contractFileCount:     2,
        requirementsChecklist: [true, true, false],
        phases:                [
          setupPhase(3, 3),
          foundationalPhase(6, 6),
          userStoryPhase(1, productSearchStories, 9, 9),
          userStoryPhase(2, productSearchStories, 0, 11),
          userStoryPhase(3, productSearchStories, 0, 8),
          polishPhase(0, 4),
        ],
      },
      {
        folderName:            '003-wishlist',
        title:                 'Wishlist',
        userStories:           wishlistStories,
        hasPlan:               true,
        supportingFiles:       EVERY_SUPPORTING_FILE,
        contractFileCount:     1,
        requirementsChecklist: [true, true],
        phases:                [
          setupPhase(2, 2),
          foundationalPhase(3, 3),
          userStoryPhase(1, wishlistStories, 9, 9),
          userStoryPhase(2, wishlistStories, 9, 9),
          polishPhase(4, 4),
          { name: 'Convergence', doneTaskCount: 0, taskCount: 3 },
        ],
      },
      {
        folderName:        '004-gift-cards',
        title:             'Gift Cards',
        userStories:       giftCardStories,
        hasPlan:           true,
        supportingFiles:   ['research.md', 'data-model.md'],
        contractFileCount: 1,
        phases:            [
          setupPhase(0, 2),
          foundationalPhase(0, 5),
          userStoryPhase(1, giftCardStories, 0, 7),
          userStoryPhase(2, giftCardStories, 0, 6),
          userStoryPhase(3, giftCardStories, 0, 4),
          polishPhase(0, 3),
        ],
      },
      {
        folderName:  '005-order-tracking',
        title:       'Order Tracking',
        userStories: storiesOf(['See an order delivery status', 1], ['Get notified when an order ships', 2]),
        hasPlan:     true,
      },
      {
        folderName:            '006-saved-addresses',
        title:                 'Saved Addresses',
        userStories:           storiesOf(['Save a delivery address', 1], ['Choose a saved address at checkout', 2]),
        clarificationSessions: [{
          dateText: '2026-09-20',
          answers:  [
            { question: 'How many addresses may a customer save?', answer: 'Ten.' },
            { question: 'Is one address the default?', answer: 'Yes, the first one saved.' },
            { question: 'Are addresses outside the country allowed?', answer: 'No.' },
          ],
        }],
        hasPlan: true,
      },
      {
        folderName:            '007-store-pickup',
        title:                 'Store Pickup',
        userStories:           storiesOf(['Choose a pickup store', 1], ['See when an order is ready for pickup', 2], ['Change the pickup store', 3]),
        clarificationSessions: [
          { dateText: '2026-09-22', answers: [{ question: 'Which stores offer pickup?', answer: 'Every example store.' }] },
          { dateText: '2026-09-25', answers: [{ question: 'How long is an order held?', answer: 'Seven days.' }] },
        ],
      },
      {
        folderName:         '008-gift-wrapping',
        title:              'Gift Wrapping',
        userStories:        storiesOf(['Add gift wrapping to an order', 1]),
        openClarifications: ['which wrapping papers are offered?', 'is a gift message included in the price?'],
      },
    ],
  };
}

export function writeExampleSpecKitRepository(directory: string, dating: SpecKitFileDatingOptions): void {
  writeSpecKitRepository(directory, exampleSpecKitRepositoryDescription(), dating);
}
