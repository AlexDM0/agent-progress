/**
 * Agent-written HTML, an epic's `descriptionHtml`, reaches the DOM only as the `srcdoc` of a sandboxed frame: fixed markup plus the string.
 * Without `allow-scripts` nothing in it runs; `allow-same-origin` lets the parent size the frame to its content; links open in a new tab.
 */
import { useEffect, useRef, useState } from 'react';

export const SANDBOX_PERMISSIONS = 'allow-same-origin allow-popups allow-popups-to-escape-sandbox';

const FRAME_DOCUMENT_HEAD = '<!doctype html><html><head><meta charset="utf-8"><base target="_blank"></head><body>';

const FRAME_DOCUMENT_FOOT = '</body></html>';

export interface SandboxedHtmlProps {
  readonly html:  string;
  readonly title: string;
}

export function SandboxedHtml({ html, title }: SandboxedHtmlProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);

  useEffect(() => {
    const element = frame.current;
    if (element === null) return undefined;
    let observer: ResizeObserver | null = null;
    const measure = (): void => {
      const body = element.contentDocument?.body ?? null;
      if (body === null) return;
      setContentHeight(body.scrollHeight);
      if (observer === null && typeof ResizeObserver === 'function') {
        observer = new ResizeObserver(() => setContentHeight(body.scrollHeight));
        observer.observe(body);
      }
    };
    element.addEventListener('load', measure);
    return () => {
      element.removeEventListener('load', measure);
      observer?.disconnect();
    };
  }, [html]);

  return (
    <iframe
      ref={frame}
      className="bridge-sandboxed-html"
      title={title}
      sandbox={SANDBOX_PERMISSIONS}
      srcDoc={`${FRAME_DOCUMENT_HEAD}${html}${FRAME_DOCUMENT_FOOT}`}
      style={contentHeight === null ? undefined : { height: `${contentHeight}px` }}
    />
  );
}
