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
  'hook bash-domains',
];

/** Verbs that build a kind whose own verb is named above: `job wind-down` is a `job-stop` of mode `wind-down`. */
export const OTHER_VERBS_OF_CONTROL_KIND: Readonly<Partial<Record<ControlCommandKind, readonly string[]>>> = { 'job-stop': ['job wind-down'], };

/** The verb each control command is typed as; under a job the verb parses its arguments as usual and relays the command it built. */
export const RELAYED_VERB_OF_CONTROL_KIND: Readonly<Record<ControlCommandKind, string>> = {
  'ticket-add':                  'ticket add',
  'ticket-edit':                 'ticket edit',
  'ticket-depends':              'ticket depends',
  'ticket-priority':             'ticket priority',
  'ticket-epic':                 'ticket epic',
  'ticket-abandon':              'ticket abandon',
  'ticket-ready':                'ticket ready',
  'ticket-triage':               'ticket triage',
  'ticket-park':                 'ticket park',
  'incident-answer':             'incident answer',
  'incident-note':               'incident note',
  'incident-escalate':           'incident escalate',
  'ticket-network':              'ticket network',
  'ticket-hold':                 'ticket hold',
  'ticket-unhold':               'ticket unhold',
  'epic-add':                    'epic add',
  'draft-open':                  'draft open',
  'draft-claim':                 'draft claim',
  'draft-release':               'draft release',
  'draft-note':                  'draft note',
  'draft-ask':                   'draft ask',
  'draft-answer':                'draft answer',
  'draft-drop':                  'draft drop',
  'draft-close':                 'draft close',
  'draft-abandon':               'draft abandon',
  'decision-answer':             'decide',
  'job-stop':                    'job stop',
  'job-fresh':                   'job fresh',
  'job-stop-all':                'job stop',
  'job-message':                 'job message',
  'worktree-repair':             'worktree repair',
  'gate-retry':                  'gate retry',
  'merge-fixer':                 'merge fixer',
  'merge-abort':                 'merge abort',
  'merge-review':                'merge review',
  'merge-land':                  'merge land',
  'intake-start':                'intake',
  'intake-close':                'intake close',
  'runner-pause':                'run pause',
  'runner-resume':               'run resume',
  'runner-stop':                 'run stop',
  'runner-restart':              'run restart',
  'concurrency-set':             'concurrency',
  'checks-set':                  'checks',
  'install-command-set':         'checks',
  'checks-definition-files-set': 'checks',
  'gate-key-command-set':        'checks',
  'gate-cache-paths-set':        'checks',
};
