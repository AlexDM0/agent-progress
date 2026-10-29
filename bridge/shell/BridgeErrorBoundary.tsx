/**
 * Catches whatever a view throws while rendering and shows a banner in its place, the static page's failed-bundle banner in the Bridge.
 * React offers error boundaries only as class components.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface BridgeErrorBoundaryProps {
  readonly children: ReactNode;
  readonly onError?: (error: unknown, info: ErrorInfo) => void;
}

interface BridgeErrorBoundaryState {
  readonly failure: string | null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class BridgeErrorBoundary extends Component<BridgeErrorBoundaryProps, BridgeErrorBoundaryState> {
  override state: BridgeErrorBoundaryState = { failure: null };

  static getDerivedStateFromError(error: unknown): BridgeErrorBoundaryState {
    return { failure: messageOf(error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  override render(): ReactNode {
    if (this.state.failure === null) return this.props.children;
    return (
      <div className="bridge-banner bridge-banner-error" role="alert">
        {`The Bridge failed to render: ${this.state.failure}. Reload the page; the board itself is unaffected.`}
      </div>
    );
  }
}
