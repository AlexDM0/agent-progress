import type { GroupMarkVocabulary } from '../../@types/GroupMarks.ts';

export const SPEC_MARK_VOCABULARY: GroupMarkVocabulary = Object.freeze({
  noun:                 'Spec',
  chipOpenerAttribute:  'data-spec',
  titleOpenerAttribute: 'data-open-spec',
  itemOpenerAttribute:  'data-open-work-item',
  filterChipAttribute:  'data-spec-chip',
  noGroupChip:          null,
});
