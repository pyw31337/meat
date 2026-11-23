#!/usr/bin/env python3
"""Fail-fast operational health check for collection, publication, and alerts."""

from __future__ import annotations

import csv
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib import request

ROOT = Path(__file__).resolve().parents[1]
HISTORY = ROOT / "history" / "prices.csv"
NOTIFICATION_STATUS = ROOT / "history" / "notification_status.json"
PUBLIC_CSV = "https://pyw31337.github.io/meat/history/prices.csv"
KST = timezone(timedelta(hours=9))


def fetch(url: str) -> bytes:
    req = request.Request(url, headers={"User-Agent": "meat-tracker-health-check"})
    with request.urlopen(req, timeout=20) as response:
        return response.read()


def latest_date(raw: bytes) -> str:
    rows = list(csv.DictReader(raw.decode("utf-8-sig").splitlines()))
    dates = [row.get("date", "") for row in rows if row.get("date")]
    if not dates:
        raise RuntimeError("price history has no dated rows")
    return max(dates)


def main() -> int:
    checks: dict[str, dict[str, object]] = {}
    failures: list[str] = []

    local_date = latest_date(HISTORY.read_bytes())
    today = datetime.now(KST).date()
    local_age = (today - datetime.strptime(local_date, "%Y-%m-%d").date()).days
    checks["collection_freshness"] = {"latest_date": local_date, "age_days": local_age}
    if local_age > 1:
        failures.append(f"local history is {local_age} days old ({local_date})")

    try:
        public_date = latest_date(fetch(PUBLIC_CSV))
        checks["pages_freshness"] = {"latest_date": public_date}
        if public_date != local_date:
            failures.append(f"Pages is stale ({public_date}; repository is {local_date})")
    except Exception as error:
        checks["pages_freshness"] = {"error": str(error)}
        failures.append(f"Pages history could not be read: {error}")

    if NOTIFICATION_STATUS.exists():
        status = json.loads(NOTIFICATION_STATUS.read_text(encoding="utf-8"))
        checks["notifications"] = {
            "status": status.get("status"),
            "checked_at": status.get("checked_at"),
            "configured_channels": status.get("configured_channels", []),
        }
        if status.get("status") == "failed":
            failures.append("latest price alert delivery failed")
    else:
        checks["notifications"] = {"status": "missing"}
        failures.append("notification status file is missing")

    result = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "service": "meat-tracker",
        "status": "failed" if failures else "healthy",
        "checks": checks,
        "failures": failures,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as output:
            output.write("## Meat Tracker health\n\n")
            output.write(f"**Status:** `{result['status']}`\n\n")
            for failure in failures:
                output.write(f"- ❌ {failure}\n")
            if not failures:
                output.write("- ✅ Collection, Pages publication, and notification state are healthy.\n")
    if failures and os.getenv("NTFY_TOPIC", "").strip():
        topic = os.environ["NTFY_TOPIC"].strip()
        message = "Meat Tracker health check failed:\n- " + "\n- ".join(failures)
        req = request.Request(
            f"https://ntfy.sh/{topic}",
            data=message.encode("utf-8"),
            headers={"Title": "Meat Tracker health check", "Priority": "high", "Tags": "warning"},
            method="POST",
        )
        try:
            request.urlopen(req, timeout=15).read()
        except Exception as error:
            print(f"warning: health alert could not be delivered: {error}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
