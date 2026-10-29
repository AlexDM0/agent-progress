/**
 * The one control that posts a `ControlCommand`: disabled whenever the shell says controls may not act, and showing the Overseer's
 * refusal verbatim beside itself.
 */
import { useContext, useState } from 'react';

import type { ControlCommandBody }                             from '../api/CommandClient.ts';
import { ControlAvailabilityUtil, ControlSurroundingsContext } from './ControlAvailability.ts';

export interface CommandButtonProps {
  readonly label:                     string;
  /** `null` while a form behind the control is not complete: the control stays disabled. */
  readonly command:                   ControlCommandBody | null;
  /** Restart and Stop: the Overseer answers them while launches are held for an install change. */
  readonly answeredWhileInstallHeld?: boolean;
  /** The view's own reason it has nothing to send, such as a multi-select with nothing selected. */
  readonly hasNothingToSend?:         boolean;
  /** Called once the Overseer applied the command, so a form can clear itself. */
  readonly onApplied?:                () => void;
}

export function CommandButton({
  label, command, answeredWhileInstallHeld = false, hasNothingToSend = false, onApplied
}: CommandButtonProps) {
  const { availability, commandClient, onInstallHeld } = useContext(ControlSurroundingsContext);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const enabled = ControlAvailabilityUtil.controlIsEnabled(availability, answeredWhileInstallHeld) && !sending && !hasNothingToSend && command !== null;

  const send = async (): Promise<void> => {
    if (command === null) return;
    setSending(true);
    setRefusal(null);
    const outcome = await commandClient.send(command);
    setSending(false);
    if (outcome.verdict === 'applied') onApplied?.();
    if (outcome.verdict === 'refused') setRefusal(outcome.refusal);
    if (outcome.verdict === 'install-held') onInstallHeld(outcome.refusal);
  };

  return (
    <span className="bridge-control">
      <button type="button" className="bridge-button" disabled={!enabled} onClick={() => void send()}>{label}</button>
      {refusal === null ? null : <span className="bridge-refusal" role="status">{refusal}</span>}
    </span>
  );
}
