import React from "react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Shown above the message. Say which part failed, not "something went wrong". */
  title?: string;
  /** What the reader loses while this is broken. Reassure them about the journal. */
  detail?: string;
  /** When set, the boundary offers a local retry instead of a full page reload. */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * A crash inside one panel must never take the journal down with it.
 *
 * Wrap the whole app once, and wrap every enhancement panel (digest, insights,
 * research) separately, so that the write, save, close and digest loop keeps
 * working when an enhancement throws.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log the shape of the failure, never the writer's content.
    console.error("[ErrorBoundary]", this.props.title || "app", error.message, info.componentStack);
  }

  handleReset = () => {
    if (this.props.onReset) {
      this.setState({ error: null });
      this.props.onReset();
    } else {
      window.location.reload();
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          background: "var(--bg-sunk)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "var(--s5)",
          margin: "var(--s5) auto",
          maxWidth: "var(--measure)",
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-ai)",
            fontSize: 15,
            fontWeight: 600,
            color: "var(--text)",
            margin: 0,
          }}
        >
          {this.props.title || "This part stopped working"}
        </p>
        <p
          style={{
            fontFamily: "var(--font-ai)",
            fontSize: 14,
            color: "var(--text-muted)",
            lineHeight: 1.6,
            marginTop: "var(--s2)",
            marginBottom: "var(--s4)",
          }}
        >
          {this.props.detail || "Nothing you wrote has been lost."}
        </p>
        <button className="btn btn-secondary" onClick={this.handleReset}>
          {this.props.onReset ? "Try again" : "Reload"}
        </button>
      </div>
    );
  }
}
