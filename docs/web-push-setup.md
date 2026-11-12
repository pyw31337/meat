# PWA Web Push 연결

GitHub Pages는 정적 호스팅이라 브라우저의 구독 정보(기기별 Push endpoint)를 안전하게 보관하거나 앱이 닫힌 뒤 직접 발송할 수 없습니다. 이 저장소는 표준 Web Push 서버와 연결할 수 있도록 클라이언트와 수집 워크플로의 접점을 준비해 둡니다.

## 필요한 서버 API

서버는 HTTPS에서 아래 두 엔드포인트를 제공해야 합니다.

1. `POST /push/subscriptions`
   - 페이지의 `알림 설정`이 전송합니다.
   - 요청 본문: `{ subscription, preferences: { porkAtOrBelow: 1700, beefAtOrBelow: 7000 } }`
   - `https://pyw31337.github.io`에 대한 CORS를 허용하고, 구독을 기기별로 저장합니다.
2. `POST /push/dispatch`
   - GitHub Actions 수집기가 조건 충족 시 호출합니다.
   - 헤더: `Authorization: Bearer <WEB_PUSH_DISPATCH_TOKEN>`
   - 본문: `{ title, body, url, tag }`
   - 저장된 모든 활성 구독에 Web Push를 전송합니다. 만료/410 구독은 제거합니다.

VAPID 개인 키와 발송 토큰은 서버와 GitHub Secrets에만 보관합니다. 브라우저에 노출되는 것은 VAPID **공개 키**뿐입니다.

## 대시보드 연결

`src/pushConfig.js`에 아래 공개 값을 넣습니다. 이 파일 변경은 Pages 배포 시 자동으로 번들에 반영됩니다.

```js
export const PUSH_CONFIG = Object.freeze({
  subscribeUrl: 'https://push.example.com/push/subscriptions',
  vapidPublicKey: 'PUBLIC_VAPID_KEY',
});
```

GitHub 저장소 Secrets에는 다음을 설정합니다.

- `WEB_PUSH_DISPATCH_URL`: `https://push.example.com/push/dispatch`
- `WEB_PUSH_DISPATCH_TOKEN`: 발송 API의 비밀 토큰

수집 워크플로는 삼겹살 100g당 1,700원 이하 또는 한우 100g당 7,000원 이하에서 이 발송 API를 호출합니다. iPhone/iPad에서는 iOS 16.4 이상에서 Safari로 홈 화면에 설치한 PWA에서 권한을 허용해야 합니다.
