/**
 * An element the page hides through the `hidden` attribute is not rendered, whatever `display` its rules set: the browser's own
 * `[hidden] { display: none }` loses to any author rule declaring `display`, so each such rule needs a `[hidden]` rule over it. The
 * scan collects every element id a page module hides through `DomUtil.setHidden`, `.hidden =` or `toggleAttribute('hidden')`, finds
 * the element in `resources/template.html`, and fails when a rule that can reach the element declares a `display` other than `none`
 * with no `display: none` rule matching the hidden element at a specificity that wins. What matters: the real template and page modules
 * pass with every collected id found in the template; each hiding form is collected; and removing the epic strip's cover fails.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join }                      from 'node:path';
import { describe, expect, test }    from 'bun:test';
import { resourceFilePathOf }        from '../../shared/ResourceFilePath.ts';
import { TEMPLATE_FILE_NAME }        from './constants/TemplateFile.ts';

type PageSource = { path: string, text: string };

type HidingSites = { elementIds: Set<string>, unresolvedSites: string[] };

type StyleRule = { selector: string, display: string, important: boolean, order: number };

type ElementOpeningTag = { tagName: string, attributes: Map<string, string> };

type Specificity = readonly [number, number, number];

type MatchMode = 'reaching' | 'cover';

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

const PAGE_FOLDER = join(import.meta.dir, '..', '..', '..', 'page');

/** `DomUtil.setHidden` itself, whose callers are collected, and the epic column's header cell, reached by a selector and checked by hand. */
const UNRESOLVED_HIDING_SITES = ['page/tickets/TicketsController.ts: epicHeader', 'page/utils/DomUtil.ts: element'];

const SET_HIDDEN_CALL       = /DomUtil\.setHidden\(\s*('[^']*'|\w+)/g;
const HIDDEN_PROPERTY_WRITE = /(\w+)\.hidden\s*=(?!=)/g;
const HIDDEN_TOGGLE_CALL    = /(\w+)\.toggleAttribute\(\s*['"]hidden['"]/g;
const STRING_CONSTANT       = /const\s+([A-Z][A-Z0-9_]*)\s*=\s*'([^']*)'/g;
const COMMENT_PATTERN       = /\/\*[\s\S]*?\*\//g;

function pageSourcesOf(folder: string): PageSource[] {
  const sources: PageSource[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      const path = join(entry.parentPath, entry.name);
      sources.push({ path: `page/${path.slice(folder.length + 1)}`, text: readFileSync(path, 'utf8') });
    }
  }
  return sources;
}

function constantValuesOf(sources: readonly PageSource[]): Map<string, string> {
  const valuesByName = new Map<string, string>();
  for (const source of sources) {
    for (const match of source.text.matchAll(STRING_CONSTANT)) {
      valuesByName.set(match[1] ?? '', match[2] ?? '');
    }
  }
  return valuesByName;
}

function idOfArgument(argument: string, localText: string, constants: ReadonlyMap<string, string>): string | null {
  if (argument.startsWith('\'')) {
    return argument.slice(1, -1);
  }
  const localValue = new RegExp(`const\\s+${argument}\\s*=\\s*'([^']*)'`).exec(localText)?.[1];
  return localValue ?? constants.get(argument) ?? null;
}

/** Follows `const name = document.getElementById(ID)`, its arrow-function form, and `const name = getter()` to the id. */
function idOfVariable(variableName: string, localText: string, constants: ReadonlyMap<string, string>): string | null {
  const lookup = new RegExp(`const\\s+${variableName}\\s*=\\s*(?:\\(\\)[^;\\n]*?)?document\\.getElementById\\(\\s*('[^']*'|\\w+)\\s*\\)`).exec(localText);
  if (lookup?.[1] !== undefined) {
    return idOfArgument(lookup[1], localText, constants);
  }
  const getterCall = new RegExp(`const\\s+${variableName}\\s*=\\s*(\\w+)\\(\\)`).exec(localText);
  return getterCall?.[1] !== undefined && getterCall[1] !== variableName ? idOfVariable(getterCall[1], localText, constants) : null;
}

function hidingSitesOf(sources: readonly PageSource[]): HidingSites {
  const constants                  = constantValuesOf(sources);
  const elementIds                 = new Set<string>();
  const unresolvedSites: string[]  = [];
  for (const source of sources) {
    const text = source.text.replace(COMMENT_PATTERN, ' ');
    for (const match of text.matchAll(SET_HIDDEN_CALL)) {
      const elementId = idOfArgument(match[1] ?? '', text, constants);
      if (elementId === null) {
        unresolvedSites.push(`${source.path}: ${match[1] ?? ''}`);
      } else {
        elementIds.add(elementId);
      }
    }
    for (const match of [...text.matchAll(HIDDEN_PROPERTY_WRITE), ...text.matchAll(HIDDEN_TOGGLE_CALL)]) {
      const elementId = idOfVariable(match[1] ?? '', text, constants);
      if (elementId === null) {
        unresolvedSites.push(`${source.path}: ${match[1] ?? ''}`);
      } else {
        elementIds.add(elementId);
      }
    }
  }
  return { elementIds, unresolvedSites: [...new Set(unresolvedSites)] };
}

function styleRulesOf(templateText: string): StyleRule[] {
  const sheet = [...templateText.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => match[1] ?? '').join('\n').replace(COMMENT_PATTERN, ' ');
  const rules: StyleRule[] = [];
  for (const match of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const displayDeclaration = /(?:^|;)\s*display\s*:\s*([^;]+)/.exec(match[2] ?? '');
    if (displayDeclaration?.[1] === undefined) {
      continue;
    }
    const value = displayDeclaration[1].trim();
    for (const selector of splitOutsideParentheses(match[1] ?? '', /,/)) {
      rules.push({
        selector: selector.trim(), display: value.replace(/\s*!important$/, ''), important: value.endsWith('!important'), order: rules.length
      });
    }
  }
  return rules;
}

function splitOutsideParentheses(text: string, separator: RegExp): string[] {
  const parts: string[] = [];
  let depth             = 0;
  let current           = '';
  for (const character of text) {
    depth += character === '(' ? 1 : character === ')' ? -1 : 0;
    if (depth === 0 && separator.test(character)) {
      parts.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  parts.push(current);
  return parts.filter((part) => part.trim() !== '');
}

function simpleSelectorsOf(compound: string): string[] {
  const simpleSelectors: string[] = [];
  let depth                       = 0;
  let current                     = '';
  for (const character of compound) {
    if (depth === 0 && /[#.[:]/.test(character) && current !== '' && !current.endsWith(':')) {
      simpleSelectors.push(current);
      current = '';
    }
    depth   += character === '(' ? 1 : character === ')' ? -1 : 0;
    current += character;
  }
  simpleSelectors.push(current);
  return simpleSelectors.filter((simpleSelector) => simpleSelector !== '');
}

function specificityOf(selector: string): Specificity {
  let ids     = 0;
  let classes = 0;
  let types   = 0;
  for (const compound of splitOutsideParentheses(selector, /[\s>+~]/)) {
    for (const simpleSelector of simpleSelectorsOf(compound)) {
      if (simpleSelector.startsWith('#')) {
        ids++;
      } else if (simpleSelector.startsWith(':not(') || simpleSelector.startsWith(':has(')) {
        const [innerIds, innerClasses, innerTypes] = specificityOf(simpleSelector.slice(5, -1));
        ids += innerIds;
        classes += innerClasses;
        types += innerTypes;
      } else if (simpleSelector.startsWith('::')) {
        types++;
      } else if (/^[.[:]/.test(simpleSelector)) {
        classes++;
      } else if (simpleSelector !== '*') {
        types++;
      }
    }
  }
  return [ids, classes, types];
}

function specificityIsAtLeast(candidate: Specificity, reference: Specificity): boolean {
  for (let i = 0; i < candidate.length; i++) {
    if ((candidate[i] ?? 0) !== (reference[i] ?? 0)) {
      return (candidate[i] ?? 0) > (reference[i] ?? 0);
    }
  }
  return true;
}

function openingTagFrom(tagName: string, attributeText: string): ElementOpeningTag {
  const attributes = new Map<string, string>();
  for (const attribute of attributeText.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
    attributes.set(attribute[1] ?? '', attribute[2] ?? '');
  }
  return { tagName, attributes };
}

/** The element with that id and its ancestors, outermost first, read from the template's markup; null when no element has the id. */
function elementChainOf(templateText: string, elementId: string): ElementOpeningTag[] | null {
  const markup                       = templateText.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(style|script)[\s\S]*?<\/\1>/g, ' ');
  const openElements: ElementOpeningTag[] = [];
  for (const tag of markup.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*)>/g)) {
    const tagName = tag[2] ?? '';
    if (tag[1] === '/') {
      const openIndex = openElements.findLastIndex((openElement) => openElement.tagName === tagName);
      openElements.length = openIndex < 0 ? openElements.length : openIndex;
      continue;
    }
    const element = openingTagFrom(tagName, tag[3] ?? '');
    if (element.attributes.get('id') === elementId) {
      return [...openElements, element];
    }
    if (!VOID_ELEMENTS.has(tagName) && !(tag[3] ?? '').endsWith('/')) {
      openElements.push(element);
    }
  }
  return null;
}

/**
 * Whether a compound can match the element. An attribute other than `hidden` is page state, so a reaching rule's may match; a cover
 * must name `[hidden]` and match on what the markup holds. A state pseudo-class may match a reaching rule and never makes a cover;
 * `:not([hidden])` and a pseudo-element never style the hidden element itself.
 */
function compoundCanMatch(compound: string, element: ElementOpeningTag, mode: MatchMode): boolean {
  const classes         = new Set((element.attributes.get('class') ?? '').split(/\s+/));
  const simpleSelectors = simpleSelectorsOf(compound);
  return simpleSelectors.every((simpleSelector) => {
    if (simpleSelector.startsWith('#')) {
      return element.attributes.get('id') === simpleSelector.slice(1);
    }
    if (simpleSelector.startsWith('.')) {
      return classes.has(simpleSelector.slice(1));
    }
    if (simpleSelector === '[hidden]') {
      return element.attributes.has('hidden');
    }
    if (simpleSelector.startsWith('[')) {
      const [, name = '', value] = /^\[([\w-]+)(?:[~|^$*]?="?([^"\]]*)"?)?\]$/.exec(simpleSelector) ?? [];
      return mode === 'reaching' || (element.attributes.has(name) && (value === undefined || element.attributes.get(name) === value));
    }
    if (simpleSelector.replace(/\s/g, '') === ':not([hidden])') {
      return !element.attributes.has('hidden');
    }
    if (simpleSelector.startsWith('::')) {
      return false;
    }
    if (simpleSelector.startsWith(':')) {
      return mode === 'reaching';
    }
    return simpleSelector === '*' || simpleSelector === element.tagName;
  });
}

/** Matches right to left: `>` needs the parent, a space any ancestor; a sibling combinator's compound is taken as matching. */
function selectorCanMatch(selector: string, chain: readonly ElementOpeningTag[], mode: MatchMode): boolean {
  const parts   = splitOutsideParentheses(selector.replace(/\s*([>+~])\s*/g, ' $1 '), /\s/);
  const element = chain.at(-1);
  if (element === undefined || !compoundCanMatch(parts.at(-1) ?? '', element, mode)) {
    return false;
  }
  if (mode === 'cover' && !simpleSelectorsOf(parts.at(-1) ?? '').includes('[hidden]')) {
    return false;
  }
  const ancestorsMatch = (partIndex: number, ancestorCount: number): boolean => {
    if (partIndex < 0) {
      return true;
    }
    const combinator = /^[>+~]$/.test(parts[partIndex] ?? '') ? parts[partIndex] : ' ';
    const compound   = parts[combinator === ' ' ? partIndex : partIndex - 1] ?? '';
    const nextIndex  = combinator === ' ' ? partIndex - 1 : partIndex - 2;
    const ancestorMode: MatchMode = 'reaching';
    if (combinator === '+' || combinator === '~') {
      return ancestorsMatch(nextIndex, ancestorCount);
    }
    if (combinator === '>') {
      const parent = chain[ancestorCount - 1];
      return parent !== undefined && compoundCanMatch(compound, parent, ancestorMode) && ancestorsMatch(nextIndex, ancestorCount - 1);
    }
    for (let i = ancestorCount - 1; i >= 0; i--) {
      const ancestor = chain[i];
      if (ancestor !== undefined && compoundCanMatch(compound, ancestor, ancestorMode) && ancestorsMatch(nextIndex, i)) {
        return true;
      }
    }
    return false;
  };
  return ancestorsMatch(parts.length - 2, chain.length - 1);
}

function uncoveredDisplayRulesOf(templateText: string, elementId: string): string[] {
  const chain = elementChainOf(templateText, elementId);
  const element = chain?.at(-1);
  if (chain === null || element === undefined) {
    return [`#${elementId} is not in the template`];
  }
  const hiddenChain = [...chain.slice(0, -1), { tagName: element.tagName, attributes: new Map([...element.attributes, ['hidden', '']]) }];
  const rules       = styleRulesOf(templateText);
  const covers      = rules.filter((rule) => rule.display === 'none' && selectorCanMatch(rule.selector, hiddenChain, 'cover'));
  const reaching    = rules.filter((rule) => rule.display !== 'none' && selectorCanMatch(rule.selector, hiddenChain, 'reaching'));
  return reaching
    .filter((rule) => !covers.some((cover) => (cover.important && !rule.important)
      || (cover.important === rule.important && (cover.order > rule.order
        ? specificityIsAtLeast(specificityOf(cover.selector), specificityOf(rule.selector))
        : !specificityIsAtLeast(specificityOf(rule.selector), specificityOf(cover.selector))))))
    .map((rule) => `#${elementId}: ${rule.selector} { display: ${rule.display} }`);
}

function offencesOf(templateText: string, elementIds: Iterable<string>): string[] {
  return [...elementIds].flatMap((elementId) => uncoveredDisplayRulesOf(templateText, elementId));
}

const templateText = readFileSync(resourceFilePathOf(TEMPLATE_FILE_NAME), 'utf8');

describe('every element the page hides is display: none while hidden', () => {
  test('every element id the page modules hide has a winning [hidden] rule over each display its rules set', () => {
    const { elementIds, unresolvedSites } = hidingSitesOf(pageSourcesOf(PAGE_FOLDER));
    expect(elementIds.size).toBeGreaterThanOrEqual(11);
    expect([...unresolvedSites].sort()).toEqual(UNRESOLVED_HIDING_SITES);
    expect(offencesOf(templateText, elementIds)).toEqual([]);
  });

  test('the epic strip, the Tickets epic filter and the Epics tab are among the ids checked', () => {
    const { elementIds } = hidingSitesOf(pageSourcesOf(PAGE_FOLDER));
    expect([...elementIds]).toEqual(expect.arrayContaining(['ap-kanban-epics', 'ap-ticket-epic-filter', 'ap-tab-epics']));
  });

  test('each hiding form is collected and resolved to its id', () => {
    const planted: PageSource[] = [{
      path: 'page/Planted.ts',
      text: `
        const STRIP_ELEMENT_ID = 'planted-strip';
        DomUtil.setHidden(STRIP_ELEMENT_ID, true);
        DomUtil.setHidden('planted-literal', true);
        const banner = document.getElementById('planted-banner');
        banner.hidden = true;
        const popover = (): HTMLElement | null => document.getElementById('planted-popover');
        const popoverElement = popover();
        popoverElement.hidden = false;
        const note = document.getElementById('planted-note');
        note.toggleAttribute('hidden', true);
        const header = document.querySelector('th');
        header.hidden = true;
      `,
    }];
    const { elementIds, unresolvedSites } = hidingSitesOf(planted);
    expect([...elementIds].sort()).toEqual(['planted-banner', 'planted-literal', 'planted-note', 'planted-popover', 'planted-strip']);
    expect(unresolvedSites).toEqual(['page/Planted.ts: header']);
  });

  test('removing the epic strip cover fails on the strip', () => {
    const uncovered = templateText.replace(/\.ap-epic-strip\[hidden\][^{]*\{[^}]*\}/, '');
    expect(uncovered.length).toBeLessThan(templateText.length);
    expect(offencesOf(uncovered, ['ap-kanban-epics'])).toEqual(['#ap-kanban-epics: .ap-epic-strip { display: flex }']);
  });

  test('a cover earlier in the sheet at a lower specificity loses, and an !important one wins', () => {
    const sheetOf = (rules: string): string => `<style>${rules}</style><div class="x" id="planted" hidden></div>`;
    expect(offencesOf(sheetOf('[hidden] { display: none } .x { display: flex }'), ['planted'])).toEqual(['#planted: .x { display: flex }']);
    expect(offencesOf(sheetOf('.x[hidden] { display: none } .x { display: flex }'), ['planted'])).toEqual([]);
    expect(offencesOf(sheetOf('.x { display: flex } [hidden] { display: none !important }'), ['planted'])).toEqual([]);
    expect(offencesOf(sheetOf('.x:not([hidden]) { display: flex }'), ['planted'])).toEqual([]);
  });

  test('a rule reaches the element only through ancestors the markup gives it', () => {
    const markup = '<div class="outer"><p></p><div class="x" id="planted" hidden></div></div>';
    expect(offencesOf(`<style>.elsewhere .x { display: flex }</style>${markup}`, ['planted'])).toEqual([]);
    expect(offencesOf(`<style>.outer > .x { display: flex }</style>${markup}`, ['planted'])).toEqual(['#planted: .outer > .x { display: flex }']);
  });
});
