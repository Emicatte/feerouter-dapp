IN QUESTO MOMENTO è SOLO DISPONIBILE LA SEZIONE "SEND" LE ALTRE SONO ANCORA IN SVILUPPO
1. Stack Tecnologico
Backend: Framework FastAPI (Python 3.11+) con esecuzione asincrona.

Database: PostgreSQL gestito tramite SQLAlchemy 2.0 con supporto asyncpg e Connection Pooling ottimizzato per alti volumi di scrittura.

Caching & Concurrency: Redis utilizzato per il rate-limiting (sliding window), caching dei metadata e gestione dello stato di idempotenza.

Infrastructure: Containerizzazione Docker con reverse proxy Nginx per il bilanciamento del carico e la terminazione SSL.

2. Architettura Event-Driven (Auto-Forwarding)
Il sistema di "Smart Routing" (Sweeper) è attivato in tempo reale tramite Alchemy Webhooks:

Verifica di Sicurezza: Ogni richiesta in entrata viene validata tramite firma HMAC SHA256 per garantire l'autenticità del mittente.

Idempotency Control: Implementazione di un controllo univoco sul trigger_tx_hash per prevenire l'esecuzione duplicata di trasferimenti a fronte di notifiche multiple.

Asynchronous Processing: La logica di sweep è gestita tramite task asincroni per non bloccare l'endpoint del webhook, garantendo tempi di risposta inferiori ai 100ms.

3. Motore di Esecuzione e Sicurezza (Sweep Engine)
Per proteggere il capitale degli utenti e ottimizzare i costi operativi, è stato implementato il Gas-Guard System:

Analisi Dinamica del Gas: Il sistema calcola il costo stimato in ETH/Base prima di ogni transazione.

Soglia di Sostenibilità: Se le commissioni di rete superano una percentuale definita (es. max_gas_percent: 10%), lo sweep viene sospeso e messo in stato gas_too_high.

Retry Logic: Un cron-job monitora le transazioni sospese, riprovando l'esecuzione non appena le condizioni di rete tornano favorevoli.

4. Compliance e Reporting (DAC8 Ready)
L'intera struttura dati è stata progettata nativamente per soddisfare i requisiti della direttiva DAC8 (CARF):

Tracciamento granulare di ogni transazione con metadati completi (timestamp, indirizzi, valori, hash).

Storage centralizzato dei log di esecuzione per generare reportistica fiscale automatizzata per le autorità competenti.

5. Scalabilità e Monitoraggio
Rate Limiting: Protezione contro attacchi DoS implementata a livello Nginx e applicativo via Redis.

Observability: Integrazione con Prometheus e Sentry per il monitoraggio in tempo reale delle prestazioni e il tracciamento degli errori (Error Tracking).