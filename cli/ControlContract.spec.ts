/**
 * Design section 9.1's rule over the control contract: every kind names a verb `cli/CommandTable.ts` has, every mutating verb is either a
 * kind's or on the exact list of verbs User runs by hand, and every verb of the table is placed once. What matters: a kind without a verb
 * and a relayable verb without a kind are both named, and each list is exact both ways, so a stale entry fails as loudly as a missing one.
 */
import { describe, expect, test } from 'bun:test';

import { CONTROL_COMMAND_KINDS }                                                                  from '../src/services/control/ControlService.ts';
import type { ControlCommandKind }                                                                from '../src/shared/@types/ControlCommand.ts';
import { COMMAND_NAMES }                                                                          from './CommandTable.ts';
import { OTHER_VERBS_OF_CONTROL_KIND, READ_ONLY_VERBS_UNDER_A_JOB, RELAYED_VERB_OF_CONTROL_KIND } from './constants/JobVerbs.ts';
import { DRAFT_SUBCOMMAND_NAMES }                                                                 from './drafts/DraftCommand.ts';
import { EPIC_SUBCOMMAND_NAMES }                                                                  from './epics/EpicCommand.ts';
import { GATE_SUBCOMMAND_NAMES }                                                                  from './gates/GateCommand.ts';
import { INCIDENT_SUBCOMMAND_NAMES }                                                              from './incidents/IncidentCommand.ts';
import { INTAKE_SUBCOMMAND_NAMES }                                                                from './intake/IntakeCommand.ts';
import { JOB_SUBCOMMAND_NAMES }                                                                   from './jobs/JobCommand.ts';
import { MERGE_SUBCOMMAND_NAMES }                                                                 from './merges/MergeCommand.ts';
import { RUN_SUBCOMMAND_NAMES }                                                                   from './runner/RunCommand.ts';
import { TICKET_SUBCOMMAND_NAMES }                                                                from './tickets/TicketCommand.ts';
import { WORKTREE_SUBCOMMAND_NAMES }                                                              from './worktrees/WorktreeCommand.ts';

const VERB_OF_KIND: { readonly [Kind in ControlCommandKind]: string } = RELAYED_VERB_OF_CONTROL_KIND;

/** Mutating verbs User runs by hand: never relayed, never offered in the UI (design section 9.1). */
const NOT_RELAYABLE_MUTATING_VERBS = [
  'task',
  'log',
  'range',
  'clear',
  'ticket agent',
  'ticket size',
  'ticket status',
  'ticket link',
  'ticket introduced-by',
  'ticket release-of',
  'ticket rereview',
  'ticket reopen',
  'epic edit',
  'epic remove',
  'release',
  'ticket start',
  'ticket finish',
  'ticket approve',
  'ticket deliver',
  'review record',
  'rework',
  'init',
  'update',
  'dispatcher',
  'run',
];

/**
 * `open` writes no tracker file but launches a browser and registers the dashboard, so a session under a job may not run it; `await` is
 * the wait of User's own session around the Overseer, which runs under no job.
 */
const READ_ONLY_VERBS = [...READ_ONLY_VERBS_UNDER_A_JOB, 'open', 'await'];

/** Verbs design section 9.2 retires, which no command replaces; they leave the table with T26. */
const RETIRING_VERBS = ['hook', 'render', 'ticket claim'];

interface ControlContract {
  readonly verbOfKind:                Readonly<Record<string, string>>;
  readonly notRelayableMutatingVerbs: readonly string[];
  readonly readOnlyVerbs:             readonly string[];
  readonly retiringVerbs:             readonly string[];
  readonly tableVerbs:                readonly string[];
}

function subcommandVerbsOf(command: string, subcommandNames: readonly string[]): string[] {
  return subcommandNames.map((subcommand) => `${command} ${subcommand}`);
}

/** Every verb `agent-progress` answers: a command, or a command and its subcommand where the command has several. */
function tableVerbsOf(commandNames: readonly string[]): string[] {
  return commandNames.flatMap((command) => {
    if (command === 'ticket') return subcommandVerbsOf(command, TICKET_SUBCOMMAND_NAMES);
    if (command === 'epic') return subcommandVerbsOf(command, EPIC_SUBCOMMAND_NAMES);
    if (command === 'draft') return subcommandVerbsOf(command, DRAFT_SUBCOMMAND_NAMES);
    if (command === 'review') return ['review record'];
    if (command === 'run') return [command, ...subcommandVerbsOf(command, RUN_SUBCOMMAND_NAMES)];
    if (command === 'job') return subcommandVerbsOf(command, JOB_SUBCOMMAND_NAMES);
    if (command === 'incident') return subcommandVerbsOf(command, INCIDENT_SUBCOMMAND_NAMES);
    if (command === 'merge') return subcommandVerbsOf(command, MERGE_SUBCOMMAND_NAMES);
    if (command === 'worktree') return subcommandVerbsOf(command, WORKTREE_SUBCOMMAND_NAMES);
    if (command === 'gate') return subcommandVerbsOf(command, GATE_SUBCOMMAND_NAMES);
    if (command === 'intake') return [command, ...subcommandVerbsOf(command, INTAKE_SUBCOMMAND_NAMES)];
    // The measurement events retire as `hook`; the network guard a runner renders into a job's settings stays.
    if (command === 'hook') return [command, 'hook bash-domains', 'hook session-start'];
    return [command];
  });
}

function contractViolationsOf(contract: ControlContract): string[] {
  const tableVerbs = new Set(contract.tableVerbs);
  const placements = [
    ...Object.values(contract.verbOfKind).map((verb) => ({ verb, place: 'a control kind' })),
    ...Object.values(OTHER_VERBS_OF_CONTROL_KIND).flat().map((verb) => ({ verb, place: 'a control kind' })),
    ...contract.notRelayableMutatingVerbs.map((verb) => ({ verb, place: 'the not-relayable list' })),
    ...contract.readOnlyVerbs.map((verb) => ({ verb, place: 'the read-only list' })),
    ...contract.retiringVerbs.map((verb) => ({ verb, place: 'the retiring list' })),
  ];
  const kindsWithoutAVerb = Object.entries(contract.verbOfKind)
    .filter(([, verb]) => !tableVerbs.has(verb))
    .map(([kind, verb]) => `kind ${kind} names ${verb}, which cli/CommandTable.ts does not answer`);
  const staleListEntries = placements
    .filter(({ verb, place }) => place !== 'a control kind' && !tableVerbs.has(verb))
    .map(({ verb, place }) => `${verb} is on ${place} but cli/CommandTable.ts does not answer it`);
  const placedVerbs = new Set(placements.map(({ verb }) => verb));
  const verbsWithoutAKind = contract.tableVerbs
    .filter((verb) => !placedVerbs.has(verb))
    .map((verb) => `${verb} is relayable but no control kind applies it`);
  const placesOfVerb = Map.groupBy(placements.filter(({ place }) => place !== 'a control kind'), ({ verb }) => verb);
  const kindVerbs = new Set(Object.values(contract.verbOfKind));
  const verbsPlacedTwice = [...placesOfVerb.entries()]
    .filter(([verb, places]) => places.length + (kindVerbs.has(verb) ? 1 : 0) > 1)
    .map(([verb]) => `${verb} is placed more than once`);
  return [...kindsWithoutAVerb, ...staleListEntries, ...verbsWithoutAKind, ...verbsPlacedTwice];
}

const CONTRACT: ControlContract = {
  verbOfKind:                VERB_OF_KIND,
  notRelayableMutatingVerbs: NOT_RELAYABLE_MUTATING_VERBS,
  readOnlyVerbs:             READ_ONLY_VERBS,
  retiringVerbs:             RETIRING_VERBS,
  tableVerbs:                tableVerbsOf(COMMAND_NAMES),
};

describe('the control contract', () => {
  test('the scan saw the table: ticket, epic and draft verbs and the top-level commands are all there', () => {
    expect(CONTRACT.tableVerbs).toContain('ticket add');
    expect(CONTRACT.tableVerbs).toContain('epic add');
    expect(CONTRACT.tableVerbs).toContain('draft open');
    expect(CONTRACT.tableVerbs).toContain('concurrency');
    expect(CONTRACT.tableVerbs.length).toBeGreaterThan(Object.keys(VERB_OF_KIND).length);
  });

  test('every kind the service applies has a verb here, and every verb here a kind the service applies', () => {
    expect([...CONTROL_COMMAND_KINDS].sort() as string[]).toEqual(Object.keys(VERB_OF_KIND).sort());
  });

  test('no kind without a verb, no relayable verb without a kind, and every list exact both ways', () => {
    expect(contractViolationsOf(CONTRACT)).toEqual([]);
  });

  test('a kind whose verb the table does not answer is named', () => {
    expect(contractViolationsOf({ ...CONTRACT, verbOfKind: { ...VERB_OF_KIND, 'ticket-shelve': 'ticket shelve' } })).toEqual([
      'kind ticket-shelve names ticket shelve, which cli/CommandTable.ts does not answer',
    ]);
  });

  test('a mutating verb the table answers with no kind and on no list is named as relayable without a kind', () => {
    expect(contractViolationsOf({ ...CONTRACT, tableVerbs: [...CONTRACT.tableVerbs, 'ticket shelve'] })).toEqual([
      'ticket shelve is relayable but no control kind applies it',
    ]);
    const withoutTheHoldKind = Object.fromEntries(Object.entries(VERB_OF_KIND).filter(([kind]) => kind !== 'ticket-hold'));
    expect(contractViolationsOf({ ...CONTRACT, verbOfKind: withoutTheHoldKind })).toEqual(['ticket hold is relayable but no control kind applies it']);
  });

  test('a stale not-relayable entry and a verb placed twice are named', () => {
    expect(contractViolationsOf({ ...CONTRACT, notRelayableMutatingVerbs: [...NOT_RELAYABLE_MUTATING_VERBS, 'ticket waive'] })).toEqual([
      'ticket waive is on the not-relayable list but cli/CommandTable.ts does not answer it',
    ]);
    expect(contractViolationsOf({ ...CONTRACT, notRelayableMutatingVerbs: [...NOT_RELAYABLE_MUTATING_VERBS, 'ticket hold'] })).toEqual([
      'ticket hold is placed more than once',
    ]);
  });
});
