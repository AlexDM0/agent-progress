import type { ControlCommandKind } from '../../src/shared/@types/ControlCommand.ts';

/**
 * The verbs a session under a job runs directly: none takes the lock or writes the data folder. Every other verb relays, when it is the
 * verb of a control command, or is refused; `cli/RelayUnderJob.spec.ts` holds both lists exact.
 */
export const READ_ONLY_VERBS_UNDER_A_JOB: readonly string[] = [
  'help',
  'status',
  'usage',
  'review-stats',
  'ticket show',
  'ticket list',
  'epic show',
  'epic list',
  'draft show',
  'draft list',
];

/** The verb each control command is typed as; under a job the verb parses its arguments as usual and relays the command it built. */
export const RELAYED_VERB_OF_CONTROL_KIND: Readonly<Record<ControlCommandKind, string>> = {
  'ticket-add':          'ticket add',
  'ticket-edit':         'ticket edit',
  'ticket-depends':      'ticket depends',
  'ticket-priority':     'ticket priority',
  'ticket-epic':         'ticket epic',
  'ticket-abandon':      'ticket abandon',
  'ticket-ready':        'ticket ready',
  'ticket-network':      'ticket network',
  'ticket-hold':         'ticket hold',
  'ticket-unhold':       'ticket unhold',
  'epic-add':            'epic add',
  'draft-open':          'draft open',
  'draft-claim':         'draft claim',
  'draft-release':       'draft release',
  'draft-note':          'draft note',
  'draft-ask':           'draft ask',
  'draft-answer':        'draft answer',
  'draft-drop':          'draft drop',
  'draft-close':         'draft close',
  'draft-abandon':       'draft abandon',
  'concurrency-set':     'concurrency',
  'checks-set':          'checks',
  'install-command-set': 'checks',
};
