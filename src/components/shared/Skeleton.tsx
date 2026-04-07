/**
 * src/components/shared/Skeleton.tsx — Content skeleton placeholder
 */

'use client';

/** Skeleton props */
export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  borderRadius?: number;
  className?: string;
}

/**
 * Animated skeleton placeholder for loading states.
 */
export function Skeleton({
  width = '100%',
  height = 16,
  borderRadius = 4,
  className,
}: SkeletonProps) {
  return (
    <div
      className={className}
      style={{
        width,
        height,
        borderRadius,
        background: 'rgba(255,255,255,0.06)',
        animation: 'pulse 1.5s ease-in-out infinite',
      }}
      aria-hidden="true"
    />
  );
}
