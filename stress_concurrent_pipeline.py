"""
Stress Test S3: Concurrent TX Pipeline (Nonce Collision Detection)

Simula il caso peggiore: N distribuzioni lanciate simultaneamente.
Ogni TX ha un nonce pre-assegnato. Se il nonce manager ha bug, TX collidono.

Adattivo: calcola il numero massimo di TX dalla balance disponibile.
Target: 50 TX. Se la balance non basta, lancia il massimo possibile.
"""

import asyncio
import json
import sys
import time
import os
from collections import Counter

from web3 import Web3

# ─── Config ────────────────────────────────────────────────────
RPC_URL = os.environ.get(
    "RPC_URL",
    "https://base-sepolia.g.alchemy.com/v2/" + os.environ.get("ALCHEMY_API_KEY", ""),
)
PRIVATE_KEY = os.environ.get(
    "PRIVATE_KEY",
    os.environ.get("ORACLE_PRIVATE_KEY", ""),
)
CONTRACT = "0x481062Ba5843BbF8BcC7781EF84D42e49D0D77c3"
CHAIN_ID = 84532  # Base Sepolia

TARGET_CONCURRENT_TXS = 50
RECIPIENTS_PER_TX = 5         # 5 recipients per call (as specified)
VALUE_PER_TX_WEI = 100_000    # minimal value — test is about nonce, not amounts
GAS_MARGIN = 1.3              # 30% gas margin
CONFIRMATION_TIMEOUT = 180    # seconds

ABI = [
    {
        "inputs": [
            {"name": "recipients", "type": "address[]"},
            {"name": "amounts", "type": "uint256[]"},
        ],
        "name": "distributeETH",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function",
    }
]


def setup():
    """Validate env and return (w3, account, contract)."""
    if not PRIVATE_KEY:
        print("ERROR: Set PRIVATE_KEY or ORACLE_PRIVATE_KEY env var")
        sys.exit(1)

    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    if not w3.is_connected():
        print(f"ERROR: Cannot connect to {RPC_URL[:40]}...")
        sys.exit(1)

    chain = w3.eth.chain_id
    if chain != CHAIN_ID:
        print(f"ERROR: Expected chain {CHAIN_ID}, got {chain}")
        sys.exit(1)

    account = w3.eth.account.from_key(PRIVATE_KEY)
    contract = w3.eth.contract(address=CONTRACT, abi=ABI)
    return w3, account, contract


def estimate_max_txs(w3, account, contract):
    """Estimate gas cost per TX and return (max_affordable, gas_limit, gas_params)."""
    balance = w3.eth.get_balance(account.address)

    # Build gas params (EIP-1559 for Base)
    latest = w3.eth.get_block("latest")
    base_fee = latest.get("baseFeePerGas", w3.eth.gas_price)
    max_priority = max(base_fee // 10, 1_000_000)  # at least 0.001 gwei
    max_fee = base_fee * 2 + max_priority

    gas_params = {
        "maxFeePerGas": max_fee,
        "maxPriorityFeePerGas": max_priority,
    }

    # Estimate gas with a real call
    recipients = [w3.eth.account.create().address for _ in range(RECIPIENTS_PER_TX)]
    fee_wei = VALUE_PER_TX_WEI * 50 // 10_000
    distributable = VALUE_PER_TX_WEI - fee_wei
    per_r = distributable // RECIPIENTS_PER_TX
    amounts = [per_r] * (RECIPIENTS_PER_TX - 1)
    amounts.append(distributable - sum(amounts))

    gas_est = contract.functions.distributeETH(recipients, amounts).estimate_gas(
        {"from": account.address, "value": VALUE_PER_TX_WEI}
    )
    gas_limit = int(gas_est * GAS_MARGIN)

    cost_per_tx = gas_limit * max_fee + VALUE_PER_TX_WEI
    max_affordable = int(balance * 0.95 / cost_per_tx)  # keep 5% reserve

    return max_affordable, gas_limit, gas_params, balance, cost_per_tx


def build_distribute_tx(w3, account, contract, nonce, gas_limit, gas_params):
    """Build and sign a distributeETH transaction."""
    recipients = [w3.eth.account.create().address for _ in range(RECIPIENTS_PER_TX)]
    fee_wei = VALUE_PER_TX_WEI * 50 // 10_000
    distributable = VALUE_PER_TX_WEI - fee_wei
    per_r = distributable // RECIPIENTS_PER_TX
    amounts = [per_r] * (RECIPIENTS_PER_TX - 1)
    amounts.append(distributable - sum(amounts))

    tx = contract.functions.distributeETH(recipients, amounts).build_transaction(
        {
            "from": account.address,
            "value": VALUE_PER_TX_WEI,
            "nonce": nonce,
            "gas": gas_limit,
            "chainId": CHAIN_ID,
            **gas_params,
        }
    )
    signed = w3.eth.account.sign_transaction(tx, PRIVATE_KEY)
    return signed


def send_tx_sync(w3, account, contract, nonce, tx_index, gas_limit, gas_params):
    """Send a single TX (sync, for use with asyncio.to_thread)."""
    start = time.time()
    try:
        signed = build_distribute_tx(w3, account, contract, nonce, gas_limit, gas_params)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        elapsed = time.time() - start
        return {
            "index": tx_index,
            "nonce": nonce,
            "tx_hash": tx_hash.hex(),
            "send_time_ms": int(elapsed * 1000),
            "status": "SENT",
        }
    except Exception as e:
        elapsed = time.time() - start
        error_str = str(e)[:200]
        # "already known" means TX is in mempool — compute hash
        if "already known" in error_str.lower():
            return {
                "index": tx_index,
                "nonce": nonce,
                "tx_hash": "already_known",
                "send_time_ms": int(elapsed * 1000),
                "status": "SENT_ALREADY_KNOWN",
            }
        return {
            "index": tx_index,
            "nonce": nonce,
            "tx_hash": None,
            "send_time_ms": int(elapsed * 1000),
            "status": f"ERROR: {error_str}",
        }


async def main():
    w3, account, contract = setup()

    print("=" * 64)
    print("  STRESS TEST S3: Concurrent TX Pipeline (Nonce Collision)")
    print("=" * 64)
    print(f"  Chain:      Base Sepolia ({CHAIN_ID})")
    print(f"  Contract:   {CONTRACT}")
    print(f"  Sender:     {account.address}")

    # ── Estimate capacity ─────────────────────────────────
    max_affordable, gas_limit, gas_params, balance, cost_per_tx = estimate_max_txs(
        w3, account, contract
    )

    concurrent_txs = min(TARGET_CONCURRENT_TXS, max_affordable)
    if concurrent_txs < 3:
        print(f"\n  ERROR: Balance too low ({balance / 10**18:.8f} ETH)")
        print(f"         Need at least {3 * cost_per_tx / 10**18:.8f} ETH")
        print(f"         Fund wallet with Base Sepolia ETH and retry.")
        sys.exit(1)

    base_nonce = w3.eth.get_transaction_count(account.address)
    total_cost = concurrent_txs * cost_per_tx

    print(f"  Balance:    {balance / 10**18:.10f} ETH")
    print(f"  Gas limit:  {gas_limit}")
    print(f"  maxFee:     {gas_params['maxFeePerGas'] / 10**9:.6f} gwei")
    print(f"  Cost/TX:    {cost_per_tx / 10**18:.10f} ETH")
    print(f"  Base nonce: {base_nonce}")
    print(f"  TX count:   {concurrent_txs}" + (
        f" (reduced from {TARGET_CONCURRENT_TXS} — insufficient balance)"
        if concurrent_txs < TARGET_CONCURRENT_TXS
        else ""
    ))
    print(f"  Nonce range: {base_nonce} → {base_nonce + concurrent_txs - 1}")
    print(f"  Total cost: {total_cost / 10**18:.10f} ETH")
    print(f"  Recipients: {RECIPIENTS_PER_TX} per TX")
    print("-" * 64)

    # ── Launch ALL TXs in parallel ────────────────────────
    print(f"\nLaunching {concurrent_txs} TX simultaneously...")
    start = time.time()
    tasks = [
        asyncio.to_thread(
            send_tx_sync,
            w3, account, contract,
            base_nonce + i, i,
            gas_limit, gas_params,
        )
        for i in range(concurrent_txs)
    ]
    results = await asyncio.gather(*tasks)
    send_time = time.time() - start

    # ── Send phase results ────────────────────────────────
    sent = [r for r in results if r["status"].startswith("SENT")]
    errors = [r for r in results if not r["status"].startswith("SENT")]

    print(f"\nSend phase: {len(sent)} sent, {len(errors)} errors in {send_time:.2f}s")
    send_times = [r["send_time_ms"] for r in results]
    print(f"  Send latency: min={min(send_times)}ms, max={max(send_times)}ms, "
          f"avg={sum(send_times)//len(send_times)}ms")

    if errors:
        print("\n  Send errors:")
        error_types = Counter()
        for e in errors:
            # Extract first meaningful part of error
            err_msg = e["status"].replace("ERROR: ", "")[:80]
            error_types[err_msg] += 1
            print(f"    nonce={e['nonce']}: {e['status'][:100]}")
        print(f"  Error breakdown: {dict(error_types)}")

    # ── Check for nonce collisions (CRITICAL) ─────────────
    sent_nonces = [r["nonce"] for r in sent]
    nonce_counts = Counter(sent_nonces)
    collisions = {n: c for n, c in nonce_counts.items() if c > 1}
    if collisions:
        print(f"\n  CRITICAL: NONCE COLLISIONS DETECTED!")
        for nonce, count in sorted(collisions.items()):
            print(f"    Nonce {nonce}: used {count} times!")
    else:
        print(f"\n  No nonce collisions (all {len(sent)} nonces unique)")

    # ── Wait for confirmations ────────────────────────────
    confirmable = [r for r in sent if r["tx_hash"] and r["tx_hash"] != "already_known"]
    if confirmable:
        print(f"\nWaiting for {len(confirmable)} confirmations (timeout {CONFIRMATION_TIMEOUT}s)...")
        confirmed = 0
        reverted = 0
        timed_out = 0
        blocks_seen = set()

        for r in confirmable:
            try:
                receipt = w3.eth.wait_for_transaction_receipt(
                    r["tx_hash"], timeout=CONFIRMATION_TIMEOUT
                )
                r["gas_used"] = receipt.gasUsed
                r["block"] = receipt.blockNumber
                blocks_seen.add(receipt.blockNumber)
                if receipt.status == 1:
                    r["confirmed"] = "SUCCESS"
                    confirmed += 1
                else:
                    r["confirmed"] = "REVERTED"
                    reverted += 1
            except Exception:
                r["confirmed"] = "TIMEOUT"
                timed_out += 1

        print(f"  Confirmed: {confirmed}, Reverted: {reverted}, Timeout: {timed_out}")
        if blocks_seen:
            print(f"  Blocks used: {min(blocks_seen)} → {max(blocks_seen)} "
                  f"({max(blocks_seen) - min(blocks_seen) + 1} blocks)")
    else:
        confirmed = 0
        reverted = 0
        timed_out = 0

    # ── Nonce gap analysis ────────────────────────────────
    confirmed_nonces = sorted(
        [r["nonce"] for r in results if r.get("confirmed") == "SUCCESS"]
    )
    gaps = set()
    if confirmed_nonces:
        expected = set(range(confirmed_nonces[0], confirmed_nonces[-1] + 1))
        gaps = expected - set(confirmed_nonces)
        if gaps:
            print(f"\n  NONCE GAPS DETECTED: {sorted(gaps)}")
            print(f"  This means TX were lost in the mempool!")
        else:
            print(f"\n  No nonce gaps — all confirmed nonces sequential "
                  f"({confirmed_nonces[0]}..{confirmed_nonces[-1]})")

    # ── Final report ──────────────────────────────────────
    total_time = time.time() - start
    print(f"\n{'=' * 64}")
    print(f"  FINAL REPORT")
    print(f"{'=' * 64}")
    print(f"  TX attempted:       {concurrent_txs}")
    print(f"  Sent successfully:  {len(sent)}")
    print(f"  Send errors:        {len(errors)}")
    print(f"  Confirmed on-chain: {confirmed}")
    print(f"  Reverted:           {reverted}")
    print(f"  Timed out:          {timed_out}")
    print(f"  Nonce collisions:   {len(collisions)}")
    print(f"  Nonce gaps:         {len(gaps)}")
    print(f"  Total time:         {total_time:.1f}s")
    if confirmed > 0:
        print(f"  Effective TPS:      {confirmed / total_time:.2f} TX/s")
        print(f"  Recipients served:  {confirmed * RECIPIENTS_PER_TX}")
    print(f"  Total ETH spent:    ~{(balance - w3.eth.get_balance(account.address)) / 10**18:.10f}")

    # ── Verdict ───────────────────────────────────────────
    critical_issues = []
    if collisions:
        critical_issues.append(f"NONCE COLLISIONS: {collisions}")
    if gaps:
        critical_issues.append(f"NONCE GAPS: {sorted(gaps)}")
    if len(errors) > concurrent_txs * 0.1:
        critical_issues.append(f"HIGH ERROR RATE: {len(errors)}/{concurrent_txs}")

    print(f"\n{'=' * 64}")
    if critical_issues:
        print("  VERDICT: FAIL")
        for issue in critical_issues:
            print(f"    - {issue}")
    else:
        print(f"  VERDICT: PASS")
        print(f"    {concurrent_txs} concurrent TX, 0 nonce collisions, 0 gaps")
    print(f"{'=' * 64}")

    # ── Write detailed results ────────────────────────────
    report_file = "STRESS_S3_RESULTS.md"
    with open(report_file, "w") as f:
        f.write(f"# Stress Test S3: {concurrent_txs} Concurrent TX Pipeline\n\n")
        f.write(f"**Date:** {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}\n")
        f.write(f"**Chain:** Base Sepolia ({CHAIN_ID})\n")
        f.write(f"**Contract:** `{CONTRACT}`\n")
        f.write(f"**Sender:** `{account.address}`\n\n")

        f.write(f"## Results\n\n")
        f.write(f"| Metric | Value |\n")
        f.write(f"|--------|-------|\n")
        f.write(f"| TX attempted | {concurrent_txs} |\n")
        f.write(f"| Sent successfully | {len(sent)} |\n")
        f.write(f"| Send errors | {len(errors)} |\n")
        f.write(f"| Confirmed | {confirmed} |\n")
        f.write(f"| Reverted | {reverted} |\n")
        f.write(f"| Timed out | {timed_out} |\n")
        f.write(f"| Nonce collisions | {len(collisions)} |\n")
        f.write(f"| Nonce gaps | {len(gaps)} |\n")
        f.write(f"| Total time | {total_time:.1f}s |\n")
        f.write(f"| Effective TPS | {confirmed / total_time:.2f} |\n\n")

        verdict = "FAIL" if critical_issues else "PASS"
        f.write(f"## Verdict: {verdict}\n\n")
        if critical_issues:
            for issue in critical_issues:
                f.write(f"- {issue}\n")
        else:
            f.write(f"All {concurrent_txs} TX sent with unique nonces, ")
            f.write(f"no gaps, no collisions.\n")

        f.write(f"\n## Transaction Details\n\n")
        f.write(f"| # | Nonce | Status | Confirmed | Gas | Block | Send ms |\n")
        f.write(f"|---|-------|--------|-----------|-----|-------|--------|\n")
        for r in sorted(results, key=lambda x: x["nonce"]):
            f.write(
                f"| {r['index']} "
                f"| {r['nonce']} "
                f"| {r['status'][:20]} "
                f"| {r.get('confirmed', '-')} "
                f"| {r.get('gas_used', '-')} "
                f"| {r.get('block', '-')} "
                f"| {r['send_time_ms']} |\n"
            )

    print(f"\nDetailed results: {report_file}")


if __name__ == "__main__":
    asyncio.run(main())
