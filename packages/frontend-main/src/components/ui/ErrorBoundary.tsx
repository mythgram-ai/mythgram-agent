import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Shown above the error details when a child crashes. */
  title?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Minimal crash guard: if a child throws during render, show a recoverable
 * error card instead of unmounting the whole app to a white blank screen.
 * A reload reboots from the persisted backend state (nothing is deleted).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    // eslint-disable-next-line no-console
    console.error("[app] view crashed:", error);
  }

  private reload = (): void => {
    this.setState({ error: null });
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="grid h-dvh w-full place-items-center bg-[var(--bg)] p-6 text-[var(--fg)]">
          <div className="w-full max-w-md rounded-[var(--radius-xl)] border border-[var(--border)] p-6 text-center">
            <h1 className="m-0 text-sm font-semibold">{this.props.title ?? "Something went wrong"}</h1>
            <p className="mx-0 mb-0 mt-2 text-xs leading-relaxed text-[var(--muted)]">
              A view crashed instead of showing a blank screen. Your chats and settings are safe in
              the local database — reloading restores them.
            </p>
            <p className="mx-0 mb-0 mt-2 break-words font-mono text-[11px] text-[var(--subtle)]">
              {String(this.state.error.message || this.state.error)}
            </p>
            <button
              type="button"
              onClick={this.reload}
              className="mt-4 inline-flex items-center justify-center rounded-[var(--radius-md)] bg-[var(--secondary)] px-4 py-2 text-sm font-medium text-[var(--secondary-fg)] transition-colors hover:brightness-110"
            >
              Reload app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
