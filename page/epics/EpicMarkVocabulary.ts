import type { GroupMarkVocabulary } from '../@types/GroupMarks.ts';
import { NO_EPIC_CHIP }             from '../constants/EpicChips.ts';

export const EPIC_MARK_VOCABULARY: GroupMarkVocabulary = Object.freeze({
  noun:                 'Epic',
  chipOpenerAttribute:  'data-epic',
  titleOpenerAttribute: 'data-open-epic',
  itemOpenerAttribute:  'data-open-ticket',
  filterChipAttribute:  'data-epic-chip',
  noGroupChip:          Object.freeze({ key: NO_EPIC_CHIP, label: 'no epic' }),
});
