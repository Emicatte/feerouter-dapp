/**
 * src/lib/utils/format.ts — Number and address formatting
 *
 * Display-friendly formatters for balances, prices, and addresses.
 */

/**
 * Truncate an Ethereum address for display.
 * @param address - Full 0x address
 * @param chars - Characters to show on each side (default 4)
 * @example truncateAddress('0x1234...abcd') → '0x1234…abcd'
 */
export function truncateAddress(address: string, chars: number = 4): string {
  if (address.length <= chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}…${address.slice(-chars)}`;
}

/**
 * Format a token balance for display.
 * @param value - Numeric balance value
 * @param decimals - Number of decimal places
 */
export function formatBalance(value: number, decimals: number = 4): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format a USD value for display.
 * @param value - USD amount
 */
export function formatUsd(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format a EUR value for display.
 * @param value - EUR amount
 */
export function formatEur(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format gas price in Gwei.
 * @param weiValue - Gas price in wei (bigint)
 */
export function formatGwei(weiValue: bigint): string {
  const gwei = Number(weiValue) / 1e9;
  return `${gwei.toFixed(1)} Gwei`;
}
