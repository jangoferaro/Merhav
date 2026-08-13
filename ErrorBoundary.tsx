import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

type Props = { children: ReactNode };
type State = { hasError: boolean };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          dir="rtl"
          className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
          <p className="text-[1.15rem] font-light">משהו נשבר כאן</p>
          <p className="max-w-sm text-[0.9rem] leading-relaxed text-muted-foreground">
            אפשר לרענן את הדף ולנסות שוב.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-full border border-border bg-card/60 px-5 py-2.5 text-[0.9rem] transition-all duration-200 hover:border-primary/40 hover:bg-primary/[0.07] active:scale-[0.97]">
            רענון
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
