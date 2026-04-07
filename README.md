# RSends — Multi-Chain Payment Gateway

Payment infrastructure for Web3: receive on any chain, auto-forward, swap, split, and distribute — with full compliance, double-entry ledger, and real-time monitoring.

## Architecture

```
Frontend (Next.js 14)          Backend (FastAPI)              Smart Contracts (Solidity)
----------------------         ----------------------         -------------------------
CommandCenter.tsx              execution_engine.py            FeeRouterV4.sol
TransferForm.tsx               strategy_engine.py             RSendBatchDistributor.sol
PortfolioDashboard.tsx         sweep_service.py               RSendForwarder.sol
SwapModule.tsx                 distribution_service.py
SweepFeed.tsx (WebSocket)      ledger_service.py
                               reconciliation_service.py
Chain Adapters
├── evm-adapter.ts             Middleware
├── solana-adapter.ts          ├── rate_limit.py
└── tron-adapter.ts            ├── idempotency.py
                               ├── input_sanitization.py
Hooks                          ├── api_auth.py
├── useUniversalWallet.ts      └── error_handler.py
├── useForwardingRules.ts
├── useSwapQuote.ts            Infrastructure
├── usePermit2Flow.ts          ├── Redis (cache + rate limit)
└── useSweepWebSocket.ts       ├── Celery (async tasks)
                               ├── PostgreSQL (asyncpg)
                               ├── Sentry (errors)
                               └── Prometheus (metrics)
```

## Features

### Multi-Chain Support
- **EVM** — Base, Ethereum, Arbitrum (Wagmi v2 + Viem)
- **Solana** — Mainnet, Devnet (@solana/web3.js)
- **Tron** — Mainnet, Shasta (TronWeb)
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
- Bridge integrations planned: LayerZero, Across, Wormhole

### Strategy DSL (Conditional Automation)
- IF/THEN rules layered on top of forwarding rules
- **Conditions**: amount thresholds, token matching, gas price, time windows, sender whitelists, daily limits
- **Actions**: forward, split, swap, delay, batch, notify, webhook, emergency stop
- Dry-run simulator via `/api/v1/strategies/simulate`
- Priority-based evaluation, execution limits, cooldowns

### Smart Contracts
- **FeeRouterV4** — Fee-splitting router with 0.5% protocol fee, multi-recipient support
- **RSendBatchDistributor** — Gas-optimized batch distribution (ETH + ERC-20)
- **RSendForwarder** — Deterministic forwarding contracts per user

### Compliance & Security
- AML screening (OFAC, Chainalysis integration)
- DAC8 XML report generation
- Anomaly detection (statistical)
- Anti-phishing setup
- Input sanitization middleware
- HMAC webhook verification
- API key authentication (production)
- Circuit breakers on all external services

### Financial Infrastructure
- Double-entry bookkeeping ledger
- Automated reconciliation (ledger vs blockchain)
- Spending policy enforcement (reserve/release)
- Nonce management with gap detection
- Idempotent webhook processing (Redis-backed, fail-closed)

### Monitoring & Observability
- `/health`, `/health/live`, `/health/ready`, `/health/deep`
- `/health/sweep` — full pipeline health (DB, Redis, Celery, circuit breakers, hot wallet)
- `/health/rpc` — per-chain RPC provider status
- `/health/config` — env var audit (values never exposed)
- Prometheus metrics via `/metrics`
- Sentry error tracking
- Structured JSON logging

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
| Alembic | Database migrations |
| Redis + hiredis | Cache, rate limiting, idempotency |
| Celery | Async task queue |
| eth-account + eth-abi | EVM transaction signing |
| boto3 | AWS KMS signing (optional) |
| Sentry SDK | Error tracking |
| Prometheus | Metrics |
| SciPy + Pandas | Anomaly detection |
| lxml | DAC8 XML compliance reports |
| httpx | Async HTTP client |

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
│   ├── PortfolioDashboard.tsx    # Portfolio analytics
│   ├── SwapModule.tsx            # Token swap UI
│   ├── SweepFeed.tsx             # Real-time sweep WebSocket feed
│   ├── providers.tsx             # EVM providers (Wagmi + RainbowKit)
│   ├── providers-solana.tsx      # Solana wallet adapter
│   ├── providers-tron.tsx        # Tron wallet adapter
│   └── api/                      # Next.js API routes
│       ├── oracle/sign/          # Compliance oracle
│       └── portfolio/[address]/  # Portfolio data
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
│   └── feeRouterAbi.ts           # Contract ABI
├── contracts/                    # Foundry project
│   ├── src/
│   │   ├── FeeRouterV4.sol       # Fee routing + splitting
│   │   ├── RSendBatchDistributor.sol  # Batch distribution
│   │   └── RSendForwarder.sol    # Per-user forwarder
│   ├── test/                     # Forge tests
│   ├── script/                   # Deploy scripts
│   └── foundry.toml
├── rpagos-backend/               # Python backend
│   ├── app/
│   │   ├── main.py               # FastAPI app + health checks
│   │   ├── config.py             # Settings (env vars)
│   │   ├── celery_app.py         # Celery config
│   │   ├── api/
│   │   │   ├── routes.py         # TX callback, anomalies, DAC8
│   │   │   ├── sweeper_routes.py # Sweep operations
│   │   │   ├── distribution_routes.py
│   │   │   ├── execution_routes.py    # Cross-chain engine
│   │   │   ├── strategy_routes.py     # Conditional automation
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
│   │   │   ├── aml_models.py          # BlacklistedWallet
│   │   │   └── schemas.py            # Pydantic schemas
│   │   ├── services/
│   │   │   ├── execution_engine.py    # Cross-chain pipeline
│   │   │   ├── strategy_engine.py     # Condition evaluator
│   │   │   ├── sweep_service.py       # Sweep orchestration
│   │   │   ├── distribution_service.py
│   │   │   ├── ledger_service.py      # Double-entry bookkeeping
│   │   │   ├── reconciliation_service.py
│   │   │   ├── aml_service.py         # AML/OFAC screening
│   │   │   ├── anomaly_service.py     # Statistical detection
│   │   │   ├── circuit_breaker.py     # Fault tolerance
│   │   │   ├── cache_service.py       # Redis
│   │   │   ├── nonce_manager.py       # Nonce + gap detection
│   │   │   ├── wallet_manager.py      # Hot wallet
│   │   │   ├── rpc_manager.py         # Multi-provider RPC
│   │   │   ├── gas_estimator.py
│   │   │   ├── price_service.py
│   │   │   ├── notification_service.py
│   │   │   └── spending_policy.py     # Reserve/release
│   │   ├── middleware/
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
│   ├── alembic/                  # DB migrations
│   │   ├── env.py
│   │   └── versions/
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

### Compliance
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/anomalies` | List anomaly alerts |
| POST | `/api/v1/dac8/generate` | Generate DAC8 XML report |

### Health
| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Basic health + Redis status |
| GET | `/health/live` | Liveness probe (container) |
| GET | `/health/ready` | Readiness probe (DB + Redis) |
| GET | `/health/deep` | Last reconciliation report |
| GET | `/health/sweep` | Full pipeline health |
| GET | `/health/rpc` | Per-chain RPC status |
| GET | `/health/config` | Env var audit |
| GET | `/metrics` | Prometheus metrics |

## Networks

| Chain | ID | Status |
|---|---|---|
| Base Mainnet | 8453 | Production |
| Base Sepolia | 84532 | Testnet |
| Ethereum | 1 | Supported |
| Arbitrum | 42161 | Supported |
| Solana Mainnet | mainnet-beta | Supported |
| Tron Mainnet | tron-mainnet | Supported |

## Environment Variables

### Frontend (.env.local)
```
NEXT_PUBLIC_WC_PROJECT_ID=        # WalletConnect Cloud
NEXT_PUBLIC_TREASURY_ADDRESS=     # Protocol fee wallet
NEXT_PUBLIC_ALCHEMY_API_KEY=      # Alchemy RPC
```

### Backend (.env)
```
DATABASE_URL=                     # PostgreSQL async URL
REDIS_URL=                        # Redis URL
ALCHEMY_API_KEY=                  # Alchemy API
ALCHEMY_WEBHOOK_SECRET=           # Webhook HMAC (optional, enables webhook mode)
SWEEP_PRIVATE_KEY=                # Hot wallet key (local signer)
SIGNER_MODE=local                 # local | kms
KMS_KEY_ID=                       # AWS KMS key (if signer_mode=kms)
HMAC_SECRET=                      # API HMAC secret
TELEGRAM_BOT_TOKEN=               # Notifications (optional)
TELEGRAM_CHAT_ID=                 # Notifications (optional)
SENTRY_DSN=                       # Error tracking (optional)
DEBUG=false                       # Enables /docs, verbose logging
```

## License

Proprietary. All rights reserved.
