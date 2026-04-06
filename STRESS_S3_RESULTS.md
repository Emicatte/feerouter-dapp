# Stress Test S3: 50 Concurrent TX Pipeline

**Date:** 2026-04-05 11:34:28 UTC
**Chain:** Base Sepolia (84532)
**Contract:** `0x481062Ba5843BbF8BcC7781EF84D42e49D0D77c3`
**Sender:** `0x0e056Ce14D1D56f799588f4760E5C39d47f14B82`

## Verdict: **FAIL**

## Summary

| Metric | Value |
|--------|-------|
| TX Target | 50 |
| TX Attempted | 50 |
| Sent Successfully | 34 |
| Send Errors | 16 |
| Confirmed | 22 |
| Reverted | 0 |
| Timed Out | 12 |
| Nonce Collisions | NONE |
| Nonce Gaps | [91, 92, 93, 96, 97, 98, 100, 101, 102, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133] |
| Total Time | 1116.4s |
| Effective TPS | 0.02 |
| Blocks Used | 4 |
| ETH Spent | 0.0051963743 |

### Issues

- NONCE GAPS: [91, 92, 93, 96, 97, 98, 100, 101, 102, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133]
- HIGH ERROR RATE: 16/50

## TX Details

| # | Nonce | Status | Confirmed | Gas | Block | Send ms | Retries |
|---|-------|--------|-----------|-----|-------|---------|---------|
| 0 | 89 | SENT | SUCCESS | 229731 | 39809733 | 391 | 1 |
| 1 | 90 | SENT | SUCCESS | 229731 | 39809733 | 343 | 1 |
| 2 | 91 | SENT | TIMEOUT | - | - | 353 | 1 |
| 3 | 92 | ERROR: {'code': -320 | - | - | - | 531 | 1 |
| 4 | 93 | ERROR: {'code': -320 | - | - | - | 345 | 1 |
| 5 | 94 | SENT | SUCCESS | 229731 | 39809733 | 356 | 1 |
| 6 | 95 | SENT | SUCCESS | 229731 | 39809733 | 335 | 1 |
| 7 | 96 | ERROR: {'code': -320 | - | - | - | 365 | 1 |
| 8 | 97 | ERROR: {'code': -320 | - | - | - | 337 | 1 |
| 9 | 98 | SENT | TIMEOUT | - | - | 368 | 1 |
| 10 | 99 | SENT | SUCCESS | 229731 | 39809734 | 164 | 1 |
| 11 | 100 | ERROR: {'code': -320 | - | - | - | 411 | 1 |
| 12 | 101 | ERROR: {'code': -320 | - | - | - | 226 | 1 |
| 13 | 102 | ERROR: {'code': -320 | - | - | - | 162 | 1 |
| 14 | 103 | SENT | SUCCESS | 229719 | 39809734 | 159 | 1 |
| 15 | 104 | SENT | SUCCESS | 229731 | 39809734 | 237 | 1 |
| 16 | 105 | SENT | SUCCESS | 229719 | 39809734 | 241 | 1 |
| 17 | 106 | SENT | SUCCESS | 229731 | 39809734 | 250 | 1 |
| 18 | 107 | SENT | SUCCESS | 229719 | 39809734 | 174 | 1 |
| 19 | 108 | SENT | SUCCESS | 229719 | 39809734 | 232 | 1 |
| 20 | 109 | SENT | SUCCESS | 229719 | 39809735 | 171 | 1 |
| 21 | 110 | SENT | SUCCESS | 229731 | 39809735 | 176 | 1 |
| 22 | 111 | SENT | SUCCESS | 229719 | 39809735 | 155 | 1 |
| 23 | 112 | SENT | SUCCESS | 229731 | 39809735 | 172 | 1 |
| 24 | 113 | SENT | SUCCESS | 229731 | 39809735 | 787 | 1 |
| 25 | 114 | SENT | SUCCESS | 229719 | 39809735 | 162 | 1 |
| 26 | 115 | SENT | SUCCESS | 229731 | 39809735 | 179 | 1 |
| 27 | 116 | SENT | SUCCESS | 229731 | 39809735 | 169 | 1 |
| 28 | 117 | SENT | SUCCESS | 229719 | 39809735 | 161 | 1 |
| 29 | 118 | SENT | SUCCESS | 229731 | 39809735 | 1303 | 1 |
| 30 | 119 | ERROR: 429 Client Er | - | - | - | 0 | 3 |
| 31 | 120 | ERROR: 429 Client Er | - | - | - | 0 | 3 |
| 32 | 121 | ERROR: 429 Client Er | - | - | - | 0 | 3 |
| 33 | 122 | SENT | TIMEOUT | - | - | 159 | 1 |
| 34 | 123 | SENT | TIMEOUT | - | - | 2269 | 1 |
| 35 | 124 | SENT | TIMEOUT | - | - | 159 | 1 |
| 36 | 125 | SENT | TIMEOUT | - | - | 2274 | 1 |
| 37 | 126 | SENT | TIMEOUT | - | - | 627 | 1 |
| 38 | 127 | SENT | TIMEOUT | - | - | 1203 | 1 |
| 39 | 128 | ERROR: 429 Client Er | - | - | - | 0 | 3 |
| 40 | 129 | SENT | TIMEOUT | - | - | 237 | 1 |
| 41 | 130 | ERROR: 429 Client Er | - | - | - | 0 | 3 |
| 42 | 131 | SENT | TIMEOUT | - | - | 547 | 1 |
| 43 | 132 | SENT | TIMEOUT | - | - | 177 | 1 |
| 44 | 133 | SENT | TIMEOUT | - | - | 207 | 1 |
| 45 | 134 | SENT | SUCCESS | 229719 | 39810203 | 214 | 1 |
| 46 | 135 | ERROR: 429 Client Er | - | - | - | 0 | 3 |
| 47 | 136 | ERROR: 429 Client Er | - | - | - | 0 | 3 |
| 48 | 137 | ERROR: 429 Client Er | - | - | - | 0 | 3 |
| 49 | 138 | ERROR: 429 Client Er | - | - | - | 0 | 3 |
