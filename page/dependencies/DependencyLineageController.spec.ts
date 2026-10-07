/**
 * The lineage highlight must follow the pointer without flashing: pointing at empty canvas or leaving it clears the highlight only after
 * the grace, a node reached inside the grace takes over with no frame in which nothing is lit, and a clear pending against a canvas the
 * page has since replaced must not touch the new one. The page has no DOM under Bun, so the canvas is a minimal element tree carrying
 * only what the controller reads, and the timers are Bun's fake ones.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test
} from 'bun:test';
import { DependencyGraphUtil }                                                 from '../utils/DependencyGraphUtil.ts';
import { createDependencyLineageController, LINEAGE_CLEAR_GRACE_MILLISECONDS } from './DependencyLineageController.ts';

interface FakePointerEvent {
  target:        FakeElement;
  relatedTarget: FakeElement | null;
}

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  parent:            FakeElement | null = null;
  readonly listeners  = new Map<string, (event: FakePointerEvent) => void>();

  constructor(readonly className: string, attributes: Record<string, string> = {}) {
    for (const [name, value] of Object.entries(attributes)) {
      this.attributes.set(name, value);
    }
  }

  append(...children: FakeElement[]): this {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
    return this;
  }

  matches(selector: string): boolean {
    return selector.startsWith('.') ? this.className === selector.slice(1) : this.attributes.has(selector.slice(1, -1));
  }

  closest(selector: string): FakeElement | null {
    let element: FakeElement | null = this;
    while (element !== null && !element.matches(selector)) {
      element = element.parent;
    }
    return element;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }

  contains(other: FakeElement | null): boolean {
    return other !== null && (other === this || this.contains(other.parent));
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  toggleAttribute(name: string, force: boolean): void {
    if (force) {
      this.attributes.set(name, '');
    } else {
      this.attributes.delete(name);
    }
  }

  addEventListener(type: string, listener: (event: FakePointerEvent) => void): void {
    this.listeners.set(type, listener);
  }
}

const CONTAINER_ELEMENT_ID = 'ap-dependencies';

const GRAPH = DependencyGraphUtil.dependencyGraphOf(
  [{ id: '1' }, { id: '2', dependsOn: ['1'] }, { id: '3' }],
  0,
  { settlesDependents: () => false, primaryGroupKeyOf: () => null },
);

const REPLACED_GLOBAL_NAMES = ['Element', 'Node', 'document'] as const;
const originalGlobals = new Map(REPLACED_GLOBAL_NAMES.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));

let container: FakeElement;

function canvasWithNodes(): FakeElement {
  return new FakeElement('ap-dependency-canvas').append(
    new FakeElement('ap-dependency-band'),
    new FakeElement('ap-dependency-node', { 'data-open-ticket': '1' }).append(new FakeElement('ap-dependency-node-title')),
    new FakeElement('ap-dependency-node', { 'data-open-ticket': '2' }),
    new FakeElement('ap-dependency-node', { 'data-open-ticket': '3' }),
    new FakeElement('ap-dependency-edge', { 'data-from': '1', 'data-to': '2' }),
  );
}

function canvas(): FakeElement {
  return container.querySelectorAll('.ap-dependency-canvas')[0] ?? new FakeElement('missing');
}

function element(className: string, ticketId?: string): FakeElement {
  const found = canvas().querySelectorAll(`.${className}`).find((candidate) => ticketId === undefined || candidate.getAttribute('data-open-ticket') === ticketId);
  return found ?? new FakeElement('missing');
}

function pointerOver(target: FakeElement): void {
  container.listeners.get('pointerover')?.({ target, relatedTarget: null });
}

function pointerOut(target: FakeElement, relatedTarget: FakeElement | null): void {
  container.listeners.get('pointerout')?.({ target, relatedTarget });
}

function litTicketIds(): string[] {
  if (!canvas().hasAttribute('data-lineage-shown')) {
    return [];
  }
  return canvas().querySelectorAll('[data-lit]').flatMap((lit) => lit.getAttribute('data-open-ticket') ?? []);
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'Element', { value: FakeElement, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'Node', { value: FakeElement, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'document', {
    value:        { getElementById: (id: string) => (id === CONTAINER_ELEMENT_ID ? container : null) },
    configurable: true,
    writable:     true,
  });
});

afterAll(() => {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, name);
    } else {
      Object.defineProperty(globalThis, name, descriptor);
    }
  }
});

beforeEach(() => {
  jest.useFakeTimers();
  container = new FakeElement('ap-card').append(canvasWithNodes(), new FakeElement('ap-dependency-legend'));
  createDependencyLineageController({ containerElementId: CONTAINER_ELEMENT_ID, readGraph: () => GRAPH }).wire();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the lineage highlight', () => {
  test('lights a hovered node, everything it depends on and the edge between them', () => {
    pointerOver(element('ap-dependency-node', '2'));
    expect(litTicketIds()).toEqual(['1', '2']);
    expect(element('ap-dependency-edge').hasAttribute('data-lit')).toBe(true);
  });

  test('pointing at empty canvas keeps the lineage for the grace, then clears it', () => {
    pointerOver(element('ap-dependency-node', '2'));
    pointerOver(element('ap-dependency-band'));
    jest.advanceTimersByTime(LINEAGE_CLEAR_GRACE_MILLISECONDS - 1);
    expect(litTicketIds()).toEqual(['1', '2']);
    jest.advanceTimersByTime(1);
    expect(litTicketIds()).toEqual([]);
    expect(element('ap-dependency-edge').hasAttribute('data-lit')).toBe(false);
  });

  test('a node reached inside the grace takes over with no frame in which nothing is lit', () => {
    pointerOver(element('ap-dependency-node', '2'));
    pointerOver(element('ap-dependency-band'));
    jest.advanceTimersByTime(LINEAGE_CLEAR_GRACE_MILLISECONDS / 2);
    pointerOver(element('ap-dependency-node', '3'));
    expect(litTicketIds()).toEqual(['3']);
    jest.advanceTimersByTime(LINEAGE_CLEAR_GRACE_MILLISECONDS * 2);
    expect(litTicketIds()).toEqual(['3']);
  });

  test('wandering over empty canvas never stretches the grace', () => {
    pointerOver(element('ap-dependency-node', '2'));
    pointerOver(element('ap-dependency-band'));
    jest.advanceTimersByTime(LINEAGE_CLEAR_GRACE_MILLISECONDS - 1);
    pointerOver(canvas());
    jest.advanceTimersByTime(1);
    expect(litTicketIds()).toEqual([]);
  });

  test('leaving the canvas clears the same way, and hovering a node again cancels the pending clear', () => {
    pointerOver(element('ap-dependency-node', '2'));
    pointerOut(element('ap-dependency-node', '2'), null);
    jest.advanceTimersByTime(LINEAGE_CLEAR_GRACE_MILLISECONDS - 1);
    expect(litTicketIds()).toEqual(['1', '2']);
    pointerOver(element('ap-dependency-node', '1'));
    jest.advanceTimersByTime(LINEAGE_CLEAR_GRACE_MILLISECONDS);
    expect(litTicketIds()).toEqual(['1', '2']);
    pointerOut(element('ap-dependency-node', '1'), container.querySelectorAll('.ap-dependency-legend')[0] ?? null);
    jest.advanceTimersByTime(LINEAGE_CLEAR_GRACE_MILLISECONDS);
    expect(litTicketIds()).toEqual([]);
  });

  test('pointing at a part of a node is pointing at the node', () => {
    pointerOver(element('ap-dependency-node-title'));
    expect(litTicketIds()).toEqual(['1', '2']);
  });

  test('moving between parts of the canvas is not leaving it', () => {
    pointerOver(element('ap-dependency-node', '2'));
    pointerOut(element('ap-dependency-node', '2'), element('ap-dependency-node', '1'));
    pointerOver(element('ap-dependency-node', '1'));
    jest.advanceTimersByTime(LINEAGE_CLEAR_GRACE_MILLISECONDS);
    expect(litTicketIds()).toEqual(['1', '2']);
  });

  test('a clear pending against a canvas the page replaced leaves the new canvas alone', () => {
    pointerOver(element('ap-dependency-node', '2'));
    const replacedCanvas = canvas();
    pointerOver(element('ap-dependency-band'));
    container.children.splice(0, 1);
    replacedCanvas.parent = null;
    container.append(canvasWithNodes());
    canvas().setAttribute('data-lineage-shown', '');
    jest.advanceTimersByTime(LINEAGE_CLEAR_GRACE_MILLISECONDS);
    expect(canvas().hasAttribute('data-lineage-shown')).toBe(true);
    expect(replacedCanvas.hasAttribute('data-lineage-shown')).toBe(true);
  });
});
