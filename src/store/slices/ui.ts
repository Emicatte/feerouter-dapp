/**
 * src/store/slices/ui.ts — Zustand slice: UI state
 *
 * Manages modals, toasts, and transient UI state.
 */

import type { StateCreator } from 'zustand';

/** Toast notification */
export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
}

// ────────────────────────────────────────────────────────────────
// Enhanced toast type (PROMPT 9)
// ────────────────────────────────────────────────────────────────

/** Toast action button */
export interface ToastAction {
  /** Button label */
  label: string;
  /** Callback when clicked */
  onClick: () => void;
}

/** Enhanced toast with loading state, title, suggestion, and action */
export interface EnhancedToast {
  id: string;
  /** Toast type — 'loading' requires manual dismissal */
  type: 'success' | 'error' | 'warning' | 'info' | 'loading';
  /** Optional short title (bold heading) */
  title?: string;
  /** Main message body */
  message: string;
  /** Recovery suggestion (shown below message) */
  suggestion?: string;
  /** Auto-dismiss duration in ms (null = manual only) */
  duration: number | null;
  /** Optional action button (e.g. "View on Explorer") */
  action?: ToastAction;
  /** Timestamp for ordering */
  createdAt: number;
}

/** Active modal identifiers */
export type ModalId =
  | 'connect-wallet'
  | 'account'
  | 'chain-selector'
  | 'token-selector-in'
  | 'token-selector-out'
  | 'confirm-swap'
  | 'settings'
  | null;

/** UI slice state */
export interface UISlice {
  activeModal: ModalId;
  toasts: Toast[];
  openModal: (id: Exclude<ModalId, null>) => void;
  closeModal: () => void;
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  /** Enhanced toast queue (PROMPT 9) */
  enhancedToasts: EnhancedToast[];
  addEnhancedToast: (toast: Omit<EnhancedToast, 'id' | 'createdAt'>) => string;
  removeEnhancedToast: (id: string) => void;
  clearAllToasts: () => void;
  /** Update an existing toast (e.g. loading → success) */
  updateEnhancedToast: (id: string, patch: Partial<Omit<EnhancedToast, 'id' | 'createdAt'>>) => void;
}

/** UI slice creator */
export const createUISlice: StateCreator<UISlice> = (set) => ({
  activeModal: null,
  toasts: [],
  openModal: (id) => set({ activeModal: id }),
  closeModal: () => set({ activeModal: null }),
  addToast: (toast) =>
    set((state) => ({
      toasts: [...state.toasts, { ...toast, id: crypto.randomUUID() }],
    })),
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),

  // ── Enhanced toasts (PROMPT 9) ─────────────────────────────
  enhancedToasts: [],
  addEnhancedToast: (toast) => {
    const id = crypto.randomUUID();
    set((state) => ({
      enhancedToasts: [
        ...state.enhancedToasts,
        { ...toast, id, createdAt: Date.now() },
      ],
    }));
    return id;
  },
  removeEnhancedToast: (id) =>
    set((state) => ({
      enhancedToasts: state.enhancedToasts.filter((t) => t.id !== id),
    })),
  clearAllToasts: () => set({ toasts: [], enhancedToasts: [] }),
  updateEnhancedToast: (id, patch) =>
    set((state) => ({
      enhancedToasts: state.enhancedToasts.map((t) =>
        t.id === id ? { ...t, ...patch } : t,
      ),
    })),
});
