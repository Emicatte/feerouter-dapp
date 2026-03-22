# RPagos Backend Core — Compliance & Data Engine

Micro-servizio Python/FastAPI per ricevere transazioni Web3 dal frontend (`TransactionStatus.tsx`), validarle, persisterle e generare i report fiscali **DAC8/CARF** richiesti dalla normativa europea sulle cripto-attività.

## Stack

| Componente | Tecnologia | Ruolo |
|---|---|---|
| Framework | FastAPI | API async ad alte prestazioni |
| Validazione | Pydantic v2 | Schema validation tipizzata |
| Database | SQLAlchemy 2.0 + PostgreSQL | Persistenza immutabile |
| Anomalie | Scipy + Pandas + NumPy | Analisi statistiche z-score |
| Report XML | lxml | Generazione DAC8/CARF |
| Test | pytest + httpx | Test asincroni end-to-end |

## Architettura

```
rpagos-backend/
├── app/
│   ├── main.py              # FastAPI app + lifespan
│   ├── config.py             # Pydantic Settings (.env)
│   ├── api/
│   │   └── routes.py         # 4 endpoint REST
│   ├── models/
│   │   ├── db_models.py      # SQLAlchemy models (3 tabelle)
│   │   └── schemas.py        # Pydantic request/response
│   ├── services/
│   │   ├── hmac_service.py   # Verifica firma HMAC-SHA256
│   │   ├── anomaly_service.py # Analizzatore anomalie (stile radioastronomia)
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
