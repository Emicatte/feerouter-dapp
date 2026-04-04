# Stress Test S3: 8 Concurrent TX Pipeline

**Date:** 2026-04-04 19:33:54 UTC
**Chain:** Base Sepolia (84532)
**Contract:** `0x481062Ba5843BbF8BcC7781EF84D42e49D0D77c3`
**Sender:** `0xa61A471FC226a06C681cf2Ec41d2C64a147b4392`

## Results

| Metric | Value |
|--------|-------|
| TX attempted | 8 |
| Sent successfully | 8 |
| Send errors | 0 |
| Confirmed | 8 |
| Reverted | 0 |
| Timed out | 0 |
| Nonce collisions | 0 |
| Nonce gaps | 0 |
| Total time | 3.1s |
| Effective TPS | 2.62 |

## Verdict: PASS

All 8 TX sent with unique nonces, no gaps, no collisions.

## Transaction Details

| # | Nonce | Status | Confirmed | Gas | Block | Send ms |
|---|-------|--------|-----------|-----|-------|--------|
| 0 | 135 | SENT | SUCCESS | 115697 | 39781473 | 374 |
| 1 | 136 | SENT | SUCCESS | 115697 | 39781473 | 346 |
| 2 | 137 | SENT | SUCCESS | 115697 | 39781473 | 351 |
| 3 | 138 | SENT | SUCCESS | 115697 | 39781473 | 318 |
| 4 | 139 | SENT | SUCCESS | 115697 | 39781473 | 343 |
| 5 | 140 | SENT | SUCCESS | 115697 | 39781473 | 343 |
| 6 | 141 | SENT | SUCCESS | 115697 | 39781473 | 350 |
| 7 | 142 | SENT | SUCCESS | 115697 | 39781473 | 376 |
