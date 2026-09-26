/** The Workflow arguments the dispatcher takes: the ones it refuses to run without, in the order it checks them, and the summary its refusals quote. */
export const DISPATCH_ARGUMENTS = {
  REQUIRED_NAMES: ['mainCheckout', 'mainLine', 'checkCommand'],
  SUMMARY_TEXT:   '{ mainCheckout, mainLine, checkCommand, installCommand?, includeLowPriority?, ticketIds?, readyTickets? }',
} as const;
