/** A feature's `spec.md` and `plan.md` text read into their parsed shapes, or a `malformed` verdict, never a throw. */
import type {
  PlanDocument,
  SpecClarificationAnswer,
  SpecDocument,
  SpecOpenClarification,
  SpecUserStory
} from '../@types/SpecDocument.ts';
import type { SpecKitReading }                                                        from '../@types/SpecKitReading.ts';
import { CLARIFICATIONS_HEADING, NEEDS_CLARIFICATION_MARKER, SECTION_HEADING_PREFIX } from '../constants/SpecKitMarkers.ts';
import { PLAN_TEMPLATE_TITLE, SPEC_TEMPLATE_TITLE }                                   from '../constants/SpecKitTemplateTitles.ts';
import { SpecKitMarkdownUtil }                                                        from './SpecKitMarkdownUtil.ts';

const { capturedTextOf, titledDocumentOf } = SpecKitMarkdownUtil;

const USER_STORY_HEADING            = /^### User Story (?<number>\d+) - (?<title>.+?) \(Priority: P(?<priority>\d+)\)/;
const CREATED_FIELD                 = /^\*\*Created\*\*:\s*(?<text>.*)$/;
const REQUIREMENT_ITEM              = /^\s*[-*]\s+\*\*(?<id>FR-\d+)\*\*/;
const SUCCESS_CRITERION_ITEM        = /^\s*[-*]\s+\*\*(?<id>SC-\d+)\*\*/;
const OPEN_CLARIFICATION            = new RegExp(`\\[${NEEDS_CLARIFICATION_MARKER}:\\s*(?<text>[^\\]]*)\\]`, 'g');
const CLARIFICATION_SESSION_HEADING = /^### Session (?<date>\S+)/;
const CLARIFICATION_ANSWER          = /^\s*-\s+Q:\s*(?<question>.*?)\s*→\s*A:\s*(?<answer>.*)$/;

interface CollectedClarificationSession {
  readonly dateText: string;
  readonly line:     number;
  readonly answers:  SpecClarificationAnswer[];
}

function specReadingOf(text: string): SpecKitReading<SpecDocument> {
  const titled = titledDocumentOf(text, SPEC_TEMPLATE_TITLE, false);
  if (titled.verdict === 'malformed') return titled;

  let createdText: string | null = null;
  let currentSection = '';
  const userStories: SpecUserStory[]                        = [];
  const requirementIds: string[]                            = [];
  const successCriterionIds: string[]                       = [];
  const openClarifications: SpecOpenClarification[]         = [];
  const clarificationSessions: CollectedClarificationSession[] = [];

  for (const { text: lineText, line } of titled.document.lines) {
    if (lineText.startsWith(SECTION_HEADING_PREFIX)) currentSection = lineText.trim();

    const created = CREATED_FIELD.exec(lineText);
    if (created !== null && createdText === null) createdText = capturedTextOf(created, 'text').trim();

    const userStory = USER_STORY_HEADING.exec(lineText);
    if (userStory !== null) {
      userStories.push({
        number:   Number(capturedTextOf(userStory, 'number')),
        title:    capturedTextOf(userStory, 'title'),
        priority: Number(capturedTextOf(userStory, 'priority')),
        line,
      });
    }

    const requirement = REQUIREMENT_ITEM.exec(lineText);
    if (requirement !== null) requirementIds.push(capturedTextOf(requirement, 'id'));
    const successCriterion = SUCCESS_CRITERION_ITEM.exec(lineText);
    if (successCriterion !== null) successCriterionIds.push(capturedTextOf(successCriterion, 'id'));

    for (const marker of lineText.matchAll(OPEN_CLARIFICATION)) openClarifications.push({ text: capturedTextOf(marker, 'text').trim(), line });

    if (currentSection !== CLARIFICATIONS_HEADING) continue;
    const session = CLARIFICATION_SESSION_HEADING.exec(lineText);
    if (session !== null) clarificationSessions.push({ dateText: capturedTextOf(session, 'date'), line, answers: [] });
    const answer      = CLARIFICATION_ANSWER.exec(lineText);
    const openSession = clarificationSessions.at(-1);
    if (answer !== null && openSession !== undefined) {
      openSession.answers.push({ question: capturedTextOf(answer, 'question'), answer: capturedTextOf(answer, 'answer'), line });
    }
  }

  return {
    verdict:  'parsed',
    document: {
      fillState: titled.document.fillState,
      title:     titled.document.title,
      createdText,
      userStories,
      requirementIds,
      successCriterionIds,
      openClarifications,
      clarificationSessions,
    },
  };
}

function planReadingOf(text: string): SpecKitReading<PlanDocument> {
  const titled = titledDocumentOf(text, PLAN_TEMPLATE_TITLE, false);
  if (titled.verdict === 'malformed') return titled;
  const openClarificationCount = titled.document.lines
    .reduce((count, { text: lineText }) => count + lineText.split(NEEDS_CLARIFICATION_MARKER).length - 1, 0);
  return {
    verdict:  'parsed',
    document: { fillState: titled.document.fillState, title: titled.document.title, openClarificationCount },
  };
}

export const SpecFeatureDocumentUtil = { planReadingOf, specReadingOf } as const;
