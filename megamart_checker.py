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
        logging.FileHandler("booking_checker.log", encoding="utf-8") # Append to same log file
    ]
)

# Configuration Variables
RECEIVER_EMAIL = os.getenv("RECEIVER_EMAIL")
if not RECEIVER_EMAIL:
    logging.error("RECEIVER_EMAIL environment variable is not set!")
    sys.exit(1)
BEEF_SEARCH_URL = "https://www.megamart.com/search/?text=%ED%95%9C%EC%9A%B0+%EB%93%B1%EC%8B%AC"
PORK_SEARCH_URL = "https://www.megamart.com/search/?text=%EC%82%BC%EA%B2%B9%EC%82%B4+%EA%B5%AD%EB%82%B4%EC%82%B0"
BEEF_PRICE_THRESHOLD = 7000  # Alert if beef price is <= 7000 KRW/100g
PORK_PRICE_THRESHOLD = 2000  # Alert if pork price is <= 2000 KRW/100g

def upload_to_tmpfiles(file_path):
    try:
        logging.info(f"Uploading {file_path} to Tmpfiles.org with 48 hours expiration...")
        url = "https://tmpfiles.org/api/v1/upload"
        boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
        body_parts = []
        
        # expire field (48 hours = 172800 seconds)
        body_parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="expire"\r\n\r\n172800\r\n'.encode('utf-8'))
        
        # file field
        filename = os.path.basename(file_path)
        with open(file_path, 'rb') as f:
            file_content = f.read()
            
        file_header = (
            f'--{boundary}\r\n'
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f'Content-Type: image/png\r\n\r\n'
        ).encode('utf-8')
        body_parts.append(file_header)
        body_parts.append(file_content)
        body_parts.append(b'\r\n')
        body_parts.append(f'--{boundary}--\r\n'.encode('utf-8'))
        
        body_data = b''.join(body_parts)
        
        req = urllib.request.Request(
            url,
            data=body_data,
            headers={
                'Content-Type': f'multipart/form-data; boundary={boundary}',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            method='POST'
        )
        
        with urllib.request.urlopen(req, timeout=20) as response:
            res_data = response.read().decode('utf-8')
            result = json.loads(res_data)
            if result.get('status') == 'success':
                download_url = result['data']['url']
                # Convert standard download page to raw file URL
                direct_url = download_url.replace("https://tmpfiles.org/", "https://tmpfiles.org/dl/")
                logging.info(f"Successfully uploaded to Tmpfiles: {direct_url}")
                return direct_url
            else:
                logging.error(f"Tmpfiles upload failed: {res_data}")
                return None
    except Exception as e:
        logging.error(f"Failed to upload to Tmpfiles: {e}")
        return None

def send_email(subject, body, attachment_path=None):
    try:
        # If attachment is provided, upload it to Tmpfiles and add the link to the body
        if attachment_path and os.path.exists(attachment_path):
            img_url = upload_to_tmpfiles(attachment_path)
            if img_url:
                body = body.strip() + f"\n\n■ 가격 변동 추이 그래프 (아래 링크 클릭):\n{img_url}"
            else:
                body = body.strip() + "\n\n(참고: 가격 변동 추이 그래프 업로드에 실패했습니다.)"
        
        logging.info(f"Sending email notification to {RECEIVER_EMAIL} via FormSubmit AJAX endpoint...")
        url = f"https://formsubmit.co/ajax/{RECEIVER_EMAIL}"
        
        payload = {
            "_subject": subject,
            "name": "Megamart Price Monitor",
            "message": body.strip()
        }
        
        data = json.dumps(payload).encode('utf-8')
        
        req = urllib.request.Request(
            url, 
            data=data, 
            headers={
                'Content-Type': 'application/json',
                'Origin': 'http://localhost',
                'Referer': 'http://localhost/',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            method='POST'
        )
        
        with urllib.request.urlopen(req, timeout=15) as response:
            res_data = response.read().decode('utf-8')
            res_json = json.loads(res_data)
            
            if res_json.get("success") == "true" or "needs Activation" in res_json.get("message", ""):
                logging.info("AJAX Email submitted successfully!")
                return True
            else:
                logging.error(f"FormSubmit error: {res_json.get('message')}")
                return False
                
    except Exception as e:
        logging.error(f"Failed to send notification: {e}")
        return False

def init_driver():
    options = Options()
    options.add_argument('--headless=new')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('--disable-gpu')
    options.add_argument('--window-size=1920,1080')
    options.add_argument('user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
    options.add_argument('--disable-blink-features=AutomationControlled')
    options.page_load_strategy = 'eager'  # Do not wait for heavy image/tracker downloads
    
    # Exclude automation switch to avoid bot flags
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option('useAutomationExtension', False)
    
    driver = webdriver.Chrome(options=options)
    driver.set_page_load_timeout(35)  # Cap page loading time to 35s to prevent urllib3 ReadTimeoutError
    
    # Hide automation webdriver property
    driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
        "source": "const newProto = navigator.__proto__; delete newProto.webdriver; navigator.__proto__ = newProto;"
    })
    return driver

def save_price_history_and_plot(products):
    import csv
    from datetime import datetime, timezone, timedelta
    
    os.makedirs("history", exist_ok=True)
    csv_path = "history/prices.csv"
    kst_tz = timezone(timedelta(hours=9))
    today_str = datetime.now(kst_tz).strftime("%Y-%m-%d")
    
    # Append today's data
    file_exists = os.path.exists(csv_path)
    existing_entries = set()
    if file_exists:
        try:
            with open(csv_path, "r", encoding="utf-8") as f:
                reader = csv.reader(f)
                header = next(reader, None)
                for row in reader:
                    if len(row) >= 3:
                        existing_entries.add((row[0], row[1]))
        except Exception as e:
            logging.error(f"Error reading existing CSV: {e}")

    try:
        with open(csv_path, "a", encoding="utf-8", newline="") as f:
            writer = csv.writer(f)
            if not file_exists:
                writer.writerow(["date", "product_name", "price"])
            for name, price_per_100g, actual_price, weight in products:
                if (today_str, name) not in existing_entries:
                    writer.writerow([today_str, name, price_per_100g])
                    logging.info(f"Saved history: {today_str}, {name}, 100g당 {price_per_100g}원")
    except Exception as e:
        logging.error(f"Failed to write to CSV: {e}")
        return

    # Generate trend chart
    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        import matplotlib.dates as mdates
        
        history_data = {}
        with open(csv_path, "r", encoding="utf-8") as f:
            reader = csv.reader(f)
            header = next(reader, None)
            for row in reader:
                if len(row) >= 3:
                    date_val = datetime.strptime(row[0], "%Y-%m-%d")
                    name = row[1]
                    price = int(row[2])
                    if name not in history_data:
                        history_data[name] = {"dates": [], "prices": []}
                    history_data[name]["dates"].append(date_val)
                    history_data[name]["prices"].append(price)

        import platform
        system = platform.system()
        if system == 'Darwin':
            plt.rcParams['font.family'] = 'AppleGothic'
        elif system == 'Windows':
            plt.rcParams['font.family'] = 'Malgun Gothic'
        else:
            plt.rcParams['font.family'] = 'NanumGothic'
        plt.rcParams['axes.unicode_minus'] = False

        # Separate beef and pork history
        beef_history = {}
        pork_history = {}
        for name, data in history_data.items():
            if "삼겹살" in name:
                pork_history[name] = data
            else:
                beef_history[name] = data

        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 10))
        plt.style.use('seaborn-v0_8-whitegrid' if 'seaborn-v0_8-whitegrid' in plt.style.available else 'default')

        # 1. Plot Beef Ribeye on ax1 (Top)
        if beef_history:
            for name, data in beef_history.items():
                sorted_pairs = sorted(zip(data["dates"], data["prices"]))
                sorted_dates, sorted_prices = zip(*sorted_pairs)
                short_name = name.replace(" (국내산) 100g", "").replace("등급 구이용", "")
                ax1.plot(sorted_dates, sorted_prices, marker='o', linewidth=2, label=short_name)
            ax1.xaxis.set_major_formatter(mdates.DateFormatter('%m-%d'))
            ax1.xaxis.set_major_locator(mdates.DayLocator(interval=max(1, len(sorted_dates)//10)))
        ax1.set_title("한우 등심 가격 추이 (100g당 단가)", fontsize=12, fontweight='bold')
        ax1.set_ylabel("가격 (원)", fontsize=10)
        ax1.axhline(y=7000, color='r', linestyle='--', alpha=0.7, label="Threshold (7,000원)")
        ax1.legend(loc="upper right", frameon=True, shadow=True)
        ax1.tick_params(axis='x', rotation=30)
        
        # 2. Plot Pork Belly on ax2 (Bottom)
        if pork_history:
            for name, data in pork_history.items():
                sorted_pairs = sorted(zip(data["dates"], data["prices"]))
                sorted_dates, sorted_prices = zip(*sorted_pairs)
                short_name = name.replace(" (국내산)", "")
                ax2.plot(sorted_dates, sorted_prices, marker='s', linewidth=2, label=short_name)
            ax2.xaxis.set_major_formatter(mdates.DateFormatter('%m-%d'))
            ax2.xaxis.set_major_locator(mdates.DayLocator(interval=max(1, len(sorted_dates)//10)))
        ax2.set_title("국내산 삼겹살 가격 추이 (100g당 단가)", fontsize=12, fontweight='bold')
        ax2.set_ylabel("가격 (원)", fontsize=10)
        ax2.axhline(y=2000, color='r', linestyle='--', alpha=0.7, label="Threshold (2,000원)")
        ax2.legend(loc="upper right", frameon=True, shadow=True)
        ax2.tick_params(axis='x', rotation=30)
        
        plt.tight_layout()
        
        chart_path = "history/price_trend.png"
        plt.savefig(chart_path, dpi=150)
        plt.close()
        logging.info(f"Price trend chart updated and saved to {chart_path}")
        
        update_readme(products, today_str)
        generate_interactive_dashboard()
        
    except Exception as plot_err:
        logging.error(f"Failed to generate price trend chart: {plot_err}")

def update_readme(products, today_str):
    try:
        readme_path = "README.md"
        latest_prices_str = "\n".join([
            f"- **{name}**: 100g당 {price_per_100g:,}원 (현재 판매가: {actual_price:,}원/{weight}g) (업데이트: {today_str})" 
            for name, price_per_100g, actual_price, weight in products
        ])
        
        content = f"""# Naver Booking & Megamart Price Monitor

이 저장소는 네이버 예약 및 메가마트 가격 감시 모니터링 시스템을 위한 자동화 저장소입니다.

---

## 🥩 메가마트 소고기(한우 등심) & 돼지고기(국내산 삼겹살) 실시간 추이
* **설정 가격 기준**: 소고기 100g당 **{BEEF_PRICE_THRESHOLD:,}원 이하** / 돼지고기 100g당 **{PORK_PRICE_THRESHOLD:,}원 이하**일 때 이메일 알림 발송

### 📌 최근 수집된 가격
{latest_prices_str}

### 📈 가격 추이 그래프
![가격 추이](history/price_trend.png)

---

## 📅 네이버 예약 모니터링 (애슐리퀸즈 여의도한강공원점)
* **대상 일자**: 2026년 8월 15일 광복절 (프로젝트 종료)
"""
        with open(readme_path, "w", encoding="utf-8") as f:
            f.write(content)
        logging.info("README.md updated with latest prices and chart.")
    except Exception as e:
        logging.error(f"Failed to update README.md: {e}")

def generate_interactive_dashboard():
    import json
    import csv
    
    csv_path = "history/prices.csv"
    if not os.path.exists(csv_path):
        return
        
    # Read history data to JSON
    price_history = []
    try:
        with open(csv_path, "r", encoding="utf-8") as f:
            reader = csv.reader(f)
            header = next(reader, None)
            for row in reader:
                if len(row) >= 3:
                    price_history.append({
                        "date": row[0],
                        "product_name": row[1],
                        "price": int(row[2])
                    })
    except Exception as e:
        logging.error(f"Failed to read CSV for dashboard JSON: {e}")
        return

    # Self-contained HTML template using Chart.js
    html_template = """<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>메가마트 소고기 & 돼지고기 가격 추이 대시보드</title>
    <!-- Premium Fonts -->
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&family=Outfit:wght@300;400;500;700&display=swap" rel="stylesheet">
    <!-- Chart.js -->
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        :root {
            --bg-color: #0b0c10;
            --card-bg: #1f2833;
            --text-primary: #ffffff;
            --text-secondary: #c5a059;
            --accent-color: #66fcf1;
            --accent-hover: #45f3e5;
            --border-color: #45a29e;
        }
        body {
            background-color: var(--bg-color);
            color: var(--text-primary);
            font-family: 'Outfit', 'Noto Sans KR', sans-serif;
            margin: 0;
            padding: 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
            min-height: 100vh;
        }
        .container {
            width: 100%;
            max-width: 1000px;
            margin: 20px 0;
        }
        header {
            text-align: center;
            margin-bottom: 30px;
        }
        h1 {
            font-size: 2.2rem;
            font-weight: 700;
            margin: 10px 0;
            background: linear-gradient(45deg, #ffffff, var(--accent-color));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .subtitle {
            color: var(--text-secondary);
            font-size: 1.1rem;
            font-weight: 400;
        }
        .card {
            background-color: var(--card-bg);
            border: 1px solid rgba(69, 162, 158, 0.2);
            border-radius: 16px;
            padding: 24px;
            box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
            backdrop-filter: blur(4px);
            margin-bottom: 24px;
        }
        .controls-row {
            display: flex;
            flex-wrap: wrap;
            justify-content: space-between;
            align-items: center;
            gap: 15px;
            margin-bottom: 20px;
        }
        .filter-group {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .filter-label {
            font-weight: 500;
            color: var(--text-secondary);
            margin-right: 5px;
        }
        .btn-group {
            display: flex;
            gap: 8px;
        }
        button {
            background-color: #0b0c10;
            color: #ffffff;
            border: 1px solid var(--border-color);
            padding: 8px 16px;
            border-radius: 20px;
            cursor: pointer;
            font-family: inherit;
            font-weight: 500;
            transition: all 0.3s ease;
        }
        button:hover {
            border-color: var(--accent-color);
            color: var(--accent-color);
        }
        button.active {
            background-color: var(--accent-color);
            color: #0b0c10;
            border-color: var(--accent-color);
            box-shadow: 0 0 10px rgba(102, 252, 241, 0.4);
        }
        .checkbox-container {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            margin-top: 15px;
            padding-top: 15px;
            border-top: 1px solid rgba(69, 162, 158, 0.15);
        }
        .checkbox-item {
            display: flex;
            align-items: center;
            gap: 8px;
            background: rgba(11, 12, 16, 0.5);
            padding: 8px 16px;
            border-radius: 20px;
            border: 1px solid rgba(69, 162, 158, 0.15);
            cursor: pointer;
            user-select: none;
            transition: all 0.3s ease;
        }
        .checkbox-item:hover {
            border-color: var(--accent-color);
        }
        .checkbox-item.active {
            border-color: var(--accent-color);
            background: rgba(102, 252, 241, 0.1);
        }
        .checkbox-item input {
            display: none;
        }
        .checkbox-item .indicator {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background-color: #555;
            transition: all 0.3s ease;
        }
        .checkbox-item.active .indicator {
            background-color: var(--accent-color);
            box-shadow: 0 0 8px var(--accent-color);
        }
        .chart-container {
            position: relative;
            height: 380px;
            width: 100%;
        }
        .info-footer {
            text-align: center;
            color: #666;
            font-size: 0.9rem;
            margin-top: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🥩 소고기 & 🐷 돼지고기 가격 대시보드</h1>
            <div class="subtitle">메가마트 한우 등심 & 국내산 삼겹살 가격 실시간 모니터링</div>
        </header>

        <div class="card">
            <div class="controls-row">
                <div class="filter-group">
                    <span class="filter-label">기간 필터:</span>
                    <div class="btn-group">
                        <button onclick="setPeriod(7)" id="btn-7">최근 7일</button>
                        <button onclick="setPeriod(30)" id="btn-30">최근 30일</button>
                        <button onclick="setPeriod(0)" id="btn-0" class="active">전체</button>
                    </div>
                </div>
            </div>
            
            <div class="filter-label">모니터링 상품 선택:</div>
            <div class="checkbox-container" id="product-filters">
                <!-- Checkboxes will be dynamically rendered here -->
            </div>
        </div>

        <div class="card">
            <h2 style="margin-top:0; font-size:1.4rem; color:var(--accent-color);">🥩 소고기 (한우 등심) 가격 추이</h2>
            <div class="chart-container">
                <canvas id="priceChartBeef"></canvas>
            </div>
        </div>

        <div class="card">
            <h2 style="margin-top:0; font-size:1.4rem; color:var(--accent-color);">🐷 돼지고기 (국내산 삼겹살) 가격 추이</h2>
            <div class="chart-container">
                <canvas id="priceChartPork"></canvas>
            </div>
        </div>

        <div class="info-footer">
            본 대시보드는 12시간마다 자동으로 업데이트됩니다.
        </div>
    </div>

    <script>
        // Data injected by python script
        const PRICE_DATA = /*DATA_PLACEHOLDER*/;

        // Group data by product
        const products = [...new Set(PRICE_DATA.map(item => item.product_name))];
        let activeProducts = [...products];
        let activePeriod = 0; // 0 means all-time
        let beefChart = null;
        let porkChart = null;

        // Color palettes for line charts
        const colors = [
            '#66fcf1', // Cyan
            '#ff007f', // Pink
            '#ffb300', // Yellow
            '#00e676', // Green
            '#d500f9', // Purple
            '#ff9800', // Orange
            '#2196f3'  // Blue
        ];

        // Format dates correctly
        const formatShortDate = (dateStr) => {
            const d = new Date(dateStr);
            return `${d.getMonth() + 1}-${d.getDate()}`;
        };

        // Render product toggles
        const filterContainer = document.getElementById("product-filters");
        products.forEach((prod, index) => {
            const label = document.createElement("label");
            label.className = "checkbox-item active";
            label.id = `label-${index}`;
            let display_name = prod.replace(" (국내산) 100g", "").replace("등급 구이용", "").replace(" (국내산)", "");
            label.innerHTML = `
                <input type="checkbox" checked onchange="toggleProduct('${prod}', ${index})">
                <span class="indicator"></span>
                <span>${display_name}</span>
            `;
            filterContainer.appendChild(label);
        });

        const toggleProduct = (prod, index) => {
            const label = document.getElementById(`label-${index}`);
            if (activeProducts.includes(prod)) {
                activeProducts = activeProducts.filter(p => p !== prod);
                label.classList.remove("active");
            } else {
                activeProducts.push(prod);
                label.classList.add("active");
            }
            updateCharts();
        };

        const setPeriod = (days) => {
            activePeriod = days;
            document.getElementById("btn-7").classList.remove("active");
            document.getElementById("btn-30").classList.remove("active");
            document.getElementById("btn-0").classList.remove("active");
            document.getElementById(`btn-${days}`).classList.add("active");
            updateCharts();
        };

        const updateCharts = () => {
            // Get all unique dates
            let dates = [...new Set(PRICE_DATA.map(item => item.date))].sort();
            
            // Filter by period
            if (activePeriod > 0) {
                const limitDate = new Date();
                limitDate.setDate(limitDate.getDate() - activePeriod);
                const limitStr = limitDate.toISOString().split('T')[0];
                dates = dates.filter(d => d >= limitStr);
            }

            const buildChartConfig = (filterFunc, threshold, thresholdLabel) => {
                const groupProducts = activeProducts.filter(filterFunc);
                
                const datasets = groupProducts.map((prod, index) => {
                    const prodData = PRICE_DATA.filter(item => item.product_name === prod);
                    const dataPoints = dates.map(date => {
                        const found = prodData.find(item => item.date === date);
                        return found ? found.price : null;
                    });

                    return {
                        label: prod.replace(" (국내산) 100g", "").replace("등급 구이용", "").replace(" (국내산)", ""),
                        data: dataPoints,
                        borderColor: colors[index % colors.length],
                        backgroundColor: colors[index % colors.length] + '20',
                        borderWidth: 2,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        tension: 0.15,
                        spanGaps: true
                    };
                });

                // Add threshold line
                datasets.push({
                    label: thresholdLabel,
                    data: Array(dates.length).fill(threshold),
                    borderColor: '#ff4444',
                    borderDash: [5, 5],
                    pointRadius: 0,
                    borderWidth: 1.5,
                    fill: false
                });

                return {
                    type: 'line',
                    data: {
                        labels: dates.map(d => formatShortDate(d)),
                        datasets: datasets
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            x: {
                                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                                ticks: { color: '#888' }
                            },
                            y: {
                                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                                ticks: { color: '#888' }
                            }
                        },
                        plugins: {
                            legend: {
                                labels: { color: '#fff', font: { family: 'Noto Sans KR' } }
                            },
                            tooltip: {
                                mode: 'index',
                                intersect: false,
                                callbacks: {
                                    label: function(context) {
                                        let label = context.dataset.label || '';
                                        if (label) {
                                            label += ': ';
                                        }
                                        if (context.parsed.y !== null) {
                                            label += new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(context.parsed.y).replace('₩', '') + '원';
                                        }
                                        return label;
                                    }
                                }
                            }
                        }
                    }
                };
            };

            // 1. Update Beef Chart
            if (beefChart) {
                beefChart.destroy();
            }
            beefChart = new Chart(
                document.getElementById('priceChartBeef').getContext('2d'),
                buildChartConfig((prod) => !prod.includes("삼겹살"), 7000, '알림 기준가 (7,000원)')
            );

            // 2. Update Pork Chart
            if (porkChart) {
                porkChart.destroy();
            }
            porkChart = new Chart(
                document.getElementById('priceChartPork').getContext('2d'),
                buildChartConfig((prod) => prod.includes("삼겹살"), 2000, '알림 기준가 (2,000원)')
            );
        };

        // Initial render
        updateCharts();
    </script>
</body>
</html>"""

    html_content = html_template.replace("/*DATA_PLACEHOLDER*/", json.dumps(price_history, ensure_ascii=False))
    
    try:
        dashboard_path = "dashboard.html"
        with open(dashboard_path, "w", encoding="utf-8") as f:
            f.write(html_content)
        logging.info("dashboard.html generated successfully!")
    except Exception as e:
        logging.error(f"Failed to write dashboard.html: {e}")
def generate_price_table_text():
    csv_path = "history/prices.csv"
    if not os.path.exists(csv_path):
        return ""
        
    import csv
    from collections import defaultdict
    from datetime import datetime
    
    data_by_date = defaultdict(dict)
    all_dates = set()
    
    product_mapping = {
        # Beef
        '한우 등심 1등급 구이용 (국내산) 100g': '1등급 (100g)',
        '한우 등심 1+등급 구이용 (국내산) 100g': '1+등급 (100g)',
        '한우 등심 1++등급 구이용 (국내산) 100g': '1++등급 (100g)',
        '1등급 한우 냉장 등심 구이용 (국내산) 1kg': '1등급 (1kg팩)',
        # Pork
        '돼지 삼겹살 (100g)': '삼겹살 (100g)',
        '돼지 삼겹살 (1kg팩)': '삼겹살 (1kg팩)',
        '꽃 삼겹살 (600g)': '꽃삼겹 (600g)',
        '흑돼지 삼겹살 (100g)': '흑돼지 (100g)',
        '제주 삼겹살 (100g)': '제주 (100g)',
        '포크밸리 삼겹살 (100g)': '포크밸리 (100g)'
    }
    
    lowest_db = {}
    
    try:
        with open(csv_path, "r", encoding="utf-8") as f:
            reader = csv.reader(f)
            header = next(reader, None)
            for row in reader:
                if len(row) >= 3:
                    date_str, name, price_str = row[0], row[1], row[2]
                    all_dates.add(date_str)
                    simplified_name = product_mapping.get(name, name[:10])
                    try:
                        price = int(price_str)
                        data_by_date[date_str][simplified_name] = price
                        
                        # Track lowest price
                        if simplified_name not in lowest_db:
                            lowest_db[simplified_name] = (price, date_str)
                        else:
                            current_min, current_date = lowest_db[simplified_name]
                            if price < current_min:
                                lowest_db[simplified_name] = (price, date_str)
                    except:
                        pass
    except Exception as e:
        logging.error(f"Error reading prices CSV for table: {e}")
        return ""
        
    sorted_dates = sorted(list(all_dates))
    last_7_dates = sorted_dates[-7:]
    
    if not last_7_dates:
        return ""
        
    beef_products = ['1등급 (100g)', '1+등급 (100g)', '1++등급 (100g)', '1등급 (1kg팩)']
    pork_products = ['삼겹살 (100g)', '삼겹살 (1kg팩)', '꽃삼겹 (600g)', '흑돼지 (100g)', '제주 (100g)', '포크밸리 (100g)']
    
    weekdays = ["월", "화", "수", "목", "금", "토", "일"]
    
    def format_group_prices(group_name, products_list):
        group_lines = []
        group_lines.append(f"=== [{group_name}] ===")
        for p in products_list:
            # Check if there is any history at all for this product in last 7 days or ever
            if p not in lowest_db:
                continue
                
            price, date_str = lowest_db[p]
            try:
                date_obj = datetime.strptime(date_str, "%Y-%m-%d")
                weekday_ko = weekdays[date_obj.weekday()]
                formatted_date = f"{date_obj.strftime('%y.%m.%d')} {weekday_ko}"
            except Exception:
                formatted_date = date_str
            lowest_text = f"역대 최저가 : {price:,}원 ({formatted_date})"
            
            group_lines.append(f"[ {p} ] {lowest_text}")
            
            # Print last 7 dates
            for idx in range(len(last_7_dates) - 1, -1, -1):
                d = last_7_dates[idx]
                try:
                    parts = d.split('-')
                    display_date = f"{parts[1]}-{parts[2]}"
                except:
                    display_date = d
                    
                day_label = ""
                if d == last_7_dates[-1]:
                    day_label = " (오늘)"
                elif len(last_7_dates) >= 2 and d == last_7_dates[-2]:
                    day_label = " (어제)"
                    
                price_val = data_by_date[d].get(p)
                prev_price = None
                if idx > 0:
                    prev_date = last_7_dates[idx - 1]
                    prev_price = data_by_date[prev_date].get(p)
                    
                price_detail = ""
                if price_val is not None:
                    price_str = f"{price_val:,}원"
                    if prev_price is not None:
                        if price_val < prev_price:
                            diff = prev_price - price_val
                            price_detail = f" (▼ {diff:,}원 할인!)"
                        elif price_val > prev_price:
                            diff = price_val - prev_price
                            price_detail = f" (▲ {diff:,}원 인상)"
                    else:
                        if idx > 0:
                            price_detail = " (재입고/신규)"
                else:
                    price_str = "- (품절)"
                    
                group_lines.append(f"▶ {display_date}{day_label} : {price_str}{price_detail}")
            group_lines.append("") # blank line between products
        return group_lines

    output_lines = []
    output_lines.append("■ 최근 7일간 등급별 가격 변동 추이 (100g당 단가):")
    output_lines.append("")
    output_lines.extend(format_group_prices("소고기 - 한우 등심", beef_products))
    output_lines.extend(format_group_prices("돼지고기 - 국내산 삼겹살", pork_products))
    
    return "\n".join(output_lines)

def normalize_product_title(title_text):
    # Determine grade
    if "1++" in title_text:
        grade = "1++등급"
    elif "1+" in title_text:
        grade = "1+등급"
    elif "1등급" in title_text or "1 등급" in title_text:
        grade = "1등급"
    else:
        grade = None
        
    # Determine weight
    is_1kg = "1kg" in title_text.lower() or "1 kg" in title_text.lower() or "1000g" in title_text.lower()
    
    if grade:
        if is_1kg and grade == "1등급":
            return '1등급 한우 냉장 등심 구이용 (국내산) 1kg'
        else:
            return f'한우 등심 {grade} 구이용 (국내산) 100g'
            
    return title_text

def normalize_pork_title(title_text):
    # Normalize pork titles
    if "꽃" in title_text:
        return '꽃 삼겹살 (600g)'
    elif "1kg" in title_text.lower() or "1000g" in title_text.lower():
        return '돼지 삼겹살 (1kg팩)'
    elif "흑돼지" in title_text:
        return '흑돼지 삼겹살 (100g)'
    elif "제주" in title_text:
        return '제주 삼겹살 (100g)'
    elif "포크밸리" in title_text:
        return '포크밸리 삼겹살 (100g)'
    elif "삼겹살" in title_text:
        return '돼지 삼겹살 (100g)'
    return title_text

def scrape_search_page(driver, url, is_pork=False):
    logging.info(f"Navigating to Megamart Search: {url}")
    
    # Load page with timeout resilience & retry
    max_retries = 2
    for attempt in range(1, max_retries + 1):
        try:
            driver.get(url)
            break
        except (TimeoutException, WebDriverException) as te:
            logging.warning(f"Attempt {attempt}/{max_retries}: Page load timed out or connection glitch for {url}: {te}")
            try:
                driver.execute_script("window.stop();")
            except Exception:
                pass
            if attempt == max_retries:
                logging.warning("Proceeding with whatever DOM was loaded after final attempt.")
            else:
                time.sleep(3)
                
    # Wait up to 10 seconds for items to appear
    try:
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CLASS_NAME, "item-wrapper"))
        )
    except TimeoutException:
        logging.warning(f"Timed out waiting for .item-wrapper element on {url}")
        
    time.sleep(2)
    
    # Save a screenshot for debugging
    os.makedirs("screenshots", exist_ok=True)
    suffix = "pork" if is_pork else "beef"
    driver.save_screenshot(f"screenshots/megamart_step1_loaded_{suffix}.png")
    logging.info(f"Page loaded. Saved screenshots/megamart_step1_loaded_{suffix}.png")
    
    item_wrappers = driver.find_elements(By.CLASS_NAME, "item-wrapper")
    logging.info(f"Found {len(item_wrappers)} total items on the search page.")
    if not item_wrappers:
        logging.warning(f"No item wrappers found for {url}!")
        return [], []
        
    monitored_products = []
    cheap_products = []
    
    # Exclude keywords for pork
    forbidden_pork_keywords = ["목심", "목살", "앞다리", "뒷다리", "냉동", "갈매기살", "항정살", "수입"]
    
    for item in item_wrappers:
        try:
            # Find title
            title_els = item.find_elements(By.CLASS_NAME, "title")
            if not title_els:
                continue
            title_text = title_els[0].text.strip()
            
            # Match condition
            if is_pork:
                has_pork_belly = "삼겹살" in title_text
                has_forbidden = any(k in title_text for k in forbidden_pork_keywords)
                is_matched = has_pork_belly and not has_forbidden
            else:
                is_matched = "한우" in title_text and "등심" in title_text and ("구이용" in title_text or "스테이크용" in title_text)
                
            if is_matched:
                # Normalize title
                if is_pork:
                    normalized_title = normalize_pork_title(title_text)
                    threshold = PORK_PRICE_THRESHOLD
                else:
                    normalized_title = normalize_product_title(title_text)
                    threshold = BEEF_PRICE_THRESHOLD
                    
                # Find price
                price_els = item.find_elements(By.CSS_SELECTOR, ".current-price .number")
                if not price_els:
                    continue
                price_text = price_els[0].text.strip()
                price_value = int(re.sub(r"[^\d]", "", price_text))
                
                # Parse weight
                weight = 100
                weight_match = re.search(r"(\d+)\s*(g|kg)", title_text.lower())
                if weight_match:
                    val = int(weight_match.group(1))
                    unit = weight_match.group(2)
                    if unit == "kg":
                        weight = val * 1000
                    else:
                        weight = val
                        
                price_per_100g = int((price_value / weight) * 100) if weight > 0 else 0
                
                monitored_products.append((normalized_title, price_per_100g, price_value, weight))
                logging.info(f"Monitored item: '{title_text}' (normalized: '{normalized_title}') -> {price_value:,}원 ({weight}g) | 100g당 {price_per_100g:,}원")
                
                if price_per_100g <= threshold:
                    cheap_products.append((normalized_title, price_per_100g, price_value, weight))
                    
        except Exception as item_err:
            logging.error(f"Error parsing item card: {item_err}")
            
    return monitored_products, cheap_products

def check_megamart_prices(driver, dry_run=False):
    # 1. Scrape Beef
    beef_monitored, beef_cheap = scrape_search_page(driver, BEEF_SEARCH_URL, is_pork=False)
    
    # 2. Scrape Pork
    pork_monitored, pork_cheap = scrape_search_page(driver, PORK_SEARCH_URL, is_pork=True)
    
    # Combine results
    monitored_products = beef_monitored + pork_monitored
    cheap_products = beef_cheap + pork_cheap
    
    # Save final check screenshot
    driver.save_screenshot("screenshots/megamart_step2_check.png")
    
    logging.info(f"Total matching Beef products: {len(beef_monitored)}")
    logging.info(f"Total matching Pork products: {len(pork_monitored)}")
    
    if not monitored_products:
        raise RuntimeError("No matching products found in either beef or pork search results!")
        
    # Save history and generate trend chart
    save_price_history_and_plot(monitored_products)
    
    # Build alert if either beef or pork has cheap products
    if cheap_products:
        logging.info(f"ALERT: Found {len(cheap_products)} products below threshold!")
        
        # Check rate limiting (maximum 1 alert per day)
        from datetime import datetime, timezone, timedelta
        kst_tz = timezone(timedelta(hours=9))
        today_str = datetime.now(kst_tz).strftime("%Y-%m-%d")
        
        state_file = "history/last_alert_sent.txt"
        already_sent = False
        if os.path.exists(state_file):
            try:
                with open(state_file, "r", encoding="utf-8") as sf:
                    last_sent_date = sf.read().strip()
                    if last_sent_date == today_str:
                        already_sent = True
            except Exception as se:
                logging.error(f"Failed to read alert state file: {se}")
                
        if already_sent:
            logging.info(f"Alert already sent today ({today_str}). Skipping email notification to prevent duplicate spam.")
            return True
            
        # Build alert email body
        beef_list_str = "\n".join([
            f"- {name}: 100g당 {price_per_100g:,}원 (현재 판매가: {price:,}원/{weight}g)"
            for name, price_per_100g, price, weight in beef_cheap
        ]) or "없음"
        
        pork_list_str = "\n".join([
            f"- {name}: 100g당 {price_per_100g:,}원 (현재 판매가: {price:,}원/{weight}g)"
            for name, price_per_100g, price, weight in pork_cheap
        ]) or "없음"
        
        email_subject = "[알림] 메가마트 한우 등심 & 삼겹살 가격 인하!"
        
        history_table_text = generate_price_table_text()
        
        email_body = f"""
[메가마트 한우 등심 & 삼겹살 가격 인하 알림]

설정한 조건(소고기 100g당 {BEEF_PRICE_THRESHOLD:,}원 이하 / 돼지고기 100g당 {PORK_PRICE_THRESHOLD:,}원 이하)을 만족하는 상품이 감지되었습니다!
지금 바로 할인 혜택을 확인하고 구매해 보세요.

■ 가격 인하 상품 목록:
[ 소고기 (한우 등심) ]
{beef_list_str}

[ 돼지고기 (국내산 삼겹살) ]
{pork_list_str}

{history_table_text}

■ 쇼핑몰 바로가기 링크:
- 소고기: {BEEF_SEARCH_URL}
- 돼지고기: {PORK_SEARCH_URL}

■ 실시간 인터랙티브 대시보드 바로가기 (기간/상품 다이내믹 필터링):
- 로컬 파일: workspace의 'dashboard.html' 파일을 브라우저로 직접 열어주세요.
- 깃허브 웹: https://github.com/pyw31337/beautiful-babbage/blob/main/dashboard.html

※ 이 메일은 자동 발송되었습니다.
"""
        sent_success = send_email(email_subject, email_body, attachment_path="history/price_trend.png")
        if sent_success:
            try:
                os.makedirs("history", exist_ok=True)
                with open(state_file, "w", encoding="utf-8") as sf:
                    sf.write(today_str)
                logging.info(f"Recorded alert sent date: {today_str}")
            except Exception as se:
                logging.error(f"Failed to write alert state file: {se}")
        return sent_success
    else:
        logging.info("No products found below the threshold.")
        if dry_run:
            logging.info("[Dry Run] Sending test email with current prices.")
            beef_list_str = "\n".join([
                f"- {name}: 100g당 {price_per_100g:,}원 (현재 판매가: {price:,}원/{weight}g)"
                for name, price_per_100g, price, weight in beef_monitored
            ]) or "없음"
            
            pork_list_str = "\n".join([
                f"- {name}: 100g당 {price_per_100g:,}원 (현재 판매가: {price:,}원/{weight}g)"
                for name, price_per_100g, price, weight in pork_monitored
            ]) or "없음"
            
            test_subject = "[테스트] 메가마트 소고기 & 돼지고기 가격 모니터링 테스트"
            test_body = f"""
[메가마트 소고기 & 돼지고기 모니터링 테스트 메일]

메가마트 가격 감시 스크립트가 정상적으로 동작하고 있습니다.

■ 현재 검색된 소고기 상품 목록:
{beef_list_str}

■ 현재 검색된 돼지고기 상품 목록:
{pork_list_str}

현재 가격은 설정한 기준(소고기 {BEEF_PRICE_THRESHOLD:,}원 이하 / 돼지고기 {PORK_PRICE_THRESHOLD:,}원 이하)보다 높은 상태이므로, 실제 구매 알림 메일은 발송되지 않았습니다.
"""
            send_email(test_subject, test_body, attachment_path="history/price_trend.png")
        return True

def main():
    parser = argparse.ArgumentParser(description="Megamart Hanwoo Ribeye Price Monitor")
    parser.add_argument("--dry-run", action="store_true", help="Run once, save screenshots, and send a test email")
    args = parser.parse_args()

    driver = None
    try:
        driver = init_driver()
        check_megamart_prices(driver, dry_run=args.dry_run)
    except Exception as e:
        logging.error(f"Fatal error in Megamart price checker execution: {e}", exc_info=True)
        import sys
        sys.exit(1)
    finally:
        if driver:
            driver.quit()
            logging.info("Browser driver closed.")

if __name__ == "__main__":
    main()
