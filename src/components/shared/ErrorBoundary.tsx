/**
 * src/components/shared/ErrorBoundary.tsx — React error boundary
 *
 * Catches rendering errors and shows a fallback UI.
 */

'use client';

import { Component, type ReactNode, type ErrorInfo } from 'react';

/** ErrorBoundary props */
export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

/** ErrorBoundary state */
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary that catches render errors in child components.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div role="alert">
          <h2>Something went wrong</h2>
          <p>{this.state.error?.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

// ────────────────────────────────────────────────────────────────
// Enhanced error boundary with retry, reset, and analytics (PROMPT 9)
// ────────────────────────────────────────────────────────────────

/** Error log entry for analytics (no sensitive data) */
interface BoundaryErrorLog {
  name: string;
  componentStack?: string;
  timestamp: number;
}

/** Enhanced ErrorBoundary props */
export interface AppErrorBoundaryProps {
  children: ReactNode;
  /** Optional custom fallback component */
  fallback?: ReactNode;
  /** Section label for error logs (e.g. "SwapCard", "Portfolio") */
  section?: string;
  /** Called when disconnect/reset is triggered */
  onReset?: () => void;
}

/** Enhanced ErrorBoundary state */
interface AppErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/** Buffered error logs for analytics export */
const boundaryErrorLog: BoundaryErrorLog[] = [];

/** Get boundary error logs (copy) */
export function getBoundaryErrors(): BoundaryErrorLog[] {
  return [...boundaryErrorLog];
}

/**
 * Enhanced error boundary with:
 * - User-friendly fallback UI (no technical details exposed)
 * - "Retry" button to re-render children
 * - "Reset" button to disconnect wallet and reload
 * - "Report" link placeholder
 * - Error logging for analytics (no stack traces to user)
 *
 * Does NOT crash the entire app for a single component failure.
 *
 * @example
 * ```tsx
 * <AppErrorBoundary section="SwapCard" onReset={disconnect}>
 *   <SwapCard />
 * </AppErrorBoundary>
 * ```
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log for analytics (no sensitive data)
    const entry: BoundaryErrorLog = {
      name: error.name,
      componentStack: errorInfo.componentStack?.slice(0, 200),
      timestamp: Date.now(),
    };

    boundaryErrorLog.push(entry);
    if (boundaryErrorLog.length > 50) {
      boundaryErrorLog.splice(0, boundaryErrorLog.length - 50);
    }

    // Console (dev only)
    console.error(
      `[AppErrorBoundary${this.props.section ? `:${this.props.section}` : ''}]`,
      error.name,
    );

    this.setState({ errorInfo });
  }

  /** Retry: clear error state and re-render children */
  private handleRetry = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  /** Reset: disconnect wallet and reload the page */
  private handleReset = (): void => {
    this.props.onReset?.();
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    // Custom fallback takes priority
    if (this.props.fallback) {
      return this.props.fallback;
    }

    // Default styled fallback
    return (
      <div className="error-boundary" role="alert" aria-live="assertive">
        <div className="error-boundary__icon" aria-hidden="true">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>

        <h2 className="error-boundary__title">Something went wrong</h2>

        <p className="error-boundary__message">
          {this.props.section
            ? `An error occurred in the ${this.props.section} section.`
            : 'An unexpected error occurred.'}
          {' '}Your funds are safe — this is a display issue only.
        </p>

        <div className="error-boundary__actions">
          <button
            type="button"
            className="error-boundary__btn error-boundary__btn--primary"
            onClick={this.handleRetry}
          >
            Try again
          </button>
          <button
            type="button"
            className="error-boundary__btn error-boundary__btn--secondary"
            onClick={this.handleReset}
          >
            Reset app
          </button>
        </div>

        <a
          className="error-boundary__report"
          href="https://github.com/anthropics/claude-code/issues"
          target="_blank"
          rel="noopener noreferrer"
        >
          Report this issue
        </a>
      </div>
    );
  }
}
