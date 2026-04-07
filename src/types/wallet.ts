/**
 * src/types/wallet.ts — Wallet connection state types
 *
 * Describes the connected wallet state exposed by wagmi
 * and enriched with ENS data.
 */

/** Current wallet connection state */
export interface WalletState {
  address: `0x${string}` | null;
  chainId: number | null;
  isConnected: boolean;
  isConnecting: boolean;
  connector: string | null;
  ensName: string | null;
  ensAvatar: string | null;
}

/** Supported wallet connector identifiers */
export type ConnectorId =
  | 'injected'
  | 'walletConnect'
  | 'coinbaseWallet'
  | 'safe';

/** Wallet connection request */
export interface ConnectRequest {
  connectorId: ConnectorId;
  chainId?: number;
}

/** Wallet disconnect reason */
export type DisconnectReason = 'user' | 'error' | 'chain_unsupported';
