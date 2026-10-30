/** A chat box that sends `job-message` to one session, clearing itself once the Overseer took the turn. */
import { useState } from 'react';

import { CommandButton } from '../shell/CommandButton.tsx';

export interface ChatBoxProps {
  readonly label:   string;
  /** `null` while no session can take a turn: the box stays, its Send disabled. */
  readonly jobId:   string | null;
  readonly onSent?: (text: string) => void;
}

export function ChatBox({ label, jobId, onSent }: ChatBoxProps) {
  const [text, setText] = useState('');
  const trimmed = text.trim();
  return (
    <div className="bridge-form">
      <textarea className="bridge-textarea" aria-label={label} value={text} onChange={(event) => setText(event.target.value)} />
      <CommandButton
        label="Send"
        command={jobId === null || trimmed === '' ? null : { kind: 'job-message', jobId, text: trimmed }}
        onApplied={() => {
          onSent?.(trimmed);
          setText('');
        }}
      />
    </div>
  );
}
