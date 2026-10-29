/**
 * The header: the project, the Overseer's state and its controls (Pause or Resume, Restart only with new code on disk, Stop behind a
 * confirmation), the new-code notice, concurrency, usage, the statistics, the open notices and warnings, the tabs and the theme choice.
 * Embedded, `board.css` hides it.
 */
import { useState } from 'react';

import { CommandButton }                           from './CommandButton.tsx';
import { BRIDGE_TABS, HashRouter, type BridgeTab } from './HashRouter.ts';
import type { HeaderModel }                        from './HeaderModel.ts';
import type { ThemeChoice }                        from './ThemeBootstrap.ts';

export interface HeaderProps {
  readonly project:       string;
  readonly model:         HeaderModel;
  readonly selectedTab:   BridgeTab;
  readonly themeChoice:   ThemeChoice;
  readonly onThemeChoice: (choice: ThemeChoice) => void;
}

const TAB_LABELS: Readonly<Record<BridgeTab, string>> = {
  kanban:    'Kanban',
  progress:  'Progress',
  tickets:   'Tickets',
  agents:    'Agents',
  questions: 'Questions',
  assistant: 'Assistant',
  intake:    'Intake',
};

const THEME_CHOICES: readonly ThemeChoice[] = ['auto', 'light', 'dark'];

function StopOverseer() {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return <button type="button" className="bridge-button" onClick={() => setConfirming(true)}>Stop Overseer</button>;
  }
  return (
    <span className="bridge-confirm" role="group" aria-label="Confirm stopping the Overseer">
      Stop the Overseer? Launches end until it is started again.
      <CommandButton label="Confirm stop" command={{ kind: 'runner-stop', now: false }} answeredWhileInstallHeld />
      <button type="button" className="bridge-button" onClick={() => setConfirming(false)}>Cancel</button>
    </span>
  );
}

function ConcurrencyControl({ limit }: { readonly limit: number }) {
  const [wanted, setWanted] = useState(limit);
  return (
    <span className="bridge-concurrency">
      <label>
        agents at most
        <input type="number" min={1} value={wanted} aria-label="Concurrency limit" onChange={(event) => setWanted(Number(event.currentTarget.value))} />
      </label>
      {wanted === limit || !Number.isInteger(wanted) || wanted < 1 ? null : <CommandButton label="Set" command={{ kind: 'concurrency-set', limit: wanted }} />}
    </span>
  );
}

export function Header({
  project, model, selectedTab, themeChoice, onThemeChoice
}: HeaderProps) {
  return (
    <header className="bridge-header">
      <h1 className="bridge-project">{project}</h1>
      <span className="bridge-overseer-state" data-state={model.stateToken}>{model.stateText}</span>
      {model.pauseControl === null ? null : (
        <CommandButton
          label={model.pauseControl === 'resume' ? 'Resume' : 'Pause'}
          command={{ kind: model.pauseControl === 'resume' ? 'runner-resume' : 'runner-pause' }}
        />
      )}
      {model.restartOffered ? <CommandButton label="Restart" command={{ kind: 'runner-restart', now: false }} answeredWhileInstallHeld /> : null}
      {model.stopOffered ? <StopOverseer /> : null}
      {model.newCodeNotice === null ? null : <span className="bridge-new-code" role="status">{model.newCodeNotice}</span>}
      {model.concurrencyLimit === null ? null : <ConcurrencyControl key={model.concurrencyLimit} limit={model.concurrencyLimit} />}
      <span className="bridge-usage">{model.usageText}</span>
      <ul className="bridge-statistics" aria-label="Statistics">
        {model.statistics.map((statistic) => (
          <li key={statistic.label} className="bridge-statistic">
            <b>{statistic.figure}</b>
            {` ${statistic.label}`}
          </li>
        ))}
      </ul>
      <nav className="bridge-tabs" aria-label="Views">
        {BRIDGE_TABS.map((tab) => (
          <a
            key={tab}
            className="bridge-tab"
            href={HashRouter.fragmentOf({ tab, item: null })}
            aria-current={tab === selectedTab ? 'page' : undefined}
          >
            {TAB_LABELS[tab]}
          </a>
        ))}
      </nav>
      <div className="bridge-theme" role="radiogroup" aria-label="Theme">
        {THEME_CHOICES.map((choice) => (
          <button
            key={choice}
            type="button"
            role="radio"
            className="bridge-theme-choice"
            aria-checked={choice === themeChoice}
            onClick={() => onThemeChoice(choice)}
          >
            {choice}
          </button>
        ))}
      </div>
      {model.warnings.length === 0 && model.notices.length === 0 ? null : (
        <div className="bridge-alerts">
          {model.warnings.length === 0 ? null : (
            <ul className="bridge-warnings" aria-label={`${model.warnings.length} warnings`}>
              {model.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          )}
          {model.notices.length === 0 ? null : (
            <ul className="bridge-notices" aria-label={`${model.notices.length} notices`}>
              {model.notices.map((notice) => <li key={notice}>{notice}</li>)}
            </ul>
          )}
        </div>
      )}
    </header>
  );
}
