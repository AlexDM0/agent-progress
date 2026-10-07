/** The project memory spec-kit keeps under `.specify/`: the constitution and the init options, read or a `malformed` verdict, never a throw. */
import type { ConstitutionDocument, InitOptionsDocument } from '../@types/ConstitutionDocument.ts';
import type { SpecKitReading }                            from '../@types/SpecKitReading.ts';
import {
  CORE_PRINCIPLES_HEADING,
  SECTION_HEADING_PREFIX,
  SPECKIT_VERSION_KEY,
  SUBSECTION_HEADING_PREFIX
} from '../constants/SpecKitMarkers.ts';
import { CONSTITUTION_TEMPLATE_TITLE } from '../constants/SpecKitTemplateTitles.ts';
import { SpecKitMarkdownUtil }         from './SpecKitMarkdownUtil.ts';

const { binaryContentLineOf, capturedTextOf, titledDocumentOf } = SpecKitMarkdownUtil;

const CONSTITUTION_FOOTER = /\*\*Version\*\*:\s*(?<version>.+?)\s*\|\s*\*\*Ratified\*\*:\s*(?<ratified>.+?)\s*\|\s*\*\*Last Amended\*\*:\s*(?<amended>.+?)\s*$/;
const WHOLE_FILE_LINE     = 1;

function constitutionReadingOf(text: string): SpecKitReading<ConstitutionDocument> {
  const titled = titledDocumentOf(text, CONSTITUTION_TEMPLATE_TITLE, false);
  if (titled.verdict === 'malformed') return titled;

  let currentSection = '';
  let footer: RegExpExecArray | null = null;
  const principleNames: string[] = [];
  for (const { text: lineText } of titled.document.lines) {
    if (lineText.startsWith(SECTION_HEADING_PREFIX)) currentSection = lineText.trim();
    if (currentSection === CORE_PRINCIPLES_HEADING && lineText.startsWith(SUBSECTION_HEADING_PREFIX)) {
      principleNames.push(lineText.slice(SUBSECTION_HEADING_PREFIX.length).trim());
    }
    footer = CONSTITUTION_FOOTER.exec(lineText) ?? footer;
  }

  return {
    verdict:  'parsed',
    document: {
      fillState:       titled.document.fillState,
      title:           titled.document.title,
      version:         footer === null ? null : capturedTextOf(footer, 'version'),
      ratifiedDate:    footer === null ? null : capturedTextOf(footer, 'ratified'),
      lastAmendedDate: footer === null ? null : capturedTextOf(footer, 'amended'),
      principleNames,
    },
  };
}

function initOptionsReadingOf(text: string): SpecKitReading<InitOptionsDocument> {
  const binaryLine = binaryContentLineOf(text);
  if (binaryLine !== null) return { verdict: 'malformed', reason: 'the file holds binary content, not JSON text', line: binaryLine };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (problem) {
    return { verdict: 'malformed', reason: `the file is not JSON: ${String(problem)}`, line: WHOLE_FILE_LINE };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { verdict: 'malformed', reason: 'the file does not hold a JSON object', line: WHOLE_FILE_LINE };
  }
  const speckitVersion: unknown = Object.hasOwn(parsed, SPECKIT_VERSION_KEY) ? (parsed as Record<string, unknown>)[SPECKIT_VERSION_KEY] : undefined;
  if (typeof speckitVersion !== 'string') {
    return { verdict: 'malformed', reason: `the object has no \`${SPECKIT_VERSION_KEY}\` text`, line: WHOLE_FILE_LINE };
  }
  return { verdict: 'parsed', document: { speckitVersion } };
}

export const SpecKitMemoryUtil = { constitutionReadingOf, initOptionsReadingOf } as const;
