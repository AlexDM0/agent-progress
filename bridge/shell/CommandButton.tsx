/**
 * The one control that posts a `ControlCommand`: disabled whenever the shell says controls may not act, and showing the Overseer's
 * refusal verbatim beside itself.
 */
import { useContext, useState } from 'react';

import type { ControlCommandBody }                             from '../api/CommandClient.ts';
import { ControlAvailabilityUtil, ControlSurroundingsContext } from './ControlAvailability.ts';

export interface CommandButtonProps {
  readonly label:                     string;
  readonly command:                   ControlCommandBody;
  /** Restart and Stop: the Overseer answers them while launches are held for an install change. */
  readonly answeredWhileInstallHeld?: boolean;
}

export function CommandButton({ label, command, answeredWhileInstallHeld = false }: CommandButtonProps) {
  const { availability, commandClient, onInstallHeld } = useContext(ControlSurroundingsContext);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const enabled = ControlAvailabilityUtil.controlIsEnabled(availability, answeredWhileInstallHeld) && !sending;

  const send = async (): Promise<void> => {
    setSending(true);
    setRefusal(null);
    const outcome = await commandClient.send(command);
    setSending(false);
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
