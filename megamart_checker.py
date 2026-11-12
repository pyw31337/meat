#!/usr/bin/env python3
"""Collect Megamart meat prices with stable SKU identity.

The dashboard consumes ``history/prices.csv``. Each row is unique by
``(date, product_id)`` so a search result cannot silently overwrite or distort
another product with a similar grade name.
"""

from __future__ import annotations

import csv
import logging
import os
import re
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable
from urllib import request

from selenium import webdriver
from selenium.common.exceptions import TimeoutException, WebDriverException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parent
HISTORY_DIR = ROOT / "history"
HISTORY_PATH = HISTORY_DIR / "prices.csv"
ALERT_STATE_PATH = HISTORY_DIR / "last_alert_sent.txt"
KST = timezone(timedelta(hours=9))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

BEEF_SEARCH_URL = "https://www.megamart.com/search/?text=%ED%95%9C%EC%9A%B0+%EB%93%B1%EC%8B%AC"
PORK_SEARCH_URL = "https://www.megamart.com/search/?text=%EC%82%BC%EA%B2%B9%EC%82%B4+%EA%B5%AD%EB%82%B4%EC%82%B0"
BEEF_PRICE_THRESHOLD = 7000
PORK_PRICE_THRESHOLD = 2000
CSV_FIELDS = ("date", "product_id", "product_name", "price")
FORBIDDEN_PORK = ("목심", "목살", "앞다리", "뒷다리", "냉동", "갈매기살", "항정살", "수입")


@dataclass(frozen=True)
class Observation:
    product_id: str
    product_name: str
    price_per_100g: int
    actual_price: int
    weight_grams: int
    category: str


def today_kst() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d")


def normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def safe_legacy_id(name: str) -> str:
    """Stable fallback for historical rows that predate SKU collection."""
    # Keep Korean grade markers distinct: a generic punctuation replacement would
    # otherwise turn `1등급`, `1+등급`, and `1++등급` into the same key.
    normalized = name.lower().replace("1++", "1-plus-plus").replace("1+", "1-plus")
    return "legacy:" + re.sub(r"[^a-z0-9가-힣]+", "-", normalized).strip("-")


def parse_price(value: str) -> int | None:
    digits = re.sub(r"[^0-9]", "", value or "")
    return int(digits) if digits else None


def parse_weight_grams(title: str) -> int:
    match = re.search(r"(\d+(?:\.\d+)?)\s*(kg|g)\b", title, flags=re.IGNORECASE)
    if not match:
        return 100
    value = float(match.group(1))
    return int(value * 1000) if match.group(2).lower() == "kg" else int(value)


def is_target(title: str, category: str) -> bool:
    if category == "pork":
        return "삼겹살" in title and not any(word in title for word in FORBIDDEN_PORK)
    return "한우" in title and "등심" in title and ("구이용" in title or "스테이크용" in title)


def extract_product_id(item) -> str | None:
    try:
        link = item.find_element(By.CSS_SELECTOR, "a.link")
        onclick = link.get_attribute("onclick") or ""
        match = re.search(r"goDetail\('([0-9]+)'\)", onclick)
        return match.group(1) if match else None
    except Exception:  # A missing link should not fail the rest of a collection run.
        return None


def init_driver():
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1600,1100")
    options.add_argument("--lang=ko-KR")
    options.add_argument("user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36")
    driver = webdriver.Chrome(options=options)
    driver.set_page_load_timeout(35)
    return driver


def scrape_search_page(driver, url: str, category: str) -> list[Observation]:
    try:
        driver.get(url)
    except (TimeoutException, WebDriverException) as error:
        logging.warning("Page load did not finish for %s: %s", category, error)
        driver.execute_script("window.stop();")

    try:
        WebDriverWait(driver, 12).until(EC.presence_of_element_located((By.CLASS_NAME, "item-wrapper")))
    except TimeoutException:
        logging.warning("No product cards found for %s", category)

    observations: dict[str, Observation] = {}
    for item in driver.find_elements(By.CLASS_NAME, "item-wrapper"):
        try:
            title_elements = item.find_elements(By.CLASS_NAME, "title")
            price_elements = item.find_elements(By.CSS_SELECTOR, ".current-price .number")
            if not title_elements or not price_elements:
                continue

            title = normalize_space(title_elements[0].text)
            if not is_target(title, category):
                continue
            actual_price = parse_price(price_elements[0].text)
            if actual_price is None:
                continue

            product_id = extract_product_id(item)
            if not product_id:
                logging.info("Skipping an item without a stable product id: %s", title)
                continue
            weight_grams = parse_weight_grams(title)
            if weight_grams <= 0:
                continue
            observation = Observation(
                product_id=product_id,
                product_name=title,
                price_per_100g=round(actual_price * 100 / weight_grams),
                actual_price=actual_price,
                weight_grams=weight_grams,
                category=category,
            )
            # Search pages occasionally repeat an item. Keep the first exact SKU result.
            observations.setdefault(product_id, observation)
        except Exception as error:
            logging.warning("Skipping malformed %s search card: %s", category, error)

    logging.info("Collected %d distinct %s SKUs", len(observations), category)
    return list(observations.values())


def read_history() -> dict[tuple[str, str], dict[str, str]]:
    """Read either old or current CSV, collapsing legacy duplicate rows explicitly."""
    if not HISTORY_PATH.exists():
        return {}

    with HISTORY_PATH.open(encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        if not reader.fieldnames or not {"date", "product_name", "price"}.issubset(reader.fieldnames):
            raise ValueError("history/prices.csv is missing required columns")

        rows: dict[tuple[str, str], dict[str, str]] = {}
        for row in reader:
            date = (row.get("date") or "").strip()
            name = normalize_space(row.get("product_name") or "")
            product_id = (row.get("product_id") or "").strip() or safe_legacy_id(name)
            price = parse_price(row.get("price") or "")
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date) or not name or price is None or price <= 0:
                continue
            key = (date, product_id)
            candidate = {"date": date, "product_id": product_id, "product_name": name, "price": str(price)}
            existing = rows.get(key)
            # Old data merged distinct SKUs by name. Lowest unit price is the only
            # non-fabricated, comparable aggregate until a SKU identifier exists.
            if existing is None or price < int(existing["price"]):
                rows[key] = candidate
        return rows


def write_history(rows: Iterable[dict[str, str]]) -> None:
    HISTORY_DIR.mkdir(exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="", dir=HISTORY_DIR, delete=False) as temp:
        writer = csv.DictWriter(temp, fieldnames=CSV_FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(sorted(rows, key=lambda row: (row["date"], row["product_name"], row["product_id"])))
        temp_path = Path(temp.name)
    temp_path.replace(HISTORY_PATH)


def save_history(observations: list[Observation]) -> None:
    rows = read_history()
    date = today_kst()
    for observation in observations:
        key = (date, observation.product_id)
        rows[key] = {
            "date": date,
            "product_id": observation.product_id,
            "product_name": observation.product_name,
            "price": str(observation.price_per_100g),
        }
    write_history(rows.values())
    logging.info("Saved %d unique daily observations", len(rows))

def load_alert_state() -> str:
    try:
        return ALERT_STATE_PATH.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return ""


def send_ntfy(title: str, message: str) -> bool:
    topic = os.getenv("NTFY_TOPIC", "").strip()
    if not topic:
        return False
    try:
        req = request.Request(
            f"https://ntfy.sh/{topic}",
            data=message.encode("utf-8"),
            headers={"Title": title, "Priority": "high", "Tags": "meat,chart", "Click": "https://pyw31337.github.io/meat/"},
            method="POST",
        )
        with request.urlopen(req, timeout=15) as response:
            return response.status == 200
    except Exception as error:
        logging.warning("ntfy notification failed: %s", error)
        return False


def send_email(title: str, message: str) -> bool:
    recipient = os.getenv("RECEIVER_EMAIL", "").strip()
    if not recipient:
        return False
    try:
        payload = json.dumps({"_subject": title, "name": "Megamart Price Monitor", "message": message}).encode("utf-8")
        req = request.Request(
            f"https://formsubmit.co/ajax/{recipient}",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(req, timeout=15) as response:
            result = json.loads(response.read().decode("utf-8"))
        return result.get("success") == "true"
    except Exception as error:
        logging.warning("Email notification failed: %s", error)
        return False


def notify_if_needed(observations: list[Observation]) -> None:
    cheap = [
        item for item in observations
        if item.price_per_100g <= (PORK_PRICE_THRESHOLD if item.category == "pork" else BEEF_PRICE_THRESHOLD)
    ]
    if not cheap or load_alert_state() == today_kst():
        return

    lines = ["가격 조건을 만족한 상품입니다.", ""]
    lines.extend(f"• {item.product_name}: {item.price_per_100g:,}원 / 100g" for item in cheap)
    lines.extend(["", "대시보드: https://pyw31337.github.io/meat/"])
    message = "\n".join(lines)
    title = "[메가마트] 조건 충족 가격 발견"
    delivered = send_ntfy(title, message) or send_email(title, message)
    if delivered:
        ALERT_STATE_PATH.write_text(today_kst(), encoding="utf-8")
        logging.info("Price alert delivered")
    else:
        logging.info("Price alert was not configured or could not be delivered")


def main() -> int:
    driver = None
    try:
        driver = init_driver()
        observations = [
            *scrape_search_page(driver, BEEF_SEARCH_URL, "beef"),
            *scrape_search_page(driver, PORK_SEARCH_URL, "pork"),
        ]
        if not observations:
            raise RuntimeError("No eligible products were collected; history was left unchanged.")
        save_history(observations)
        notify_if_needed(observations)
        return 0
    except Exception as error:
        logging.exception("Megamart collection failed: %s", error)
        return 1
    finally:
        if driver:
            driver.quit()


if __name__ == "__main__":
    sys.exit(main())
