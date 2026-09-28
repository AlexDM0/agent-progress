/**
 * Every colour in the page is a token: a colour literal (a colour function, a hex colour or a named colour) appears in
 * `resources/template.html` only as a custom property's value in a token block, which is `:root`, the dark theme's
 * `:root[data-theme="dark"]`, or a `[data-state]` block and its dark twin. Every other declaration, markup attribute and page module
 * reaches a colour through `var(--…)`. What matters: the real template and page modules pass; the scan recognises token definitions in
 * each block form and style fragments in the page, so a scan that finds nothing cannot pass; and a planted literal of every form the
 * guard claims is caught on its own line.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative }            from 'node:path';
import { describe, expect, test }    from 'bun:test';
import { resourceFilePathOf }        from '../../shared/ResourceFilePath.ts';
import { TEMPLATE_FILE_NAME }        from './constants/TemplateFile.ts';

type ColourOffence = { line: number, text: string };

type TokenBlockForm = 'root' | 'dark-root' | 'state' | 'dark-state';

type TemplateColourScan = { offences: ColourOffence[], tokenDefinitionsByBlockForm: Record<TokenBlockForm, number> };

type PageModuleColourScan = { offences: ColourOffence[], styleFragmentCount: number };

const PAGE_FOLDER = join(import.meta.dir, '..', '..', '..', 'page');

const TOKEN_BLOCK_SELECTORS: Record<TokenBlockForm, RegExp> = {
  'root':       /^:root$/,
  'dark-root':  /^:root\[data-theme="dark"\]$/,
  'state':      /^\[data-state="[a-z-]+"\]$/,
  'dark-state': /^:root\[data-theme="dark"\] \[data-state="[a-z-]+"\]$/,
};

const COLOUR_FUNCTION_PATTERN = /\b(?:oklch|oklab|lch|lab|rgba?|hsla?|hwb|color)\(/i;
const HEX_COLOUR_PATTERN      = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/i;
const HEX_COLOUR_IN_VALUE     = /[:,(]\s*#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/i;
const IDENTIFIER_PATTERN      = /(?<![-\w#.$])[a-z]+(?![-\w(])/gi;
const COMMENT_PATTERN         = /\/\*[\s\S]*?\*\//g;
const STRING_PATTERN          = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;
const INTERPOLATION_PATTERN   = /\$\{[^}]*\}/g;
const MARKUP_COLOUR_ATTRIBUTE = /\s(?:fill|stroke|color|stop-color|style)="([^"]*)"/g;
const PAGE_STYLE_FRAGMENTS    = [/style="([^"]*)"/g, /\.style\.\w+\s*=\s*['"`]([^'"`]*)['"`]/g, /\.setProperty\([^,]+,\s*['"`]([^'"`]*)['"`]/g];

/** The CSS named colours and system colours; `transparent`, `currentColor` and `inherit` are deliberately absent. */
const NAMED_COLOURS = new Set(`
  aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse
  chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta
  darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet
  deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green
  greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral
  lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray
  lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple
  mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite
  navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink
  plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue
  slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow
  yellowgreen
  accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext field fieldtext graytext highlight
  highlighttext linktext mark marktext selecteditem selecteditemtext visitedtext
`.trim().split(/\s+/));

function blankedKeepingLines(match: string): string {
  return match.replace(/[^\n]/g, ' ');
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

function valueHoldsColourLiteral(value: string): boolean {
  const valueWithoutStrings = value.replace(STRING_PATTERN, ' ');
  if (COLOUR_FUNCTION_PATTERN.test(valueWithoutStrings) || HEX_COLOUR_PATTERN.test(valueWithoutStrings)) {
    return true;
  }
  return (valueWithoutStrings.match(IDENTIFIER_PATTERN) ?? []).some((identifier) => NAMED_COLOURS.has(identifier.toLowerCase()));
}

function tokenBlockFormOf(selectorList: string): TokenBlockForm | null {
  const selectors = selectorList.split(',').map((selector) => selector.trim().replace(/\s+/g, ' '));
  const forms     = Object.keys(TOKEN_BLOCK_SELECTORS) as TokenBlockForm[];
  for (const form of forms) {
    if (selectors.every((selector) => TOKEN_BLOCK_SELECTORS[form].test(selector))) {
      return form;
    }
  }
  return null;
}

/** The template with everything but its style sheets' rules blanked, so an index still gives the template's own line. */
function styleSheetTextOf(templateText: string): string {
  const pieces = templateText.split(/(<style>[\s\S]*?<\/style>)/);
  return pieces
    .map((piece) => (piece.startsWith('<style>') ? piece.replace(COMMENT_PATTERN, blankedKeepingLines).replace(/<\/?style>/g, blankedKeepingLines) : blankedKeepingLines(piece)))
    .join('');
}

function markupTextOf(templateText: string): string {
  return templateText.replace(/<(style|script)[\s\S]*?<\/\1>/g, blankedKeepingLines).replace(/<!--[\s\S]*?-->/g, blankedKeepingLines);
}

function scanTemplateColours(templateText: string): TemplateColourScan {
  const sheet                       = styleSheetTextOf(templateText);
  const offences: ColourOffence[]   = [];
  const tokenDefinitionsByBlockForm = {
    'root': 0, 'dark-root': 0, 'state': 0, 'dark-state': 0
  };
  const openBlocks: { prelude: string, bodyStart: number, holdsNestedBlock: boolean }[] = [];
  let preludeStart = 0;
  for (let i = 0; i < sheet.length; i++) {
    if (sheet[i] === '{') {
      const parentBlock = openBlocks.at(-1);
      if (parentBlock) {
        parentBlock.holdsNestedBlock = true;
      }
      openBlocks.push({ prelude: sheet.slice(preludeStart, i), bodyStart: i + 1, holdsNestedBlock: false });
      preludeStart = i + 1;
    } else if (sheet[i] === '}') {
      const closedBlock = openBlocks.pop();
      preludeStart = i + 1;
      if (!closedBlock || closedBlock.holdsNestedBlock) {
        continue;
      }
      const tokenBlockForm = tokenBlockFormOf(closedBlock.prelude);
      let declarationStart = closedBlock.bodyStart;
      for (const declaration of sheet.slice(closedBlock.bodyStart, i).split(';')) {
        const colonIndex = declaration.indexOf(':');
        const property   = declaration.slice(0, colonIndex).trim();
        const value      = declaration.slice(colonIndex + 1);
        if (colonIndex >= 0 && valueHoldsColourLiteral(value)) {
          if (tokenBlockForm && property.startsWith('--')) {
            tokenDefinitionsByBlockForm[tokenBlockForm]++;
          } else {
            const leadingSpace = declaration.length - declaration.trimStart().length;
            offences.push({ line: lineAt(sheet, declarationStart + leadingSpace), text: declaration.trim() });
          }
        }
        declarationStart += declaration.length + 1;
      }
    } else if (sheet[i] === ';' && openBlocks.length === 0) {
      preludeStart = i + 1;
    }
  }
  const markup = markupTextOf(templateText);
  for (const attribute of markup.matchAll(MARKUP_COLOUR_ATTRIBUTE)) {
    if (valueHoldsColourLiteral(attribute[1] ?? '')) {
      offences.push({ line: lineAt(markup, attribute.index), text: attribute[0].trim() });
    }
  }
  return { offences, tokenDefinitionsByBlockForm };
}

function scanPageModuleColours(moduleText: string): PageModuleColourScan {
  const code                      = moduleText.replace(COMMENT_PATTERN, blankedKeepingLines).replace(/^\s*\/\/.*$/gm, blankedKeepingLines);
  const offences: ColourOffence[] = [];
  let styleFragmentCount = 0;
  code.split('\n').forEach((lineText, lineIndex) => {
    if (COLOUR_FUNCTION_PATTERN.test(lineText) || HEX_COLOUR_IN_VALUE.test(lineText)) {
      offences.push({ line: lineIndex + 1, text: lineText.trim() });
    }
  });
  for (const fragmentPattern of PAGE_STYLE_FRAGMENTS) {
    for (const fragment of code.matchAll(fragmentPattern)) {
      styleFragmentCount++;
      const line = lineAt(code, fragment.index);
      if (valueHoldsColourLiteral((fragment[1] ?? '').replace(INTERPOLATION_PATTERN, ' ')) && !offences.some((offence) => offence.line === line)) {
        offences.push({ line, text: fragment[0] });
      }
    }
  }
  return { offences, styleFragmentCount };
}

function shippingPageModulePaths(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(folder, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'testing' ? [] : shippingPageModulePaths(entryPath);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [entryPath] : [];
  });
}

function templateText(): string {
  return readFileSync(resourceFilePathOf(TEMPLATE_FILE_NAME), 'utf8');
}

function withPlantedLines(text: string, anchor: string, plantedLines: string): { text: string, plantedLine: number } {
  const anchorIndex = text.lastIndexOf(anchor);
  return { text: `${text.slice(0, anchorIndex)}${plantedLines}\n${text.slice(anchorIndex)}`, plantedLine: lineAt(text, anchorIndex) };
}

describe('the template', () => {
  test('holds no colour literal outside a token block\'s custom properties, in its rules or its markup', () => {
    expect(scanTemplateColours(templateText()).offences).toEqual([]);
  });

  const recognisedDefinitions = scanTemplateColours(templateText()).tokenDefinitionsByBlockForm;
  const recognisedTotal       = Object.values(recognisedDefinitions).reduce((sum, count) => sum + count, 0);

  test(`recognises ${recognisedTotal} token definitions, some in each of :root, the dark theme and both kinds of per-state block`, () => {
    expect(recognisedTotal).toBeGreaterThan(0);
    expect(Object.entries(recognisedDefinitions).filter(([, count]) => count === 0)).toEqual([]);
  });

  const plantedDeclarations: [string, string][] = [
    ['an oklch colour',                         '.ap-planted { color: oklch(0.5 0.1 250); }'],
    ['a hex colour',                            '.ap-planted { border-color: #1a2b3c; }'],
    ['an rgb colour',                           '.ap-planted { background: rgb(10 20 30); }'],
    ['an hsl colour',                           '.ap-planted { outline-color: hsl(200 50% 50%); }'],
    ['a named colour',                          '.ap-planted { color: rebeccapurple; }'],
    ['a colour inside a gradient',              '.ap-planted { background-image: linear-gradient(90deg, var(--line), white); }'],
    ['a colour inside a shadow',                '.ap-planted { box-shadow: 0 1px 2px oklch(0 0 0 / 0.1); }'],
    ['a colour inside color-mix()',             '.ap-planted { color: color-mix(in oklch, var(--ink), #000 20%); }'],
    ['a literal token outside a token block',   '.ap-planted { --planted-tint: oklch(0.9 0.02 250); }'],
    ['a literal in a token block\'s own rule',  ':root { accent-color: oklch(0.5 0.1 250); }'],
  ];

  test.each(plantedDeclarations)('fails on %s planted in a rule, naming its line', (_formName, plantedRule) => {
    const planted = withPlantedLines(templateText(), '</style>', plantedRule);
    expect(scanTemplateColours(planted.text).offences.map((offence) => offence.line)).toEqual([planted.plantedLine]);
  });

  test('fails on a colour literal planted in a markup attribute, naming its line', () => {
    const planted = withPlantedLines(templateText(), '</body>', '<svg viewBox="0 0 4 4"><circle cx="2" cy="2" r="2" fill="#123456"/></svg>');
    expect(scanTemplateColours(planted.text).offences.map((offence) => offence.line)).toEqual([planted.plantedLine]);
  });
});

describe('the page modules', () => {
  test('emit no colour literal in their markup or styles', () => {
    const modulePaths = shippingPageModulePaths(PAGE_FOLDER);
    const scans       = modulePaths.map((modulePath) => ({ modulePath, scan: scanPageModuleColours(readFileSync(modulePath, 'utf8')) }));
    const offences    = scans.flatMap(({ modulePath, scan }) => scan.offences.map((offence) => `${relative(PAGE_FOLDER, modulePath)}:${offence.line} ${offence.text}`));
    expect(offences).toEqual([]);
    expect(modulePaths.length).toBeGreaterThan(0);
    expect(scans.reduce((sum, { scan }) => sum + scan.styleFragmentCount, 0)).toBeGreaterThan(0);
  });

  const plantedModuleLines: [string, string][] = [
    ['a hex colour in a style attribute',        'const plantedMarkup = `<div style="left:${left};color:#fff"></div>`;'],
    ['a named colour in a style attribute',      'const plantedMarkup = `<div style="background:red"></div>`;'],
    ['a colour function anywhere in the code',   'const plantedFill = `oklch(0.5 0.1 ${hue})`;'],
    ['a colour set through setProperty',         'element.style.setProperty(\'--planted\', \'rgb(0 0 0)\');'],
    ['a named colour assigned to a style',       'element.style.borderColor = \'silver\';'],
  ];

  test.each(plantedModuleLines)('fail on %s, naming its line', (_formName, plantedLine) => {
    const moduleText = `export const unrelated = 1;\n${plantedLine}\n`;
    expect(scanPageModuleColours(moduleText).offences.map((offence) => offence.line)).toEqual([2]);
  });
});
