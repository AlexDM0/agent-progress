/** Words an `OperationRefusal` wherever the command line prints one: its own message, or its detail through the util that words that kind. */
import type { OperationRefusal }     from '../../shared/OperationRefusal.ts';
import { BoardRefusalWordingUtil }   from './BoardRefusalWordingUtil.ts';
import { TrackerReadingWordingUtil } from './TrackerReadingWordingUtil.ts';

function messageOf(refusal: OperationRefusal): string {
  const { detail } = refusal;
  if (detail === null) return refusal.message;
  switch (detail.kind) {
    case 'board-refusal':
      return BoardRefusalWordingUtil.messageOf(detail.boardRefusal);
    case 'unreadable-tracker':
      return TrackerReadingWordingUtil.refusalMessageOf(detail.reading);
  }
}

export const OperationRefusalWordingUtil = { messageOf } as const;
