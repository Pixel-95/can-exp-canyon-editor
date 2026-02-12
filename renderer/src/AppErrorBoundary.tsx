import { Component, type ErrorInfo, type ReactNode } from "react";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  public state: AppErrorBoundaryState = {
    hasError: false,
    message: "",
  };

  public static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || "Unexpected renderer error.",
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("Renderer error boundary caught an error:", error, errorInfo);
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "grid",
            placeItems: "center",
            width: "100%",
            height: "100%",
            background: "#f8fafc",
            color: "#0f172a",
            fontFamily: "\"Segoe UI\", \"Helvetica Neue\", sans-serif",
          }}
        >
          <div
            style={{
              maxWidth: "680px",
              width: "90%",
              background: "#ffffff",
              border: "1px solid #cbd5e1",
              borderRadius: "10px",
              padding: "16px",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Renderer Error</h2>
            <p style={{ margin: "0 0 12px" }}>
              The app hit an unexpected error and recovered into safe mode.
            </p>
            <p style={{ margin: "0 0 12px", wordBreak: "break-word" }}>
              <strong>Message:</strong> {this.state.message}
            </p>
            <button type="button" onClick={() => window.location.reload()}>
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
