/**
 * src/components/shared/Toast.tsx — Toast notification component
 */

'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { Toast as ToastType, EnhancedToast } from '../../store/slices/ui';
import { useAppStore } from '../../store';

/** Toast props */
export interface ToastProps {
  toast: ToastType;
  onDismiss: (id: string) => void;
}

/**
 * Single toast notification with dismiss action.
 */
export function Toast({ toast, onDismiss }: ToastProps) {
  return (
    <div role="alert" data-type={toast.type}>
      <span>{toast.message}</span>
      <button type="button" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
        &times;
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Enhanced toast system (PROMPT 9)
// ────────────────────────────────────────────────────────────────

/** Default auto-dismiss durations by type (ms) */
const AUTO_DISMISS_MS: Record<EnhancedToast['type'], number | null> = {
  success: 3_000,
  error:   8_000,
  warning: 6_000,
  info:    4_000,
  loading: null, // manual only
};

/** Max visible toasts in the stack */
const MAX_VISIBLE = 3;

// ── Icons per type ───────────────────────────────────────────

function SuccessIcon() {
  return (
    <svg className="toast-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg className="toast-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg className="toast-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg className="toast-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function LoadingIcon() {
  return (
    <div className="toast-icon spinner" style={{ width: 18, height: 18, borderColor: 'rgba(255,255,255,0.2)', borderTopColor: 'var(--pink)' }} />
  );
}

const ICON_MAP: Record<EnhancedToast['type'], () => JSX.Element> = {
  success: SuccessIcon,
  error: ErrorIcon,
  warning: WarningIcon,
  info: InfoIcon,
  loading: LoadingIcon,
};

// ── Single enhanced toast item ───────────────────────────────

interface EnhancedToastItemProps {
  toast: EnhancedToast;
  onDismiss: (id: string) => void;
}

/**
 * Single enhanced toast with icon, title, message, suggestion,
 * optional action button, and auto-dismiss timer.
 */
function EnhancedToastItem({ toast, onDismiss }: EnhancedToastItemProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissingRef = useRef(false);

  const dismiss = useCallback(() => {
    if (dismissingRef.current) return;
    dismissingRef.current = true;
    // Allow CSS exit animation time
    const el = document.getElementById(`toast-${toast.id}`);
    if (el) {
      el.setAttribute('data-exiting', 'true');
    }
    setTimeout(() => onDismiss(toast.id), 250);
  }, [toast.id, onDismiss]);

  useEffect(() => {
    const duration = toast.duration ?? AUTO_DISMISS_MS[toast.type];
    if (duration === null) return;

    timerRef.current = setTimeout(dismiss, duration);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast.duration, toast.type, dismiss]);

  const Icon = ICON_MAP[toast.type];

  return (
    <div
      id={`toast-${toast.id}`}
      className="enhanced-toast"
      data-type={toast.type}
      role="alert"
      aria-live="polite"
    >
      <div className="enhanced-toast__icon">
        <Icon />
      </div>

      <div className="enhanced-toast__body">
        {toast.title && (
          <div className="enhanced-toast__title">{toast.title}</div>
        )}
        <div className="enhanced-toast__message">{toast.message}</div>
        {toast.suggestion && (
          <div className="enhanced-toast__suggestion">{toast.suggestion}</div>
        )}
        {toast.action && (
          <button
            type="button"
            className="enhanced-toast__action"
            onClick={() => {
              toast.action!.onClick();
              dismiss();
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>

      {toast.type !== 'loading' && (
        <button
          type="button"
          className="enhanced-toast__dismiss"
          onClick={dismiss}
          aria-label="Dismiss notification"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ── Toast container (renders the stack) ──────────────────────

/**
 * Toast container that renders the enhanced toast stack.
 * Shows max 3 toasts; queues the rest.
 * Position: fixed top-right. Does not block app interaction.
 *
 * Mount this once in the app root (e.g. layout or providers).
 *
 * @example
 * ```tsx
 * // In layout.tsx or providers.tsx:
 * <ToastContainer />
 * ```
 */
export function ToastContainer() {
  const toasts = useAppStore((s) => s.enhancedToasts);
  const removeEnhancedToast = useAppStore((s) => s.removeEnhancedToast);

  // Show only the most recent MAX_VISIBLE toasts
  const visible = toasts.slice(-MAX_VISIBLE);

  if (visible.length === 0) return null;

  return (
    <div
      className="toast-container"
      aria-label="Notifications"
      role="region"
    >
      {visible.map((toast) => (
        <EnhancedToastItem
          key={toast.id}
          toast={toast}
          onDismiss={removeEnhancedToast}
        />
      ))}
    </div>
  );
}

// ── Convenience hook ─────────────────────────────────────────

/**
 * Hook for toast operations.
 * Returns `addToast`, `removeToast`, `updateToast`, `clearAll`.
 *
 * @example
 * ```tsx
 * const { addToast, updateToast } = useToastStore();
 *
 * // Loading → Success flow
 * const id = addToast({ type: 'loading', message: 'Swapping...' });
 * // ... after tx confirms:
 * updateToast(id, {
 *   type: 'success',
 *   message: 'Swap confirmed!',
 *   duration: 3000,
 *   action: { label: 'View on Explorer', onClick: () => window.open(url) },
 * });
 * ```
 */
export function useToastStore() {
  const addEnhancedToast = useAppStore((s) => s.addEnhancedToast);
  const removeEnhancedToast = useAppStore((s) => s.removeEnhancedToast);
  const updateEnhancedToast = useAppStore((s) => s.updateEnhancedToast);
  const clearAllToasts = useAppStore((s) => s.clearAllToasts);

  const addToast = useCallback(
    (toast: Omit<EnhancedToast, 'id' | 'createdAt' | 'duration'> & { duration?: number | null }) => {
      const duration = toast.duration !== undefined ? toast.duration : (AUTO_DISMISS_MS[toast.type] ?? null);
      return addEnhancedToast({ ...toast, duration });
    },
    [addEnhancedToast],
  );

  return {
    addToast,
    removeToast: removeEnhancedToast,
    updateToast: updateEnhancedToast,
    clearAll: clearAllToasts,
  };
}
