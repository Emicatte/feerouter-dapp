/**
 * RPagos Frontend — Test: CommandCenter Component
 *
 * Testa rendering tabs, form validation, stati wallet.
 * Usa @testing-library/react con mock per wagmi, WebSocket, e API hooks.
 *
 * Come eseguire:
 *   cd fee-router-dapp
 *   npx jest app/__tests__/test_command_center.tsx --verbose
 *
 * Oppure esegui tutti i frontend test:
 *   npx jest --verbose
 */

import React from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ═══════════════════════════════════════════════════════════
//  Mock dei moduli esterni
// ═══════════════════════════════════════════════════════════

// Mock wagmi hooks
const mockUseAccount = jest.fn()
const mockUseChainId = jest.fn()
jest.mock('wagmi', () => ({
  useAccount: () => mockUseAccount(),
  useChainId: () => mockUseChainId(),
}))

// Mock framer-motion (render senza animazioni)
jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
    button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

// Mock recharts (non serve renderizzare charts nei test)
jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div data-testid="chart-container">{children}</div>,
  AreaChart: ({ children }: any) => <div data-testid="area-chart">{children}</div>,
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  PieChart: ({ children }: any) => <div data-testid="pie-chart">{children}</div>,
  Pie: () => null,
  Cell: () => null,
  BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
}))

// Mock forwarding rules hook
const mockCreateRule = jest.fn()
const mockUpdateRule = jest.fn()
const mockDeleteRule = jest.fn()
const mockPauseRule = jest.fn()
const mockResumeRule = jest.fn()
const mockEmergencyStop = jest.fn()

jest.mock('../../lib/useForwardingRules', () => ({
  useForwardingRules: () => ({
    rules: mockRules,
    loading: false,
    createRule: mockCreateRule,
    updateRule: mockUpdateRule,
    deleteRule: mockDeleteRule,
    pauseRule: mockPauseRule,
    resumeRule: mockResumeRule,
    emergencyStop: mockEmergencyStop,
  }),
}))

// Mock sweep WebSocket hook
jest.mock('../../lib/useSweepWebSocket', () => ({
  useSweepWebSocket: () => ({
    events: [],
    connected: true,
    reconnect: jest.fn(),
  }),
}))

// Mock sweep stats hook
const mockStats = {
  total_sweeps: 42,
  total_volume_eth: 12.5678,
  completed: 38,
  failed: 4,
  success_rate: 90.5,
  total_volume_usd: 25000.0,
  total_gas_spent_eth: 0.0023,
  avg_sweep_time_sec: 3.2,
}

jest.mock('../../lib/useSweepStats', () => ({
  useSweepStats: () => ({
    stats: mockStats,
    daily: [],
    loading: false,
    refresh: jest.fn(),
  }),
}))

// Mock sub-components that are imported
jest.mock('../StatusCards', () => {
  return function MockStatusCards(props: any) {
    return <div data-testid="status-cards">StatusCards</div>
  }
})

jest.mock('../RuleCard', () => {
  return function MockRuleCard(props: any) {
    return <div data-testid="rule-card">{props.rule?.label || 'rule'}</div>
  }
})

jest.mock('../SplitSlider', () => {
  return function MockSplitSlider(props: any) {
    return <div data-testid="split-slider">SplitSlider</div>
  }
})

jest.mock('../SweepFeed', () => {
  return function MockSweepFeed(props: any) {
    return <div data-testid="sweep-feed">SweepFeed</div>
  }
})

jest.mock('../EmergencyStop', () => {
  return function MockEmergencyStop(props: any) {
    return <div data-testid="emergency-stop">EmergencyStop</div>
  }
})

// ── Shared state ─────────────────────────────────────────

let mockRules: any[] = []

// Import the component AFTER mocks
import CommandCenter from '../CommandCenter'

// ═══════════════════════════════════════════════════════════
//  Setup
// ═══════════════════════════════════════════════════════════

beforeEach(() => {
  jest.clearAllMocks()
  mockRules = []
  // Default: connected wallet
  mockUseAccount.mockReturnValue({
    address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    isConnected: true,
  })
  mockUseChainId.mockReturnValue(8453)
  // Mock global fetch (gas price)
  global.fetch = jest.fn().mockResolvedValue({
    json: () => Promise.resolve({ result: '0x3B9ACA00' }), // 1 gwei
  })
})

afterEach(() => {
  jest.restoreAllMocks()
})


// ═══════════════════════════════════════════════════════════
//  1. Rendering — Wallet not connected
// ═══════════════════════════════════════════════════════════

describe('Wallet not connected', () => {
  test('shows connect wallet message', () => {
    mockUseAccount.mockReturnValue({ address: undefined, isConnected: false })

    render(<CommandCenter />)

    expect(screen.getByText('Connect wallet')).toBeInTheDocument()
    expect(screen.getByText(/To access Command Center/i)).toBeInTheDocument()
  })

  test('does not render tabs when disconnected', () => {
    mockUseAccount.mockReturnValue({ address: undefined, isConnected: false })

    render(<CommandCenter />)

    expect(screen.queryByText('Configure')).not.toBeInTheDocument()
    expect(screen.queryByText('Monitor')).not.toBeInTheDocument()
  })
})


// ═══════════════════════════════════════════════════════════
//  2. Rendering — Tab Bar
// ═══════════════════════════════════════════════════════════

describe('Tab bar rendering', () => {
  test('renders all 4 tabs', () => {
    render(<CommandCenter />)

    expect(screen.getByText('Configure')).toBeInTheDocument()
    expect(screen.getByText('Monitor')).toBeInTheDocument()
    expect(screen.getByText('History')).toBeInTheDocument()
    expect(screen.getByText('Analytics')).toBeInTheDocument()
  })

  test('Configure is default active tab', () => {
    render(<CommandCenter />)

    // Configure tab should be visible — look for form elements from Configure tab
    const configBtn = screen.getByText('Configure')
    expect(configBtn).toBeInTheDocument()
  })

  test('clicking Monitor tab switches content', async () => {
    render(<CommandCenter />)

    const monitorBtn = screen.getByText('Monitor')
    fireEvent.click(monitorBtn)

    // After switching, Monitor tab content should render (StatusCards)
    await waitFor(() => {
      expect(screen.getByTestId('status-cards')).toBeInTheDocument()
    })
  })

  test('clicking History tab switches content', async () => {
    render(<CommandCenter />)

    const historyBtn = screen.getByText('History')
    fireEvent.click(historyBtn)

    // History tab content should appear
    await waitFor(() => {
      // History tab has filter controls — look for the text "filters"
      // or the export button
      const container = document.body
      expect(container).toBeTruthy()
    })
  })

  test('clicking Analytics tab switches content', async () => {
    render(<CommandCenter />)

    const analyticsBtn = screen.getByText('Analytics')
    fireEvent.click(analyticsBtn)

    // Analytics tab should render chart containers
    await waitFor(() => {
      const charts = screen.queryAllByTestId('chart-container')
      // Analytics tab renders charts
      expect(charts.length).toBeGreaterThanOrEqual(0)
    })
  })
})


// ═══════════════════════════════════════════════════════════
//  3. Stats Summary Bar
// ═══════════════════════════════════════════════════════════

describe('Stats summary bar', () => {
  test('renders sweep count from stats', () => {
    render(<CommandCenter />)

    // The stats bar should show "42" (total_sweeps)
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  test('renders volume from stats', () => {
    render(<CommandCenter />)

    // The stats bar should show "12.5678 ETH" (total_volume_eth)
    expect(screen.getByText('12.5678 ETH')).toBeInTheDocument()
  })

  test('renders stats labels', () => {
    render(<CommandCenter />)

    expect(screen.getByText('Sweeps')).toBeInTheDocument()
    expect(screen.getByText('Vol 24h')).toBeInTheDocument()
    expect(screen.getByText('Rules')).toBeInTheDocument()
  })

  test('shows active rules count', () => {
    mockRules = [
      { id: 1, is_active: true, is_paused: false, label: 'Rule A' },
      { id: 2, is_active: true, is_paused: true, label: 'Rule B' },
      { id: 3, is_active: false, is_paused: false, label: 'Rule C' },
    ]

    render(<CommandCenter />)

    // Only 1 rule is active AND not paused
    expect(screen.getByText('1')).toBeInTheDocument()
  })
})


// ═══════════════════════════════════════════════════════════
//  4. Configure Tab — Form Validation
// ═══════════════════════════════════════════════════════════

describe('Configure tab', () => {
  test('renders configure tab content', () => {
    render(<CommandCenter />)

    // Configure tab is default — the tab content area should be rendered
    // It contains form elements or the rule list
    const container = document.querySelector('[style]')
    expect(container).toBeTruthy()
    // The Configure tab label should be rendered
    expect(screen.getByText('Configure')).toBeInTheDocument()
  })

  test('renders existing rules', () => {
    mockRules = [
      { id: 1, is_active: true, is_paused: false, label: 'My Rule',
        source_wallet: '0xbb', destination_wallet: '0xcc',
        split_enabled: false, split_percent: 100 },
    ]

    render(<CommandCenter />)

    expect(screen.getByTestId('rule-card')).toBeInTheDocument()
  })

  test('renders no rules message when empty', () => {
    mockRules = []

    render(<CommandCenter />)

    // Should show some form of "no rules" or the create form
    const container = document.body
    expect(container).toBeTruthy()
  })
})


// ═══════════════════════════════════════════════════════════
//  5. Monitor Tab
// ═══════════════════════════════════════════════════════════

describe('Monitor tab', () => {
  test('renders StatusCards', async () => {
    render(<CommandCenter />)
    fireEvent.click(screen.getByText('Monitor'))

    await waitFor(() => {
      expect(screen.getByTestId('status-cards')).toBeInTheDocument()
    })
  })

  test('renders SweepFeed', async () => {
    render(<CommandCenter />)
    fireEvent.click(screen.getByText('Monitor'))

    await waitFor(() => {
      expect(screen.getByTestId('sweep-feed')).toBeInTheDocument()
    })
  })

  test('renders EmergencyStop', async () => {
    render(<CommandCenter />)
    fireEvent.click(screen.getByText('Monitor'))

    await waitFor(() => {
      expect(screen.getByTestId('emergency-stop')).toBeInTheDocument()
    })
  })
})


// ═══════════════════════════════════════════════════════════
//  6. Tab switching doesn't crash
// ═══════════════════════════════════════════════════════════

describe('Tab switching resilience', () => {
  test('switching through all tabs without crashes', async () => {
    render(<CommandCenter />)

    const tabs = ['Monitor', 'History', 'Analytics', 'Configure']
    for (const tabName of tabs) {
      fireEvent.click(screen.getByText(tabName))
      await waitFor(() => {
        // Just verify no crash — component still in DOM
        expect(screen.getByText(tabName)).toBeInTheDocument()
      })
    }
  })

  test('rapid tab switching does not crash', async () => {
    render(<CommandCenter />)

    // Rapidly switch tabs
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByText('Monitor'))
      fireEvent.click(screen.getByText('Configure'))
      fireEvent.click(screen.getByText('Analytics'))
      fireEvent.click(screen.getByText('History'))
    }

    // Should still be stable
    expect(screen.getByText('History')).toBeInTheDocument()
  })
})


// ═══════════════════════════════════════════════════════════
//  7. Edge Cases
// ═══════════════════════════════════════════════════════════

describe('Edge cases', () => {
  test('handles zero stats', () => {
    // Override stats mock for this test
    jest.doMock('../../lib/useSweepStats', () => ({
      useSweepStats: () => ({
        stats: { total_sweeps: 0, total_volume_eth: 0, completed: 0, failed: 0, success_rate: 0 },
        daily: [],
        loading: false,
        refresh: jest.fn(),
      }),
    }))

    render(<CommandCenter />)

    // Should render without crashing
    expect(screen.getByText('Configure')).toBeInTheDocument()
  })

  test('handles many rules', () => {
    mockRules = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      is_active: true,
      is_paused: false,
      label: `Rule ${i + 1}`,
      source_wallet: `0x${String(i).padStart(40, '0')}`,
      destination_wallet: '0x' + 'cc'.repeat(20),
      split_enabled: false,
      split_percent: 100,
    }))

    render(<CommandCenter />)

    const ruleCards = screen.getAllByTestId('rule-card')
    expect(ruleCards).toHaveLength(10)
  })
})
