/**
 * src/components/shared/LoadingSpinner.tsx — Animated loading spinner
 */

'use client';

/** LoadingSpinner props */
export interface LoadingSpinnerProps {
  size?: number;
  className?: string;
}

/**
 * Simple CSS-animated loading spinner.
 */
export function LoadingSpinner({ size = 24, className }: LoadingSpinnerProps) {
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        border: '2px solid rgba(255,255,255,0.1)',
        borderTopColor: '#3B82F6',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }}
      role="status"
      aria-label="Loading"
    />
  );
}
