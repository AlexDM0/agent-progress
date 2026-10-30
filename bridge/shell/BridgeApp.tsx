/**
 * The Bridge's shell: it follows the Overseer's event stream into one state, routes the hash to a tab, wires the embedded channel, and says
 * whether controls may act. After the stream comes back it asks `/api/identity` again and reloads when the Overseer runs new code, since
 * the bundle it holds may no longer match the API. Everything it reaches outside the page arrives in `services`, so a DOM spec fakes it.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';

import type { BoardStateDocument, OverseerIdentity }                                     from '../@types/BoardStateDocument.ts';
import type { ConversationBoardDocument }                                                from '../@types/ConversationDocuments.ts';
import type { KanbanBoardState }                                                         from '../@types/KanbanBoardState.ts';
import type { PreferenceStorage }                                                        from '../@types/PreferenceStorage.ts';
import type { ProgressBoardState }                                                       from '../@types/ProgressBoardState.ts';
import type { TicketsBoardState }                                                        from '../@types/TicketsBoardState.ts';
import type { CommandClient }                                                            from '../api/CommandClient.ts';
import type { ConnectionState, EventStreamHandlers }                                     from '../api/EventStreamClient.ts';
import { boardPreferenceStoreOf, sharedPreferenceStoreOf, type PreferenceStore }         from '../preferences/PreferenceStore.ts';
import { TimeUtil }                                                                      from '../utils/TimeUtil.ts';
import { AgentsView, BROWSER_AGENTS_CLOCK, type AgentsClock }                            from '../views/agents/AgentsView.tsx';
import { AssistantView }                                                                 from '../views/assistant/AssistantView.tsx';
import type { TranscriptFollower }                                                       from '../views/assistant/TranscriptLog.tsx';
import { DetailPanel }                                                                   from '../views/detail-panel/DetailPanel.tsx';
import { EpicsModel }                                                                    from '../views/epics/EpicsModel.ts';
import { EpicsView }                                                                     from '../views/epics/EpicsView.tsx';
import { FinishedWorkModel }                                                             from '../views/finished-work/FinishedWorkModel.ts';
import type { FinishedWorkChoice }                                                       from '../views/finished-work/FinishedWorkModel.ts';
import { FinishedWorkMenu, FinishedWorkView, useFinishedWorkChoice }                     from '../views/finished-work/FinishedWorkView.tsx';
import { IntakeView }                                                                    from '../views/intake/IntakeView.tsx';
import { KanbanModel }                                                                   from '../views/kanban/KanbanModel.ts';
import { KanbanView }                                                                    from '../views/kanban/KanbanView.tsx';
import { MergeQueueModel }                                                               from '../views/merge-queue/MergeQueueModel.ts';
import { MergeQueueView }                                                                from '../views/merge-queue/MergeQueueView.tsx';
import { ProgressModel }                                                                 from '../views/progress/ProgressModel.ts';
import { ProgressView }                                                                  from '../views/progress/ProgressView.tsx';
import { QuestionAlerts, type QuestionNotifier }                                         from '../views/questions/QuestionAlerts.ts';
import { QuestionsView }                                                                 from '../views/questions/QuestionsView.tsx';
import { TicketsModel }                                                                  from '../views/tickets/TicketsModel.ts';
import { TicketsView }                                                                   from '../views/tickets/TicketsView.tsx';
import { BoardStateUpdate }                                                              from './BoardStateUpdate.ts';
import { ConnectionBanners }                                                             from './ConnectionBanners.tsx';
import { ControlAvailabilityUtil, ControlSurroundingsContext, type ControlSurroundings } from './ControlAvailability.ts';
import { EmbeddedChannel, type EmbeddedSurroundings }                                    from './EmbeddedChannel.ts';
import {
  DEFAULT_TAB,
  HashRouter,
  TAB_CHOICE_NAME,
  type BridgeTab
} from './HashRouter.ts';
import { Header }                           from './Header.tsx';
import { HeaderModelUtil }                  from './HeaderModel.ts';
import { ThemeBootstrap, type ThemeChoice } from './ThemeBootstrap.ts';

export interface BridgeServices {
  readonly commandClient:        CommandClient;
  readonly openEventStream:      (handlers: EventStreamHandlers) => { close: () => void };
  readonly fetchIdentity:        () => Promise<OverseerIdentity | null>;
  readonly reload:               () => void;
  readonly storage:              () => PreferenceStorage;
  readonly embedded:             boolean;
  readonly embeddedSurroundings: () => EmbeddedSurroundings;
  readonly now:                  () => Date;
  readonly followTranscript:     TranscriptFollower;
  readonly questionNotifier:     QuestionNotifier;
}

interface SelectedViewProps {
  readonly tab:                  BridgeTab;
  readonly selectedItem:         string | null;
  readonly boardState:           BoardStateDocument;
  readonly services:             BridgeServices;
  readonly agentsClock:          AgentsClock;
  /** `null` when the board carries no page payload the Kanban can read: the tab then shows the counts. */
  readonly kanbanBoardState:     KanbanBoardState | null;
  readonly ticketsBoardState:    TicketsBoardState | null;
  readonly progressBoardState:   ProgressBoardState | null;
  readonly progressNow:          number;
  readonly boardStore:           PreferenceStore | null;
  readonly finishedWorkChoice:   FinishedWorkChoice;
  readonly onFinishedWorkChoice: (choice: FinishedWorkChoice) => void;
}

function SelectedView({
  tab, selectedItem, boardState, services, agentsClock, kanbanBoardState, ticketsBoardState, progressBoardState, progressNow, boardStore,
  finishedWorkChoice, onFinishedWorkChoice
}: SelectedViewProps) {
  const conversationBoard = boardState as unknown as ConversationBoardDocument;
  switch (tab) {
    case 'agents':
      return <AgentsView jobs={boardState.jobs} decisions={boardState.decisions} selectedJobId={selectedItem} clock={agentsClock} />;
    case 'kanban':
      if (selectedItem === MERGE_QUEUE_ITEM) {
        return <MergeQueueView targets={MergeQueueModel.mergeQueueModelOf(boardState.mergeQueue, boardState.notices ?? [])} />;
      }
      if (kanbanBoardState !== null) {
        return (
          <>
            <p><a href={HashRouter.fragmentOf({ tab: 'kanban', item: MERGE_QUEUE_ITEM })}>Merge queue</a></p>
            <KanbanView boardState={kanbanBoardState} boardStore={boardStore} />
          </>
        );
      }
      break;
    case 'tickets':
      if (ticketsBoardState === null) break;
      return (
        <>
          {selectedItem === null
            ? null
            : <DetailPanel boardState={ticketsBoardState} ticketId={selectedItem} todayCalendarDate={TimeUtil.calendarDateOf(services.now().getTime())} tab={tab} />}
          <TicketsView boardState={ticketsBoardState} boardStore={boardStore} />
        </>
      );
    case 'progress':
      if (progressBoardState === null && boardState.page === undefined) break;
      return (
        <>
          {progressBoardState === null
            ? null
            : <ProgressView boardState={progressBoardState} boardStore={boardStore} nowEpochMilliseconds={progressNow} todayCalendarDate={TimeUtil.calendarDateOf(progressNow)} />}
          {boardState.page === undefined
            ? null
            : <FinishedWorkAndEpics page={boardState.page} finishedWorkChoice={finishedWorkChoice} onFinishedWorkChoice={onFinishedWorkChoice} now={services.now()} />}
        </>
      );
    case 'questions':
      return <QuestionsView board={conversationBoard} notifier={services.questionNotifier} />;
    case 'assistant':
      return <AssistantView board={conversationBoard} followTranscript={services.followTranscript} />;
    case 'intake':
      return <IntakeView board={conversationBoard} followTranscript={services.followTranscript} />;
    default:
      break;
  }
  return <BoardCounts boardState={boardState} tab={tab} />;
}

export interface BridgeAppProps {
  readonly services: BridgeServices;
}

const HELD_BY_INSTALL_CHANGE = 'held-by-install-change';

/** The Kanban's Merge queue lane opens its detail at `#kanban/merge-queue`. */
export const MERGE_QUEUE_ITEM = 'merge-queue';

export function BridgeApp({ services }: BridgeAppProps) {
  const sharedStore = useMemo(() => sharedPreferenceStoreOf(services.storage), [services]);
  const [identity, setIdentity] = useState<OverseerIdentity | null>(null);
  const [boardState, setBoardState] = useState<BoardStateDocument | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [boardShownAsOf, setBoardShownAsOf] = useState<string | null>(null);
  const [installRefusal, setInstallRefusal] = useState<string | null>(null);
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(() => ThemeBootstrap.themeChoiceOf(sharedStore.readChoice('theme')));
  const knownCodeVersion = useRef<string | null>(null);
  const streamWasDown = useRef(false);

  const boardStore = useMemo(() => (identity === null ? null : boardPreferenceStoreOf(identity.trackerId, services.storage)), [identity, services]);
  const storedTab = useCallback(() => boardStore?.readChoice(TAB_CHOICE_NAME) ?? null, [boardStore]);
  const route = HashRouter.useHashRoute(storedTab);
  const openDecisions = (boardState as ConversationBoardDocument | null)?.decisions ?? null;
  QuestionAlerts.useOpenQuestionAlerts(openDecisions, services.questionNotifier);
  const [finishedWorkChoice, chooseFinishedWork] = useFinishedWorkChoice(boardStore);

  useEffect(() => {
    let current = true;
    void services.fetchIdentity().then((fetched) => {
      if (!current || fetched === null) return;
      knownCodeVersion.current = fetched.codeVersion;
      setIdentity(fetched);
    });
    return () => {
      current = false;
    };
  }, [services]);

  useEffect(() => {
    const stream = services.openEventStream({
      onEvent: (kind, data) => {
        setBoardState((previous) => BoardStateUpdate.boardStateAfter(previous, kind, data));
        if (kind !== 'board') return;
        setBoardShownAsOf(services.now().toLocaleString());
        if ((data as Partial<BoardStateDocument>).overseer?.state !== HELD_BY_INSTALL_CHANGE) setInstallRefusal(null);
      },
      onConnection: (state) => {
        setConnection(state);
        if (state === 'down') streamWasDown.current = true;
        if (state !== 'live' || !streamWasDown.current) return;
        streamWasDown.current = false;
        void services.fetchIdentity().then((fetched) => {
          if (fetched !== null && knownCodeVersion.current !== null && fetched.codeVersion !== knownCodeVersion.current) services.reload();
        });
      },
    });
    return () => stream.close();
  }, [services]);

  const panelIsOpen = route.item !== null;
  const panelIsOpenNow = useRef(panelIsOpen);
  useEffect(() => {
    panelIsOpenNow.current = panelIsOpen;
  }, [panelIsOpen]);

  useEffect(() => {
    if (!services.embedded) return undefined;
    const channel = EmbeddedChannel.open(services.embeddedSurroundings(), {
      onTheme:     (theme) => ThemeBootstrap.applyParentTheme(theme),
      panelIsOpen: () => panelIsOpenNow.current,
    });
    return () => channel.close();
  }, [services]);

  useEffect(() => {
    boardStore?.writeChoice(TAB_CHOICE_NAME, route.tab, DEFAULT_TAB);
  }, [boardStore, route.tab]);

  const streamIsDown = connection === 'down';
  const installIsHeld = installRefusal !== null || boardState?.overseer.state === HELD_BY_INSTALL_CHANGE;
  const controlSurroundings = useMemo((): ControlSurroundings => ({
    availability:  ControlAvailabilityUtil.availabilityOf(streamIsDown, installIsHeld),
    commandClient: services.commandClient,
    onInstallHeld: setInstallRefusal,
  }), [streamIsDown, installIsHeld, services]);

  const agentsClock = useMemo((): AgentsClock => ({ now: services.now, everySecond: BROWSER_AGENTS_CLOCK.everySecond }), [services]);
  const kanbanBoardState = useMemo(() => KanbanModel.kanbanBoardStateOf(boardState), [boardState]);
  const ticketsBoardState = useMemo(() => TicketsModel.ticketsBoardStateOf(boardState), [boardState]);
  const progressBoardState = useMemo(() => ProgressModel.progressBoardStateOf(boardState), [boardState]);
  // The chart reads the clock once per board: its now line and Fit range move on with the next board, and are only shown.
  const progressNow = useMemo(() => (boardState === null ? 0 : services.now().getTime()), [boardState, services]);

  const chooseTheme = (choice: ThemeChoice): void => {
    ThemeBootstrap.chooseTheme(sharedStore, choice);
    setThemeChoice(choice);
  };

  return (
    <ControlSurroundingsContext.Provider value={controlSurroundings}>
      <div className="bridge-shell">
        <ConnectionBanners
          streamIsDown={streamIsDown}
          boardShownAsOf={boardShownAsOf}
          installHeldRefusal={installIsHeld ? installRefusal : undefined}
        />
        <Header
          project={boardState?.project ?? identity?.project ?? ''}
          model={HeaderModelUtil.headerModelOf(boardState, services.now())}
          selectedTab={route.tab}
          themeChoice={themeChoice}
          onThemeChoice={chooseTheme}
        />
        <main className="bridge-panel" data-tab={route.tab}>
          {boardState === null
            ? <p className="bridge-empty">Waiting for the Overseer&apos;s first board.</p>
            : (
              <SelectedView
                tab={route.tab}
                selectedItem={route.item}
                boardState={boardState}
                services={services}
                agentsClock={agentsClock}
                kanbanBoardState={kanbanBoardState}
                ticketsBoardState={ticketsBoardState}
                progressBoardState={progressBoardState}
                progressNow={progressNow}
                boardStore={boardStore}
                finishedWorkChoice={finishedWorkChoice}
                onFinishedWorkChoice={chooseFinishedWork}
              />
            )}
        </main>
      </div>
    </ControlSurroundingsContext.Provider>
  );
}

interface FinishedWorkAndEpicsProps {
  readonly page:                 NonNullable<BoardStateDocument['page']>;
  readonly finishedWorkChoice:   FinishedWorkChoice;
  readonly onFinishedWorkChoice: (choice: FinishedWorkChoice) => void;
  readonly now:                  Date;
}

function FinishedWorkAndEpics({
  page, finishedWorkChoice, onFinishedWorkChoice, now
}: FinishedWorkAndEpicsProps) {
  const nowEpochMilliseconds = now.getTime();
  const cutoff = FinishedWorkModel.cutoffEpochMillisecondsOf(finishedWorkChoice, nowEpochMilliseconds);
  return (
    <>
      <FinishedWorkMenu choice={finishedWorkChoice} onChoice={onFinishedWorkChoice} hiddenCount={FinishedWorkModel.finishedTicketsOf(page.tickets, cutoff).hiddenCount} />
      <EpicsView model={EpicsModel.epicsModelOf(page, finishedWorkChoice, nowEpochMilliseconds)} />
      <FinishedWorkView tickets={page.tickets} choice={finishedWorkChoice} nowEpochMilliseconds={nowEpochMilliseconds} />
    </>
  );
}

function BoardCounts({ boardState, tab }: { readonly boardState: BoardStateDocument; readonly tab: string }) {
  return (
    <p className="bridge-empty">
      {`${boardState.jobs.length} jobs, ${boardState.decisions.length} decisions, ${boardState.incidents.length} incidents. `}
      {tab === 'kanban' ? <a href={HashRouter.fragmentOf({ tab: 'kanban', item: MERGE_QUEUE_ITEM })}>Merge queue</a> : null}
    </p>
  );
}
