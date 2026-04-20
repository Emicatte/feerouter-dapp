'use client'

import { useState, useEffect } from 'react'
import { Link } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { useAccount, useChainId } from 'wagmi'
import dynamic from 'next/dynamic'
import { C } from '@/app/designTokens'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'

import TransferForm from '@/app/TransferForm'
import SwapModule from '@/app/SwapModule'
import { ChainFamilySwitch } from '@/components/shared/ChainFamilySwitch'
import NetworkSelector from '@/app/NetworkSelector'
import AccountHeader, { type NonEvmWalletProps } from '@/app/AccountHeader'
import { useUniversalWallet } from '@/hooks/useUniversalWallet'
import { useWallet as useSolanaWallet } from '@solana/wallet-adapter-react'
import { useTron } from '@/app/providers-tron'

// CommandCenter lazy — usa Recharts e WebSocket pesanti
const CommandCenter = dynamic(() => import('@/app/command-center'), {
  ssr: false,
  loading: () => (
    <div style={{ padding: 40, textAlign: 'center', color: C.sub, fontFamily: C.D }}>
      …
    </div>
  ),
})

type AppTab = 'send' | 'swap' | 'command'

const panelBase: React.CSSProperties = {
  transition: 'opacity 380ms cubic-bezier(0.16,1,0.3,1)',
  willChange: 'opacity',
}
const panelActive: React.CSSProperties = {
  ...panelBase,
  position: 'relative',
  opacity: 1,
  pointerEvents: 'auto',
  zIndex: 1,
}
const panelHidden: React.CSSProperties = {
  ...panelBase,
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  opacity: 0,
  pointerEvents: 'none',
  zIndex: 0,
}

export default function AppPage() {
  const [tab, setTab] = useState<AppTab>('send')
  const { address } = useAccount()
  const chainId = useChainId()
  const [isMobile, setIsMobile] = useState(false)
  const t = useTranslations('dapp')

  // Universal wallet (EVM / Solana / Tron) — source of truth for activeFamily
  const wallet = useUniversalWallet()
  const activeFamily = wallet.activeFamily

  const { disconnect: solanaDisconnect } = useSolanaWallet()
  const tron = useTron()

  // Build nonEvmWallet prop for AccountHeader when active family is Tron/Solana
  const nonEvmWallet: NonEvmWalletProps | undefined = (() => {
    if (activeFamily === 'evm') return undefined
    const conn = activeFamily === 'tron' ? wallet.connections.tron : wallet.connections.solana
    if (!conn?.address) return undefined
    return {
      family: activeFamily as 'tron' | 'solana',
      address: conn.address,
      disconnect: activeFamily === 'tron' ? tron.disconnect : solanaDisconnect,
    }
  })()

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const tabItems: { key: AppTab; label: string }[] = [
    { key: 'send',    label: t('tabs.send') },
    { key: 'swap',    label: t('tabs.swap') },
    { key: 'command', label: t('tabs.flow') },
  ]

  return (
    <>
      {/* Top bar accent — coerente con landing */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 3,
        background: C.text, zIndex: 1001,
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, width: 96, height: 3,
          background: C.purple,
        }} />
      </div>

      {/* Navbar /app — flat flex justify-between, logo+tabs left, cluster right */}
      <nav
        className="fixed left-0 right-0 z-[1000] flex items-center justify-between gap-4 bg-white/85 border-b border-black/[0.06] backdrop-blur-md px-3 md:px-6"
        style={{
          top: 3,
          height: isMobile ? 52 : 60,
          WebkitBackdropFilter: 'blur(16px) saturate(180%)',
        }}
      >
        {/* Left: logo + tabs, flat */}
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 no-underline">
            <img src="/favicon.svg" alt="RSends" width={28} height={28} className="rounded-[7px]" />
            {!isMobile && (
              <span className="font-display text-[16px] font-extrabold tracking-[-0.03em]" style={{ color: C.text }}>
                RSends
              </span>
            )}
          </Link>

          <div className="flex items-center gap-1" role="tablist" aria-label="App sections">
            {tabItems.map(({ key, label }) => {
              const active = tab === key
              return (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  role="tab"
                  aria-selected={active}
                  aria-current={active ? 'page' : undefined}
                  className={[
                    'rounded-md transition-colors font-display',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-black/20 focus-visible:ring-offset-0',
                    isMobile ? 'px-3 py-1.5 text-[12px]' : 'px-3 py-1.5 text-sm',
                    active
                      ? 'bg-neutral-100 text-black font-medium'
                      : 'text-black/60 hover:text-black hover:bg-black/[0.03]',
                  ].join(' ')}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Right: cluster EVM/SOL/TRX | Network | Wallet */}
        <div className="flex items-center gap-2">
          <ChainFamilySwitch
            active={activeFamily}
            onSelect={(family) => wallet.setActiveFamily(family)}
            connections={wallet.connections}
          />
          <NetworkSelector />
          <AccountHeader nonEvmWallet={nonEvmWallet} />
        </div>
      </nav>

      {/* Main container */}
      <main style={{
        paddingTop: isMobile ? 75 : 90,
        paddingBottom: 80,
        minHeight: '100vh',
        background: C.bg,
      }}>
        <div style={{
          maxWidth: tab === 'command' ? 680 : 520,
          margin: '0 auto',
          padding: '0 20px',
          position: 'relative',
        }}>
          {/* Send */}
          <div style={tab === 'send' ? panelActive : panelHidden}>
            <ErrorBoundary module="TransferForm">
              <TransferForm noCard />
            </ErrorBoundary>
          </div>

          {/* Swap */}
          <div style={tab === 'swap' ? panelActive : panelHidden}>
            <ErrorBoundary module="SwapModule">
              <SwapModule noCard onSwapComplete={() => {}} />
            </ErrorBoundary>
          </div>

          {/* Flow */}
          <div style={tab === 'command' ? panelActive : panelHidden}>
            <ErrorBoundary module="CommandCenter">
              <CommandCenter
                ownerAddress={address}
                chainId={chainId}
                isVisible={tab === 'command'}
              />
            </ErrorBoundary>
          </div>
        </div>
      </main>
    </>
  )
}
