"""
Stress Test S5: 200-Wallet Mega Batch + Full Wei-Level Reconciliation
Simula un payroll aziendale da 200 destinatari.
Ogni wei deve arrivare al wallet giusto — tolleranza zero.

Budget scaling: il deployer ha 0.000711 ETH (dopo i test precedenti).
Usiamo 0.0006 ETH (600_000_000_000_000 wei) invece di 0.1 ETH.
La matematica di reconciliation è identica a qualsiasi scala.
"""

import json
import os
import sys
import time
import subprocess
from web3 import Web3
from web3.exceptions import TransactionNotFound
from decimal import Decimal

# ── Config ─────────────────────────────────────────────────────────────────────
RPC_URL     = "https://base-sepolia.g.alchemy.com/v2/KsynbKs-OZ1c4BSw-2D4R"
PRIVATE_KEY = "0xe6b574972275d918bfb8c72b91e2fc3d152d1841d53854a6c64866442104a2ce"
CONTRACT    = "0x481062Ba5843BbF8BcC7781EF84D42e49D0D77c3"
DEPLOYER    = "0xa61A471FC226a06C681cf2Ec41d2C64a147b4392"
TREASURY    = DEPLOYER   # treasury == deployer in this contract deployment
CHAIN_ID    = 84532
N           = 200
FEE_BPS     = 50
BPS_DENOM   = 10_000

# Scaled-down total: 0.0006 ETH (original target: 0.1 ETH)
# Saved ~0.0001 ETH for gas (200 recipients × ~37,177 gas ≈ 7.5M gas @ 0.006 gwei = 0.000045 ETH)
TOTAL_WEI   = 600_000_000_000_000     # 0.0006 ETH
ORIGINAL_TARGET_ETH = 0.1

# ABI
ABI = [
    {
        "inputs": [
            {"name": "recipients", "type": "address[]"},
            {"name": "amounts",    "type": "uint256[]"}
        ],
        "name": "distributeETH",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
    }
]

# Event signatures
SINGLE_TRANSFER_TOPIC  = Web3.keccak(text="SingleTransfer(address,uint256,uint256)").hex()
BATCH_DISTRIBUTED_TOPIC = Web3.keccak(text="BatchDistributed(address,address,uint256,uint256,uint256)").hex()

w3       = Web3(Web3.HTTPProvider(RPC_URL))
contract = w3.eth.contract(address=Web3.to_checksum_address(CONTRACT), abi=ABI)


# ══════════════════════════════════════════════════════════════════════════════
# STEP 1: Generate 200 deterministic wallet addresses
# ══════════════════════════════════════════════════════════════════════════════

def generate_wallets(n: int) -> list[dict]:
    """Generate n deterministic accounts (no private keys needed — receive only)."""
    wallets = []
    for i in range(n):
        # Deterministic address: keccak256("payroll_s5_" || i)
        addr_bytes = Web3.keccak(text=f"payroll_s5_{i}")[-20:]
        addr = Web3.to_checksum_address("0x" + addr_bytes.hex())
        wallets.append({"index": i, "address": addr})
    return wallets


# ══════════════════════════════════════════════════════════════════════════════
# STEP 2: Assign amounts (equal share, last gets remainder)
# ══════════════════════════════════════════════════════════════════════════════

def compute_distribution(wallets: list[dict]) -> dict:
    """
    Compute per-wallet amounts matching exactly the contract's logic:
    - fee = total_wei * fee_bps // bps_denom
    - distributable = total_wei - fee
    - each recipient i (except last): amounts[i] (equal split)
    - last recipient: distributable - sum(amounts[0..n-2])

    Returns dict with all pre-tx financial data.
    """
    n = len(wallets)
    fee_wei          = TOTAL_WEI * FEE_BPS // BPS_DENOM
    distributable    = TOTAL_WEI - fee_wei
    per_wallet_base  = distributable // n
    remainder        = distributable - per_wallet_base * (n - 1)   # last gets this

    amounts = [per_wallet_base] * (n - 1) + [remainder]

    # Assign
    for i, w in enumerate(wallets):
        w["expected_wei"] = amounts[i]

    # Assertions (pre-flight checks)
    total_assigned = sum(amounts)
    assert total_assigned == distributable, \
        f"Amount sum mismatch: {total_assigned} != {distributable}"
    assert amounts[-1] == remainder, "Remainder calculation error"
    assert fee_wei + total_assigned == TOTAL_WEI, \
        f"Fee + amounts != total_wei: {fee_wei+total_assigned} != {TOTAL_WEI}"

    return {
        "total_wei":         TOTAL_WEI,
        "fee_wei":           fee_wei,
        "distributable_wei": distributable,
        "per_wallet_base":   per_wallet_base,
        "last_wallet_extra": remainder - per_wallet_base,   # extra wei on last
        "amounts":           amounts,
        "sum_check":         total_assigned,
    }


# ══════════════════════════════════════════════════════════════════════════════
# STEP 3: Execute on-chain
# ══════════════════════════════════════════════════════════════════════════════

def send_distribution(wallets: list[dict], dist: dict) -> dict:
    """Build, sign, send distributeETH TX. Return receipt data."""
    recipients  = [w["address"] for w in wallets]
    amounts     = dist["amounts"]
    gas_price   = w3.eth.gas_price
    nonce       = w3.eth.get_transaction_count(DEPLOYER)

    print(f"  Nonce: {nonce}", flush=True)
    print(f"  Gas price: {w3.from_wei(gas_price, 'gwei'):.6f} gwei", flush=True)
    print(f"  Estimating gas...", flush=True)

    try:
        gas_est = contract.functions.distributeETH(recipients, amounts).estimate_gas({
            "from": DEPLOYER, "value": TOTAL_WEI,
        })
        gas_limit = int(gas_est * 1.1)   # 10% buffer
    except Exception as e:
        gas_limit = 9_000_000   # fallback for 200 recipients
        print(f"  Gas estimate failed ({e}), using fallback {gas_limit}", flush=True)

    print(f"  Gas limit: {gas_limit:,}", flush=True)

    tx = contract.functions.distributeETH(recipients, amounts).build_transaction({
        "from":     DEPLOYER,
        "value":    TOTAL_WEI,
        "nonce":    nonce,
        "gas":      gas_limit,
        "gasPrice": gas_price,
        "chainId":  CHAIN_ID,
    })
    signed = w3.eth.account.sign_transaction(tx, PRIVATE_KEY)
    raw    = getattr(signed, "raw_transaction", None) or getattr(signed, "rawTransaction", None)

    print(f"  Sending TX...", flush=True)
    t0 = time.perf_counter()
    tx_hash = w3.eth.send_raw_transaction(raw)
    tx_hash_hex = tx_hash.hex()
    print(f"  TX sent: {tx_hash_hex}", flush=True)

    print(f"  Waiting for receipt...", flush=True)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
    confirm_time = time.perf_counter() - t0

    if receipt.status != 1:
        raise RuntimeError(f"TX reverted: {tx_hash_hex}")

    print(f"  Confirmed in {confirm_time:.1f}s | block={receipt.blockNumber} | gas={receipt.gasUsed:,}", flush=True)

    return {
        "tx_hash":      tx_hash_hex,
        "block":        receipt.blockNumber,
        "gas_used":     receipt.gasUsed,
        "gas_price":    gas_price,
        "gas_cost_wei": receipt.gasUsed * gas_price,
        "confirm_s":    confirm_time,
        "logs":         receipt.logs,
    }


# ══════════════════════════════════════════════════════════════════════════════
# STEP 4: Wei-level reconciliation (all 200 recipients)
# ══════════════════════════════════════════════════════════════════════════════

def reconcile_balances(wallets: list[dict]) -> dict:
    """Read on-chain balance for EVERY recipient. Compare to expected_wei."""
    failures = []
    matches  = 0

    print(f"  Checking {len(wallets)} balances...", flush=True)
    for i, w in enumerate(wallets):
        on_chain = w3.eth.get_balance(w["address"])
        delta    = on_chain - w["expected_wei"]
        w["on_chain_wei"]  = on_chain
        w["delta_wei"]     = delta

        if delta != 0:
            failures.append({
                "index":    i,
                "address":  w["address"],
                "expected": w["expected_wei"],
                "actual":   on_chain,
                "delta":    delta,
            })
        else:
            matches += 1

        if (i + 1) % 50 == 0:
            print(f"    Checked {i+1}/{len(wallets)} — {matches} OK, {len(failures)} mismatch", flush=True)

    return {
        "total":    len(wallets),
        "matches":  matches,
        "failures": failures,
        "pass":     len(failures) == 0,
    }


# ══════════════════════════════════════════════════════════════════════════════
# STEP 5: Verify treasury fee
# ══════════════════════════════════════════════════════════════════════════════

def verify_fee(tx_info: dict, dist: dict, balance_before_treasury: int) -> dict:
    """
    Verify treasury received exactly fee_wei.
    Since treasury == deployer, subtract gas cost from the check.
    """
    balance_after = w3.eth.get_balance(TREASURY)
    # Treasury is the deployer, so it also paid for gas
    # Net change = balance_after - balance_before = fee_received - gas_paid - total_sent
    net_change       = balance_after - balance_before_treasury
    expected_net     = dist["fee_wei"] - tx_info["gas_cost_wei"] - TOTAL_WEI
    delta            = net_change - expected_net

    return {
        "balance_before":  balance_before_treasury,
        "balance_after":   balance_after,
        "fee_expected":    dist["fee_wei"],
        "gas_cost":        tx_info["gas_cost_wei"],
        "net_change":      net_change,
        "expected_net":    expected_net,
        "delta":           delta,
        "pass":            delta == 0,
    }


# ══════════════════════════════════════════════════════════════════════════════
# STEP 6: Verify events from TX receipt
# ══════════════════════════════════════════════════════════════════════════════

def verify_events(tx_info: dict, wallets: list[dict], dist: dict) -> dict:
    """
    Parse SingleTransfer and BatchDistributed events from receipt logs.
    Verify count and per-address amounts.
    """
    logs = tx_info["logs"]

    single_transfers   = []
    batch_distributed  = []

    for log in logs:
        if not log["topics"]:
            continue
        topic0 = log["topics"][0].hex()
        if topic0 == SINGLE_TRANSFER_TOPIC:
            # SingleTransfer(address indexed to, uint256 amount, uint256 index)
            to_addr  = Web3.to_checksum_address("0x" + log["topics"][1].hex()[-40:])
            data     = log["data"].hex() if isinstance(log["data"], bytes) else log["data"]
            data_hex = data[2:] if data.startswith("0x") else data
            amount   = int(data_hex[:64], 16)
            idx      = int(data_hex[64:128], 16)
            single_transfers.append({"to": to_addr, "amount": amount, "index": idx})
        elif topic0 == BATCH_DISTRIBUTED_TOPIC:
            batch_distributed.append(log)

    # Verify counts
    count_ok = len(single_transfers) == N and len(batch_distributed) == 1

    # Verify each event matches expected amount for that address
    # Build address → expected map
    addr_expected = {w["address"].lower(): w["expected_wei"] for w in wallets}
    event_mismatches = []
    for ev in single_transfers:
        exp = addr_expected.get(ev["to"].lower())
        if exp is None:
            event_mismatches.append({"to": ev["to"], "issue": "address not in recipient list"})
        elif ev["amount"] != exp:
            event_mismatches.append({
                "to":       ev["to"],
                "index":    ev["index"],
                "event_amount": ev["amount"],
                "expected": exp,
                "delta":    ev["amount"] - exp,
            })

    # Verify BatchDistributed total
    batch_ok = False
    if batch_distributed:
        bd    = batch_distributed[0]
        bdata = bd["data"].hex() if isinstance(bd["data"], bytes) else bd["data"]
        bdata = bdata[2:] if bdata.startswith("0x") else bdata
        # BatchDistributed(address sender, address token, uint256 totalAmount, uint256 recipientCount, uint256 fee)
        total_amount    = int(bdata[:64],    16)
        recipient_count = int(bdata[64:128], 16)
        fee_event       = int(bdata[128:192], 16)
        batch_ok = (
            total_amount    == TOTAL_WEI
            and recipient_count == N
            and fee_event       == dist["fee_wei"]
        )

    return {
        "single_transfer_count":    len(single_transfers),
        "batch_distributed_count":  len(batch_distributed),
        "count_ok":                 count_ok,
        "event_mismatches":         event_mismatches,
        "event_match_ok":           len(event_mismatches) == 0,
        "batch_event_ok":           batch_ok,
        "batch_total_amount":       total_amount if batch_distributed else None,
        "batch_recipient_count":    recipient_count if batch_distributed else None,
        "batch_fee":                fee_event if batch_distributed else None,
        "pass": count_ok and len(event_mismatches) == 0 and batch_ok,
    }


# ══════════════════════════════════════════════════════════════════════════════
# WRITE REPORT
# ══════════════════════════════════════════════════════════════════════════════

def write_report(wallets, dist, tx_info, recon, fee_check, events):
    outfile = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "STRESS_S5_RESULTS.md")

    all_pass = recon["pass"] and fee_check["pass"] and events["pass"]
    verdict  = "ALL CHECKS PASS — PRODUCTION READY" if all_pass else "FAILURES DETECTED — NOT PRODUCTION READY"
    verdict_prefix = "✓" if all_pass else "✗ CRITICAL"

    with open(outfile, "w") as f:
        def w(s=""): f.write(s + "\n")

        w("# Stress Test S5 — 200-Wallet Mega Batch + Full Wei Reconciliation")
        w()
        w(f"**Date:** 2026-04-04")
        w(f"**Network:** Base Sepolia (chain ID {CHAIN_ID})")
        w(f"**Contract:** `{CONTRACT}`")
        w(f"**TX Hash:** `{tx_info['tx_hash']}`")
        w(f"**Block:** {tx_info['block']}")
        w()
        w(f"## VERDICT: {verdict_prefix} {verdict}")
        w()
        w("---")
        w()
        w("## Pre-TX Financial Calculation")
        w()
        w("| Parameter | Value | Wei |")
        w("|-----------|-------|-----|")
        w(f"| Total sent (msg.value) | {w3.from_wei(dist['total_wei'], 'ether')} ETH | {dist['total_wei']} |")
        w(f"| Fee (0.5%) | {w3.from_wei(dist['fee_wei'], 'ether')} ETH | {dist['fee_wei']} |")
        w(f"| Distributable | {w3.from_wei(dist['distributable_wei'], 'ether')} ETH | {dist['distributable_wei']} |")
        w(f"| Per recipient (base) | — | {dist['per_wallet_base']} wei |")
        w(f"| Last recipient extra | — | +{dist['last_wallet_extra']} wei (remainder) |")
        w(f"| Sum check (must = distributable) | — | {dist['sum_check']} {'✓' if dist['sum_check'] == dist['distributable_wei'] else '✗'} |")
        w(f"| Original target | 0.1 ETH | 100,000,000,000,000,000 |")
        w(f"| Scaled to | {w3.from_wei(TOTAL_WEI, 'ether')} ETH | {TOTAL_WEI} |")
        w()
        w("---")
        w()
        w("## On-Chain TX")
        w()
        w("| Metric | Value |")
        w("|--------|-------|")
        w(f"| TX Hash | `{tx_info['tx_hash']}` |")
        w(f"| Block | {tx_info['block']} |")
        w(f"| Gas Used | {tx_info['gas_used']:,} |")
        w(f"| Gas Price | {w3.from_wei(tx_info['gas_price'], 'gwei'):.6f} gwei |")
        w(f"| Gas Cost | {w3.from_wei(tx_info['gas_cost_wei'], 'ether'):.8f} ETH |")
        w(f"| Gas/Recipient | {tx_info['gas_used'] // N:,} |")
        w(f"| Confirmation time | {tx_info['confirm_s']:.1f}s |")
        w()
        w("---")
        w()
        w("## CHECK 1 — Balance Reconciliation (All 200 Recipients)")
        w()
        w(f"| Metric | Value |")
        w(f"|--------|-------|")
        w(f"| Recipients checked | {recon['total']} |")
        w(f"| Exact matches | {recon['matches']} |")
        w(f"| Mismatches | {len(recon['failures'])} |")
        w(f"| **Result** | **{'PASS ✓' if recon['pass'] else 'FAIL ✗'}** |")
        w()
        if recon["failures"]:
            w("### Failed Recipients")
            w()
            w("| Index | Address | Expected (wei) | Actual (wei) | Delta |")
            w("|-------|---------|----------------|--------------|-------|")
            for fail in recon["failures"][:20]:  # cap at 20
                w(f"| {fail['index']} | `{fail['address'][:20]}...` | {fail['expected']} | {fail['actual']} | {fail['delta']:+d} |")
        else:
            w("All 200 recipient balances match exactly. Zero delta on every address.")
        w()
        w("---")
        w()
        w("## CHECK 2 — Treasury Fee Verification")
        w()
        w(f"| Metric | Value |")
        w(f"|--------|-------|")
        w(f"| Expected fee | {fee_check['fee_expected']} wei |")
        w(f"| Gas cost | {fee_check['gas_cost']} wei |")
        w(f"| Net deployer change | {fee_check['net_change']:+d} wei |")
        w(f"| Expected net change | {fee_check['expected_net']:+d} wei |")
        w(f"| Delta | {fee_check['delta']:+d} wei |")
        w(f"| **Result** | **{'PASS ✓' if fee_check['pass'] else 'FAIL ✗'}** |")
        w()
        w("---")
        w()
        w("## CHECK 3 — Event Log Verification")
        w()
        w(f"| Metric | Expected | Actual | Result |")
        w(f"|--------|----------|--------|--------|")
        w(f"| SingleTransfer events | {N} | {events['single_transfer_count']} | {'✓' if events['count_ok'] else '✗'} |")
        w(f"| BatchDistributed events | 1 | {events['batch_distributed_count']} | {'✓' if events['batch_distributed_count'] == 1 else '✗'} |")
        w(f"| BatchDistributed.totalAmount | {TOTAL_WEI} | {events.get('batch_total_amount', '?')} | {'✓' if events['batch_event_ok'] else '✗'} |")
        w(f"| BatchDistributed.recipientCount | {N} | {events.get('batch_recipient_count', '?')} | {'✓' if events['batch_event_ok'] else '✗'} |")
        w(f"| BatchDistributed.fee | {dist['fee_wei']} | {events.get('batch_fee', '?')} | {'✓' if events['batch_event_ok'] else '✗'} |")
        w(f"| Event amount mismatches | 0 | {len(events['event_mismatches'])} | {'✓' if events['event_match_ok'] else '✗'} |")
        w(f"| **Result** | | | **{'PASS ✓' if events['pass'] else 'FAIL ✗'}** |")
        w()
        if events["event_mismatches"]:
            w("### Event Mismatches")
            w()
            w("| To | Index | Event Amount | Expected | Delta |")
            w("|----|----|----|----|-----|")
            for m in events["event_mismatches"][:20]:
                w(f"| `{m['to'][:20]}...` | {m.get('index','?')} | {m.get('event_amount','?')} | {m.get('expected','?')} | {m.get('delta',0):+d} |")
        w()
        w("---")
        w()
        w(f"## Final Verdict: {verdict}")
        w()
        w(f"| Check | Result |")
        w(f"|-------|--------|")
        w(f"| Balance reconciliation (200/200) | {'✓ PASS' if recon['pass'] else '✗ FAIL'} |")
        w(f"| Treasury fee accuracy | {'✓ PASS' if fee_check['pass'] else '✗ FAIL'} |")
        w(f"| Event log verification | {'✓ PASS' if events['pass'] else '✗ FAIL'} |")
        w(f"| **Overall** | **{'✓ PRODUCTION READY' if all_pass else '✗ NOT PRODUCTION READY'}** |")
        w()
        w("---")
        w()
        w("## Appendix — All 200 Recipients")
        w()
        w("| # | Address | Expected (wei) | On-Chain (wei) | Match |")
        w("|---|---------|----------------|----------------|-------|")
        for wlt in wallets:
            match = "✓" if wlt.get("delta_wei", 999) == 0 else f"✗ (Δ={wlt.get('delta_wei',0):+d})"
            w(f"| {wlt['index']} | `{wlt['address']}` | {wlt['expected_wei']} | {wlt.get('on_chain_wei', '?')} | {match} |")

    return outfile


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

def main():
    print("=" * 64, flush=True)
    print("Stress Test S5 — 200-Wallet Mega Batch + Full Reconciliation", flush=True)
    print("=" * 64, flush=True)

    balance_before = w3.eth.get_balance(DEPLOYER)
    print(f"\nDeployer balance: {w3.from_wei(balance_before, 'ether'):.6f} ETH", flush=True)
    print(f"Total to distribute: {w3.from_wei(TOTAL_WEI, 'ether')} ETH (scaled from {ORIGINAL_TARGET_ETH} ETH target)", flush=True)
    print(f"Recipients: {N}", flush=True)
    print(flush=True)

    # Step 1: Generate wallets
    print("Step 1: Generating 200 deterministic recipient addresses...", flush=True)
    wallets = generate_wallets(N)
    print(f"  Generated: {wallets[0]['address']} ... {wallets[-1]['address']}", flush=True)

    # Step 2: Compute distribution
    print("\nStep 2: Computing distribution amounts...", flush=True)
    dist = compute_distribution(wallets)
    print(f"  fee_wei:          {dist['fee_wei']:,}", flush=True)
    print(f"  distributable:    {dist['distributable_wei']:,}", flush=True)
    print(f"  per_wallet_base:  {dist['per_wallet_base']:,}", flush=True)
    print(f"  last_wallet:      {dist['amounts'][-1]:,} (+{dist['last_wallet_extra']} remainder)", flush=True)
    print(f"  sum_check:        {dist['sum_check']} == {dist['distributable_wei']} ✓", flush=True)

    # Step 3: Execute on-chain
    print("\nStep 3: Sending distributeETH TX on-chain...", flush=True)
    tx_info = send_distribution(wallets, dist)

    # Step 4: Reconciliation
    print("\nStep 4: Reconciling balances (all 200 recipients)...", flush=True)
    recon = reconcile_balances(wallets)
    status4 = "PASS ✓" if recon["pass"] else f"FAIL ✗ ({len(recon['failures'])} mismatches)"
    print(f"  Result: {status4}", flush=True)

    # Step 5: Fee verification
    print("\nStep 5: Verifying treasury fee...", flush=True)
    fee_check = verify_fee(tx_info, dist, balance_before)
    status5 = "PASS ✓" if fee_check["pass"] else f"FAIL ✗ (delta={fee_check['delta']:+d} wei)"
    print(f"  Net deployer change: {fee_check['net_change']:+d} wei", flush=True)
    print(f"  Expected net:        {fee_check['expected_net']:+d} wei", flush=True)
    print(f"  Delta:               {fee_check['delta']:+d} wei", flush=True)
    print(f"  Result: {status5}", flush=True)

    # Step 6: Event verification
    print("\nStep 6: Verifying event logs...", flush=True)
    events = verify_events(tx_info, wallets, dist)
    print(f"  SingleTransfer events: {events['single_transfer_count']} (expected {N})", flush=True)
    print(f"  BatchDistributed events: {events['batch_distributed_count']} (expected 1)", flush=True)
    print(f"  Event amount mismatches: {len(events['event_mismatches'])}", flush=True)
    status6 = "PASS ✓" if events["pass"] else "FAIL ✗"
    print(f"  Result: {status6}", flush=True)

    # Save wallet data
    wallet_json = os.path.join(os.path.dirname(os.path.abspath(__file__)), "s5_wallets.json")
    with open(wallet_json, "w") as f:
        json.dump(wallets, f, indent=2)
    print(f"\nWallet data saved to: {wallet_json}", flush=True)

    # Write report
    print("\nWriting STRESS_S5_RESULTS.md...", flush=True)
    outfile = write_report(wallets, dist, tx_info, recon, fee_check, events)

    # Final summary
    all_pass = recon["pass"] and fee_check["pass"] and events["pass"]
    print(flush=True)
    print("=" * 64, flush=True)
    print(f"FINAL VERDICT: {'ALL CHECKS PASS — PRODUCTION READY' if all_pass else 'FAILURES DETECTED'}", flush=True)
    print(f"  Check 1 (balances):    {status4}", flush=True)
    print(f"  Check 2 (fee):         {status5}", flush=True)
    print(f"  Check 3 (events):      {status6}", flush=True)
    print(f"  Report: {outfile}", flush=True)
    print("=" * 64, flush=True)


if __name__ == "__main__":
    main()
