#!/usr/bin/env python3
"""Upgrade the legacy three-column price history to the SKU-aware CSV schema.

Historical rows do not include a product id. Duplicate date/name records are
therefore reduced to their minimum unit price instead of pretending they are
separate products. New collector runs write real Megamart product IDs.
"""

from __future__ import annotations

import csv
import re
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "history" / "prices.csv"
FIELDS = ("date", "product_id", "product_name", "price")


def legacy_id(name: str) -> str:
    normalized = name.lower().replace("1++", "1-plus-plus").replace("1+", "1-plus")
    return "legacy:" + re.sub(r"[^a-z0-9가-힣]+", "-", normalized).strip("-")


def to_price(value: str) -> int | None:
    digits = re.sub(r"[^0-9]", "", value or "")
    return int(digits) if digits else None


def main() -> None:
    with CSV_PATH.open(encoding="utf-8", newline="") as source:
        reader = csv.DictReader(source)
        if not reader.fieldnames or not {"date", "product_name", "price"}.issubset(reader.fieldnames):
            raise ValueError("prices.csv is missing date, product_name, or price")
        rows: dict[tuple[str, str], dict[str, str]] = {}
        for row in reader:
            date = (row.get("date") or "").strip()
            name = re.sub(r"\s+", " ", (row.get("product_name") or "")).strip()
            product_id = (row.get("product_id") or "").strip() or legacy_id(name)
            price = to_price(row.get("price") or "")
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date) or not name or not price:
                continue
            key = (date, product_id)
            if key not in rows or price < int(rows[key]["price"]):
                rows[key] = {"date": date, "product_id": product_id, "product_name": name, "price": str(price)}

    with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="", dir=CSV_PATH.parent, delete=False) as temporary:
        writer = csv.DictWriter(temporary, fieldnames=FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(sorted(rows.values(), key=lambda row: (row["date"], row["product_name"], row["product_id"])))
        temporary_path = Path(temporary.name)
    temporary_path.replace(CSV_PATH)
    print(f"Migrated to {len(rows)} unique daily observations.")


if __name__ == "__main__":
    main()
