/** The word a closing event is stamped with: a delivery reads as its state's label does, so the page never says "delivered". */
export const CLOSING_EVENT_WORD = {
  delivered: 'done',
  abandoned: 'abandoned',
} as const satisfies Record<'delivered' | 'abandoned', string>;
