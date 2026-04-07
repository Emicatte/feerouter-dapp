/**
 * src/app/layout.tsx — Root layout with design system
 *
 * Uses next/font for zero layout shift (Syne + DM Mono).
 * Wraps children with providers, toast container, and error boundary.
 */

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Syne, DM_Mono } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

/** Syne — display font for headings and UI */
const syne = Syne({
  subsets: ['latin'],
  variable: '--font-syne',
  display: 'swap',
  weight: ['400', '600', '700', '800'],
});

/** DM Mono — monospace font for amounts, addresses, code */
const dmMono = DM_Mono({
  subsets: ['latin'],
  variable: '--font-dm-mono',
  display: 'swap',
  weight: ['300', '400', '500'],
});

export const metadata: Metadata = {
  title: 'Swap — Web3 Wallet Connect',
  description: 'Swap tokens across EVM chains with fee routing.',
  icons: { icon: '/favicon.svg' },
};

/** Layout props */
export interface RootLayoutProps {
  children: ReactNode;
}

/**
 * Root layout with font variables, providers, and global styles.
 */
export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" className={`${syne.variable} ${dmMono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
