#!/usr/bin/env python3
"""Fetch official RUB rates and store an audited snapshot in a local SHM DB."""

from __future__ import annotations

import argparse
import base64
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
import subprocess
import sys
from urllib.request import Request, urlopen
from xml.etree import ElementTree


SOURCE_URL = "https://www.cbr.ru/scripts/XML_daily.asp"
SYMBOLS = {"RUB": "₽", "USD": "$", "EUR": "€", "GBP": "£", "CNY": "¥", "NOK": "kr"}


def load_xml(path: str | None) -> bytes:
    if path:
        with open(path, "rb") as source:
            raw = source.read(65_537)
    else:
        request = Request(SOURCE_URL, headers={"User-Agent": "ShpunBillingFX/1.0"})
        with urlopen(request, timeout=10) as response:
            if response.status != 200:
                raise ValueError(f"CBR returned HTTP {response.status}")
            raw = response.read(65_537)
    if not raw or len(raw) > 65_536:
        raise ValueError("CBR XML is empty or unexpectedly large")
    return raw


def parse_rates(raw: bytes) -> dict:
    root = ElementTree.fromstring(raw)
    if root.tag != "ValCurs":
        raise ValueError("Unexpected CBR XML root")
    effective_date = datetime.strptime(root.attrib["Date"], "%d.%m.%Y").date()
    now = datetime.now(timezone.utc)
    effective_at = datetime.combine(effective_date, datetime.min.time(), timezone.utc)
    age = (now - effective_at).total_seconds()
    if age < -86_400 or age > 7 * 86_400:
        raise ValueError("CBR effective date is outside the accepted seven-day window")

    currencies = {
        "RUB": {"name": "Russian Ruble", "symbol": "₽", "value": "1"}
    }
    for item in root.findall("Valute"):
        code = (item.findtext("CharCode") or "").strip().upper()
        if len(code) != 3 or not code.isascii() or not code.isalpha():
            continue
        try:
            nominal = Decimal((item.findtext("Nominal") or "").replace(",", "."))
            total = Decimal((item.findtext("Value") or "").replace(",", "."))
            value = total / nominal
        except (InvalidOperation, ZeroDivisionError):
            raise ValueError(f"Invalid CBR rate for {code}") from None
        if not value.is_finite() or value <= 0 or value >= Decimal("1000000000"):
            raise ValueError(f"CBR rate is out of bounds for {code}")
        currencies[code] = {
            "name": (item.findtext("Name") or code).strip(),
            "symbol": SYMBOLS.get(code, code),
            "value": format(value, "f"),
        }
    if "USD" not in currencies or "EUR" not in currencies:
        raise ValueError("CBR payload lacks mandatory USD or EUR rates")

    return {
        "source": "cbr",
        "source_url": SOURCE_URL,
        "effective_date": effective_date.isoformat(),
        "effective_at_epoch": int(effective_at.timestamp()),
        "fetched_at_epoch": int(now.timestamp()),
        "currencies": currencies,
    }


def mysql(container: str, statement: str) -> str:
    process = subprocess.run(
        [
            "docker", "exec", "-i", container, "sh", "-c",
            'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot "${MYSQL_DATABASE:-shm}" --batch --skip-column-names',
        ],
        input=statement,
        text=True,
        capture_output=True,
        timeout=45,
        check=False,
    )
    if process.returncode:
        raise RuntimeError(f"Local SHM database rejected rate update: {process.stderr.strip()}")
    return process.stdout.strip()


def store_rates(container: str, state: dict) -> None:
    current_state = mysql(
        container,
        "SELECT CONCAT_WS(CHAR(9), "
        "JSON_UNQUOTE(JSON_EXTRACT(value, '$.source')), "
        "JSON_UNQUOTE(JSON_EXTRACT(value, '$.effective_date'))) "
        "FROM config WHERE `key` = 'shpun_fx';\n",
    )
    if current_state:
        source, _, effective_date = current_state.partition("\t")
        if source == "cbr" and effective_date > state["effective_date"]:
            raise ValueError("Refusing to replace newer official rates with older data")

    canonical = json.dumps(
        {"source": state["source"], "effective_date": state["effective_date"],
         "currencies": state["currencies"]},
        ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")
    fingerprint = hashlib.sha256(canonical).hexdigest()
    payload = json.dumps(state, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    encoded = base64.b64encode(payload.encode("utf-8")).decode("ascii")
    fetched_at = datetime.fromtimestamp(state["fetched_at_epoch"], timezone.utc).strftime(
        "%Y-%m-%d %H:%M:%S"
    )
    statement = f"""
START TRANSACTION;
INSERT IGNORE INTO shpun_fx_history
  (source, effective_date, fetched_at, fingerprint, payload)
VALUES
  ('cbr', '{state['effective_date']}', '{fetched_at}', '{fingerprint}',
   CONVERT(FROM_BASE64('{encoded}') USING utf8mb4));
INSERT INTO config (`key`, `value`)
VALUES ('shpun_fx', CONVERT(FROM_BASE64('{encoded}') USING utf8mb4))
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`);
COMMIT;
"""
    mysql(container, statement)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mysql-container", required=True)
    parser.add_argument("--xml-file", help="Offline fixture for tests")
    parser.add_argument("--dry-run", action="store_true")
    options = parser.parse_args()
    state = parse_rates(load_xml(options.xml_file))
    if not options.dry_run:
        store_rates(options.mysql_container, state)
    print(
        f"source=cbr effective_date={state['effective_date']} "
        f"currencies={len(state['currencies'])} stored={not options.dry_run}"
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"FX sync failed: {error}", file=sys.stderr)
        sys.exit(1)
