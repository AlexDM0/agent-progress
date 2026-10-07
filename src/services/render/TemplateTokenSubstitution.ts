import { OperationRefusal } from '../../shared/OperationRefusal.ts';

const REGULAR_EXPRESSION_SPECIAL_CHARACTERS = /[.*+?^${}()|[\]\\]/g;

/** A template under `resources/` and every placeholder it holds, named by the path a refusal reports. */
export interface TemplateDescription {
  templateFilePath: string;
  tokens:           readonly string[];
}

/** Splitting on every token at once keeps injected content out of the search: a task named `__TICKETS__` would be found by a later replacement. */
function templateTokenPattern(tokens: readonly string[]): RegExp {
  const alternatives = tokens.map((token) => token.replace(REGULAR_EXPRESSION_SPECIAL_CHARACTERS, '\\$&'));
  return new RegExp(`(${alternatives.join('|')})`);
}

/** Refuses, as unrepaired, a template in which any token of `values` does not occur exactly once. */
export function substituteTemplateTokens(template: string, description: TemplateDescription, values: Readonly<Record<string, string>>): string {
  const pieces = template.split(templateTokenPattern(description.tokens));
  for (const token of Object.keys(values)) {
    const occurrences = pieces.filter((piece) => piece === token).length;
    if (occurrences !== 1) {
      throw new OperationRefusal('unrepaired', {
        kind:             'template-token-not-unique',
        templateFilePath: description.templateFilePath,
        token,
        occurrenceCount:  occurrences,
      });
    }
  }
  return pieces.map((piece) => (Object.hasOwn(values, piece) ? values[piece] ?? '' : piece)).join('');
}
