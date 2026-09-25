/**
 * What `renderProgressHtml` must guarantee: each token replaced exactly once, both islands parsing
 * back to what went in, and nothing from the tracker able to close the script element it travels in.
 */

import { describe, expect, test } from 'bun:test';
import {
  CLOCK_SLICE_END,
  DONE_WORK_VISIBLE_MILLISECONDS,
  MAXIMUM_TICKS_PER_AXIS,
  TICK_COUNT_SAFETY_BOUND,
  TICK_STEP_LADDER_MINUTES,
} from '../constants/Limits.ts';
import type { ProgressFile, Task, Ticket }              from '../constants/Types.ts';
import { refusalIsOperationRefusal }                    from '../platform/OperationRefusal.ts';
import { renderProgressHtml, substituteTemplateTokens } from './Template.ts';

const GENERATED_AT = new Date('2026-09-18T20:11:03Z');

function exampleTask(changes: Partial<Task> = {}): Task {
  return {
    id:     1,
    name:   'Split the exporter into two passes',
    status: 'running',
    start:  '2026-09-18T20:05:00+02:00',
    end:    null,
    owner:  'Alex Example',
    note:   '',
    ticket: '003',
    tokens: 12_300,
    ...changes,
  };
}

function exampleProgress(changes: Partial<ProgressFile> = {}): ProgressFile {
  return {
    version:    1,
    trackerId:  'tracker-for-the-template-spec',
    project:    'Example Agency',
    startedAt:  '2026-09-18T20:00:00+02:00',
    nextTaskId: 2,
    view:       { kind: 'auto' },
    tasks:      [exampleTask()],
    log:        [{ at: '2026-09-18T20:05:00+02:00', text: 'Review pass started' }],
    ...changes,
  };
}

function exampleTicket(changes: { title?: string; body?: string } = {}): Ticket {
  return {
    frontmatter: {
      id:          '003',
      title:       changes.title ?? 'Split the exporter into two passes',
      type:        'change',
      status:      'in-review',
      filed:       '2026-09-18T20:44:00+02:00',
      updated:     '2026-09-18T21:49:00+02:00',
      started:     '2026-09-18T21:02:00+02:00',
      finished:    '2026-09-18T21:49:00+02:00',
      delivered:   null,
      abandonedAt: null,
      branch:      'ticket/exporter-passes',
      task:        1,
      extra:       [],
    },
    body:     changes.body ?? '## Report\n\nTwo passes are fine.\n',
    filePath: '/example/.agent-progress/tickets/003-exporter.md',
  };
}

function render(overrides: Partial<Parameters<typeof renderProgressHtml>[0]> = {}): string {
  return renderProgressHtml({
    progress:          exampleProgress(),
    tickets:           [exampleTicket()],
    pageScript:        'window.examplePageScript = 1;',
    pageScriptFailure: null,
    generatedAt:       GENERATED_AT,
    concurrency:       { limit: 2, agentsInFlight: 1 },
    ...overrides,
  });
}

/** `[^<]*` rather than a lazy any: every `<` inside an island is escaped, so the real element holds none. */
function islandTextOf(document: string, elementId: string): string {
  const match = new RegExp(`<script type="application/json" id="${elementId}">([^<]*)</script>`).exec(document);
  return match?.[1] ?? '';
}

function lastScriptBodyOf(document: string): string {
  const body = document.slice(document.lastIndexOf('<script>') + '<script>'.length);
  return body.slice(0, body.indexOf('</script>'));
}

function islandContentsOf(document: string, elementId: string): unknown {
  return JSON.parse(islandTextOf(document, elementId)) as unknown;
}

describe('renderProgressHtml', () => {
  test('leaves none of the template’s three tokens standing', () => {
    const document = render();

    expect(document).not.toContain('__PROGRESS__');
    expect(document).not.toContain('__TICKETS__');
    expect(document).not.toContain('__PAGE_SCRIPT__');
  });

  test('leaves the bootstrap’s split spelling of the page-script global untouched', () => {
    expect(render()).toContain('window["__PAGE" + "_SCRIPT__"] = 0;');
  });

  test('substitutes the page script exactly once', () => {
    const document = render({ pageScript: 'window.exampleMarker = "page-script";' });

    expect(document.split('window.exampleMarker').length - 1).toBe(1);
  });

  // A screen reader pairs a tab with its panel only through these ids; the bootstrap selects panels by data-panel, so nothing else would notice a typo.
  test.each([
    ['progress', ''],
    ['tickets', ' hidden'],
  ])('ties the %s tab and its panel to each other by id', (panelName, hiddenAttribute) => {
    const document = render();

    expect(document).toContain('role="tablist"');
    expect(document).toContain(`role="tab" id="ap-tab-${panelName}" aria-controls="ap-panel-${panelName}" data-tab="${panelName}"`);
    expect(document).toContain(`<section data-panel="${panelName}" role="tabpanel" id="ap-panel-${panelName}" aria-labelledby="ap-tab-${panelName}"${hiddenAttribute}>`);
  });

  test('titles the document after the project', () => {
    expect(render()).toContain('<title>Example Agency progress</title>');
    expect(render()).not.toContain('<title>agent-progress</title>');
  });

  test('escapes a project name that would otherwise close the title element', () => {
    const document = render({ progress: exampleProgress({ project: '</title><script>alert(1)</script>' }) });

    expect(document).toContain('<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt; progress</title>');
  });

  test('carries the tracker through the progress island unchanged', () => {
    const payload = islandContentsOf(render(), 'ap-progress-data') as { progress: ProgressFile; pageScriptFailure: string | null };

    expect(payload.progress).toEqual(exampleProgress());
    expect(payload.pageScriptFailure).toBeNull();
  });

  test('stamps the island with the generated time it was handed, never a clock', () => {
    const payload = islandContentsOf(render(), 'ap-progress-data') as { generatedAtEpochMilliseconds: number };

    expect(payload.generatedAtEpochMilliseconds).toBe(GENERATED_AT.getTime());
  });

  test('carries the concurrency figures it was handed, never a count of its own', () => {
    const payload = islandContentsOf(render({ concurrency: { limit: 3, agentsInFlight: 2 } }), 'ap-progress-data') as { concurrency: unknown };

    expect(payload.concurrency).toEqual({ limit: 3, agentsInFlight: 2 });
  });

  test('sends the real constants as the limits, not page-local copies', () => {
    const payload = islandContentsOf(render(), 'ap-progress-data') as { limits: Record<string, unknown> };

    expect(payload.limits['tickStepLadderMinutes']).toEqual([...TICK_STEP_LADDER_MINUTES]);
    expect(payload.limits['maximumTicksPerAxis']).toBe(MAXIMUM_TICKS_PER_AXIS);
    expect(payload.limits['tickCountSafetyBound']).toBe(TICK_COUNT_SAFETY_BOUND);
    expect(payload.limits['clockSliceEnd']).toBe(CLOCK_SLICE_END);
    expect(payload.limits['doneWorkVisibleMilliseconds']).toBe(DONE_WORK_VISIBLE_MILLISECONDS);
  });

  test('carries every ticket’s frontmatter, its path and its rendered body through the tickets island', () => {
    const [ticket] = islandContentsOf(render(), 'ap-tickets-data') as Array<{ id: string; filePath: string; bodyHtml: string }>;

    expect(ticket?.id).toBe('003');
    expect(ticket?.filePath).toBe('/example/.agent-progress/tickets/003-exporter.md');
    expect(ticket?.bodyHtml).toContain('<h2>Report</h2>');
  });

  test('sanitises a ticket body on the way into the island', () => {
    const document = render({ tickets: [exampleTicket({ body: 'a [link](javascript:alert(1)) and <script>alert(2)</script>\n' })] });
    const [ticket] = islandContentsOf(document, 'ap-tickets-data') as Array<{ bodyHtml: string }>;

    expect(ticket?.bodyHtml).not.toContain('javascript:');
    expect(ticket?.bodyHtml).not.toContain('<script');
    expect(ticket?.bodyHtml).toContain('&lt;script&gt;');
  });

  test.each([
    ['a closing script tag', '</script><script>alert(1)</script>'],
    ['an HTML comment opener', 'x <!--<script'],
  ])('neutralises %s in both islands while keeping the value readable', (_description, hostile) => {
    const progress = exampleProgress({ tasks: [exampleTask({ name: hostile })] });
    const document = render({ progress, tickets: [exampleTicket({ title: hostile })] });

    for (const elementId of ['ap-progress-data', 'ap-tickets-data']) {
      expect(islandTextOf(document, elementId)).not.toContain('<');
    }
    expect((islandContentsOf(document, 'ap-progress-data') as { progress: ProgressFile }).progress.tasks[0]?.name).toBe(hostile);
    expect((islandContentsOf(document, 'ap-tickets-data') as Array<{ title: string }>)[0]?.title).toBe(hostile);
  });

  test('escapes a ticket title carrying markup rather than letting it through the island', () => {
    const document = render({ tickets: [exampleTicket({ title: '<b>bold</b>' })] });
    const [ticket] = islandContentsOf(document, 'ap-tickets-data') as Array<{ title: string }>;

    expect(ticket?.title).toBe('<b>bold</b>');
    expect(document).not.toContain('<b>bold</b>');
  });

  test('writes an empty tickets island when there are none', () => {
    expect(islandContentsOf(render({ tickets: [] }), 'ap-tickets-data')).toEqual([]);
  });

  test('injects a banner-only script when the page script could not be built', () => {
    const document = render({ pageScript: null, pageScriptFailure: 'the bundler could not resolve an import' });

    expect(document).toContain('document.getElementById("ap-error")');
    expect(document).toContain('the bundler could not resolve an import');
    expect((islandContentsOf(document, 'ap-progress-data') as { pageScriptFailure: string }).pageScriptFailure)
      .toBe('the bundler could not resolve an import');
  });

  test('neutralises a bundler message that would close the script element', () => {
    const injected = lastScriptBodyOf(render({ pageScript: null, pageScriptFailure: '</script><script>alert(1)</script>' }));

    expect(injected).not.toContain('<');
    expect(injected).toContain('\\u003C/script');
  });
});

describe('substituteTemplateTokens', () => {
  const values = { '__PROGRESS__': '{}', '__TICKETS__': '[]' };

  test('substitutes each token once and leaves the rest of the template byte for byte', () => {
    expect(substituteTemplateTokens('a __PROGRESS__ b __TICKETS__ c', values)).toBe('a {} b [] c');
  });

  test.each([
    ['a token that is gone', 'a __PROGRESS__ b'],
    ['a token that occurs twice', 'a __PROGRESS__ b __TICKETS__ c __TICKETS__'],
  ])('refuses %s as unrepaired', (_description, template) => {
    let status: string | false = false;
    try {
      substituteTemplateTokens(template, values);
    } catch (failure) {
      status = refusalIsOperationRefusal(failure) && failure.status;
    }

    expect(status).toBe('unrepaired');
  });

  test('does not find a token inside the text it just injected', () => {
    const injected = { '__PROGRESS__': '__TICKETS__', '__TICKETS__': 'second' };

    expect(substituteTemplateTokens('__PROGRESS__ / __TICKETS__', injected)).toBe('__TICKETS__ / second');
  });
});
