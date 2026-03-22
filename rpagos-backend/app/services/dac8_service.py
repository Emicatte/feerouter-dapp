"""
RPagos Backend Core — Generatore XML DAC8.

La Direttiva DAC8 (Council Directive EU 2023/2226) richiede ai Crypto-Asset
Service Providers (CASP) di segnalare le transazioni crypto alle autorità
fiscali degli Stati membri UE.

Questo modulo genera il file XML nel formato richiesto, basato sullo schema
OECD Crypto-Asset Reporting Framework (CARF).

Struttura XML:
  <DAC8_CARF>
    <MessageSpec>          → Identificazione del messaggio
    <ReportingFI>          → Dati dell'entità che reporta (RPagos)
    <AccountReport>        → Per ogni utente/portafoglio
      <TransactionDetails> → Dettagli di ogni transazione reportable
"""

import os
from datetime import datetime, timezone
from typing import Optional
from lxml import etree
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.db_models import TransactionLog, ComplianceSnapshot
from app.models.schemas import DAC8ReportResponse


# Namespace OECD CARF (placeholder — lo schema ufficiale verrà pubblicato)
CARF_NS = "urn:oecd:ties:carf:v1"
DAC8_NS = "urn:eu:taxud:dac8:v1"

NSMAP = {
    None: DAC8_NS,
    "carf": CARF_NS,
}


async def generate_dac8_report(
    db: AsyncSession,
    fiscal_year: Optional[int] = None,
    output_dir: str = "./reports",
) -> DAC8ReportResponse:
    """
    Genera il report XML DAC8/CARF per l'anno fiscale specificato.

    1. Recupera tutte le TX con dac8_reportable=True
    2. Le raggruppa per crypto-asset
    3. Genera la struttura XML secondo lo schema CARF
    4. Salva il file e aggiorna il DB
    """
    settings = get_settings()
    year = fiscal_year or settings.dac8_fiscal_year

    # ── 1. Recupera transazioni reportable ───────────────────
    query = (
        select(TransactionLog, ComplianceSnapshot)
        .join(ComplianceSnapshot, TransactionLog.id == ComplianceSnapshot.transaction_id)
        .where(ComplianceSnapshot.dac8_reportable == True)  # noqa: E712
        .where(
            TransactionLog.tx_timestamp >= datetime(year, 1, 1, tzinfo=timezone.utc)
        )
        .where(
            TransactionLog.tx_timestamp < datetime(year + 1, 1, 1, tzinfo=timezone.utc)
        )
        .order_by(TransactionLog.tx_timestamp)
    )

    result = await db.execute(query)
    rows = result.all()
    total_reportable = len(rows)

    # ── 2. Costruisci albero XML ─────────────────────────────
    root = etree.Element("DAC8_CARF", nsmap=NSMAP)
    root.set("version", "1.0")

    # ── MessageSpec ──────────────────────────────────────────
    msg_spec = etree.SubElement(root, "MessageSpec")
    etree.SubElement(msg_spec, "SendingCountry").text = settings.dac8_reporting_country
    etree.SubElement(msg_spec, "ReceivingCountry").text = settings.dac8_reporting_country
    etree.SubElement(msg_spec, "MessageType").text = "DAC8"
    etree.SubElement(msg_spec, "Warning").text = ""
    etree.SubElement(msg_spec, "MessageRefId").text = (
        f"RPagos-DAC8-{year}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
    )
    etree.SubElement(msg_spec, "ReportingPeriod").text = f"{year}-12-31"
    etree.SubElement(msg_spec, "Timestamp").text = (
        datetime.now(timezone.utc).isoformat()
    )

    # ── ReportingFI (Financial Institution / CASP) ───────────
    reporting_fi = etree.SubElement(root, "ReportingFI")
    fi_name = etree.SubElement(reporting_fi, "Name")
    fi_name.text = settings.dac8_reporting_entity_name
    fi_tin = etree.SubElement(reporting_fi, "TIN")
    fi_tin.text = settings.dac8_reporting_entity_tin
    fi_tin.set("issuedBy", settings.dac8_reporting_country)
    fi_address = etree.SubElement(reporting_fi, "Address")
    etree.SubElement(fi_address, "CountryCode").text = settings.dac8_reporting_country

    # ── AccountReport (una per ogni transazione per ora) ─────
    for tx, compliance in rows:
        account = etree.SubElement(root, "AccountReport")

        # Account Holder (in produzione: dati KYC del cliente)
        holder = etree.SubElement(account, "AccountHolder")
        etree.SubElement(holder, "AccountHolderType").text = "CRS801"  # Individual

        # Account Number (wallet address)
        acct_number = etree.SubElement(account, "AccountNumber")
        acct_number.text = tx.recipient or "UNKNOWN"

        # Crypto Asset
        crypto = etree.SubElement(account, "CryptoAsset")
        etree.SubElement(crypto, "AssetCode").text = tx.currency
        etree.SubElement(crypto, "AssetName").text = tx.currency

        # Transaction Details
        tx_detail = etree.SubElement(account, "TransactionDetails")
        etree.SubElement(tx_detail, "TransactionType").text = "TRANSFER"
        etree.SubElement(tx_detail, "TransactionHash").text = tx.tx_hash
        etree.SubElement(tx_detail, "GrossAmount").text = f"{tx.gross_amount:.8f}"
        etree.SubElement(tx_detail, "NetAmount").text = f"{tx.net_amount:.8f}"
        etree.SubElement(tx_detail, "FeeAmount").text = f"{tx.fee_amount:.8f}"
        etree.SubElement(tx_detail, "Currency").text = tx.currency
        etree.SubElement(tx_detail, "Network").text = tx.network

        # Fiat Equivalent
        if compliance.fiat_gross:
            fiat = etree.SubElement(tx_detail, "FiatEquivalent")
            etree.SubElement(fiat, "Amount").text = f"{compliance.fiat_gross:.2f}"
            etree.SubElement(fiat, "Currency").text = "EUR"
            if compliance.fiat_rate:
                etree.SubElement(fiat, "ExchangeRate").text = f"{compliance.fiat_rate:.6f}"

        # Timestamp
        etree.SubElement(tx_detail, "TransactionTimestamp").text = (
            tx.tx_timestamp.isoformat() if tx.tx_timestamp else ""
        )

        # Fiscal Reference
        etree.SubElement(tx_detail, "FiscalReference").text = tx.fiscal_ref

        # Compliance Info
        compliance_el = etree.SubElement(tx_detail, "ComplianceInfo")
        etree.SubElement(compliance_el, "ComplianceId").text = compliance.compliance_id
        etree.SubElement(compliance_el, "Jurisdiction").text = (
            compliance.ip_jurisdiction or ""
        )
        etree.SubElement(compliance_el, "MiCAApplicable").text = str(
            compliance.mica_applicable
        ).lower()

    # ── 3. Serializza e salva ────────────────────────────────
    os.makedirs(output_dir, exist_ok=True)
    filename = f"DAC8_RPagos_{year}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.xml"
    filepath = os.path.join(output_dir, filename)

    tree = etree.ElementTree(root)
    tree.write(
        filepath,
        pretty_print=True,
        xml_declaration=True,
        encoding="UTF-8",
    )

    # ── 4. Aggiorna compliance records nel DB ────────────────
    for tx, compliance in rows:
        compliance.dac8_xml_generated = True
        compliance.dac8_xml_path = filepath
    if rows:
        await db.commit()

    # ── 5. Preview XML ───────────────────────────────────────
    xml_bytes = etree.tostring(root, pretty_print=True, encoding="unicode")
    preview = xml_bytes[:2000] + ("\n... [truncated]" if len(xml_bytes) > 2000 else "")

    return DAC8ReportResponse(
        status="generated",
        fiscal_year=year,
        total_reportable=total_reportable,
        xml_path=filepath,
        xml_preview=preview,
    )
