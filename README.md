# RSends — Multi-Chain Payment Gateway

Payment infrastructure for Web3: receive on any chain, auto-forward, swap, split, and distribute — with full compliance, double-entry ledger, and real-time monitoring.

## Architecture

```
Frontend (Next.js 14)          Backend (FastAPI)              Smart Contracts (Solidity)
----------------------         ----------------------         -------------------------
CommandCenter.tsx              execution_engine.py            FeeRouterV4.sol
TransferForm.tsx               strategy_engine.py             RSendBatchDistributor.sol
CrossChainForm.tsx             sweep_service.py               RSendForwarder.sol
PortfolioDashboard.tsx         split_executor.py              RSendCCIPSender.sol
SwapModule.tsx                 distribution_service.py        RSendCCIPReceiver.sol
SweepFeed.tsx (WebSocket)      ledger_service.py
                               reconciliation_service.py
Chain Adapters                 aml_service.py
├── evm-adapter.ts             key_manager.py (KMS/Local)
├── solana-adapter.ts
└── tron-adapter.ts            Middleware
                               ├── correlation.py (X-Correlation-ID)
Hooks                          ├── structured_logging.py
├── useUniversalWallet.ts      ├── rate_limit.py
├── useForwardingRules.ts      ├── idempotency.py
├── useSwapQuote.ts            ├── input_sanitization.py
├── usePermit2Flow.ts          ├── api_auth.py
└── useSweepWebSocket.ts       └── error_handler.py

Oracle (Next.js API)           Security
├── sign/route.ts              ├── signing_rate_limit.py
│   ├── signing guard          ├── signing_audit.py
│   ├── AML check              ├── circuit_breaker.py
│   └── EIP-712 sign           └── alert_service.py

                               Infrastructure
                               ├── Redis (cache + rate limit + nonce dedup)
                               ├── Celery (async tasks)
                               ├── PostgreSQL (asyncpg, 15 migrations)
                               ├── AWS KMS (HSM signing + IAM policy)
                               ├── Sentry (errors)
                               ├── Prometheus (metrics)
                               ├── OpenTelemetry (tracing)
                               └── Telegram/Webhook (alerts)
```

## Features

### Multi-Chain Support
- **EVM** — Base, Ethereum, Arbitrum, Optimism, Polygon, BNB, Avalanche (Wagmi v2 + Viem)
- **Solana** — Mainnet, Devnet (@solana/web3.js)
- **Tron** — Mainnet, Shasta (TronWeb)
- **Cross-chain** — Chainlink CCIP bridge between all supported EVM chains
- Universal wallet abstraction via `useUniversalWallet` hook
- Chain family switching with `ChainFamilySwitch` component

### Auto-Forwarding (EVM)
- Conditional forwarding rules with HMAC-signed wallet auth
- Percentage splits, min/max thresholds, gas strategy selection
- Emergency stop, pause/resume per rule
- Batch rule creation
- Real-time sweep monitoring via WebSocket

### Cross-Chain Execution Engine
- Sequential pipeline: **detect -> bridge -> swap -> split -> send -> notify**
- Plan preview (dry-run) before execution
- Fail-safe: funds stay at last successful position on failure
- Bridge: Chainlink CCIP (live), LayerZero, Across, Wormhole (planned)

### Strategy DSL (Conditional Automation)
- IF/THEN rules layered on top of forwarding rules
- **Conditions**: amount thresholds, token matching, gas price, time windows, sender whitelists, daily limits
- **Actions**: forward, split, swap, delay, batch, notify, webhook, emergency stop
- Dry-run simulator via `/api/v1/strategies/simulate`
- Priority-based evaluation, execution limits, cooldowns

### Merchant B2B API (Payment Gateway)
- Payment intent creation with configurable expiration (5min–24h)
- Auto-matching: confirmed TX → pending intent (amount + currency + recipient, FIFO)
- Webhook delivery with HMAC-SHA256 signature (`X-RSend-Signature`)
- Exponential backoff retry (30s → 2m → 8m → 32m → 2h, max 5 attempts)
- Idempotent delivery: same TX triggers one webhook per endpoint
- Event filtering: `payment.completed`, `payment.expired`, `payment.cancelled`
- Paginated transaction listing with status/currency filters
- Bearer API key authentication per merchant

### Smart Contracts
- **FeeRouterV4** — Fee-splitting router with 0.5% protocol fee, multi-recipient support
- **RSendBatchDistributor** — Gas-optimized batch distribution (ETH + ERC-20)
- **RSendForwarder** — Deterministic forwarding contracts per user
- **RSendCCIPSender** — Cross-chain token bridge + swap via Chainlink CCIP and Uniswap V3
- **RSendCCIPReceiver** — CCIP message receiver with idempotency and allowlisted senders

### Cross-Chain Bridge (Chainlink CCIP)
- **Bridge mode**: Send same token cross-chain (e.g., USDC Base → USDC Arbitrum)
- **Swap & Bridge mode**: Atomic swap + bridge in 1 TX (e.g., ETH Base → USDC Arbitrum)
- Uniswap V3 on-chain swap before CCIP bridge
- 0.5% RSend fee on bridged amount
- CCIP fee paid in native ETH by the user (excess refunded)
- Supported chains: Base, Ethereum, Arbitrum, Optimism, Polygon, BNB, Avalanche
- Anti-MEV: `minAmountOut` slippage protection required on all swaps
- AML compliance check before every cross-chain transfer

### Compliance & Security
- **AML screening** — OFAC SDN, EU sanctions, local blacklist (hardcoded + DB)
- **Transaction monitoring** — single tx (>EUR1K), daily (>EUR5K), monthly (>EUR15K DAC8 KYC), velocity (>10/h), structuring detection
- **AML admin panel** — alert review workflow (pending/reviewed/escalated/dismissed), sanctions management, 24h statistics
- **Split AML gate** — pre-execution recipient screening + anti-structuring detection on split plans
- DAC8 XML report generation (CARF-compliant)
- Anomaly detection (statistical z-score)
- Input sanitization middleware
- HMAC webhook verification
- API key authentication (production)

### Signing Protection
- **Oracle signing guard** — pre-flight validation before EIP-712 signature (chain, recipient, amount bounds, deadline)
- **Rate limiting** — per-wallet (10/min, 50/hr), per-IP (20/min), global (100/min)
- **Replay protection** — server-side nonce deduplication via Redis SETNX
- **Immutable audit log** — every signing request (approved/denied) persisted to Postgres
- **AML integration** — full AML check before oracle signature

### KMS Hardening
- **IAM policy** — signing restricted to backend role, destructive ops require MFA + admin role
- **Local rate limiter** — defence-in-depth (60/min, 500/hr) on top of IAM limits
- **KMS audit log** — every sign/verify/rotate operation persisted to Postgres
- **Key rotation** — sign with active key, verify with active + previous keys
- **Health check** — `describe_key` validation of key state

### Financial Infrastructure
- Double-entry bookkeeping ledger
- Automated reconciliation (ledger vs blockchain)
- Spending policy enforcement (reserve/release)
- Nonce management with gap detection
- Idempotent webhook processing (Redis-backed, fail-closed)
- **Fail-closed circuit breakers** — financial ops blocked when Redis/Postgres/RPC down
- **DependencyGuard** — pre-flight infrastructure checks before sweep/transfer/execution

### Monitoring & Observability
- **Correlation ID** — `X-Correlation-ID` propagated across HTTP, Celery, and logs (contextvars)
- **Structured JSON logging** — correlation_id, service, chain_id, tx_hash, duration_ms
- `/health`, `/health/live`, `/health/ready`, `/health/deep` (5-component concurrent check)
- `/health/sweep` — full pipeline health (DB, Redis, Celery, circuit breakers, hot wallet)
- `/health/rpc` — per-chain RPC provider status
- `/health/config` — env var audit (values never exposed)
- Prometheus metrics via `/metrics`
- Sentry error tracking
- OpenTelemetry tracing (optional)

### Alert Service
- **Immediate notifications** — Telegram bot + generic webhook (Slack/Discord/PagerDuty)
- **9 alert types** — SIGNING_DOWN, SIGNING_SPIKE, KMS_RATE_LIMIT, RPC_DOWN, REDIS_DOWN, AML_BLOCK, SWEEP_FAILED, BALANCE_LOW, CB_RECOVERY
- **Per-severity cooldown** — EMERGENCY (1min), CRITICAL (5min), WARNING (15min), INFO (60min)
- **Circuit breaker integration** — automatic alert on OPEN + recovery notification on CLOSED

### Token Explorer
- **Multi-chain token list** — unified view across all 12 supported chains (EVM + TRON)
- **Bulk market data** — single `/api/tokens-market` call fetches price, 24h change, 7d sparkline, logo, market cap, and 24h volume for every token (collapses 16+ CoinGecko requests into one)
- **Server-side cache** — 5 min TTL with stale-on-error fallback (UI degrades gracefully if CoinGecko is unreachable)
- **Ranked ordering** — majors first (BTC, ETH, TRX, BNB, AVAX, POL, OP, ARB, CELO), then stables (USDC, USDT, DAI, cUSD, USDB, USDD, WETH)
- **Per-row sparkline** — Catmull-Rom smoothed SVG chart with gradient fill, in-line per token row
- **Inline Token Detail view** (Uniswap-style, no route change):
  - Back button → `AnimatePresence` transition to the table
  - Large 48px logo + name + symbol + current price (mono font)
  - Interactive 700×300 SVG chart with hover crosshair + circle marker + tooltip (price override on hover, change recomputed vs series start)
  - Time-range pills `[1H | 1D | 1W | 1M | 1Y]` (only `1W` active; others disabled with "Coming soon" tooltip)
  - Stats grid: market cap, 24h volume, chains count — all compact-formatted (`$281.7B`, `$293.5M`)
  - Chain pill list with real CoinGecko CDN icons + letter-bubble fallback on 404
  - Per-chain contract addresses: truncated `0xAAAA…BBBB`, clipboard copy with 1.5s flash, explorer link (`SUPPORTED_CHAINS[chainId].explorerUrl/token/{addr}`), native tokens render as "Native token"
- **Resilient icons** — two-tier fallback: CDN image first, colored letter bubble on error (no broken-image artifacts)
- **Parallax background** — `.rp-bg` orb layer drifts at 15% of scroll velocity via `requestAnimationFrame` + `translate3d`, respects `prefers-reduced-motion`

## Stack

### Frontend
| Dependency | Version | Purpose |
|---|---|---|
| Next.js | 14.2 | App Router, SSR |
| React | 18.3 | UI |
| Wagmi | 2.19 | EVM wallet |
| Viem | 2.47 | EVM client |
| RainbowKit | 2.2 | Wallet connect UI |
| @solana/web3.js | 1.98 | Solana |
| TronWeb | 6.2 | Tron |
| Zustand | 5.0 | State management |
| React Query | 5.45 | Data fetching |
| Framer Motion | 12.38 | Animations |
| Recharts | 3.8 | Charts |
| Tailwind CSS | 3.4 | Styling |
| jsPDF | 4.2 | PDF receipts |

### Backend
| Dependency | Purpose |
|---|---|
| FastAPI + Uvicorn | API server (4 workers prod) |
| SQLAlchemy 2.0 + asyncpg | Async ORM + PostgreSQL |
| Alembic | Database migrations (15 versions) |
| Redis + hiredis | Cache, rate limiting, idempotency, nonce dedup |
| Celery | Async task queue |
| eth-account + eth-abi | EVM transaction signing |
| boto3 | AWS KMS signing + audit |
| Sentry SDK | Error tracking |
| Prometheus | Metrics + circuit breaker gauges |
| OpenTelemetry | Distributed tracing (optional) |
| SciPy + Pandas | Anomaly detection |
| lxml | DAC8 XML compliance reports |
| httpx | Async HTTP client (alerts, webhooks) |

### Smart Contracts
| Tool | Purpose |
|---|---|
| Solidity 0.8.24 | Contract language |
| Foundry (Forge) | Build, test, deploy |
| OpenZeppelin v5 | Security primitives |

## Project Structure

```
fee-router-dapp/
├── app/                          # Next.js pages + components
│   ├── CommandCenter.tsx         # Main control panel (6 tabs)
│   ├── TransferForm.tsx          # Token transfer (gold standard pattern)
│   ├── CrossChainForm.tsx        # CCIP bridge + swap & bridge UI
│   ├── PortfolioDashboard.tsx    # Portfolio analytics
│   ├── SwapModule.tsx            # Token swap UI
│   ├── SweepFeed.tsx             # Real-time sweep WebSocket feed
│   ├── ExploreTokens.tsx         # Multi-chain token explorer + inline detail view switcher
│   ├── TokenDetailView.tsx       # Uniswap-style detail: chart + stats + chains + addresses
│   ├── tokens/
│   │   └── tokenRegistry.ts      # TOKEN_LIST + SUPPORTED_CHAINS (explorer URLs, native currency, icon URLs)
│   ├── providers.tsx             # EVM providers (Wagmi + RainbowKit)
│   ├── providers-solana.tsx      # Solana wallet adapter
│   ├── providers-tron.tsx        # Tron wallet adapter
│   └── api/                      # Next.js API routes
│       ├── oracle/sign/          # Compliance oracle
│       ├── portfolio/[address]/  # Portfolio data
│       └── tokens-market/        # CoinGecko bulk proxy (price + 24h + 7d sparkline + image, 5-min cache, stale-on-error)
├── components/shared/
│   └── ChainFamilySwitch.tsx     # EVM/Solana/Tron selector
├── hooks/
│   ├── useUniversalWallet.ts     # Multi-chain wallet abstraction
│   └── useTronWallet.ts          # Tron wallet hook
├── lib/
│   ├── chain-adapters/           # Chain abstraction layer
│   │   ├── types.ts              # ChainFamily, UniversalAddress, adapters
│   │   ├── evm-adapter.ts        # EVM (swap, transfer, fee routing)
│   │   ├── solana-adapter.ts     # Solana adapter
│   │   ├── tron-adapter.ts       # Tron adapter
│   │   └── registry.ts           # Adapter registry
│   ├── useForwardingRules.ts     # EVM forwarding CRUD + wallet auth
│   ├── useSwapQuote.ts           # DEX quote aggregation
│   ├── usePermit2Flow.ts         # EIP-2612 gasless approvals
│   ├── useComplianceEngine.ts    # Client-side compliance
│   ├── useSweepWebSocket.ts      # WebSocket sweep feed
│   ├── contractRegistry.ts       # Deployed contract addresses
│   ├── ccipRegistry.ts           # CCIP chain configs + selectors
│   ├── ccipMonitor.ts            # CCIP event processing
│   └── feeRouterAbi.ts           # Contract ABI
├── contracts/                    # Foundry project
│   ├── src/
│   │   ├── FeeRouterV4.sol           # Fee routing + splitting
│   │   ├── RSendBatchDistributor.sol # Batch distribution
│   │   ├── RSendForwarder.sol        # Per-user forwarder
│   │   ├── RSendCCIPSender.sol       # CCIP cross-chain sender + swap
│   │   └── RSendCCIPReceiver.sol     # CCIP cross-chain receiver
│   ├── test/                     # Forge tests
│   ├── script/                   # Deploy scripts
│   │   ├── DeployCCIP.s.sol      # CCIP sender + receiver deploy
│   │   └── ...
│   └── foundry.toml
├── rpagos-backend/               # Python backend
│   ├── app/
│   │   ├── main.py               # FastAPI app + health checks
│   │   ├── config.py             # Settings (env vars)
│   │   ├── celery_app.py         # Celery config
│   │   ├── api/
│   │   │   ├── routes.py              # TX callback, anomalies, DAC8
│   │   │   ├── merchant_routes.py     # B2B merchant API
│   │   │   ├── sweeper_routes.py      # Sweep operations
│   │   │   ├── distribution_routes.py
│   │   │   ├── execution_routes.py    # Cross-chain engine
│   │   │   ├── strategy_routes.py     # Conditional automation
│   │   │   ├── signing_routes.py      # Signing guard + audit
│   │   │   ├── aml_routes.py          # AML check + admin panel
│   │   │   ├── health_routes.py       # /health/deep (5-component)
│   │   │   ├── ledger_routes.py
│   │   │   ├── audit_routes.py
│   │   │   ├── price_routes.py
│   │   │   └── websocket_routes.py
│   │   ├── models/
│   │   │   ├── db_models.py           # TransactionLog, ComplianceSnapshot
│   │   │   ├── forwarding_models.py   # ForwardingRule, SweepLog
│   │   │   ├── ledger_models.py       # Account, LedgerEntry (double-entry)
│   │   │   ├── command_models.py      # DistributionList, SweepBatch
│   │   │   ├── strategy_models.py     # Strategy (conditions + actions)
│   │   │   ├── merchant_models.py     # PaymentIntent, MerchantWebhook, WebhookDelivery
│   │   │   ├── aml_models.py          # SanctionEntry, AMLAlert, AMLConfig, BlacklistedWallet
│   │   │   ├── signing_models.py     # SigningAuditLog (immutable)
│   │   │   ├── kms_models.py         # KMSAuditLog (immutable)
│   │   │   └── schemas.py            # Pydantic schemas
│   │   ├── services/
│   │   │   ├── execution_engine.py    # Cross-chain pipeline
│   │   │   ├── strategy_engine.py     # Condition evaluator
│   │   │   ├── sweep_service.py       # Sweep orchestration
│   │   │   ├── split_executor.py      # Split plan execution + AML gate
│   │   │   ├── distribution_service.py
│   │   │   ├── ledger_service.py      # Double-entry bookkeeping
│   │   │   ├── reconciliation_service.py
│   │   │   ├── webhook_service.py     # Merchant webhook delivery + retry
│   │   │   ├── aml_service.py         # AML screening + monitoring + split checks
│   │   │   ├── aml_exceptions.py      # AMLBlockedError, AMLReviewRequired
│   │   │   ├── anomaly_service.py     # Statistical detection
│   │   │   ├── circuit_breaker.py     # Fault tolerance + DependencyGuard
│   │   │   ├── alert_service.py       # Telegram/webhook alerts + cooldown
│   │   │   ├── signing_audit.py       # Immutable signing audit log
│   │   │   ├── signing_rate_limit.py  # Redis-backed signing rate limits
│   │   │   ├── key_manager.py         # KMS/Local/Vault signers + rate limit + audit
│   │   │   ├── cache_service.py       # Redis
│   │   │   ├── nonce_manager.py       # Nonce + gap detection
│   │   │   ├── wallet_manager.py      # Hot wallet
│   │   │   ├── rpc_manager.py         # Multi-provider RPC
│   │   │   ├── gas_estimator.py
│   │   │   ├── price_service.py
│   │   │   ├── notification_service.py
│   │   │   └── spending_policy.py     # Reserve/release
│   │   ├── middleware/
│   │   │   ├── correlation.py         # X-Correlation-ID (contextvars)
│   │   │   ├── structured_logging.py  # JSON formatter + TimedOperation
│   │   │   ├── rate_limit.py
│   │   │   ├── idempotency.py
│   │   │   ├── input_sanitization.py
│   │   │   ├── api_auth.py
│   │   │   ├── error_handler.py
│   │   │   └── request_context.py
│   │   ├── security/
│   │   │   ├── auth.py
│   │   │   ├── api_keys.py
│   │   │   ├── input_validator.py
│   │   │   └── webhook_verifier.py
│   │   ├── tasks/                # Celery async tasks
│   │   │   ├── sweep_tasks.py
│   │   │   ├── periodic_tasks.py
│   │   │   └── notification_tasks.py
│   │   └── jobs/
│   │       └── reconciliation_job.py
│   ├── alembic/                  # DB migrations (0001–0015)
│   │   ├── env.py
│   │   └── versions/
│   ├── infrastructure/
│   │   └── kms_policy.json       # AWS KMS IAM policy (signing + admin)
│   ├── data/
│   │   └── sanctions/
│   │       └── ofac_sdn.json     # OFAC SDN sanctioned addresses
│   ├── docker-compose.yml
│   └── requirements.txt
└── public/
    ├── chains/                   # Chain icons
    └── tokens/                   # Token icons
```

## Setup

### Prerequisites
- Node.js >= 20.x
- Python >= 3.11
- PostgreSQL 15+
- Redis 7+
- Foundry (for contracts)

### Frontend

```bash
npm install --legacy-peer-deps
cp .env.local.example .env.local
# Fill in: NEXT_PUBLIC_WC_PROJECT_ID, NEXT_PUBLIC_TREASURY_ADDRESS, NEXT_PUBLIC_ALCHEMY_API_KEY
npm run dev
```

### Backend

```bash
cd rpagos-backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Fill in: DATABASE_URL, REDIS_URL, ALCHEMY_API_KEY, SWEEP_PRIVATE_KEY, HMAC_SECRET
alembic upgrade head
uvicorn app.main:app --reload
```

### Smart Contracts

```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts --no-git
forge build
forge test
# Deploy: see contracts/script/
```

### Docker (Backend + Infra)

```bash
cd rpagos-backend
docker-compose up -d  # PostgreSQL + Redis + Celery
```

## API Endpoints

### Transactions
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/tx/callback` | Alchemy webhook callback |
| GET | `/api/v1/tx/{fiscal_ref}` | Get transaction by fiscal ref |

### Forwarding & Sweeps
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/sweep/rules` | Create forwarding rule |
| GET | `/api/v1/sweep/rules` | List rules for owner |
| POST | `/api/v1/sweep/execute` | Trigger sweep execution |
| WS | `/ws/sweep-feed` | Real-time sweep events |

### Distribution
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/distribution/lists` | Create distribution list |
| POST | `/api/v1/distribution/execute` | Execute batch distribution |

### Cross-Chain Execution
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/execution/plan` | Create execution plan (dry-run) |
| POST | `/api/v1/execution/plan/{id}/execute` | Execute plan |
| GET | `/api/v1/execution/plan/{id}` | Get plan status |

### Strategies
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/strategies/` | Create conditional strategy |
| GET | `/api/v1/strategies/` | List strategies for owner |
| PATCH | `/api/v1/strategies/{id}` | Update strategy |
| DELETE | `/api/v1/strategies/{id}` | Delete strategy |
| POST | `/api/v1/strategies/simulate` | Dry-run condition test |

### Merchant B2B API
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/merchant/payment-intent` | Create payment intent |
| GET | `/api/v1/merchant/payment-intent/{id}` | Get intent status |
| POST | `/api/v1/merchant/webhook/register` | Register webhook URL |
| POST | `/api/v1/merchant/webhook/test` | Send test event |
| GET | `/api/v1/merchant/transactions` | List merchant transactions |

### Signing Guard (internal, called by oracle)
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/internal/signing/check` | Pre-signing validation (rate limit, nonce, chain, amount, deadline) |
| POST | `/api/internal/signing/audit` | Write to immutable signing audit log |

### AML
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/aml/check` | Full AML check (screening + monitoring) |
| GET | `/admin/aml/alerts` | List alerts (filter by status/sender, paginated) |
| POST | `/admin/aml/alerts/{id}/review` | Review alert (reviewed/escalated/dismissed) |
| POST | `/admin/aml/sanctions/update` | Upload sanctions list (JSON) or load OFAC file |
| GET | `/admin/aml/stats` | 24h alert statistics |

### Compliance
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/anomalies` | List anomaly alerts |
| POST | `/api/v1/dac8/generate` | Generate DAC8 XML report |

### Health & Monitoring
| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Basic health + Redis status |
| GET | `/health/live` | Liveness probe (container) |
| GET | `/health/ready` | Readiness probe (DB + Redis) |
| GET | `/health/deep` | 5-component check (Postgres, Redis, Celery, RPC, KMS) |
| GET | `/health/sweep` | Full pipeline health |
| GET | `/health/rpc` | Per-chain RPC status |
| GET | `/health/config` | Env var audit |
| GET | `/health/dependencies` | Circuit breaker states |
| GET | `/health/reconciliation` | Last reconciliation report |
| GET | `/metrics` | Prometheus metrics |

## Networks

| Chain | ID | Status | CCIP Bridge |
|---|---|---|---|
| Base Mainnet | 8453 | Production | Yes |
| Base Sepolia | 84532 | Testnet | - |
| Ethereum | 1 | Supported | Yes |
| Arbitrum | 42161 | Supported | Yes |
| Optimism | 10 | Supported | Yes |
| Polygon | 137 | Supported | Yes |
| BNB Chain | 56 | Supported | Yes |
| Avalanche | 43114 | Supported | Yes |
| Solana Mainnet | mainnet-beta | Supported | - |
| Tron Mainnet | tron-mainnet | Supported | - |

## Environment Variables

### Frontend (.env.local)
```
NEXT_PUBLIC_WC_PROJECT_ID=        # WalletConnect Cloud
NEXT_PUBLIC_TREASURY_ADDRESS=     # Protocol fee wallet
NEXT_PUBLIC_ALCHEMY_API_KEY=      # Alchemy RPC
HMAC_SECRET=                      # HMAC-SHA256 secret (must match backend). Server-side only.
RPAGOS_BACKEND_URL=               # Python backend URL (e.g. https://rpagos-backend.onrender.com)
ADMIN_SECRET=                     # Admin dashboard access token. Min 32 random chars.
```

### Backend (.env)
```
DATABASE_URL=                     # PostgreSQL async URL
REDIS_URL=                        # Redis URL
ALCHEMY_API_KEY=                  # Alchemy API
ALCHEMY_WEBHOOK_SECRET=           # Webhook HMAC (optional, enables webhook mode)
SWEEP_PRIVATE_KEY=                # Hot wallet key (local signer)
SIGNER_MODE=local                 # local | kms | vault
KMS_KEY_ID=                       # AWS KMS key (if signer_mode=kms)
AWS_REGION=eu-west-1              # AWS region for KMS
DEPOSIT_MASTER_KEY=               # Master key for deposit address derivation
HMAC_SECRET=                      # API HMAC secret (>= 32 chars in prod)
TELEGRAM_BOT_TOKEN=               # Sweep notifications (optional)
TELEGRAM_CHAT_ID=                 # Sweep notifications chat
TELEGRAM_ALERT_CHAT_ID=           # Critical alerts chat (falls back to TELEGRAM_CHAT_ID)
ALERT_WEBHOOK_URL=                # Discord/Slack webhook for critical alerts
SENTRY_DSN=                       # Error tracking (optional)
OTEL_ENDPOINT=                    # OpenTelemetry OTLP endpoint (optional)
DEBUG=false                       # Enables /docs, verbose logging
```

## License

Proprietary. All rights reserved.
