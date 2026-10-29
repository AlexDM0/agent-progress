/** The shell's header: the project and the Overseer's state, its Pause or Resume, the tabs, and the theme choice. Embedded, `board.css` hides it. */
import type { OverseerFactsDocument }              from '../@types/BoardStateDocument.ts';
import { CommandButton }                           from './CommandButton.tsx';
import { BRIDGE_TABS, HashRouter, type BridgeTab } from './HashRouter.ts';
import type { ThemeChoice }                        from './ThemeBootstrap.ts';

export interface BridgeHeaderProps {
  readonly project:       string;
  readonly overseer:      OverseerFactsDocument | null;
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

const OVERSEER_STATE_LABELS: Readonly<Record<OverseerFactsDocument['state'], string>> = {
  'serving':                'serving',
  'held-by-install-change': 'held for an install change',
  'handing-over':           'passing the Baton',
  'down':                   'down',
};

export function BridgeHeader({
  project, overseer, selectedTab, themeChoice, onThemeChoice
}: BridgeHeaderProps) {
  const overseerLabel = overseer === null ? 'connecting' : `${OVERSEER_STATE_LABELS[overseer.state]}${overseer.paused ? ', paused' : ''}`;
  return (
    <header className="bridge-header">
      <h1 className="bridge-project">{project}</h1>
      <span className="bridge-overseer-state" data-state={overseer?.state ?? 'connecting'}>{`Overseer ${overseerLabel}`}</span>
      {overseer === null ? null : (
        <CommandButton
          label={overseer.paused ? 'Resume' : 'Pause'}
          command={{ kind: overseer.paused ? 'runner-resume' : 'runner-pause' }}
        />
      )}
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
    </header>
  );
}
