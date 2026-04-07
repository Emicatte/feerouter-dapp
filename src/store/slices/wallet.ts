/**
 * src/store/slices/wallet.ts — Zustand slice: connection state
 *
 * Client-side wallet state managed independently from wagmi
 * for UI-specific concerns (modals, last-used connector, etc.).
 */

import type { StateCreator } from 'zustand';
import type { WalletState } from '../../types/wallet';
import type { TrackedTransaction, TxStatus, SerializedTransaction } from '../../types/transaction';
import { TxWatcher } from '../../services/background/tx-watcher';

/** localStorage key for persisting last-used connector */
const LAST_CONNECTOR_STORAGE_KEY = 'wc-last-connector';

/** Wallet slice state */
export interface WalletSlice {
  wallet: WalletState;
  lastConnectorId: string | null;
  /** Merge partial wallet state */
  setWallet: (wallet: Partial<WalletState>) => void;
  /** Persist last-used connector ID */
  setLastConnector: (id: string) => void;
  /** Reset wallet to initial disconnected state */
  resetWallet: () => void;
  /** Set full connected state in one call */
  setConnected: (data: {
    address: `0x${string}`;
    chainId: number;
    connector: string;
  }) => void;
  /** Reset wallet and clear persisted connector */
  setDisconnected: () => void;
  /** Update only the chain ID */
  setChainId: (chainId: number) => void;
  /** Update ENS name and avatar */
  setEnsData: (ensName: string | null, ensAvatar: string | null) => void;

  // ── Transaction history (PROMPT 5) ──────────────────────────
  /** All tracked transactions across chains */
  transactions: SerializedTransaction[];
  /** Add a new tracked transaction */
  addTransaction: (tx: SerializedTransaction) => void;
  /** Update an existing transaction by hash */
  updateTransaction: (hash: `0x${string}`, updates: Partial<SerializedTransaction>) => void;
  /** Clear transaction history for a chain (or all chains) */
  clearHistory: (chainId?: number) => void;
  /** Load transaction history from TxWatcher localStorage */
  loadHistory: (chainId: number) => void;
}

/** Initial wallet state */
const INITIAL_WALLET: WalletState = {
  address: null,
  chainId: null,
  isConnected: false,
  isConnecting: false,
  connector: null,
  ensName: null,
  ensAvatar: null,
};

/**
 * Typed selectors for use with useAppStore.
 * @example const address = useAppStore(walletSelectors.address);
 */
export const walletSelectors = {
  /** Select the connected wallet address */
  address: (state: WalletSlice) => state.wallet.address,
  /** Select whether a wallet is connected */
  isConnected: (state: WalletSlice) => state.wallet.isConnected,
  /** Select the current chain ID */
  chainId: (state: WalletSlice) => state.wallet.chainId,
  /** Select the full wallet state object */
  wallet: (state: WalletSlice) => state.wallet,
  /** Select the last-used connector ID */
  lastConnectorId: (state: WalletSlice) => state.lastConnectorId,
  /** Select all transactions */
  transactions: (state: WalletSlice) => state.transactions,
  /** Select only pending transactions */
  pendingTransactions: (state: WalletSlice) =>
    state.transactions.filter(
      (tx) => tx.status === 'pending' || tx.status === 'confirming' || tx.status === 'approving',
    ),
  /** Select recent transactions (limited) */
  recentTransactions: (limit: number) => (state: WalletSlice) =>
    state.transactions.slice(0, limit),
  /** Select transactions for a specific chain */
  transactionsByChain: (chainId: number) => (state: WalletSlice) =>
    state.transactions.filter((tx) => tx.chainId === chainId),
} as const;

/**
 * Read last-used connector ID from localStorage.
 * @returns The connector ID string, or null if unavailable.
 */
function readLastConnector(): string | null {
  try {
    return localStorage.getItem(LAST_CONNECTOR_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Persist connector ID to localStorage.
 * Silently fails during SSR or when storage is blocked.
 */
function writeLastConnector(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(LAST_CONNECTOR_STORAGE_KEY, id);
    } else {
      localStorage.removeItem(LAST_CONNECTOR_STORAGE_KEY);
    }
  } catch {
    /* SSR or storage blocked */
  }
}

/** Wallet slice creator */
export const createWalletSlice: StateCreator<WalletSlice> = (set) => ({
  wallet: INITIAL_WALLET,
  lastConnectorId: readLastConnector(),

  setWallet: (partial) =>
    set((state) => ({ wallet: { ...state.wallet, ...partial } })),

  setLastConnector: (id) => {
    writeLastConnector(id);
    set({ lastConnectorId: id });
  },

  resetWallet: () => set({ wallet: INITIAL_WALLET }),

  setConnected: ({ address, chainId, connector }) =>
    set({
      wallet: {
        ...INITIAL_WALLET,
        address,
        chainId,
        isConnected: true,
        isConnecting: false,
        connector,
      },
    }),

  setDisconnected: () => {
    writeLastConnector(null);
    set({ wallet: INITIAL_WALLET, lastConnectorId: null });
  },

  setChainId: (chainId) =>
    set((state) => ({ wallet: { ...state.wallet, chainId } })),

  setEnsData: (ensName, ensAvatar) =>
    set((state) => ({ wallet: { ...state.wallet, ensName, ensAvatar } })),

  // ── Transaction history (PROMPT 5) ──────────────────────────
  transactions: [],

  addTransaction: (tx) =>
    set((state) => {
      // Avoid duplicates
      const exists = state.transactions.some(
        (t) => t.hash.toLowerCase() === tx.hash.toLowerCase(),
      );
      if (exists) return state;
      return { transactions: [tx, ...state.transactions] };
    }),

  updateTransaction: (hash, updates) =>
    set((state) => ({
      transactions: state.transactions.map((tx) =>
        tx.hash.toLowerCase() === hash.toLowerCase()
          ? { ...tx, ...updates }
          : tx,
      ),
    })),

  clearHistory: (chainId) =>
    set((state) => {
      const watcher = TxWatcher.getInstance();
      watcher.clearHistory(chainId);
      if (chainId != null) {
        return {
          transactions: state.transactions.filter((tx) => tx.chainId !== chainId),
        };
      }
      return { transactions: [] };
    }),

  loadHistory: (chainId) =>
    set(() => {
      const watcher = TxWatcher.getInstance();
      const history = watcher.getHistory(chainId);
      return { transactions: history };
    }),
});
