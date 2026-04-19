# Prompt Claude Code — /markets e /token/[id] production pages

## Contesto
Monorepo: `~/Desktop/wallet connect/fee-router-dapp/`
Creiamo le pagine reali (v1) collegate dai mockup landing:
- **`/markets`**: tabella full-featured con tutti i token CoinGecko supportati (paginata, sortable, searchable, live)
- **`/token/[id]`**: dettaglio singolo token con price chart interattivo TradingView, stats, description, CTA "Open in RSends"

Architettura: **client-side fetch da CoinGecko**, con cache localStorage aggressiva per ridurre rate-limit hits.
Chart: **TradingView Lightweight Charts** (libreria free, professional look).

## Principi

1. **Cache first, fetch second.** Ogni request check localStorage prima. Se cached e non-stale, usa cache. TTL: markets 30s, coin info 5min, chart history 10min.
2. **Graceful degradation su 429.** Se CoinGecko rate-limita, mostra ultimo snapshot cached con banner "Prices may be slightly delayed". Mai rompere UI.
3. **SEO basics.** Ogni pagina ha `<title>` dinamico e `<meta description>` coerente (via `generateMetadata`).
4. **Respect motion system.** Usa FadeIn/Stagger esistenti per entrate, nessuna nuova animazione custom.
5. **i18n-ready, non tradotto completo.** Chiavi messages per label UI in EN+IT (gli altri placeholder). Non ripetere il lavoro su lingue che non gestisci.
6. **No over-engineering.** v1 è v1: niente order book, niente news, niente sentiment. Scope già definito.

## Pre-check

```bash
cd ~/Desktop/wallet\ connect/fee-router-dapp/
git checkout -b feat-markets-token-pages
git tag backup-pre-markets-token

# Struttura locale
find app/\[locale\] -type d -maxdepth 2

# Esistono placeholder da sostituire?
ls app/\[locale\]/markets 2>/dev/null
ls app/\[locale\]/token 2>/dev/null
cat app/\[locale\]/markets/page.tsx 2>/dev/null
cat app/\[locale\]/token/\[id\]/page.tsx 2>/dev/null

# Hook token prices esistente
cat hooks/useTokenPrices.ts 2>/dev/null | head -40

# Verifica dipendenze
grep -E '"lightweight-charts"|"date-fns"' package.json
```

Mostrami output. Sostituiremo i placeholder creati precedentemente.

---

## Step 1 — Install dipendenze

```bash
npm install lightweight-charts date-fns
```

- `lightweight-charts`: TradingView chart (~35kb gzipped)
- `date-fns`: formattazione date/timeframe selector

## Step 2 — Refactor cache layer

Crea `lib/coingeckoCache.ts`:

```ts
'use client';

type CacheEntry<T> = {
  data: T;
  timestamp: number;
  ttl: number;
};

const STORAGE_PREFIX = 'rs_cg_';
const MEMORY_CACHE = new Map<string, CacheEntry<any>>();

export function getCached<T>(key: string): T | null {
  const full = STORAGE_PREFIX + key;

  // Check memory first (faster)
  const mem = MEMORY_CACHE.get(full);
  if (mem && Date.now() - mem.timestamp < mem.ttl) {
    return mem.data as T;
  }

  // Check localStorage
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(full);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (Date.now() - entry.timestamp < entry.ttl) {
      MEMORY_CACHE.set(full, entry);
      return entry.data;
    }
    // Expired
    window.localStorage.removeItem(full);
    MEMORY_CACHE.delete(full);
  } catch {
    return null;
  }
  return null;
}

export function getStaleCache<T>(key: string): T | null {
  const full = STORAGE_PREFIX + key;
  const mem = MEMORY_CACHE.get(full);
  if (mem) return mem.data as T;
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(full);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    return entry.data;
  } catch {
    return null;
  }
}

export function setCached<T>(key: string, data: T, ttlMs: number): void {
  const full = STORAGE_PREFIX + key;
  const entry: CacheEntry<T> = {
    data,
    timestamp: Date.now(),
    ttl: ttlMs,
  };
  MEMORY_CACHE.set(full, entry);
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(full, JSON.stringify(entry));
  } catch {
    // Quota exceeded — purge oldest and retry once
    try {
      const keys = Object.keys(window.localStorage).filter((k) => k.startsWith(STORAGE_PREFIX));
      if (keys.length > 0) {
        window.localStorage.removeItem(keys[0]);
        window.localStorage.setItem(full, JSON.stringify(entry));
      }
    } catch {
      // give up silently
    }
  }
}

// Inflight dedup: same URL pending → return same promise
const INFLIGHT = new Map<string, Promise<any>>();

export async function fetchWithDedup<T>(url: string): Promise<T> {
  if (INFLIGHT.has(url)) return INFLIGHT.get(url)!;
  const p = fetch(url).then(async (r) => {
    if (!r.ok) {
      const err = new Error(`CoinGecko ${r.status}`);
      (err as any).status = r.status;
      throw err;
    }
    return r.json();
  }).finally(() => {
    INFLIGHT.delete(url);
  });
  INFLIGHT.set(url, p);
  return p;
}
```

## Step 3 — Hook generico per CoinGecko

Crea `hooks/useCoinGecko.ts` — astrazione sopra fetch/cache. Sostituirà anche `useTokenPrices` esistente (ma manteniamo retrocompat: espone un wrapper).

```ts
'use client';

import { useEffect, useRef, useState } from 'react';
import { getCached, getStaleCache, setCached, fetchWithDedup } from '@/lib/coingeckoCache';

type UseCoinGeckoOptions = {
  ttlMs: number;
  refreshIntervalMs?: number;
  enabled?: boolean;
};

type State<T> = {
  data: T | null;
  error: Error | null;
  stale: boolean;
  loading: boolean;
};

export function useCoinGecko<T>(
  url: string | null,
  cacheKey: string,
  options: UseCoinGeckoOptions
): State<T> {
  const { ttlMs, refreshIntervalMs, enabled = true } = options;
  const [state, setState] = useState<State<T>>({
    data: null,
    error: null,
    stale: false,
    loading: true,
  });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled || !url) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }

    let cancelled = false;
    const run = async () => {
      // Try cache first
      const cached = getCached<T>(cacheKey);
      if (cached) {
        if (!cancelled && mountedRef.current) {
          setState({ data: cached, error: null, stale: false, loading: false });
        }
        return;
      }

      try {
        const data = await fetchWithDedup<T>(url);
        setCached(cacheKey, data, ttlMs);
        if (!cancelled && mountedRef.current) {
          setState({ data, error: null, stale: false, loading: false });
        }
      } catch (err) {
        const stale = getStaleCache<T>(cacheKey);
        if (!cancelled && mountedRef.current) {
          setState({
            data: stale,
            error: err as Error,
            stale: stale !== null,
            loading: false,
          });
        }
      }
    };

    run();

    // Refresh interval
    let interval: NodeJS.Timeout | null = null;
    if (refreshIntervalMs) {
      interval = setInterval(() => {
        if (document.visibilityState === 'visible') run();
      }, refreshIntervalMs);
    }

    // Refetch on visibility
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        const cached = getCached<T>(cacheKey);
        if (!cached) run();
      }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [url, cacheKey, ttlMs, refreshIntervalMs, enabled]);

  return state;
}
```

## Step 4 — `/markets` page

Crea (o sostituisci) `app/[locale]/markets/page.tsx`:

```tsx
import type { Metadata } from 'next';
import MarketsClient from './MarketsClient';

export const metadata: Metadata = {
  title: 'Markets — RSends',
  description:
    'Track every crypto token across 11+ chains. Live prices, 24h changes, volume, and 7d sparklines — updated every 30 seconds.',
};

export default function MarketsPage() {
  return <MarketsClient />;
}
```

Crea `app/[locale]/markets/MarketsClient.tsx`:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCoinGecko } from '@/hooks/useCoinGecko';
import AnimatedNumber from '@/components/motion/AnimatedNumber';
import { Link } from 'next-intl/link';
import { useTranslations } from 'next-intl';

type Token = {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  price_change_percentage_24h: number;
  price_change_percentage_7d_in_currency?: number;
  sparkline_in_7d: { price: number[] };
  market_cap: number;
  total_volume: number;
  market_cap_rank: number;
};

type SortKey =
  | 'market_cap_rank'
  | 'current_price'
  | 'price_change_percentage_24h'
  | 'price_change_percentage_7d_in_currency'
  | 'total_volume'
  | 'market_cap';

function Sparkline({ data, positive }: { data: number[]; positive: boolean }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 100;
  const h = 28;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} className="block">
      <polyline
        fill="none"
        stroke={positive ? '#0E9F6E' : '#D4342E'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export default function MarketsClient() {
  const t = useTranslations('markets');
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('market_cap_rank');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const perPage = 100;
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=${page}&sparkline=true&price_change_percentage=24h,7d`;

  const { data: tokens, error, stale, loading } = useCoinGecko<Token[]>(
    url,
    `markets_p${page}`,
    { ttlMs: 30_000, refreshIntervalMs: 30_000 }
  );

  const filtered = useMemo(() => {
    if (!tokens) return [];
    const q = query.toLowerCase().trim();
    const list = q
      ? tokens.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            t.symbol.toLowerCase().includes(q)
        )
      : tokens;

    const sorted = [...list].sort((a, b) => {
      const av = (a[sortKey] ?? 0) as number;
      const bv = (b[sortKey] ?? 0) as number;
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return sorted;
  }, [tokens, query, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'market_cap_rank' ? 'asc' : 'desc');
    }
  };

  const SortHeader = ({
    label,
    k,
    align = 'left',
  }: {
    label: string;
    k: SortKey;
    align?: 'left' | 'right';
  }) => (
    <th
      onClick={() => toggleSort(k)}
      className={`text-xs tracking-[0.12em] text-[#0A0A0A]/60 font-medium py-4 px-4 uppercase cursor-pointer hover:text-[#0A0A0A] transition-colors select-none ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {label}
      {sortKey === k && (
        <span className="ml-1 text-[#C8512C]">
          {sortDir === 'asc' ? '↑' : '↓'}
        </span>
      )}
    </th>
  );

  return (
    <main className="min-h-screen py-20">
      <div className="mx-auto max-w-[1440px] px-24">

        {/* Header */}
        <div className="mb-12">
          <p className="text-sm tracking-[0.18em] text-[#C8512C] font-medium mb-6">
            MARKETS
          </p>
          <h1 className="text-[72px] leading-[1.05] tracking-[-0.02em] font-semibold text-[#0A0A0A] mb-4">
            Tokens overview
          </h1>
          <p className="text-xl text-[#0A0A0A]/70 max-w-[680px]">
            Every token across 11+ chains. Prices update every 30 seconds.
          </p>
        </div>

        {/* Search + status */}
        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or ticker…"
            className="px-4 py-3 border border-[#0A0A0A]/15 rounded-lg text-sm bg-white focus:border-[#C8512C] focus:outline-none transition-colors w-full max-w-[320px]"
          />
          <div className="text-xs text-[#0A0A0A]/50">
            {stale && <span className="text-[#C8512C]">Prices may be slightly delayed · </span>}
            {tokens && `${filtered.length} tokens`} · Live · updates every 30s
          </div>
        </div>

        {/* Table */}
        <div className="border border-[#0A0A0A]/10 rounded-2xl overflow-hidden bg-white">
          <table className="w-full">
            <thead className="bg-[#FAFAFA] border-b border-[#0A0A0A]/8">
              <tr>
                <SortHeader label="#" k="market_cap_rank" />
                <th className="text-xs tracking-[0.12em] text-[#0A0A0A]/60 font-medium py-4 px-4 uppercase text-left">
                  Token
                </th>
                <SortHeader label="Price" k="current_price" align="right" />
                <SortHeader label="24h" k="price_change_percentage_24h" align="right" />
                <SortHeader label="7d" k="price_change_percentage_7d_in_currency" align="right" />
                <SortHeader label="Volume" k="total_volume" align="right" />
                <SortHeader label="Market cap" k="market_cap" align="right" />
                <th className="text-xs tracking-[0.12em] text-[#0A0A0A]/60 font-medium py-4 px-4 uppercase text-right">
                  Last 7d
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="text-center py-20 text-[#0A0A0A]/50">
                    Loading markets…
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-20 text-[#0A0A0A]/50">
                    No tokens found for "{query}".
                  </td>
                </tr>
              )}
              {filtered.map((token) => {
                const pos24 = token.price_change_percentage_24h >= 0;
                const pos7d = (token.price_change_percentage_7d_in_currency ?? 0) >= 0;
                return (
                  <tr
                    key={token.id}
                    className="border-b border-[#0A0A0A]/5 last:border-0 hover:bg-[#FAFAFA] transition-colors"
                  >
                    <td className="py-4 px-4 text-sm text-[#0A0A0A]/60">
                      {token.market_cap_rank}
                    </td>
                    <td className="py-4 px-4">
                      <Link
                        href={`/token/${token.id}`}
                        className="flex items-center gap-3 hover:text-[#C8512C] transition-colors"
                      >
                        <img
                          src={token.image}
                          alt={token.name}
                          className="w-8 h-8 rounded-full"
                        />
                        <div>
                          <div className="text-sm font-medium text-[#0A0A0A]">
                            {token.name}
                          </div>
                          <div className="text-[11px] text-[#0A0A0A]/50 uppercase">
                            {token.symbol}
                          </div>
                        </div>
                      </Link>
                    </td>
                    <td className="py-4 px-4 text-sm font-medium text-[#0A0A0A] text-right">
                      <AnimatedNumber
                        value={token.current_price}
                        prefix="$"
                        decimals={token.current_price < 1 ? 4 : 2}
                      />
                    </td>
                    <td className="py-4 px-4 text-right">
                      <span
                        className={`text-sm font-medium ${
                          pos24 ? 'text-[#0E9F6E]' : 'text-[#D4342E]'
                        }`}
                      >
                        {pos24 ? '▲' : '▼'}{' '}
                        {Math.abs(token.price_change_percentage_24h).toFixed(2)}%
                      </span>
                    </td>
                    <td className="py-4 px-4 text-right">
                      {token.price_change_percentage_7d_in_currency !== undefined && (
                        <span
                          className={`text-sm font-medium ${
                            pos7d ? 'text-[#0E9F6E]' : 'text-[#D4342E]'
                          }`}
                        >
                          {pos7d ? '▲' : '▼'}{' '}
                          {Math.abs(token.price_change_percentage_7d_in_currency).toFixed(2)}%
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-4 text-sm text-[#0A0A0A]/70 text-right">
                      {formatCompact(token.total_volume)}
                    </td>
                    <td className="py-4 px-4 text-sm text-[#0A0A0A]/70 text-right">
                      {formatCompact(token.market_cap)}
                    </td>
                    <td className="py-4 px-4 flex justify-end">
                      <Sparkline
                        data={token.sparkline_in_7d?.price ?? []}
                        positive={pos7d}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between mt-8">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-5 py-3 border border-[#0A0A0A]/15 rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#0A0A0A]/5 transition-colors"
          >
            ← Previous
          </button>
          <span className="text-sm text-[#0A0A0A]/60">
            Page {page}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!tokens || tokens.length < perPage}
            className="px-5 py-3 border border-[#0A0A0A]/15 rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#0A0A0A]/5 transition-colors"
          >
            Next →
          </button>
        </div>

      </div>
    </main>
  );
}
```

## Step 5 — `/token/[id]` page

Crea `app/[locale]/token/[id]/page.tsx` (server component con metadata dinamica):

```tsx
import type { Metadata } from 'next';
import TokenClient from './TokenClient';

type Props = { params: { id: string; locale: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const name = params.id.charAt(0).toUpperCase() + params.id.slice(1).replace(/-/g, ' ');
  return {
    title: `${name} price, chart & info — RSends`,
    description: `Live ${name} price, 7-day chart, market cap, volume, and more. Trade and swap ${name} on RSends.`,
  };
}

export default function TokenPage({ params }: Props) {
  return <TokenClient id={params.id} />;
}
```

Crea `app/[locale]/token/[id]/TokenClient.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useCoinGecko } from '@/hooks/useCoinGecko';
import AnimatedNumber from '@/components/motion/AnimatedNumber';
import { Link } from 'next-intl/link';
import { createChart, ColorType, IChartApi, ISeriesApi, LineStyle } from 'lightweight-charts';

type TokenDetail = {
  id: string;
  symbol: string;
  name: string;
  image: { large: string };
  market_cap_rank: number;
  market_data: {
    current_price: { usd: number };
    price_change_percentage_24h: number;
    market_cap: { usd: number };
    total_volume: { usd: number };
    circulating_supply: number;
    max_supply: number | null;
    ath: { usd: number };
    ath_date: { usd: string };
    atl: { usd: number };
    atl_date: { usd: string };
  };
  description: { en: string };
  links: {
    homepage: string[];
    blockchain_site: string[];
    twitter_screen_name: string;
  };
  categories: string[];
};

type ChartRange = '1' | '7' | '30' | '90' | '365';

const RANGES: Array<{ key: ChartRange; label: string }> = [
  { key: '1', label: '1D' },
  { key: '7', label: '7D' },
  { key: '30', label: '30D' },
  { key: '90', label: '90D' },
  { key: '365', label: '1Y' },
];

function formatCompact(n: number): string {
  if (!n) return '—';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function formatSupply(n: number | null): string {
  if (!n) return 'Unlimited';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Strip HTML from CoinGecko description
function stripHtml(html: string): string {
  if (typeof window === 'undefined') return html.replace(/<[^>]*>/g, '');
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
}

export default function TokenClient({ id }: { id: string }) {
  const [range, setRange] = useState<ChartRange>('7');

  const { data: token, error, stale, loading } = useCoinGecko<TokenDetail>(
    `https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false`,
    `token_${id}`,
    { ttlMs: 5 * 60_000, refreshIntervalMs: 60_000 }
  );

  const { data: history } = useCoinGecko<{ prices: [number, number][] }>(
    `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${range}`,
    `history_${id}_${range}`,
    { ttlMs: 10 * 60_000 }
  );

  // Chart
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current || !history?.prices) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const positive =
      history.prices.length > 1 &&
      history.prices[history.prices.length - 1][1] >= history.prices[0][1];
    const color = positive ? '#0E9F6E' : '#D4342E';

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#FFFFFF' },
        textColor: '#0A0A0A',
        fontFamily: 'inherit',
      },
      grid: {
        vertLines: { color: 'rgba(10,10,10,0.04)' },
        horzLines: { color: 'rgba(10,10,10,0.04)' },
      },
      rightPriceScale: {
        borderColor: 'rgba(10,10,10,0.08)',
      },
      timeScale: {
        borderColor: 'rgba(10,10,10,0.08)',
        timeVisible: range === '1',
      },
      width: chartContainerRef.current.clientWidth,
      height: 400,
      crosshair: {
        mode: 1,
        vertLine: { color: 'rgba(10,10,10,0.3)', style: LineStyle.Dashed, width: 1 },
        horzLine: { color: 'rgba(10,10,10,0.3)', style: LineStyle.Dashed, width: 1 },
      },
    });

    const series = chart.addAreaSeries({
      lineColor: color,
      topColor: color + '40',
      bottomColor: color + '00',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });

    series.setData(
      history.prices.map(([t, v]) => ({
        time: (t / 1000) as any,
        value: v,
      }))
    );

    chart.timeScale().fitContent();

    chartRef.current = chart;
    seriesRef.current = series;

    const onResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      chart.remove();
    };
  }, [history, range]);

  if (loading && !token) {
    return (
      <main className="min-h-screen py-32">
        <div className="mx-auto max-w-[1440px] px-24">
          <div className="text-[#0A0A0A]/50">Loading {id}…</div>
        </div>
      </main>
    );
  }

  if (!token) {
    return (
      <main className="min-h-screen py-32">
        <div className="mx-auto max-w-[1440px] px-24">
          <h1 className="text-[48px] font-semibold text-[#0A0A0A] mb-4">
            Token not found
          </h1>
          <p className="text-[#0A0A0A]/70 mb-8">
            We couldn't load data for "{id}". It might not exist or the rate limit was hit.
          </p>
          <Link
            href="/markets"
            className="inline-flex items-center gap-2 bg-[#0A0A0A] text-white px-6 py-3 rounded-lg"
          >
            ← Back to markets
          </Link>
        </div>
      </main>
    );
  }

  const md = token.market_data;
  const pos24 = md.price_change_percentage_24h >= 0;

  return (
    <main className="min-h-screen py-20">
      <div className="mx-auto max-w-[1440px] px-24">

        {/* Back link */}
        <Link
          href="/markets"
          className="inline-flex items-center gap-2 text-sm text-[#0A0A0A]/60 hover:text-[#C8512C] mb-10 transition-colors"
        >
          ← Back to markets
        </Link>

        {/* Header: token info */}
        <div className="flex items-start gap-8 mb-12 flex-wrap">
          <img
            src={token.image.large}
            alt={token.name}
            className="w-20 h-20 rounded-full"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-4 mb-3 flex-wrap">
              <h1 className="text-[56px] leading-[1] tracking-[-0.02em] font-semibold text-[#0A0A0A]">
                {token.name}
              </h1>
              <span className="text-2xl text-[#0A0A0A]/50 uppercase font-medium">
                {token.symbol}
              </span>
              {token.market_cap_rank && (
                <span className="text-xs px-3 py-1 bg-[#0A0A0A]/5 rounded-full text-[#0A0A0A]/70 font-medium">
                  Rank #{token.market_cap_rank}
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-4 flex-wrap">
              <div className="text-[48px] font-semibold text-[#0A0A0A] leading-none">
                <AnimatedNumber
                  value={md.current_price.usd}
                  prefix="$"
                  decimals={md.current_price.usd < 1 ? 4 : 2}
                />
              </div>
              <span
                className={`text-xl font-medium ${
                  pos24 ? 'text-[#0E9F6E]' : 'text-[#D4342E]'
                }`}
              >
                {pos24 ? '▲' : '▼'} {Math.abs(md.price_change_percentage_24h).toFixed(2)}%
              </span>
              <span className="text-sm text-[#0A0A0A]/50">(24h)</span>
            </div>
            {stale && (
              <p className="text-xs text-[#C8512C] mt-3">
                Prices may be slightly delayed due to rate limiting.
              </p>
            )}
          </div>

          <Link
            href={`/app?token=${token.id}`}
            className="bg-[#0A0A0A] text-white px-6 py-3 rounded-lg font-medium hover:bg-[#0A0A0A]/90 transition-colors"
          >
            Open in RSends →
          </Link>
        </div>

        {/* Chart + range selector */}
        <div className="border border-[#0A0A0A]/10 rounded-2xl bg-white p-6 mb-12">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
            <h2 className="text-xl font-semibold text-[#0A0A0A]">Price chart</h2>
            <div className="flex gap-1 bg-[#FAFAFA] p-1 rounded-lg">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRange(r.key)}
                  className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                    range === r.key
                      ? 'bg-white text-[#0A0A0A] shadow-sm'
                      : 'text-[#0A0A0A]/60 hover:text-[#0A0A0A]'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div ref={chartContainerRef} style={{ width: '100%', height: 400 }} />
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-12">
          {[
            { label: 'Market cap', value: formatCompact(md.market_cap.usd) },
            { label: '24h volume', value: formatCompact(md.total_volume.usd) },
            { label: 'Circulating supply', value: formatSupply(md.circulating_supply) },
            { label: 'Max supply', value: formatSupply(md.max_supply) },
            { label: 'All-time high', value: formatCompact(md.ath.usd), sub: formatDate(md.ath_date.usd) },
            { label: 'All-time low', value: formatCompact(md.atl.usd), sub: formatDate(md.atl_date.usd) },
          ].map((s) => (
            <div
              key={s.label}
              className="bg-[#FAFAFA] border border-[#0A0A0A]/5 rounded-xl p-5"
            >
              <div className="text-xs tracking-[0.12em] text-[#0A0A0A]/60 uppercase font-medium mb-2">
                {s.label}
              </div>
              <div className="text-xl font-semibold text-[#0A0A0A]">
                {s.value}
              </div>
              {s.sub && (
                <div className="text-xs text-[#0A0A0A]/50 mt-1">{s.sub}</div>
              )}
            </div>
          ))}
        </div>

        {/* Links + Description */}
        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <h2 className="text-2xl font-semibold text-[#0A0A0A] mb-4">
              About {token.name}
            </h2>
            {token.description.en ? (
              <p className="text-[#0A0A0A]/80 leading-[1.7] whitespace-pre-line">
                {stripHtml(token.description.en).slice(0, 800)}
                {stripHtml(token.description.en).length > 800 && '…'}
              </p>
            ) : (
              <p className="text-[#0A0A0A]/50">No description available.</p>
            )}
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-[#0A0A0A] mb-4">Links</h2>
            <div className="space-y-2">
              {token.links.homepage.filter(Boolean).slice(0, 1).map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between px-4 py-3 border border-[#0A0A0A]/10 rounded-lg hover:border-[#C8512C] transition-colors group"
                >
                  <span className="text-sm font-medium text-[#0A0A0A]">Website</span>
                  <span className="text-xs text-[#0A0A0A]/50 group-hover:text-[#C8512C] truncate max-w-[180px]">
                    {new URL(url).hostname} ↗
                  </span>
                </a>
              ))}
              {token.links.blockchain_site.filter(Boolean).slice(0, 1).map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between px-4 py-3 border border-[#0A0A0A]/10 rounded-lg hover:border-[#C8512C] transition-colors group"
                >
                  <span className="text-sm font-medium text-[#0A0A0A]">Explorer</span>
                  <span className="text-xs text-[#0A0A0A]/50 group-hover:text-[#C8512C] truncate max-w-[180px]">
                    {new URL(url).hostname} ↗
                  </span>
                </a>
              ))}
              {token.links.twitter_screen_name && (
                <a
                  href={`https://twitter.com/${token.links.twitter_screen_name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between px-4 py-3 border border-[#0A0A0A]/10 rounded-lg hover:border-[#C8512C] transition-colors group"
                >
                  <span className="text-sm font-medium text-[#0A0A0A]">Twitter</span>
                  <span className="text-xs text-[#0A0A0A]/50 group-hover:text-[#C8512C]">
                    @{token.links.twitter_screen_name} ↗
                  </span>
                </a>
              )}
            </div>

            {token.categories && token.categories.length > 0 && (
              <div className="mt-8">
                <h3 className="text-sm tracking-[0.12em] uppercase text-[#0A0A0A]/60 font-medium mb-3">
                  Categories
                </h3>
                <div className="flex flex-wrap gap-2">
                  {token.categories.slice(0, 6).map((c) => (
                    <span
                      key={c}
                      className="text-xs px-3 py-1 bg-[#0A0A0A]/5 rounded-full text-[#0A0A0A]/70"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
```

## Step 6 — i18n keys (minimal, per titoli)

Aggiungi in `messages/en.json`:

```json
"markets": {
  "pageTitle": "Tokens overview",
  "pageSubtitle": "Every token across 11+ chains. Prices update every 30 seconds.",
  "search": "Search by name or ticker…",
  "backToMarkets": "Back to markets"
}
```

E in `messages/it.json`:

```json
"markets": {
  "pageTitle": "Panoramica token",
  "pageSubtitle": "Ogni token su oltre 11 chain. I prezzi si aggiornano ogni 30 secondi.",
  "search": "Cerca per nome o ticker…",
  "backToMarkets": "Torna a markets"
}
```

Placeholder EN per `es.json`, `fr.json`, `de.json`.

Per v1, i componenti possono avere label EN hardcoded (velocità > copertura i18n al 100%). Quando vorrai completare la localizzazione di queste due pagine sarà un passaggio successivo.

---

## Step 7 — Verifica

```bash
npm run dev
```

Checklist `/markets`:
- [ ] `/en/markets` carica la tabella con top 100 token
- [ ] Search filtra istantaneamente
- [ ] Click su header colonna ordina asc/desc
- [ ] Sparkline 7d visibili per ogni riga
- [ ] Click su token name → `/en/token/[id]`
- [ ] Paginazione prev/next funziona
- [ ] Dopo 30s, i prezzi si aggiornano (AnimatedNumber transition)
- [ ] DevTools Network: solo 1 fetch per page, non 100

Checklist `/token/[id]`:
- [ ] `/en/token/bitcoin` carica header + chart + stats + description + links
- [ ] Range selector (1D/7D/30D/90D/1Y) cambia il chart fluidamente
- [ ] Chart ha tooltip hover (crosshair TradingView)
- [ ] Chart colorato verde/rosso in base a performance periodo
- [ ] Stats card mostrano numeri formattati correttamente ($1.2B, 19.4M supply, ecc.)
- [ ] Links website/explorer/twitter aprono in nuovo tab
- [ ] Description troncata a 800 char
- [ ] Click "Open in RSends →" porta a `/app?token=bitcoin`
- [ ] Click "← Back to markets" torna a `/markets`

Checklist failure modes:
- [ ] Rate limit CoinGecko (429): banner "Prices may be slightly delayed", dati cached persistono
- [ ] Token inesistente (es. `/token/nonesistente`): pagina errore gentile + link markets
- [ ] Chart vuoto (history API down): non crasha, mostra "No data"
- [ ] Rifresh della pagina: cache localStorage idratata, no flash di loading

Checklist SEO:
- [ ] `/markets`: `<title>Markets — RSends</title>`
- [ ] `/token/bitcoin`: `<title>Bitcoin price, chart & info — RSends</title>`
- [ ] Meta description presenti

---

## Output atteso

1. Output pre-check
2. Diff file creati/modificati
3. Screenshot `/markets` con tabella popolata
4. Screenshot `/token/bitcoin` con chart 7D
5. Screenshot `/token/ethereum` con chart 1D (verifica toggle range funziona)

## Non toccare

- Landing, hero, two-paths, mockup
- Dapp `/app`
- Backend, contracts

## Fermati e chiedi se

- `lightweight-charts` dà errori SSR (serve dynamic import con `ssr: false`)
- `next-intl/link` non è installato / Fase 1 i18n non ancora in main
- Le immagini CoinGecko danno CORS error (raro, ma alcuni adblock le bloccano)
- Il path `app/[locale]/token/[id]/page.tsx` entra in conflitto con una route esistente
- Rate limit CoinGecko lo colpisci già in dev con pochi refresh (serve API key Demo)

## Commit

```bash
git add -A
git commit -m "feat(pages): /markets table + /token/[id] detail with TradingView chart + client cache layer"
```

Non push, aspetta conferma.

## Post-v1 roadmap (fuori scope ora)

Quando il traffico crescerà:
- Migrate fetch client-side → Next.js API routes + Redis cache
- Aggiungi news feed (CryptoPanic API)
- Aggiungi social sentiment (LunarCrush)
- Related tokens section (CoinGecko categories)
- Pre-render top 50 pagine token come SSG (build-time) per SEO migliore
- RSS feed `/markets/feed.xml`