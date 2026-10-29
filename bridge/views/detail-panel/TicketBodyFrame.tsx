/**
 * A ticket's rendered body, agent-written, reaches the DOM only as the `srcdoc` of this frame: without `allow-scripts` nothing in it runs,
 * `allow-same-origin` lets the panel size the frame to its content, and links open in a new tab.
 */
import { useEffect, useRef, useState } from 'react';

export const TICKET_BODY_SANDBOX = 'allow-same-origin allow-popups allow-popups-to-escape-sandbox';

export interface TicketBodyFrameProps {
  readonly title:          string;
  readonly sourceDocument: string;
}

export function TicketBodyFrame({ title, sourceDocument }: TicketBodyFrameProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const [loadCount, setLoadCount] = useState(0);

  useEffect(() => {
    const body = frame.current?.contentDocument?.body;
    if (body === undefined || body === null || typeof ResizeObserver === 'undefined') return undefined;
    const measure = (): void => setContentHeight(body.scrollHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [loadCount]);

  return (
    <iframe
      ref={frame}
      className="bridge-ticket-body"
      title={`Description of ${title}`}
      sandbox={TICKET_BODY_SANDBOX}
      srcDoc={sourceDocument}
      style={contentHeight === null ? undefined : { height: `${contentHeight}px` }}
      onLoad={() => setLoadCount((count) => count + 1)}
    />
  );
}
