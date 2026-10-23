/**
 * An element the page hides through the `hidden` attribute is not rendered, whatever `display` its rules set: the browser's own
 * `[hidden] { display: none }` loses to any author rule declaring `display`, so each such rule needs a `[hidden]` rule over it. The
 * scan collects every element id a page module hides through `DomUtil.setHidden`, `.hidden =` or `toggleAttribute('hidden')`, finds
 * the element in the template of each page edition whose entry reaches the module, and fails when a rule that can reach the element
 * declares a `display` other than `none` with no `display: none` rule matching the hidden element at a specificity that wins. The tracker
 * page's modules are checked against `resources/template.html`, the spec page's against `resources/spec-template.html` with the design
 * styles injected as the render injects them, and a module both reach against both. What matters: the real templates and page modules
 * pass with every collected id found in each template; each hiding form is collected; removing the epic strip's cover fails; an id a
 * spec-reached module hides that the spec template lacks fails; and each edition resolves constants from its own modules only.
 * Embedded mode (`page/header/EmbeddedDashboardMode.ts`) hides elements through rules under `html[data-embedded="dashboard"]` the page
 * script adds: each element they hide must lose every other `display` to one, the four header parts must be among them, and the
 * `hidden` covers must still win with those rules added.
 */

import { readFileSync }           from 'node:fs';
import { describe, expect, test } from 'bun:test';
import { resourceFilePathOf }     from '../../shared/ResourceFilePath.ts';
import {
  createImportGraphScanner,
  reachablePathsFrom,
  repositoryRootOfThisCheckout,
  type ImportGraph
} from '../../testing/ImportGraph.ts';
import { designStylesOf }                                                    from './DesignStyleExtraction.ts';
import { PAGE_ENTRY_POINTS }                                                 from './constants/PageEntryPoints.ts';
import { SPEC_TEMPLATE_FILE_NAME, SPEC_TEMPLATE_TOKENS, TEMPLATE_FILE_NAME } from './constants/TemplateFile.ts';

type PageSource = { path: string, text: string };

type HidingSites = { elementIds: Set<string>, unresolvedSites: string[] };

type StyleRule = { selector: string, display: string, important: boolean, order: number, conditional: boolean };

type ElementOpeningTag = { tagName: string, attributes: Map<string, string> };

type Specificity = readonly [number, number, number];

/** A cover names `[hidden]`; an embedded cover holds while the root carries the embedded mark. */
type MatchMode = 'reaching' | 'cover' | 'embedded-cover';

type HidingCause = 'hidden-attribute' | 'embedded-dashboard';

const EMBEDDED_DASHBOARD_MARK = '[data-embedded="dashboard"]';

const EMBEDDED_MODE_MODULE_PATH = 'page/header/EmbeddedDashboardMode.ts';

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

const SCANNER = createImportGraphScanner(repositoryRootOfThisCheckout());

const TRACKER_ENTRY_PATH = PAGE_ENTRY_POINTS.TRACKER.join('/');

const SPEC_ENTRY_PATH = PAGE_ENTRY_POINTS.SPEC.join('/');

/**
 * `DomUtil.setHidden` and `PageShell.showTabButton` themselves, whose callers are collected, and the epic column's header cell, reached by a
 * selector and checked by hand.
 */
const UNRESOLVED_HIDING_SITES = ['page/shell/PageShell.ts: tabElement', 'page/tickets/TicketsController.ts: epicHeader', 'page/utils/DomUtil.ts: element'];

const SPEC_UNRESOLVED_HIDING_SITES = ['page/shell/PageShell.ts: tabElement', 'page/utils/DomUtil.ts: element'];

/** `DomUtil.setHidden` and `PageShell.showTabButton` hide the element their first argument names, so their callers are collected. */
const SET_HIDDEN_CALL       = /(?:DomUtil\.setHidden|(?<!function )\bshowTabButton)\(\s*('[^']*'|\w+)/g;
const HIDDEN_PROPERTY_WRITE = /(\w+)\.hidden\s*=(?!=)/g;
const HIDDEN_TOGGLE_CALL    = /(\w+)\.toggleAttribute\(\s*['"]hidden['"]/g;
const STRING_CONSTANT       = /const\s+([A-Z][A-Z0-9_]*)\s*=\s*'([^']*)'/g;
const COMMENT_PATTERN       = /\/\*[\s\S]*?\*\//g;

function pageSourcesReachedFrom(graph: ImportGraph, entryPath: string): PageSource[] {
  return [...reachablePathsFrom(graph, [entryPath])]
    .filter((path) => path.startsWith('page/'))
    .sort()
    .map((path) => ({ path, text: graph.sourceTextOf(path) }));
}

/** The graph with a line appended to a real module, in memory. */
function graphWithAppendedLine(modulePath: string, line: string): ImportGraph {
  return SCANNER.graphWithPlantedFiles({ [modulePath]: `${SCANNER.graph.sourceTextOf(modulePath)}\n${line}\n` });
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
    const value        = displayDeclaration[1].trim();
    const textBefore   = sheet.slice(0, match.index);
    const conditional  = textBefore.split('{').length > textBefore.split('}').length;
    for (const selector of splitOutsideParentheses(match[1] ?? '', /,/)) {
      rules.push({
        selector: selector.trim(), display: value.replace(/\s*!important$/, ''), important: value.endsWith('!important'), order: rules.length, conditional
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
    const ancestorMode = mode;
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

function withAttribute(element: ElementOpeningTag, name: string, value: string): ElementOpeningTag {
  return { tagName: element.tagName, attributes: new Map([...element.attributes, [name, value]]) };
}

/** The chain as it stands while hidden: the element carrying `hidden`, or the root carrying the embedded mark. */
function chainHiddenBy(chain: readonly ElementOpeningTag[], element: ElementOpeningTag, cause: HidingCause): ElementOpeningTag[] {
  const root = chain[0];
  if (cause === 'hidden-attribute' || root === undefined) {
    return [...chain.slice(0, -1), withAttribute(element, 'hidden', '')];
  }
  return [withAttribute(root, 'data-embedded', 'dashboard'), ...chain.slice(1)];
}

function coversElement(rule: StyleRule, hiddenChain: readonly ElementOpeningTag[], cause: HidingCause): boolean {
  if (rule.display !== 'none' || rule.conditional) {
    return false;
  }
  return cause === 'hidden-attribute'
    ? selectorCanMatch(rule.selector, hiddenChain, 'cover')
    : rule.selector.includes(EMBEDDED_DASHBOARD_MARK) && selectorCanMatch(rule.selector, hiddenChain, 'embedded-cover');
}

function uncoveredDisplayRulesOf(templateText: string, elementId: string, cause: HidingCause): string[] {
  const chain = elementChainOf(templateText, elementId);
  const element = chain?.at(-1);
  if (chain === null || element === undefined) {
    return [`#${elementId} is not in the template`];
  }
  const hiddenChain = chainHiddenBy(chain, element, cause);
  const rules       = styleRulesOf(templateText);
  const covers      = rules.filter((rule) => coversElement(rule, hiddenChain, cause));
  const reaching    = rules.filter((rule) => rule.display !== 'none' && selectorCanMatch(rule.selector, hiddenChain, 'reaching'));
  return reaching
    .filter((rule) => !covers.some((cover) => (cover.important && !rule.important)
      || (cover.important === rule.important && (cover.order > rule.order
        ? specificityIsAtLeast(specificityOf(cover.selector), specificityOf(rule.selector))
        : !specificityIsAtLeast(specificityOf(rule.selector), specificityOf(cover.selector))))))
    .map((rule) => `#${elementId}: ${rule.selector} { display: ${rule.display} }`);
}

function offencesOf(templateText: string, elementIds: Iterable<string>, cause: HidingCause = 'hidden-attribute'): string[] {
  return [...elementIds].flatMap((elementId) => uncoveredDisplayRulesOf(templateText, elementId, cause));
}

function embeddedStylesOf(graph: ImportGraph): string {
  return /EMBEDDED_DASHBOARD_STYLES\s*=\s*`([^`]*)`/.exec(graph.sourceTextOf(EMBEDDED_MODE_MODULE_PATH))?.[1] ?? '';
}

/** The template as the page script leaves it in embedded mode: the root marked and the embedded styles appended to the head. */
function templateWithEmbeddedStyles(templateSource: string, embeddedStyles: string): string {
  return templateSource
    .replace('<html lang="en">', '<html lang="en" data-embedded="dashboard">')
    .replace('</head>', () => `<style>${embeddedStyles}</style>\n</head>`);
}

/** The ids whose own rule hides them in embedded mode, read from the embedded styles. */
function embeddedHiddenIdsOf(embeddedStyles: string): string[] {
  return styleRulesOf(`<style>${embeddedStyles}</style>`)
    .filter((rule) => rule.display === 'none' && rule.selector.includes(EMBEDDED_DASHBOARD_MARK))
    .map((rule) => /#([\w-]+)$/.exec(rule.selector)?.[1])
    .filter((elementId) => elementId !== undefined)
    .sort();
}

const templateText = readFileSync(resourceFilePathOf(TEMPLATE_FILE_NAME), 'utf8');

const rawSpecTemplateText = readFileSync(resourceFilePathOf(SPEC_TEMPLATE_FILE_NAME), 'utf8');

/** The spec template's design rules arrive only at render, so the guard reads it with them injected through the render's own extraction. */
const specTemplateText = rawSpecTemplateText.replace(SPEC_TEMPLATE_TOKENS.DESIGN_STYLES, () => designStylesOf(templateText, `resources/${TEMPLATE_FILE_NAME}`));

describe('every element the page hides is display: none while hidden', () => {
  test('every element id the page modules hide has a winning [hidden] rule over each display its rules set', () => {
    const { elementIds, unresolvedSites } = hidingSitesOf(pageSourcesReachedFrom(SCANNER.graph, TRACKER_ENTRY_PATH));
    expect(elementIds.size).toBeGreaterThanOrEqual(11);
    expect([...unresolvedSites].sort()).toEqual(UNRESOLVED_HIDING_SITES);
    expect(offencesOf(templateText, elementIds)).toEqual([]);
  });

  test('the epic strip, the Tickets epic filter, the Epics tab and the Dependencies tab are among the ids checked', () => {
    const { elementIds } = hidingSitesOf(pageSourcesReachedFrom(SCANNER.graph, TRACKER_ENTRY_PATH));
    expect([...elementIds]).toEqual(expect.arrayContaining(['ap-kanban-epics', 'ap-ticket-epic-filter', 'ap-tab-epics', 'ap-tab-dependencies']));
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

  test('a cover that holds only under a page state or a media query does not count', () => {
    const markup = '<div class="outer"><div class="x" id="planted" hidden></div></div>';
    expect(offencesOf(`<style>.x { display: flex } .outer:hover .x[hidden] { display: none }</style>${markup}`, ['planted']))
      .toEqual(['#planted: .x { display: flex }']);
    expect(offencesOf(`<style>.x { display: flex } @media (min-width: 1px) { .x[hidden] { display: none } }</style>${markup}`, ['planted']))
      .toEqual(['#planted: .x { display: flex }']);
  });

  test('a rule reaches the element only through ancestors the markup gives it', () => {
    const markup = '<div class="outer"><p></p><div class="x" id="planted" hidden></div></div>';
    expect(offencesOf(`<style>.elsewhere .x { display: flex }</style>${markup}`, ['planted'])).toEqual([]);
    expect(offencesOf(`<style>.outer > .x { display: flex }</style>${markup}`, ['planted'])).toEqual(['#planted: .outer > .x { display: flex }']);
  });
});

describe('every element the spec page hides is display: none while hidden in the spec template', () => {
  test('the spec template is read with the design rules injected', () => {
    expect(styleRulesOf(specTemplateText).length).toBeGreaterThan(styleRulesOf(rawSpecTemplateText).length);
    expect(specTemplateText).not.toContain(SPEC_TEMPLATE_TOKENS.DESIGN_STYLES);
  });

  test('every element id the spec page modules hide has a winning [hidden] rule in the spec template', () => {
    const { elementIds, unresolvedSites } = hidingSitesOf(pageSourcesReachedFrom(SCANNER.graph, SPEC_ENTRY_PATH));
    expect([...elementIds]).toContain('ap-error');
    expect([...unresolvedSites].sort()).toEqual(SPEC_UNRESOLVED_HIDING_SITES);
    expect(offencesOf(specTemplateText, elementIds)).toEqual([]);
  });

  test('a module both entries reach is checked against both templates, so an id only the tracker template holds fails the spec page', () => {
    const sharedModulePath = 'page/shell/PageShell.ts';
    const planted          = graphWithAppendedLine(sharedModulePath, 'DomUtil.setHidden(\'ap-kanban-epics\', true);');
    const trackerSources   = pageSourcesReachedFrom(planted, TRACKER_ENTRY_PATH);
    const specSources      = pageSourcesReachedFrom(planted, SPEC_ENTRY_PATH);
    expect(trackerSources.map((source) => source.path)).toContain(sharedModulePath);
    expect(specSources.map((source) => source.path)).toContain(sharedModulePath);
    expect(offencesOf(templateText, hidingSitesOf(trackerSources).elementIds)).toEqual([]);
    expect(offencesOf(specTemplateText, hidingSitesOf(specSources).elementIds)).toEqual(['#ap-kanban-epics is not in the template']);
  });

  test('an id the spec entry itself hides that the spec template lacks fails', () => {
    const planted = graphWithAppendedLine(SPEC_ENTRY_PATH, 'DomUtil.setHidden(\'ap-planted-missing\', true);');
    expect(offencesOf(specTemplateText, hidingSitesOf(pageSourcesReachedFrom(planted, SPEC_ENTRY_PATH)).elementIds))
      .toEqual(['#ap-planted-missing is not in the template']);
  });

  test('each edition resolves a constant only from the modules its entry reaches', () => {
    const withTrackerConstant = SCANNER.graphWithPlantedFiles({
      'page/kanban/KanbanMarkup.ts': `${SCANNER.graph.sourceTextOf('page/kanban/KanbanMarkup.ts')}\nconst PLANTED_ELEMENT_ID = 'ap-error';\n`,
      [SPEC_ENTRY_PATH]:             `${SCANNER.graph.sourceTextOf(SPEC_ENTRY_PATH)}\nDomUtil.setHidden(PLANTED_ELEMENT_ID, true);\n`,
    });
    expect(hidingSitesOf(pageSourcesReachedFrom(withTrackerConstant, SPEC_ENTRY_PATH)).unresolvedSites.sort())
      .toEqual([...SPEC_UNRESOLVED_HIDING_SITES, `${SPEC_ENTRY_PATH}: PLANTED_ELEMENT_ID`].sort());
  });
});

describe('every element embedded mode hides is display: none in embedded mode', () => {
  const embeddedStyles       = embeddedStylesOf(SCANNER.graph);
  const embeddedTemplateText = templateWithEmbeddedStyles(templateText, embeddedStyles);

  test('the embedded styles are read from the module the tracker entry reaches', () => {
    expect(pageSourcesReachedFrom(SCANNER.graph, TRACKER_ENTRY_PATH).map((source) => source.path)).toContain(EMBEDDED_MODE_MODULE_PATH);
    expect(styleRulesOf(embeddedTemplateText).length).toBeGreaterThan(styleRulesOf(templateText).length);
  });

  test('the status line, the project title, the statistics and the theme switch are the elements it hides', () => {
    expect(embeddedHiddenIdsOf(embeddedStyles)).toEqual(['ap-project', 'ap-status', 'ap-summary', 'ap-theme']);
  });

  test('each element it hides has a winning embedded rule over each display its rules set', () => {
    expect(offencesOf(embeddedTemplateText, embeddedHiddenIdsOf(embeddedStyles), 'embedded-dashboard')).toEqual([]);
  });

  test('every element the page hides through hidden stays covered with the embedded styles added', () => {
    const { elementIds } = hidingSitesOf(pageSourcesReachedFrom(SCANNER.graph, TRACKER_ENTRY_PATH));
    expect(offencesOf(embeddedTemplateText, elementIds)).toEqual([]);
  });

  test('removing the theme switch rule fails on the theme switch, and the activity banner hidden cover on the banner', () => {
    const withoutThemeRule = templateWithEmbeddedStyles(templateText, embeddedStyles.replace(/^.*#ap-theme \{ display: none; \}$/m, ''));
    expect(offencesOf(withoutThemeRule, ['ap-theme'], 'embedded-dashboard')).toEqual(['#ap-theme: .ap-theme { display: flex }']);
    const withoutBannerCover = templateWithEmbeddedStyles(templateText, embeddedStyles.replace(/^.*\.ap-activity\[hidden\].*$/m, ''));
    expect(offencesOf(withoutBannerCover, ['ap-activity'])).toEqual(['#ap-activity: html[data-embedded="dashboard"] .ap-activity { display: flex }']);
  });

  test('a rule under the embedded mark covers only while the root carries it', () => {
    const markup = '<html><div class="x" id="planted"></div></html>';
    const sheet  = `<style>.x { display: flex } html${EMBEDDED_DASHBOARD_MARK} #planted { display: none }</style>`;
    expect(offencesOf(`${sheet}${markup}`, ['planted'], 'embedded-dashboard')).toEqual([]);
    expect(offencesOf(`<style>.x { display: flex } html[data-embedded="sidebar"] #planted { display: none }</style>${markup}`, ['planted'], 'embedded-dashboard'))
      .toEqual(['#planted: .x { display: flex }']);
  });
});
