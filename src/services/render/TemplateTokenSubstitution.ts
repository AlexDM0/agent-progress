import { OperationRefusal }                    from '../../shared/OperationRefusal.ts';
import { TEMPLATE_FILE_NAME, TEMPLATE_TOKENS } from './constants/TemplateFile.ts';

const REGULAR_EXPRESSION_SPECIAL_CHARACTERS = /[.*+?^${}()|[\]\\]/g;

/** Splitting on every token at once keeps injected content out of the search: a task named `__TICKETS__` would be found by a later replacement. */
function templateTokenPattern(): RegExp {
  const alternatives = Object.values(TEMPLATE_TOKENS).map((token) => token.replace(REGULAR_EXPRESSION_SPECIAL_CHARACTERS, '\\$&'));
  return new RegExp(`(${alternatives.join('|')})`);
}

/** Refuses, as unrepaired, a template in which any token of `values` does not occur exactly once. */
export function substituteTemplateTokens(template: string, values: Readonly<Record<string, string>>): string {
  const pieces = template.split(templateTokenPattern());
  for (const token of Object.keys(values)) {
    const occurrences = pieces.filter((piece) => piece === token).length;
    if (occurrences !== 1) {
      throw new OperationRefusal('unrepaired', {
        kind:             'template-token-not-unique',
        templateFilePath: `resources/${TEMPLATE_FILE_NAME}`,
        token,
        occurrenceCount:  occurrences,
      });
    }
  }
  return pieces.map((piece) => (Object.hasOwn(values, piece) ? values[piece] ?? '' : piece)).join('');
}
