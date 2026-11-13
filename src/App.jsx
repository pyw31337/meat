import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BEEF_COLOR,
  PORK_COLOR,
  chartSeries,
  dateRange,
  formatChartLabel,
  formatDate,
  getProductSeries,
  latestDate,
  parseObservations,
  productStats,
  recentRecords,
  shortName,
} from './lib/priceData';
import { PUSH_CONFIG } from './pushConfig';

const RANGE_OPTIONS = [
  { label: '30일', value: 30 },
  { label: '90일', value: 90 },
  { label: '전체', value: 0 },
];

const UNIT_OPTIONS = [
  { label: '일별', value: 'day' },
  { label: '월별', value: 'month' },
  { label: '분기별', value: 'quarter' },
];

const number = new Intl.NumberFormat('ko-KR');
const BEEF_SERIES_COLORS = ['#c53f31', '#da6554', '#9b5545', '#e28a73'];
const PORK_SERIES_COLORS = ['#1f6fae', '#3689c7', '#639fd0', '#4d759d', '#78add6', '#315d88'];
const BEEF_CARD_ORDER = ['beef-grade-1pp', 'beef-grade-1p', 'beef-grade-1', 'beef-grade-1-1kg'];
const ALERT_THRESHOLDS = { pork: 1700, beef: 7000 };
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function weekdayFor(date) {
  return WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

function MeatIcon({ className = '' }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M8.82 14c1.18 0 1.73-.48 2.43-.97.76-.53 1.89-.91 2.75-.51.38.17 1.54.51 2 .51 1 0 2.12-.89 1.99-2.29C17.74 8.09 15.15 6 12 6s-5.68 2.04-5.98 4.66c-.18 1.59.95 3.34 2.8 3.34m.68-5c.83 0 1.5.67 1.5 1.5S10.33 12 9.5 12 8 11.33 8 10.5 8.67 9 9.5 9" />
    <path d="M21.97 12.01c.02-.27.02-.55 0-.82C21.55 6.04 17.18 2 12 2s-9.45 3.88-9.95 9.02c-.04.44-.04.87 0 1.3v2.7c-.33 3.41 1.89 6.45 5.05 6.91a6 6 0 0 0 4.71-1.28c.8-.66 1.89-.75 2.84-.24.72.39 1.54.59 2.36.59h.01c1.27 0 2.48-.56 3.41-1.56 1.1-1.2 1.68-2.89 1.55-4.43l.03-3h-.03Zm-17.93-.8C4.44 7.1 7.86 4 12 4s7.64 3.23 7.97 7.35c.08 1-.26 2.02-.91 2.72-.39.42-1.06.93-2.06.93-.5 0-.98-.12-1.42-.36-1.67-.9-3.61-.72-5.05.45-.88.72-2 1.03-3.14.86-2.11-.31-3.58-2.39-3.35-4.74" />
  </svg>;
}

function ExternalIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M19 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" /></svg>;
}

function ShareIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.5-4.5M8.2 13.2l7.5 4.5" /></svg>;
}

function BellIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>;
}

function CloseIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>;
}

function dealsAtThreshold(products) {
  return products.filter((product) => productStats(product).latest.price <= ALERT_THRESHOLDS[product.category]);
}

function pushConfig() {
  return PUSH_CONFIG;
}

function vapidKeyBytes(key) {
  const normalized = `${key}${'='.repeat((4 - key.length % 4) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const binary = window.atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function seriesColor(product, products) {
  const family = products.filter((item) => item.category === product.category);
  const index = family.findIndex((item) => item.productId === product.productId);
  const colors = product.category === 'pork' ? PORK_SERIES_COLORS : BEEF_SERIES_COLORS;
  return colors[index % colors.length];
}

function lineSegments(values, width, height, pad, dates = []) {
  const numeric = values.filter(Number.isFinite);
  if (!numeric.length) return { segments: [], min: 0, max: 1 };
  const inset = typeof pad === 'number' ? { top: pad, right: pad, bottom: pad, left: pad } : pad;
  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  const range = max - min || Math.max(100, Math.round(max * 0.04));
  const xFor = (index) => inset.left + (index / Math.max(values.length - 1, 1)) * (width - inset.left - inset.right);
  const yFor = (value) => height - inset.bottom - ((value - min) / range) * (height - inset.top - inset.bottom);
  const segments = [];
  let segment = [];

  values.forEach((value, index) => {
    if (!Number.isFinite(value)) {
      if (segment.length) segments.push(segment);
      segment = [];
      return;
    }
    if (segment.length && dates[index] && dates[index - 1]) {
      const previous = new Date(`${dates[index - 1]}T12:00:00Z`);
      const current = new Date(`${dates[index]}T12:00:00Z`);
      if ((current - previous) / 86_400_000 > 1) {
        segments.push(segment);
        segment = [];
      }
    }
    segment.push([xFor(index), yFor(value), value, index]);
  });
  if (segment.length) segments.push(segment);
  return { segments, min, max, xFor, yFor };
}

function pathFor(points) {
  return points.map(([x, y], index) => `${index ? 'L' : 'M'} ${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
}

function Sparkline({ product }) {
  const [activePoint, setActivePoint] = useState(null);
  const records = recentRecords(product);
  const values = records.map((record) => record.price);
  const dates = records.map((record) => record.date);
  const geometry = lineSegments(values, 240, 78, { top: 8, right: 7, bottom: 20, left: 28 }, dates);
  const { segments, min, max, xFor, yFor } = geometry;
  const color = product.category === 'pork' ? PORK_COLOR : BEEF_COLOR;
  const singleRecord = records.length === 1;
  const average = values.filter(Number.isFinite).reduce((sum, value) => sum + value, 0) / Math.max(values.filter(Number.isFinite).length, 1);
  const points = segments.flat();
  const showPoint = (event, point) => {
    event.stopPropagation();
    const [, , value, index] = point;
    setActivePoint({ value, date: dates[index], x: point[0], y: point[1] });
  };

  return (
    <div className="spark-wrap" aria-label={`${shortName(product.name)} 최근 ${records.length}회 수집 가격 그래프`}>
      <svg className="sparkline" viewBox="0 0 240 78" role="img" onPointerLeave={() => setActivePoint(null)}>
        <defs>
          <linearGradient id={`fill-${product.productId.replace(/[^a-zA-Z0-9]/g, '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.3" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line className="spark-axis" x1="28" x2="28" y1="8" y2="58" />
        <line className="spark-baseline" x1="28" x2="233" y1="58" y2="58" />
        <line className="spark-average" x1="28" x2="233" y1={yFor(average)} y2={yFor(average)} />
        <text className="spark-axis-label" x="24" y="12" textAnchor="end">{number.format(Math.round(max))}</text>
        <text className="spark-axis-label" x="24" y="58" textAnchor="end">{number.format(Math.round(min))}</text>
        {dates.map((date, index) => {
          const x = xFor(index);
          return <line key={date} className="spark-guide" x1={x} x2={x} y1="55" y2="61" />;
        })}
        {singleRecord ? <><line x1="28" x2="233" y1={yFor(values[0])} y2={yFor(values[0])} className="spark-single-line" stroke={color} /><circle cx={xFor(0)} cy={yFor(values[0])} r="4" fill={color} className="spark-dot spark-point" onPointerDown={(event) => showPoint(event, [xFor(0), yFor(values[0]), values[0], 0])} onFocus={(event) => showPoint(event, [xFor(0), yFor(values[0]), values[0], 0])} tabIndex="0" /></> : <>{segments.map((segment, index) => (
          <path key={index} className="spark-path" d={pathFor(segment)} stroke={color} />
        ))}{points.map((point) => <circle key={point[3]} cx={point[0]} cy={point[1]} r="5" fill={color} className="spark-dot spark-point" onPointerEnter={(event) => showPoint(event, point)} onPointerDown={(event) => showPoint(event, point)} onFocus={(event) => showPoint(event, point)} onBlur={() => setActivePoint(null)} tabIndex="0" />)}</>}
      </svg>
      <div className={`spark-dates ${singleRecord ? 'is-single' : ''}`} style={!singleRecord ? { gridTemplateColumns: `repeat(${Math.max(dates.length, 1)}, minmax(0, 1fr))` } : undefined}>
        {singleRecord ? <span>{`${Number(dates[0].slice(5, 7))}.${Number(dates[0].slice(8, 10))} ${weekdayFor(dates[0])}`}</span> : dates.map((date, index) => {
          const previous = dates[index - 1];
          const newMonth = !previous || previous.slice(5, 7) !== date.slice(5, 7);
          return <span key={date}><b>{newMonth ? `${Number(date.slice(5, 7))}.${Number(date.slice(8, 10))}` : Number(date.slice(8, 10))}</b><i>{weekdayFor(date)}</i></span>;
        })}
      </div>
      {activePoint && <div className="spark-tooltip" role="status"><strong>{number.format(activePoint.value)}원</strong><span>{formatDate(activePoint.date, { month: 'numeric', day: 'numeric' })} {weekdayFor(activePoint.date)}</span></div>}
    </div>
  );
}

function ProductCard({ product, dataEndDate, isActive = false, onSelect, isSupplementary = false }) {
  const stats = productStats(product, dataEndDate);
  const color = product.category === 'pork' ? PORK_COLOR : BEEF_COLOR;
  const priceUrl = stats.latest.sourceProductId ? `https://www.megamart.com/product/${stats.latest.sourceProductId}` : null;
  const records = recentRecords(product);
  const changeLabel = stats.change === null
    ? isSupplementary ? '추세 데이터 수집 중' : '7회 비교 데이터 없음'
    : `${stats.change > 0 ? '+' : ''}${number.format(stats.change)}원 · ${stats.changePercent > 0 ? '+' : ''}${stats.changePercent}%`;

  const cardContents = <>
    <div className="product-topline">
      <span className="product-type">{isSupplementary ? `NEW ${product.category === 'pork' ? 'PORK' : 'BEEF'}` : product.category === 'pork' ? 'PORK' : 'BEEF'}</span>
      {stats.staleDays > 0 && <span className="stale-badge">{stats.staleDays}일 전</span>}
    </div>
    <h3 title={product.name}>{shortName(product.name)}</h3>
    <div className="product-price"><strong>{number.format(stats.latest.price)}</strong><span>원 / 100g</span></div>
    <p className={`product-change ${stats.change > 0 ? 'up' : stats.change < 0 ? 'down' : ''}`}>{changeLabel}</p>
    <Sparkline product={product} />
    <div className="record-meta"><span>{records.length === 1 ? '첫 수집 기록' : `최근 ${records.length}회 수집 기록`}</span><span>마지막 {formatDate(stats.latest.date, { month: 'numeric', day: 'numeric' })}</span></div>
    <dl className="product-stats">
      <div><dt>최저</dt><dd>{number.format(stats.minimum)}원</dd></div>
      <div><dt>최고</dt><dd>{number.format(stats.maximum)}원</dd></div>
      <div><dt>평균</dt><dd>{number.format(stats.average)}원</dd></div>
      <div><dt>기록</dt><dd>{product.observations.length}회</dd></div>
    </dl>
  </>;

  return (
    <article className={`product-card ${isActive ? 'is-active' : ''} ${stats.staleDays ? 'is-stale' : ''}`} style={{ '--product-color': color }}>
      {onSelect ? <button
        type="button"
        className="product-focus"
        aria-pressed={isActive}
        aria-label={`${shortName(product.name)} ${isActive ? '선택 해제' : '그래프에 선택'}`}
        onClick={onSelect}
      >{cardContents}</button> : <div className="product-focus product-static">{cardContents}</div>}
      {priceUrl && <a href={priceUrl} target="_blank" rel="noreferrer" className="buy-link">상품 보기 <span aria-hidden="true">↗</span></a>}
    </article>
  );
}

function PriceChart({ series, selectedProduct, onPoint }) {
  const scrollRef = useRef(null);
  const canvasRef = useRef(null);
  const height = 410;
  const [width, setWidth] = useState(980);
  // The coordinates use the *same* aspect ratio as the rendered canvas.
  // That fills the card while preserving circular data points as circles.
  const pad = { top: 34, right: 0, bottom: 42, left: 0 };
  const allValues = series.products.flatMap((product) => product.values).filter(Number.isFinite);
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 100;
  const yMin = Math.max(0, Math.floor((min - range * 0.12) / 100) * 100);
  const yMax = Math.ceil((max + range * 0.12) / 100) * 100;
  const yRange = yMax - yMin || 100;
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const xFor = (index) => pad.left + (index / Math.max(series.keys.length - 1, 1)) * innerWidth;
  const yFor = (value) => pad.top + (1 - (value - yMin) / yRange) * innerHeight;
  const yTicks = Array.from({ length: 5 }, (_, index) => yMin + (yRange * index) / 4);
  const labelStep = Math.max(1, Math.ceil(series.keys.length / 6));

  useEffect(() => {
    const scrollNode = scrollRef.current;
    if (!scrollNode || !window.matchMedia('(max-width: 780px)').matches) return undefined;
    const frame = requestAnimationFrame(() => { scrollNode.scrollLeft = scrollNode.scrollWidth - scrollNode.clientWidth; });
    return () => cancelAnimationFrame(frame);
  }, [series.keys.length, series.unit]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const updateViewBox = () => {
      if (!canvas.clientWidth || !canvas.clientHeight) return;
      const nextWidth = Math.round((canvas.clientWidth / canvas.clientHeight) * height);
      setWidth((currentWidth) => (Math.abs(currentWidth - nextWidth) < 1 ? currentWidth : nextWidth));
    };

    updateViewBox();
    const observer = new ResizeObserver(updateViewBox);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="chart-shell">
      <p className="mobile-chart-hint" aria-hidden="true">최근 기간부터 표시 중 · 좌우로 밀어 전체 기간 보기</p>
      <div className="chart-scroll" ref={scrollRef} tabIndex="0" aria-label="가격 추이 그래프. 모바일에서는 좌우로 밀어 전체 기간을 볼 수 있습니다.">
      <div className="chart-canvas" ref={canvasRef}>
      <svg className="main-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="선택한 기간의 상품별 100g당 가격 추이" onPointerLeave={() => onPoint(null)}>
        <defs>
          <filter id="glow" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        {yTicks.map((tick) => {
          const y = yFor(tick);
          return <g key={tick}><line x1={pad.left} x2={width - pad.right} y1={y} y2={y} className="grid-line" /><text x="5" y={y + 4} textAnchor="start" className="axis-label">{number.format(Math.round(tick))}</text><text x={width - 5} y={y + 4} textAnchor="end" className="axis-label axis-label-mobile">{number.format(Math.round(tick))}</text></g>;
        })}
        {series.keys.map((key, index) => (index % labelStep === 0 || index === series.keys.length - 1) && (
          <text key={key} x={xFor(index)} y={height - 15} textAnchor={index === 0 ? 'start' : index === series.keys.length - 1 ? 'end' : 'middle'} className="axis-label">{formatChartLabel(key, series.unit)}</text>
        ))}
        {series.products.map((product) => {
          const color = seriesColor(product, series.products);
          const dimmed = selectedProduct && product.productId !== selectedProduct;
          const points = product.values.map((value, index) => (Number.isFinite(value) ? [xFor(index), yFor(value), value, index] : null));
          const segments = [];
          let segment = [];
          points.forEach((point) => { if (point) segment.push(point); else if (segment.length) { segments.push(segment); segment = []; } });
          if (segment.length) segments.push(segment);
          return <g key={product.productId} className={dimmed ? 'chart-line is-dimmed' : 'chart-line'}>
            {segments.map((points, index) => <path key={index} d={pathFor(points)} stroke={color} filter={selectedProduct === product.productId ? 'url(#glow)' : undefined} />)}
            {points.filter(Boolean).map(([x, y, value, index]) => <circle key={index} className="chart-hit-point" cx={x} cy={y} r="8" fill="transparent" onPointerEnter={(event) => { event.stopPropagation(); onPoint({ product, value, key: series.keys[index], x, y }); }} onPointerDown={(event) => { event.stopPropagation(); onPoint({ product, value, key: series.keys[index], x, y }); }} onFocus={() => onPoint({ product, value, key: series.keys[index], x, y })} onBlur={() => onPoint(null)} tabIndex="0"><title>{`${shortName(product.name)} · ${formatChartLabel(series.keys[index], series.unit)} · ${number.format(value)}원`}</title></circle>)}
          </g>;
        })}
      </svg>
      </div>
      </div>
    </div>
  );
}

function ChangeAnalysis({ products, dataEndDate }) {
  const rows = products
    .map((product) => ({ product, stats: productStats(product, dataEndDate) }))
    .filter(({ stats }) => stats.change !== null)
    .sort((a, b) => Math.abs(b.stats.changePercent) - Math.abs(a.stats.changePercent));
  const maxPercent = Math.max(...rows.map(({ stats }) => Math.abs(stats.changePercent)), 1);

  return (
    <section className="analysis-card card-surface" aria-labelledby="change-analysis-title">
      <div className="analysis-heading">
        <div><p className="section-kicker">WEEKLY CHANGE</p><h2 id="change-analysis-title">최근 7회 기준 변동</h2></div>
        <p>마지막 가격과 7번째 이전 수집 가격을 비교합니다.</p>
      </div>
      <div className="change-list">
        {rows.map(({ product, stats }) => {
          const positive = stats.change > 0;
          const width = `${Math.max(8, Math.round((Math.abs(stats.changePercent) / maxPercent) * 100))}%`;
          return <div className="change-row" key={product.productId}>
            <span title={product.name}>{shortName(product.name)}</span>
            <div className="change-track" aria-hidden="true"><i className={positive ? 'up' : 'down'} style={{ '--bar-width': width }} /></div>
            <strong className={positive ? 'up' : 'down'}>{positive ? '+' : ''}{stats.changePercent}%</strong>
          </div>;
        })}
      </div>
    </section>
  );
}

function CollectionTimeline({ observations, dataEndDate }) {
  const dates = dateRange(dataEndDate, 14);
  const counts = new Map();
  observations.forEach((item) => counts.set(item.date, (counts.get(item.date) ?? 0) + 1));

  return (
    <section className="collection-card card-surface" aria-labelledby="collection-title">
      <div className="analysis-heading">
        <div><p className="section-kicker">COLLECTION COVERAGE</p><h2 id="collection-title">최근 14일 수집 현황</h2></div>
        <p>칸의 숫자는 해당 날짜에 기록된 가격군 수입니다.</p>
      </div>
      <div className="collection-days">
        {dates.map((date) => {
          const count = counts.get(date) ?? 0;
          return <div className={count ? 'collection-day is-recorded' : 'collection-day'} key={date} title={`${date}: ${count}개 기록`}>
            <time dateTime={date}>{Number(date.slice(5, 7))}.{Number(date.slice(8, 10))}</time>
            <strong>{count || '–'}</strong>
          </div>;
        })}
      </div>
      <p className="collection-note"><i />기록된 날 <b>{dates.filter((date) => counts.has(date)).length}일</b> <span>·</span> <i className="empty" />기록 없음</p>
    </section>
  );
}

function SupplementaryProducts({ products, dataEndDate }) {
  if (!products.length) return null;
  return (
    <section className="supplementary-section" aria-labelledby="supplementary-title">
      <div className="section-heading"><div><p className="section-kicker">ADDITIONAL OBSERVATIONS</p><h2 id="supplementary-title">추가 구성 상품</h2></div><p>기존 가격군과 동일 상품으로 단정할 수 없는 구성은 별도 카드로 수집합니다. 7회 이상의 이력이 쌓이면 변동 분석에도 포함합니다.</p></div>
      <div className="product-grid supplementary-grid">
        {products.sort((a, b) => productStats(a, dataEndDate).latest.price - productStats(b, dataEndDate).latest.price).map((product) => <ProductCard key={product.productId} product={product} dataEndDate={dataEndDate} isSupplementary />)}
      </div>
    </section>
  );
}

function NotificationDialog({ products, onClose }) {
  const [status, setStatus] = useState('');
  const [isWorking, setIsWorking] = useState(false);
  const config = pushConfig();
  const hasPushServer = Boolean(config.subscribeUrl && config.vapidPublicKey);
  const matchingProducts = dealsAtThreshold(products);

  const enableNotifications = async () => {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      setStatus('이 브라우저에서는 웹 알림을 지원하지 않습니다. 최신 Safari, Chrome, 삼성 인터넷 또는 Whale에서 다시 시도해 주세요.');
      return;
    }

    setIsWorking(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus('알림 권한이 허용되지 않았습니다. 브라우저 또는 앱 설정에서 이 사이트의 알림을 허용해 주세요.');
        return;
      }

      let registration = await navigator.serviceWorker.getRegistration();
      if (!registration) registration = await navigator.serviceWorker.register('./service-worker.js');
      registration = await navigator.serviceWorker.ready;
      localStorage.setItem('meat-price-alerts', JSON.stringify({ ...ALERT_THRESHOLDS, enabledAt: new Date().toISOString() }));

      if (matchingProducts.length) {
        const item = matchingProducts[0];
        await registration.showNotification('미트 트래커 가격 조건 충족', {
          body: `${shortName(item.name)} ${number.format(productStats(item).latest.price)}원 / 100g`,
          icon: './pwa-192.png',
          badge: './favicon-object.png',
          tag: 'meat-price-alert-preview',
          data: { url: './' },
        });
      }

      if (!hasPushServer) {
        setStatus('이 기기의 알림 권한을 허용했습니다. 다만 앱이 닫힌 뒤 모든 기기에 가격 알림을 보내려면 푸시 발송 서버 연결이 필요합니다.');
        return;
      }

      const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKeyBytes(config.vapidPublicKey),
      });
      const response = await fetch(config.subscribeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          preferences: { porkAtOrBelow: ALERT_THRESHOLDS.pork, beefAtOrBelow: ALERT_THRESHOLDS.beef },
        }),
      });
      if (!response.ok) throw new Error('구독 정보를 저장하지 못했습니다.');
      setStatus('이 기기를 가격 알림 대상에 등록했습니다. 조건 충족 시 설치된 앱으로 알림을 보냅니다.');
    } catch (notificationError) {
      setStatus(notificationError.message || '알림 설정 중 오류가 발생했습니다.');
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="notification-dialog" role="dialog" aria-modal="true" aria-labelledby="notification-title">
        <button type="button" className="dialog-close" onClick={onClose} aria-label="알림 설정 닫기"><CloseIcon /></button>
        <div className="dialog-icon"><BellIcon /></div>
        <p className="section-kicker">PRICE ALERT</p>
        <h2 id="notification-title">가격 알림 설정</h2>
        <p>삼겹살은 <strong>100g당 1,700원 이하</strong>, 한우는 <strong>100g당 7,000원 이하</strong>일 때 알림을 받습니다.</p>
        <div className="notification-status"><span>{hasPushServer ? '발송 서버 연결됨' : '발송 서버 연결 필요'}</span><b>{matchingProducts.length ? `현재 ${matchingProducts.length}개 상품이 조건을 충족했습니다.` : '현재 조건을 충족한 상품이 없습니다.'}</b></div>
        <button type="button" className="notification-enable" onClick={enableNotifications} disabled={isWorking}>{isWorking ? '알림 설정 중…' : '이 기기 알림 설정'}</button>
        <p className="notification-help">iPhone/iPad에서는 Safari에서 ‘홈 화면에 추가’로 설치한 뒤 앱 안에서 알림을 설정할 수 있습니다.</p>
        {status && <p className="notification-message" role="status">{status}</p>}
      </section>
    </div>
  );
}

export default function App() {
  const [observations, setObservations] = useState([]);
  const [error, setError] = useState('');
  const [rangeDays, setRangeDays] = useState(90);
  const [unit, setUnit] = useState('day');
  const [category, setCategory] = useState('all');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [isNotificationDialogOpen, setIsNotificationDialogOpen] = useState(false);
  const [shareMessage, setShareMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('./history/prices.csv', { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('가격 기록을 불러오지 못했습니다.');
        return response.text();
      })
      .then((text) => { if (!cancelled) setObservations(parseObservations(text)); })
      .catch((loadError) => { if (!cancelled) setError(loadError.message); });
    return () => { cancelled = true; };
  }, []);

  const dataEndDate = useMemo(() => latestDate(observations), [observations]);
  const products = useMemo(() => getProductSeries(observations), [observations]);
  // A card is a current store listing, not an archive entry.  Products that
  // disappeared from the newest collection run stay in the CSV history but
  // are excluded from the dashboard, chart, and analysis.
  const currentProducts = useMemo(() => products.filter((product) => product.observations.at(-1)?.date === dataEndDate), [dataEndDate, products]);
  const coreProducts = useMemo(() => currentProducts.filter((product) => product.isCore), [currentProducts]);
  const supplementaryProducts = useMemo(() => currentProducts.filter((product) => !product.isCore), [currentProducts]);
  const visibleProducts = useMemo(() => coreProducts
    .filter((product) => category === 'all' || product.category === category)
    .sort((a, b) => {
      if (a.category !== b.category) return a.category === 'beef' ? -1 : 1;
      if (a.category === 'beef') return BEEF_CARD_ORDER.indexOf(a.productId) - BEEF_CARD_ORDER.indexOf(b.productId);
      return productStats(a, dataEndDate).latest.price - productStats(b, dataEndDate).latest.price;
    }), [coreProducts, category, dataEndDate]);
  const currentSeries = useMemo(() => ({ ...chartSeries(visibleProducts, unit, rangeDays, dataEndDate), unit }), [visibleProducts, unit, rangeDays, dataEndDate]);
  const windowDates = useMemo(() => dateRange(dataEndDate, 7), [dataEndDate]);
  const overview = useMemo(() => {
    const latestObservations = observations.filter((item) => item.date === dataEndDate);
    const recordedDays = windowDates.filter((date) => observations.some((item) => item.date === date)).length;
    const changes = visibleProducts.map((product) => productStats(product, dataEndDate).change).filter((change) => change !== null);
    return {
      latestCount: latestObservations.length,
      recordedDays,
      beefCount: coreProducts.filter((product) => product.category === 'beef').length,
      porkCount: coreProducts.filter((product) => product.category === 'pork').length,
      rising: changes.filter((change) => change > 0).length,
      falling: changes.filter((change) => change < 0).length,
      supplementaryCount: supplementaryProducts.length,
    };
  }, [coreProducts, dataEndDate, observations, supplementaryProducts, visibleProducts, windowDates]);

  useEffect(() => { setSelectedProduct(null); setHoveredPoint(null); }, [category, rangeDays, unit]);
  useEffect(() => {
    if (!shareMessage) return undefined;
    const timeout = window.setTimeout(() => setShareMessage(''), 3200);
    return () => window.clearTimeout(timeout);
  }, [shareMessage]);

  const shareDashboard = async () => {
    const shareData = {
      title: '미트 트래커',
      text: '한우 등심과 삼겹살의 100g당 가격 추이를 확인하세요.',
      url: window.location.href,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        setShareMessage('공유 메뉴를 열었습니다. 카카오톡을 선택하면 미리보기 이미지와 설명이 함께 표시됩니다.');
      } catch (shareError) {
        if (shareError.name !== 'AbortError') setShareMessage('공유 메뉴를 열지 못했습니다. URL을 복사해 공유해 주세요.');
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareMessage('공유 링크를 복사했습니다. 카카오톡 대화창에 붙여넣어 공유할 수 있습니다.');
    } catch {
      setShareMessage('이 브라우저에서는 자동 복사를 지원하지 않습니다. 주소창의 URL을 복사해 주세요.');
    }
  };

  if (error) return <main className="state-screen"><p>데이터를 불러오지 못했습니다.</p><span>{error}</span></main>;
  if (!observations.length) return <main className="state-screen"><div className="loading-orb" /><p>가격 기록을 불러오는 중입니다</p></main>;

  return (
    <main className="page-shell">
      <header className="masthead">
        <a className="brand" href="./" aria-label="미트 트래커 첫 화면">
          <span className="brand-mark"><MeatIcon /></span>
          <span><small>MEAT TRACKER · PRICE WATCH</small><strong>미트 트래커</strong></span>
        </a>
        <div className="header-utilities">
          <div className="data-status"><span className="live-dot" />마지막 수집 <strong>{formatDate(dataEndDate, { year: 'numeric', month: 'long', day: 'numeric' })}</strong></div>
          <div className="header-actions" aria-label="서비스 도구">
            <a className="header-action megamart-action" href="https://www.megamart.com/" target="_blank" rel="noreferrer"><ExternalIcon />메가마트 가기</a>
            <button type="button" className="header-action" onClick={shareDashboard}><ShareIcon />공유</button>
            <button type="button" className="header-action" onClick={() => setIsNotificationDialogOpen(true)}><BellIcon />알림 설정</button>
          </div>
        </div>
      </header>
      {shareMessage && <div className="share-toast" role="status">{shareMessage}</div>}

      <section className="page-intro">
        <div>
          <p className="eyebrow">MEAT TRACKER · UNIT PRICE</p>
          <h1>한우·삼겹살 가격 추이</h1>
          <p>메가마트 공개 판매가를 상품별로 분리해 100g 단가로 환산한 일별 기록입니다.</p>
        </div>
        <dl className="method-note">
          <div><dt>기록 기준</dt><dd>상품별 1일 1개 가격</dd></div>
          <div><dt>표시 단위</dt><dd>원 / 100g</dd></div>
          <div><dt>그래프 공백</dt><dd>수집 기록이 없는 날짜</dd></div>
        </dl>
      </section>

      <section className="overview-grid" aria-label="가격 기록 요약">
        <article><span>비교 상품군</span><strong>{coreProducts.length}<small>개</small></strong><p>한우 {overview.beefCount}개 · 삼겹살 {overview.porkCount}개 {overview.supplementaryCount ? `· 추가 ${overview.supplementaryCount}개` : ''}</p></article>
        <article><span>최근 관측 가격군</span><strong>{overview.latestCount}<small>개</small></strong><p>{formatDate(dataEndDate, { month: 'long', day: 'numeric' })}에 기록된 가격군</p></article>
        <article><span>최근 7일 기록</span><strong>{overview.recordedDays}<small> / 7일</small></strong><p>기록된 날짜만 선으로 표시합니다</p></article>
        <article><span>최근 7회 가격 변동</span><strong className="movement"><b>↑ {overview.rising}</b><b>↓ {overview.falling}</b></strong><p>비교 가능한 상품 기준</p></article>
      </section>

      <section className="control-deck" aria-label="그래프 필터">
        <div className="segmented" role="group" aria-label="상품군">
          {[['all', '전체'], ['beef', '한우'], ['pork', '삼겹살']].map(([value, label]) => <button key={value} type="button" className={category === value ? `is-selected ${value}` : ''} onClick={() => setCategory(value)} aria-pressed={category === value}>{label}</button>)}
        </div>
        <div className="control-groups">
          <div className="segmented" role="group" aria-label="기간">{RANGE_OPTIONS.map((option) => <button key={option.value} type="button" className={rangeDays === option.value ? 'is-selected' : ''} onClick={() => setRangeDays(option.value)} aria-pressed={rangeDays === option.value}>{option.label}</button>)}</div>
          <div className="segmented subtle" role="group" aria-label="집계 단위">{UNIT_OPTIONS.map((option) => <button key={option.value} type="button" className={unit === option.value ? 'is-selected' : ''} onClick={() => setUnit(option.value)} aria-pressed={unit === option.value}>{option.label}</button>)}</div>
        </div>
      </section>

      <section className="hero-chart card-surface">
        <div className="chart-heading">
          <div><p className="section-kicker">PRICE TREND</p><h2>{category === 'all' ? '전체 상품 흐름' : category === 'beef' ? '한우 등심 흐름' : '국내산 삼겹살 흐름'}</h2></div>
          <div className="legend" aria-label="그래프 범례"><span><i className="legend-dot beef" />한우</span><span><i className="legend-dot pork" />삼겹살</span></div>
        </div>
        <PriceChart series={currentSeries} selectedProduct={selectedProduct} onPoint={setHoveredPoint} />
        <div className="chart-footnote"><span>가격 단위: 원 / 100g · 기록이 없는 날짜는 선으로 연결하지 않습니다.</span><span>{currentSeries.keys.length}개 기간 · 상품 클릭 시 강조</span></div>
        {hoveredPoint && <div className="chart-tooltip"><strong>{shortName(hoveredPoint.product.name)}</strong><span>{formatChartLabel(hoveredPoint.key, unit)} · {number.format(hoveredPoint.value)}원</span></div>}
      </section>

      <section className="product-section">
        <div className="section-heading"><div><p className="section-kicker">LATEST OBSERVATIONS</p><h2>상품별 가격 기록</h2></div></div>
        <div className="product-grid">
          {visibleProducts.map((product) => <ProductCard key={product.productId} product={product} dataEndDate={dataEndDate} isActive={selectedProduct === product.productId} onSelect={() => setSelectedProduct((active) => active === product.productId ? null : product.productId)} />)}
        </div>
      </section>

      {(category === 'all' || category === 'beef') && <SupplementaryProducts products={supplementaryProducts} dataEndDate={dataEndDate} />}

      <section className="analysis-grid">
        <ChangeAnalysis products={visibleProducts} dataEndDate={dataEndDate} />
        <CollectionTimeline observations={observations} dataEndDate={dataEndDate} />
      </section>

      <footer><span>가격은 매일 수집된 공개 판매가를 100g 단위로 환산합니다.</span><a href="https://github.com/pyw31337/meat" target="_blank" rel="noreferrer">데이터와 수집 방식 보기 ↗</a></footer>
      {isNotificationDialogOpen && <NotificationDialog products={coreProducts} onClose={() => setIsNotificationDialogOpen(false)} />}
    </main>
  );
}
