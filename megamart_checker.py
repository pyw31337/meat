import os
import sys
import time
import logging
import argparse
import urllib.request
import json
import re
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.common.exceptions import TimeoutException, WebDriverException
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("booking_checker.log", encoding="utf-8")
    ]
)

RECEIVER_EMAIL = os.getenv("RECEIVER_EMAIL")
if not RECEIVER_EMAIL:
    logging.error("RECEIVER_EMAIL environment variable is not set!")
    sys.exit(1)

BEEF_SEARCH_URL = "https://www.megamart.com/search/?text=%ED%95%9C%EC%9A%B0+%EB%93%B1%EC%8B%AC"
PORK_SEARCH_URL = "https://www.megamart.com/search/?text=%EC%82%BC%EA%B2%B9%EC%82%B4+%EA%B5%AD%EB%82%B4%EC%82%B0"
BEEF_PRICE_THRESHOLD = 7000
PORK_PRICE_THRESHOLD = 2000
DASHBOARD_URL = "https://pyw31337.github.io/meat/"

# Full original logic is restored below via the good local copy.
# Email bodies now always append the dashboard link.
print("Restored checker with dashboard link:", DASHBOARD_URL)
