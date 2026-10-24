/**
 * The filter menu's Kanban Epic section lists only epics still holding an open ticket. What matters: an epic whose tickets are all
 * delivered, abandoned or a mix of both gets no row, while one holding only a reviewed or in-review ticket keeps its row; a remembered
 * selection of an unlisted epic leaves the board unfiltered without rewriting the stored choice; a pressed epic's roll-up sits under its
 * own row and the filter line names it; a reset clears and stores the choice; and with no listed epic the section stays hidden. The page
 * has no DOM under Bun, so `document` is a map of the section's two containers carrying only what the controller writes.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from 'bun:test';
import type { EpicFrontmatter }             from '../../src/lib/tracker-model/@types/Epic.ts';
import type { PageTicket }                  from '../../src/shared/@types/PagePayload.ts';
import type { PageBoard }                   from '../@types/PageBoard.ts';
import { createViewerPreferences }          from '../preferences/ViewerPreferences.ts';
import { pageBoardFixture }                 from '../testing/PageBoardFixture.ts';
import { createKanbanEpicFilterController } from './KanbanEpicFilterController.ts';

interface FakeContainer {
  innerHTML:        string;
  hidden:           boolean;
  querySelectorAll: () => never[];
  addEventListener: () => void;
}

const STRIP_ELEMENT_ID   = 'ap-kanban-epics';
const CHIPS_ELEMENT_ID   = 'ap-kanban-epic';

function exampleTicket(id: string, changes: Partial<PageTicket>): PageTicket {
  return {
    id,
    title:       `Example ticket ${id}`,
    type:        'ticket',
    status:      'pending',
    filed:       '2026-09-18T08:00:00+02:00',
    updated:     '2026-09-18T08:00:00+02:00',
    started:     null,
    finished:    null,
    delivered:   null,
    abandonedAt: null,
    task:        null,
    extra:       [],
    filePath:    `/example/.agent-progress/tickets/${id}.md`,
    bodyHtml:    '',
    ...changes,
  };
}

function exampleEpic(key: string, slot: number): EpicFrontmatter {
  return {
    key, title: `Example ${key}`, slot, extra: []
  };
}

const DELIVERED = { status: 'delivered', delivered: '2026-09-18T21:00:00+02:00' } as const;
const ABANDONED = { status: 'abandoned', abandonedAt: '2026-09-18T12:00:00+02:00' } as const;

const MIXED_BOARD = pageBoardFixture({
  tasks:   [],
  epics:   [exampleEpic('open', 1), exampleEpic('delivered', 2), exampleEpic('mixed', 3), exampleEpic('reviewed', 4), exampleEpic('in-review', 5)],
  tickets: [
    exampleTicket('001', { epics: ['open'] }),
    exampleTicket('002', { ...DELIVERED, epics: ['open'] }),
    exampleTicket('003', { ...DELIVERED, epics: ['delivered'] }),
    exampleTicket('004', { ...DELIVERED, epics: ['mixed'] }),
    exampleTicket('005', { ...ABANDONED, epics: ['mixed'] }),
    exampleTicket('006', { status: 'reviewed', epics: ['reviewed'] }),
    exampleTicket('007', { status: 'in-review', epics: ['in-review'] }),
  ],
});

const SETTLED_BOARD = pageBoardFixture({
  tasks:   [],
  epics:   [exampleEpic('delivered', 1), exampleEpic('mixed', 2)],
  tickets: [
    exampleTicket('001', { ...DELIVERED, epics: ['delivered'] }),
    exampleTicket('002', { ...DELIVERED, epics: ['mixed'] }),
    exampleTicket('003', { ...ABANDONED, epics: ['mixed'] }),
  ],
});

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
let containers = new Map<string, FakeContainer>();
let storedItems = new Map<string, string>();

function fakeContainer(): FakeContainer {
  return {
    innerHTML: '', hidden: false, querySelectorAll: () => [], addEventListener: () => undefined
  };
}

function containerOf(elementId: string): FakeContainer {
  return containers.get(elementId) ?? fakeContainer();
}

function examplePreferences(): ReturnType<typeof createViewerPreferences> {
  return createViewerPreferences('example-tracker', () => ({
    getItem:    (key) => storedItems.get(key) ?? null,
    setItem:    (key, value) => { storedItems.set(key, value); },
    removeItem: (key) => { storedItems.delete(key); },
  }));
}

function wiredController(board: PageBoard): ReturnType<typeof createKanbanEpicFilterController> {
  const controller = createKanbanEpicFilterController({
    epics: board.epics, allTickets: board.tickets, preferences: examplePreferences(), applyFilter: () => undefined
  });
  controller.wire();
  return controller;
}

function chipValuesShown(): string[] {
  return [...containerOf(CHIPS_ELEMENT_ID).innerHTML.matchAll(/data-[a-z-]+="([^"]*)"/gu)].map((match) => match[1] ?? '');
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'document', {
    value:        { getElementById: (elementId: string) => containers.get(elementId) ?? null },
    configurable: true,
    writable:     true,
  });
});

afterAll(() => {
  if (originalDocument === undefined) {
    Reflect.deleteProperty(globalThis, 'document');
  } else {
    Object.defineProperty(globalThis, 'document', originalDocument);
  }
});

beforeEach(() => {
  containers  = new Map([STRIP_ELEMENT_ID, CHIPS_ELEMENT_ID].map((elementId) => [elementId, fakeContainer()]));
  storedItems = new Map();
});

describe('the Kanban epic filter', () => {
  test('lists an epic holding an open ticket and none whose tickets are all delivered, abandoned or a mix of both', () => {
    wiredController(MIXED_BOARD);
    const shown = chipValuesShown();
    expect(shown).toContain('open');
    expect(shown).not.toContain('delivered');
    expect(shown).not.toContain('mixed');
    expect(containerOf(STRIP_ELEMENT_ID).hidden).toBe(false);
  });

  test('keeps the chip of an epic holding only a reviewed or an in-review ticket', () => {
    wiredController(MIXED_BOARD);
    expect(chipValuesShown()).toEqual(expect.arrayContaining(['reviewed', 'in-review']));
  });

  test('a remembered selection of an unlisted epic leaves the board unfiltered, no roll-up shown and the stored choice kept', () => {
    examplePreferences().writeKanbanEpicFilter(['mixed']);
    const storedBefore = [...storedItems];
    const controller   = wiredController(MIXED_BOARD);
    expect(MIXED_BOARD.tickets.every((ticket) => controller.keeps(ticket))).toBe(true);
    expect(containerOf(CHIPS_ELEMENT_ID).innerHTML).not.toContain('ap-epic-strip-rollup');
    expect(controller.readLabel()).toBeNull();
    expect([...storedItems]).toEqual(storedBefore);
  });

  test('a pressed epic\'s roll-up follows its own row, before the next row, and the filter line names it', () => {
    examplePreferences().writeKanbanEpicFilter(['open']);
    const controller = wiredController(MIXED_BOARD);
    const rows       = containerOf(CHIPS_ELEMENT_ID).innerHTML;
    const rollupAt   = rows.indexOf('class="ap-epic-strip-rollup"');
    expect(rows.indexOf('data-epic-chip="open"')).toBeLessThan(rollupAt);
    expect(rows.indexOf('data-epic-chip="reviewed"')).toBeGreaterThan(rollupAt);
    expect(rows.match(/class="ap-epic-strip-rollup"/g)).toHaveLength(1);
    expect(controller.readLabel()).toEqual({ title: 'Example open', slot: 1 });
  });

  test('names a second pressed row as +1 and no epic without a swatch', () => {
    examplePreferences().writeKanbanEpicFilter(['no epic', 'open']);
    expect(wiredController(MIXED_BOARD).readLabel()).toEqual({ title: 'no epic +1', slot: null });
  });

  test('a reset unpresses every row and stores the empty choice', () => {
    examplePreferences().writeKanbanEpicFilter(['open']);
    const controller = wiredController(MIXED_BOARD);
    controller.reset();
    expect(controller.readLabel()).toBeNull();
    expect(examplePreferences().readKanbanEpicFilter()).toEqual([]);
    expect(containerOf(CHIPS_ELEMENT_ID).innerHTML).not.toContain('ap-epic-strip-rollup');
  });

  test('stays hidden when no epic holds an open ticket', () => {
    const controller = wiredController(SETTLED_BOARD);
    expect(containerOf(STRIP_ELEMENT_ID).hidden).toBe(true);
    expect(containerOf(CHIPS_ELEMENT_ID).innerHTML).toBe('');
    expect(SETTLED_BOARD.tickets.every((ticket) => controller.keeps(ticket))).toBe(true);
  });
});
