#!/usr/bin/env python3
import csv, hashlib, json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
now = datetime.now(timezone.utc)
source = ROOT / "history" / "prices.csv"
with source.open(newline="", encoding="utf-8") as f:
    rows = list(csv.DictReader(f))
if not rows:
    raise RuntimeError("prices.csv has no persisted rows")
keys = {(row.get("date"), row.get("product_id")) for row in rows}
latest_date = max(row.get("date") or "" for row in rows)
latest_rows = [row for row in rows if row.get("date") == latest_date]
payload = {
    "schema": "lets_observability_v1", "run_id": f"meat-{now.strftime('%Y%m%dT%H%M%SZ')}", "observed_at": now.isoformat(), "service_id": "meat", "source": "persisted_price_history",
    "stages": {"collect": {"status": "success", "ok": len(rows), "artifact": True}, "analyze": {"status": "not_started", "ok": None}, "quality": {"status": "success" if len(keys)==len(rows) else "failed", "quality_issue_count": len(rows)-len(keys)}, "publish": {"status": "success", "artifact": True}},
    "counts": {"records": len(rows), "unique_records": len(keys), "increment": len(latest_rows), "increment_date": latest_date}, "artifacts": {"history": hashlib.sha256(source.read_bytes()).hexdigest()}, "note": "Persisted price history rows; increment is the latest persisted date."
}
out = ROOT / "data" / "observability" / "latest.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(payload, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
print(f"Price history rows observed: {len(rows)}")
