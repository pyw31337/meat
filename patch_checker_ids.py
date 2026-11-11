#!/usr/bin/env python3
"""Patch megamart_checker.py to extract and save product IDs"""
from pathlib import Path

p = Path('megamart_checker.py')
c = p.read_text(encoding='utf-8')

# Add product ID extraction in scrape
old = '''price_per_100g = int((price_value / weight) * 100) if weight > 0 else 0
                
                monitored_products.append((normalized_title, price_per_100g, price_value, weight))
                logging.info(f"Monitored item: '{title_text}' (normalized: '{normalized_title}') -> {price_value:,}원 ({weight}g) | 100g당 {price_per_100g:,}원")'''

new = '''price_per_100g = int((price_value / weight) * 100) if weight > 0 else 0
                
                # Extract product ID
                product_id = None
                try:
                    link_el = item.find_element(By.CSS_SELECTOR, "a.link")
                    onclick = link_el.get_attribute("onclick") or ""
                    id_match = re.search(r"goDetail\\('(\\d+)'\\)", onclick)
                    if id_match:
                        product_id = id_match.group(1)
                except Exception:
                    pass
                
                monitored_products.append((normalized_title, price_per_100g, price_value, weight, product_id))
                logging.info(f"Monitored item: '{title_text}' (id: {product_id}) -> {price_value:,}원 ({weight}g) | 100g당 {price_per_100g:,}원")'''

if old in c:
    c = c.replace(old, new)
    print('scrape patched')
else:
    print('scrape pattern not found')

# Add mapping save after CSV write
old2 = '''except Exception as e:
        logging.error(f"Failed to write to CSV: {e}")
        return

    # Generate trend chart'''

new2 = '''except Exception as e:
        logging.error(f"Failed to write to CSV: {e}")
        return

    # Save product ID mapping
    try:
        import json
        mapping_path = "history/product_ids.json"
        mapping = {}
        if os.path.exists(mapping_path):
            with open(mapping_path, "r", encoding="utf-8") as f:
                mapping = json.load(f)
        for item in products:
            if len(item) > 4 and item[4]:
                mapping[item[0]] = item[4]
        with open(mapping_path, "w", encoding="utf-8") as f:
            json.dump(mapping, f, ensure_ascii=False, indent=2)
        logging.info(f"Product ID mapping updated: {len(mapping)} products")
    except Exception as map_err:
        logging.error(f"Failed to save product ID mapping: {map_err}")

    # Generate trend chart'''

if old2 in c:
    c = c.replace(old2, new2)
    print('mapping save patched')
else:
    print('mapping pattern not found')

p.write_text(c, encoding='utf-8')
print('done')
