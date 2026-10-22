/**
 * What `fillSpecPageTemplate` must guarantee about the project name: it heads the page before the page script runs, and a name carrying
 * markup can close neither the title nor the heading it is written into.
 */
import { describe, expect, test } from 'bun:test';

import { deriveSpecSnapshot }   from '../../lib/spec-snapshot/SpecSnapshotDerivation.ts';
import { sourceRepository }     from '../../testing/SpecSnapshotSourceFixtures.ts';
import { fillSpecPageTemplate } from './SpecPageTemplateFill.ts';

const GENERATED_AT = new Date('2026-10-07T09:00:00Z');

function renderFor(project: string): string {
  const snapshot = { ...deriveSpecSnapshot(sourceRepository([]), GENERATED_AT), project };
  return fillSpecPageTemplate({ snapshot, pageScript: 'window.exampleMarker = "page-script";', pageScriptFailure: null });
}

describe('fillSpecPageTemplate', () => {
  test('writes the project name into the heading at render', () => {
    expect(renderFor('Example Storefront')).toContain('<h1 class="ap-title" id="ap-project">Example Storefront</h1>');
  });

  test('escapes a project name that would otherwise close the heading', () => {
    expect(renderFor('</h1><script>alert(1)</script>'))
      .toContain('<h1 class="ap-title" id="ap-project">&lt;/h1&gt;&lt;script&gt;alert(1)&lt;/script&gt;</h1>');
  });

  test('escapes a project name that would otherwise close the title element', () => {
    expect(renderFor('</title><script>alert(1)</script>')).toContain('<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt; spec</title>');
  });
});
