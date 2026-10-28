/**
 * One record of every kind, as the Board's own changes log them, so a spec pinning what log.jsonl stores reads the Board's key order rather
 * than a hand-written copy of it. Test-only: nothing that ships may import `src/testing/`.
 */
import type { LogRecord }              from '../lib/tracker-model/@types/LogRecord.ts';
import { boardFixture, ticketFixture } from './BoardFixtures.ts';

export function everyRecordKindTheBoardLogs(at: string): LogRecord[] {
  const { board, records } = boardFixture({
    tickets: [
      ticketFixture({ id: '001', title: 'Example checkout page' }),
      ticketFixture({ id: '002', title: 'Example cart', group: 'example-shop' }),
      ticketFixture({ id: '004', title: 'Example cart total is wrong', type: 'bug' }),
    ],
  });
  board.recordNote('Example note from the orchestrator', at);
  board.fileTicket(ticketFixture({ id: '003', title: 'Example search page', status: 'draft' }), at);
  board.editTicket('003', { title: 'Example search results page' }, at);
  board.setTicketNetwork('003', ['api.example.com'], at);
  board.readyDraftTickets(['003'], () => [], at);
  board.setTicketPriority('001', 'high', at);
  board.setTicketSize('001', 'M', at);
  board.setTicketDependencies('002', ['001'], at);
  board.setTicketAgents('001', { model: 'sonnet', effort: 'high' }, at);
  board.holdTicket('001', 'waiting on Example Agency', at);
  board.unholdTicket('001', at);
  board.markReleaseTicket('002', at);
  board.clearReleaseTicket('002', at);
  board.addEpic({
    key:      'example-checkout',
    title:    'Example checkout redesign',
    body:     '',
    filePath: '/example-agency/storefront/.agent-progress/epics/example-checkout.md',
  }, at);
  board.editEpic('example-checkout', { title: 'Example checkout overhaul' }, at);
  board.removeEpic('example-checkout', at);
  board.setTicketEpics('002', [], at);
  board.openDraft({ title: 'Example export', request: 'Alex Example asks for an export', owner: 'opus' }, at);
  board.releaseDraft('D1', at);
  board.claimDraft('D1', { owner: 'opus', forces: false }, at);
  board.claimDraft('D1', { owner: 'example-session', forces: true }, at);
  board.addDraftNote('D1', { text: 'The export lives in src/export/', kind: 'fact' }, at);
  board.askDraftQuestion('D1', {
    question:           'Which format?',
    context:            'Alex Example named two',
    optionTexts:        ['CSV', 'JSON'],
    multiple:           false,
    recommendedLetters: ['a'],
    underQuestionId:    null,
  }, at);
  board.answerDraftQuestion('D1', 'Q1', 'a', at);
  board.dropDraftItem('D1', 'N1', at);
  board.closeDraft('D1', ['3'], at);
  board.openDraft({ title: 'Example import', request: '', owner: 'opus' }, at);
  board.abandonDraft('D2', 'folded into D1', at);
  board.moveTicket('001', 'in-progress', { checksLegality: true }, at);
  board.setCheckCommand('bun run example-checks', true, at);
  board.setInstallCommand('bun install --frozen-lockfile', at);
  board.recordGateRan({ tree: '4b825dc642cb6eb9a060e54bf8d69288fbee4904', outcome: 'passed', cached: true }, at);
  board.editTicket('001', { body: { text: 'Example rewritten report.\n', appends: false }, allowsPastPending: true }, at);
  board.moveTicket('001', 'in-review', { checksLegality: true }, at);
  board.startReviewBar('001', { round: 1 }, at);
  board.recordReview('001', {
    verdict:                 'round-requested',
    reviewStartCommit:       'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    fixReworkedCodeLines:    12,
    rebaseReworkedCodeLines: 4,
    totalReworkedCodeLines:  16,
    builderChangedFiles:     3,
    builderInsertions:       120,
    builderDeletions:        8,
    claims:                  [{ item: 'A1', result: 'holds', handoffContradicted: false }],
    findings:                [
      {
        class:    'test-gap',
        severity: 'quality',
        file:     'src/example/ExampleCheckout.ts',
        summary:  'The empty cart had no spec',
        evidence: 'watched-fail',
        outcome:  'fixed',
        commit:   'b2c3d4e',
      },
      {
        class:         'out-of-scope',
        severity:      'nit',
        file:          'docs/example.md',
        summary:       'An example sentence wraps late',
        evidence:      'reading',
        outcome:       'filed',
        filedTicketId: '004',
      },
    ],
  }, at);
  board.queueTicketForMerge('001', 'main', at);
  const merge = board.claimMergeSlot({
    ticketId:               '001',
    target:                 'main',
    targetTip:              'b2c3d4e5f60718293a4b5c6d7e8f901234567890',
    branchTip:              'c3d4e5f60718293a4b5c6d7e8f90123456789012',
    predictedConflictFiles: ['src/example/ExampleCheckout.ts'],
  }, (ticket) => (ticket.group === undefined ? 'main' : `group-${ticket.group}`), at);
  board.recordMergeLanded(merge.job.id, { target: 'main', commit: 'd4e5f60718293a4b5c6d7e8f9012345678901234', kind: 'landed' }, at);
  board.endJob(merge.job.id, { outcome: 'landed', commit: 'd4e5f60718293a4b5c6d7e8f9012345678901234' }, at);
  board.rereviewTicket('001', at);
  board.moveTicket('001', 'reviewed', { checksLegality: true }, at);
  board.moveTicket('001', 'delivered', { checksLegality: true }, at);
  board.setTicketIntroducedBy('004', '001', at);
  board.moveTicket('001', 'pending', { checksLegality: false }, at);
  board.moveTicket('003', 'abandoned', { checksLegality: true, reason: 'superseded by #001' }, at);
  board.setChartRange({
    kind:        'relative',
    from:        '-2h',
    to:          'now',
    tickMinutes: 15,
  }, at);
  board.setConcurrencyLimit(3, at);
  board.setDispatcherState('running', 'example-run', at);
  board.recordAgentStop({
    agentId:              'example-agent',
    agentType:            'agent-progress-worker',
    apiCallCount:         12,
    endContextTokens:     48_000,
    totalInputTokens:     310_000,
    cacheReadInputTokens: 250_000,
    outputTokens:         9_000,
  }, [], at);
  board.recordRunnerStarted({ codeVersion: 'a1b2c3d', installVersion: 17 }, at);
  const { job } = board.launchJob({
    kind:        'build',
    role:        'builder',
    ticketIds:   ['002'],
    parentJobId: null,
    attempt:     1,
    target:      'main',
  }, at);
  board.moveJob(job.id, 'running', at);
  board.interruptJob(job.id, 'agent-crashed', at);
  board.recordUsageLimitHit(job.id, { window: 'five_hour', resetsAt: '2026-09-26T13:00:34.000Z' }, at);
  board.moveJob(job.id, 'running', at);
  board.messageJob(job.id, 'Keep the example export small.', at);
  board.requestJobStop(job.id, 'wind-down', at);
  board.endJob(job.id, { outcome: 'failed', cause: 'no report', deniedPermissions: ['WebFetch'] }, at);
  const question = {
    question:    'Ship the example export as CSV?',
    header:      'Export',
    multiSelect: false,
    options:     [{ label: 'CSV', description: 'Comma separated' }, { label: 'JSON', description: 'One document' }],
  };
  board.openDecision({
    kind: 'agent-question', ticketIds: ['002'], jobId: null, askedBy: 'builder', requestId: 'request-1', questions: [question], context: 'Example cart',
  }, at);
  board.answerDecision('E1', ['CSV'], at);
  board.openDecision({
    kind: 'outage', ticketIds: [], jobId: null, askedBy: 'runner', requestId: null, questions: [question], context: 'Two crashed jobs',
  }, at);
  board.withdrawDecision('E2', 'job stopped', at);
  const incidentOpening = {
    kind: 'system-question', ticketIds: ['002'], jobId: null, facts: { requestId: 'request-2' }, defaultMove: 'incident-escalate',
  } as const;
  board.openIncident(incidentOpening, at);
  board.handleIncident('I1', 'incident-answer', at);
  board.openIncident({ ...incidentOpening, facts: { requestId: 'request-3' } }, at);
  board.defaultIncident('I2', 'turn-closed', at);
  board.openIncident({ ...incidentOpening, facts: { requestId: 'request-4' } }, at);
  board.escalateIncident('I3', { askedBy: 'builder', questions: [question], context: 'Example cart' }, at);
  board.triageTicket('004', at);
  board.recordRunnerStopped('stopped', at);
  board.recordRunnerHandoverFailed({ successorCodeVersion: 'd4e5f6a', step: 'build-bundles', error: 'Example bundle error' }, at);
  board.recordRelayApplied('J1', { requestId: 'request-5', commandKind: 'ticket-add', outcome: 'done' }, at);
  board.clearTracker({ ticketsSurvive: true }, at);
  return records;
}
