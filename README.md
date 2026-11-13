# 미트 트래커

한우 등심과 국내산 삼겹살의 판매가를 수집해 **100g당 가격**으로 비교하는 GitHub Pages 대시보드입니다.

<https://pyw31337.github.io/meat/>

## 데이터 원칙

- 이력의 기본 키는 `date + product_id`입니다. 같은 등급이라도 실제 상품 SKU가 다르면 별개로 기록합니다.
- 수집기는 같은 SKU를 하루에 한 번만 기록합니다.
- 이전 형식의 이력은 SKU가 없으므로 같은 날짜·상품명의 중복 행을 **최저 100g 단가** 한 건으로 정규화했습니다. 이후 수집분부터는 실제 메가마트 상품 ID를 보존합니다.
- 카드의 미니 그래프는 모든 상품에 공통인 최근 7일 축을 사용합니다. 수집되지 않은 날은 선을 이어 붙이지 않습니다.

CSV 형식:

```csv
date,product_id,product_name,price
2026-11-11,14120817,한우 등심 1++등급 구이용 (국내산) 600g,9300
```

## 로컬 실행

```bash
npm ci
npm run dev
```

검증:

```bash
npm test
npm run build
```

## 가격 수집

```bash
python3 -m pip install -r requirements.txt
python3 megamart_checker.py
```

수집기는 `history/prices.csv`를 갱신합니다. 각 행에 메가마트 상품 ID를 함께 저장합니다. `NTFY_TOPIC` 또는 `RECEIVER_EMAIL`을 GitHub Actions secret으로 설정하면 기준 가격 이하 상품을 하루 한 번 통보할 수 있습니다. 브라우저 알림 권한만 요청하는 기능은 의도적으로 제거했습니다.

PWA 알림을 모든 설치 기기로 보내려면 [Web Push 서버 설정 문서](docs/web-push-setup.md)를 따라 `push-server/`를 HTTPS로 실행하고, Pages Secrets에 `VITE_PUSH_SUBSCRIBE_URL`과 `VITE_PUSH_VAPID_PUBLIC_KEY`를 추가합니다.

기존 이력만 별도로 정규화하려면 다음을 실행합니다.

```bash
python3 scripts/migrate_history.py
```

## 배포

`main` 브랜치에 push하면 Pages workflow가 의존성 설치, 단위 테스트, Vite 빌드를 차례로 수행한 뒤 `dist/`만 배포합니다. 수집 이력이 갱신되면 같은 흐름으로 대시보드에 반영됩니다.
