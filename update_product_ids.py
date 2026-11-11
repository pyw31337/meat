#!/usr/bin/env python3
"""
메가마트 상품 ID 자동 매핑 스크립트
검색 페이지에서 상품 ID를 추출하여 history/product_ids.json 갱신
"""
import os
import re
import json
import logging
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')

BEEF_SEARCH_URL = "https://www.megamart.com/search/?text=%ED%95%9C%EC%9A%B0+%EB%93%B1%EC%8B%AC"
PORK_SEARCH_URL = "https://www.megamart.com/search/?text=%EC%82%BC%EA%B2%B9%EC%82%B4+%EA%B5%AD%EB%82%B4%EC%82%B0"
MAPPING_PATH = "history/product_ids.json"

def init_driver():
    options = Options()
    options.add_argument('--headless=new')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('--disable-gpu')
    options.add_argument('--window-size=1920,1080')
    options.add_argument('user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')
    options.add_argument('--disable-blink-features=AutomationControlled')
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    driver = webdriver.Chrome(options=options)
    driver.set_page_load_timeout(30)
    return driver

def normalize_beef(title):
    """한우 등심 상품명 정규화"""
    t = re.sub(r'\s+', ' ', title.strip())
    if '1++' in t:
        return "한우 등심 1++등급 구이용 (국내산) 100g"
    elif '1+' in t:
        return "한우 등심 1+등급 구이용 (국내산) 100g"
    elif '1등급' in t and '스테이크' not in t:
        return "한우 등심 1등급 구이용 (국내산) 100g"
    return t

def normalize_pork(title):
    """삼겹살 상품명 정규화"""
    t = re.sub(r'\s+', ' ', title.strip())
    if '꽃' in t and '삼겹살' in t:
        return "꽃 삼겹살 (600g)"
    elif '제주' in t:
        return "제주 삼겹살 (100g)"
    elif '포크밸리' in t:
        return "포크밸리 삼겹살 (100g)"
    elif '흑돼지' in t:
        return "흑돼지 삼겹살 (100g)"
    elif '1kg' in t or '1 kg' in t:
        return "돼지 삼겹살 (1kg팩)"
    elif '삼겹살' in t and '100g' in t:
        return "돼지 삼겹살 (100g)"
    return t

def scrape_product_ids(driver, url, is_pork=False):
    """검색 페이지에서 상품명-ID 매핑 추출"""
    mapping = {}
    try:
        driver.get(url)
        WebDriverWait(driver, 15).until(
            EC.presence_of_element_located((By.CLASS_NAME, "item-wrapper"))
        )
    except Exception as e:
        logging.warning(f"Page load issue: {e}")
    
    items = driver.find_elements(By.CLASS_NAME, "item-wrapper")
    logging.info(f"Found {len(items)} items on {'pork' if is_pork else 'beef'} page")
    
    forbidden_pork = ["목심", "목살", "앞다리", "뒷다리", "냉동", "갈매기살", "항정살", "수입"]
    
    for item in items:
        try:
            title_els = item.find_elements(By.CLASS_NAME, "title")
            if not title_els:
                continue
            title = title_els[0].text.strip()
            
            if is_pork:
                if "삼겹살" not in title or any(k in title for k in forbidden_pork):
                    continue
            else:
                if not ("한우" in title and "등심" in title):
                    continue
            
            try:
                link = item.find_element(By.CSS_SELECTOR, "a.link")
                onclick = link.get_attribute("onclick") or ""
                m = re.search(r"goDetail\('(\d+)'\)", onclick)
                if m:
                    product_id = m.group(1)
                    normalized = normalize_pork(title) if is_pork else normalize_beef(title)
                    mapping[normalized] = product_id
                    logging.info(f"  {normalized} -> {product_id}")
            except Exception:
                pass
        except Exception as e:
            logging.debug(f"Item parse error: {e}")
    
    return mapping

def main():
    os.makedirs("history", exist_ok=True)
    
    mapping = {}
    if os.path.exists(MAPPING_PATH):
        with open(MAPPING_PATH, "r", encoding="utf-8") as f:
            mapping = json.load(f)
        logging.info(f"Loaded existing mapping: {len(mapping)} products")
    
    driver = init_driver()
    try:
        beef_map = scrape_product_ids(driver, BEEF_SEARCH_URL, is_pork=False)
        mapping.update(beef_map)
        
        pork_map = scrape_product_ids(driver, PORK_SEARCH_URL, is_pork=True)
        mapping.update(pork_map)
        
        with open(MAPPING_PATH, "w", encoding="utf-8") as f:
            json.dump(mapping, f, ensure_ascii=False, indent=2)
        logging.info(f"Saved mapping: {len(mapping)} products to {MAPPING_PATH}")
        
    finally:
        driver.quit()

if __name__ == "__main__":
    main()
