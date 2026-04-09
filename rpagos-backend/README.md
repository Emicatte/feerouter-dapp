# RPagos Backend Core — Compliance, Data Engine & Merchant B2B API

Micro-servizio Python/FastAPI per ricevere transazioni Web3 dal frontend (`TransactionStatus.tsx`), validarle, persisterle, generare i report fiscali **DAC8/CARF** e offrire un **layer B2B per integrazioni merchant** (payment intents, webhook con HMAC, retry automatico).

## Stack

| Componente | Tecnologia | Ruolo |
|---|---|---|
| Framework | FastAPI | API async ad alte prestazioni |
| Validazione | Pydantic v2 | Schema validation tipizzata |
| Database | SQLAlchemy 2.0 + PostgreSQL | Persistenza immutabile |
| Anomalie | Scipy + Pandas + NumPy | Analisi statistiche z-score |
| Report XML | lxml | Generazione DAC8/CARF |
| HTTP Client | httpx | Webhook delivery async |
| Test | pytest + httpx | Test asincroni end-to-end |

## Architettura

```
rpagos-backend/
├── app/
│   ├── main.py              # FastAPI app + lifespan
│   ├── config.py             # Pydantic Settings (.env)
│   ├── api/
│   │   ├── routes.py         # 4 endpoint REST (TX, anomalies, DAC8)
│   │   └── merchant_routes.py # 5 endpoint B2B merchant API
│   ├── models/
│   │   ├── db_models.py      # SQLAlchemy models (TransactionLog, ComplianceSnapshot)
│   │   ├── merchant_models.py # PaymentIntent, MerchantWebhook, WebhookDelivery
│   │   └── schemas.py        # Pydantic request/response
│   ├── services/
│   │   ├── hmac_service.py   # Verifica firma HMAC-SHA256
│   │   ├── anomaly_service.py # Analizzatore anomalie (stile radioastronomia)
│   │   ├── webhook_service.py # Merchant webhook delivery + retry engine
│   │   └── dac8_service.py   # Generatore XML DAC8/CARF
│   └── db/
│       └── session.py        # Async session manager
├── tests/
│   └── test_api.py           # 13 test (tutti passing)
├── docs/
│   └── useBackendCallback.ts # Hook frontend per integrazione
├── Dockerfile
├── requirements.txt
├── pyproject.toml
└── .env.example
```

## Quick Start

```bash
# 1. Clona e installa
cd rpagos-backend
pip install -r requirements.txt

# 2. Configura
cp .env.example .env
# Modifica .env con i tuoi parametri

# 3. Lancia (dev mode con SQLite)
python -m app.main
# → http://localhost:8000
# → Swagger docs: http://localhost:8000/docs

# 4. Test
pytest -v
```

## Endpoint API

### `POST /api/v1/tx/callback`
Riceve il payload dal frontend. Workflow:
1. **Valida HMAC** — verifica `x_signature` per prevenire replay attack
2. **Controlla duplicati** — rifiuta TX con `tx_hash` già registrato (409)
3. **Persiste** — salva `TransactionLog` + `ComplianceSnapshot`
4. **Risponde** — conferma con flag `dac8_reportable`

### `GET /api/v1/tx/{fiscal_ref}`
Recupera una transazione per riferimento fiscale.

### `GET /api/v1/anomalies?window_hours=24&currency=USDC`
Lancia l'analizzatore di anomalie. Cerca tre tipi di segnali:
- **Volume spike** — picco di TX/ora (come un Fast Radio Burst)
- **Amount outlier** — importo fuori dalla distribuzione (come una supernova)
- **Frequency burst** — intervalli troppo brevi (come una pulsar millisecondo)

### `POST /api/v1/dac8/generate?fiscal_year=2025`
Genera il report XML DAC8/CARF con tutte le TX `dac8_reportable=true`.

---

### Merchant B2B API

Autenticazione: Bearer API key (header `Authorization: Bearer rsend_live_xxx`).
Il `merchant_id` viene derivato automaticamente dall'API key.

### `POST /api/v1/merchant/payment-intent`
Crea un payment intent con importo, currency, recipient e scadenza configurabile (5min–24h, default 30min).
Ritorna un `intent_id` (`pi_xxxx`) da passare al pagatore.

### `GET /api/v1/merchant/payment-intent/{intent_id}`
Recupera lo status di un intent. Auto-expire se scaduto e ancora pending.

### `POST /api/v1/merchant/webhook/register`
Registra un URL HTTPS per ricevere notifiche webhook. Genera un secret HMAC-SHA256 restituito **una sola volta**.
Eventi supportati: `payment.completed`, `payment.expired`, `payment.cancelled`.

### `POST /api/v1/merchant/webhook/test`
Invia un evento di test al webhook registrato per verificare raggiungibilita e firma HMAC.

### `GET /api/v1/merchant/transactions?status=completed&currency=USDC&page=1&per_page=20`
Lista paginata dei payment intents del merchant con filtri per status e currency.

#### Webhook Delivery
- Firma HMAC-SHA256 nell'header `X-RSend-Signature`
- Retry con backoff esponenziale: 30s → 2min → 8min → 32min → 2h (max 5 tentativi)
- Idempotency: stessa TX → un solo webhook per endpoint
- Ogni delivery loggata per audit

## Integrazione Frontend

Il file `docs/useBackendCallback.ts` contiene l'hook React da aggiungere al progetto Next.js. Uso:

```tsx
const sendCallback = useBackendCallback()

useEffect(() => {
  if (phase === 'done' && txHash) {
    sendCallback({ txHash, grossStr, netStr, feeStr, symbol, ... })
  }
}, [phase])
```

## Produzione

```bash
# Con Docker
docker build -t rpagos-backend .
docker run -p 8000:8000 \
  -e DATABASE_URL=postgresql+asyncpg://user:pass@db:5432/rpagos \
  -e HMAC_SECRET=your-64-char-hex-secret \
  rpagos-backend
```

Per PostgreSQL in produzione, cambia `DATABASE_URL` nel `.env` e usa Alembic per le migrazioni:
```bash
alembic init alembic
alembic revision --autogenerate -m "initial"
alembic upgrade head
```
