/**
 * src/components/swap/TokenInput.tsx — Token amount input field
 *
 * Input field with token selector trigger, balance display,
 * quick-amount buttons (25/50/75/MAX), numeric validation,
 * and USD equivalent display.
 */

'use client';

import { useCallback, type ChangeEvent } from 'react';
import { formatUnits } from 'viem';
import type { Token } from '../../types/token';

/** TokenInput props */
export interface TokenInputProps {
  token: Token | null;
  amount: string;
  onAmountChange: (value: string) => void;
  onTokenSelect: () => void;
  balance?: string;
  balanceRaw?: bigint;
  label: string;
  readOnly?: boolean;
  usdValue?: number | null;
  disabled?: boolean;
}

/** Regex for valid decimal number input */
const DECIMAL_REGEX = /^[0-9]*\.?[0-9]*$/;

/**
 * Validate and clamp the decimal input based on token decimals.
 * @internal
 */
function sanitizeInput(value: string, decimals: number): string {
  // Allow empty
  if (value === '' || value === '.') return value;

  // Only allow valid decimal characters
  if (!DECIMAL_REGEX.test(value)) return '';

  // Clamp decimal places to token's decimals
  const parts = value.split('.');
  if (parts.length === 2 && parts[1].length > decimals) {
    return `${parts[0]}.${parts[1].slice(0, decimals)}`;
  }

  return value;
}

/**
 * Token amount input with selector trigger, balance, and quick amounts.
 */
export function TokenInput({
  token,
  amount,
  onAmountChange,
  onTokenSelect,
  balance,
  balanceRaw,
  label,
  readOnly,
  usdValue,
  disabled,
}: TokenInputProps) {
  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const sanitized = sanitizeInput(e.target.value, token?.decimals ?? 18);
      if (sanitized !== '') {
        onAmountChange(sanitized);
      } else if (e.target.value === '') {
        onAmountChange('');
      }
    },
    [token, onAmountChange],
  );

  const handleQuickAmount = useCallback(
    (percent: number) => {
      if (!balanceRaw || !token) return;
      const portion = (balanceRaw * BigInt(percent)) / 100n;
      const formatted = formatUnits(portion, token.decimals);
      onAmountChange(formatted);
    },
    [balanceRaw, token, onAmountChange],
  );

  return (
    <div className="swap-token-input" data-disabled={disabled || undefined}>
      <div className="swap-token-input__header">
        <span className="swap-token-input__label">{label}</span>
        {balance && (
          <span className="swap-token-input__balance">
            Balance: {Number(balance).toFixed(6)}
          </span>
        )}
      </div>

      <div className="swap-token-input__row">
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={amount}
          onChange={handleChange}
          placeholder="0.0"
          readOnly={readOnly}
          disabled={disabled}
          className="swap-token-input__field"
        />
        <button
          type="button"
          onClick={onTokenSelect}
          className="swap-token-input__token-btn"
          disabled={disabled}
        >
          {token?.logoURI && (
            <img
              src={token.logoURI}
              alt={token.symbol}
              width={24}
              height={24}
              className="swap-token-input__token-icon"
            />
          )}
          <span>{token?.symbol ?? 'Select'}</span>
          <span aria-hidden="true">&#9662;</span>
        </button>
      </div>

      <div className="swap-token-input__footer">
        {usdValue != null && usdValue > 0 && (
          <span className="swap-token-input__usd">
            ~${usdValue.toFixed(2)}
          </span>
        )}
        {!readOnly && balance && (
          <div className="swap-token-input__quick-amounts">
            <button type="button" onClick={() => handleQuickAmount(25)}>
              25%
            </button>
            <button type="button" onClick={() => handleQuickAmount(50)}>
              50%
            </button>
            <button type="button" onClick={() => handleQuickAmount(75)}>
              75%
            </button>
            <button type="button" onClick={() => handleQuickAmount(100)}>
              MAX
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
